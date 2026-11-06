// One poker room: players, seats, the current hand, buy-back votes, chat and log.
// Pure game/room logic: no sockets. Time comes from `now()` and the global
// setTimeout/clearTimeout (so vi.useFakeTimers() drives it in tests).
import {
  AVATAR_COLORS,
  cardLabel,
  DEFAULT_SETTINGS,
  formatChips,
  LIMITS,
  SESSION_EXPIRED_ERROR,
  TIMING,
  type BuyBackVoteView,
  type Card,
  type ChatMessage,
  type GameSettings,
  type HandPhase,
  type HandView,
  type LedgerRow,
  type LogEntry,
  type LogKind,
  type MeView,
  type NoticePayload,
  type PlayerAction,
  type PublicPlayer,
  type RoomStatus,
  type RoomSummary,
  type RoomView,
  type VoteChoice,
} from '../../shared';
import { createHand, nextButtonSeat, type EngineEvent, type EnginePlayerState, type HandEngine } from '../engine';
import { newPlayerId, newShortId, newToken } from './ids';
import { checkSettings, normalizeName, NAME_ERROR } from './validation';

/** A rule violation with a message that can be shown to the user as-is. */
export class RoomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomError';
  }
}

export type Timing = { [K in keyof typeof TIMING]: number };

export interface RoomOptions {
  id: string;
  /** Initial settings (merged over DEFAULT_SETTINGS and validated). */
  settings?: Partial<GameSettings>;
  timing?: Partial<Timing>;
  now?: () => number;
  /** Test hook: deck order for a hand (undefined = crypto shuffle). */
  deckFactory?: (handNumber: number) => Card[] | undefined;
  /** Randomness for the first button. */
  rand?: () => number;
  /** Called after every state change (the socket layer coalesces broadcasts). */
  onChange?: (room: Room) => void;
}

export interface Outbox {
  log: LogEntry[];
  chat: ChatMessage[];
  notices: { playerId: string; notice: NoticePayload }[];
}

/** Hard cap on active people in one room (players + connected spectators). */
export const MAX_ROOM_MEMBERS = 60;
/** Player records kept before offline never-seated spectators are forgotten. */
const MAX_PLAYER_RECORDS = 200;
const CHAT_KEEP = 100;
const LOG_KEEP = 500;
const SYSTEM_NAME = 'Dealer';

type Timer = ReturnType<typeof setTimeout>;

interface PlayerRec {
  id: string;
  token: string | null;
  name: string;
  color: number;
  seat: number | null;
  /** Chips behind between hands. While dealt into a live hand the engine is authoritative. */
  stack: number;
  /** Has sat down at least once in this game (has a ledger row and has taken the buy-in). */
  hasSat: boolean;
  buyIns: number;
  totalBuyIn: number;
  inRoom: boolean;
  kicked: boolean;
  /** Number of attached sockets. */
  sockets: number;
  /** Explicit sit-out (by choice or after repeated timeouts). */
  sitOut: boolean;
  pendingSeat: number | null;
  timeouts: number;
  cooldownUntil: number | null;
  cooldownTimer: Timer | null;
  joinSeq: number;
}

interface Vote {
  id: string;
  requesterId: string;
  amount: number;
  createdAt: number;
  deadline: number;
  voters: string[];
  votes: Map<string, VoteChoice | null>;
  status: 'pending' | 'approved' | 'rejected';
  resolvedReason: BuyBackVoteView['resolvedReason'];
  resolvedAt: number | null;
  timer: Timer | null;
}

interface HandState {
  engine: HandEngine;
  /** Players dealt into this hand. */
  dealt: Set<string>;
  /** Dealt-in players who stood up / left / were kicked during this hand. */
  left: Set<string>;
  /** Cards voluntarily shown after the hand. */
  shown: Map<string, Card[]>;
  resultApplied: boolean;
  turnActorId: string | null;
  turnKind: 'clock' | 'grace' | null;
  turnDeadline: number | null;
  turnDurationMs: number | null;
  turnTimer: Timer | null;
  advanceTimer: Timer | null;
  nextHandTimer: Timer | null;
}

const PHASE_MAP: Record<HandEngine['phase'], HandPhase> = {
  betting: 'betting',
  roundComplete: 'dealing',
  complete: 'complete',
};

export class Room {
  readonly id: string;
  readonly createdAt: number;
  private readonly timing: Timing;
  private readonly now: () => number;
  private readonly deckFactory?: (handNumber: number) => Card[] | undefined;
  private readonly rand: () => number;
  onChange?: (room: Room) => void;

  private settings: GameSettings;
  private status: RoomStatus = 'lobby';
  private started = false;
  private hostId = '';
  private readonly players = new Map<string, PlayerRec>();
  private readonly tokens = new Map<string, string>();
  private joinSeq = 0;

  private hand: HandState | null = null;
  private handNumber = 0;
  private buttonSeat: number | null = null;

  private votes: Vote[] = [];
  private chat: ChatMessage[] = [];
  private log: LogEntry[] = [];
  private logSeq = 0;
  private outbox: Outbox = { log: [], chat: [], notices: [] };

  private readonly timers = new Set<Timer>();
  private totalSockets = 0;
  /** Since when the host has been offline while someone else is connected (null = not away). */
  private hostAwaySince: number | null = null;
  private hostAwayTimer: Timer | null = null;
  /** Epoch ms since when no socket is attached (null while someone is connected). */
  emptySince: number | null;
  disposed = false;

  constructor(opts: RoomOptions) {
    this.id = opts.id;
    this.timing = { ...TIMING, ...opts.timing };
    this.now = opts.now ?? (() => Date.now());
    this.deckFactory = opts.deckFactory;
    this.rand = opts.rand ?? Math.random;
    this.onChange = opts.onChange;
    const settings: GameSettings = { ...DEFAULT_SETTINGS };
    for (const [k, v] of Object.entries(opts.settings ?? {})) {
      if (v !== undefined && k in DEFAULT_SETTINGS) (settings as unknown as Record<string, unknown>)[k] = v;
    }
    const err = checkSettings(settings, { started: false, currentBuyIn: settings.buyIn, highestUsedSeat: 0 });
    if (err) throw new RoomError(err);
    this.settings = settings;
    this.createdAt = this.now();
    this.emptySince = this.createdAt;
  }

  // =================================================================== membership

  /** Creates the host player, seats them at seat 0 with one buy-in. */
  addHost(rawName: string): { playerId: string; token: string } {
    return this.mutate(() => {
      if (this.hostId) throw new RoomError('This room already has a host');
      const p = this.createPlayer(rawName);
      this.hostId = p.id;
      this.seatPlayer(p, 0);
      this.addLog('info', `${p.name} created the table`);
      return { playerId: p.id, token: p.token! };
    });
  }

  /**
   * Join with a known token (reconnect: same player, seat, stack, cards) or with a name
   * (new spectator).
   */
  join(input: { token?: string; name?: string }): { playerId: string; token: string; reconnected: boolean } {
    return this.mutate(() => {
      const known = input.token ? this.tokens.get(input.token) : undefined;
      const existing = known ? this.players.get(known) : undefined;
      if (existing && !existing.kicked && existing.token) {
        if (!existing.inRoom) {
          if (this.memberCount() >= MAX_ROOM_MEMBERS) throw new RoomError('This room is full');
          existing.inRoom = true;
          existing.color = this.pickColor(existing.id, existing.color);
          this.addLog('info', `${existing.name} came back`);
          this.systemChat(`${existing.name} came back`);
        }
        this.ensureHostPresent(existing);
        return { playerId: existing.id, token: existing.token, reconnected: true };
      }
      if (input.name === undefined) {
        throw new RoomError(input.token ? SESSION_EXPIRED_ERROR : NAME_ERROR);
      }
      if (this.memberCount() >= MAX_ROOM_MEMBERS) throw new RoomError('This room is full');
      this.pruneGhosts();
      const p = this.createPlayer(input.name);
      this.addLog('info', `${p.name} joined`);
      this.systemChat(`${p.name} joined`);
      this.ensureHostPresent(p);
      return { playerId: p.id, token: p.token!, reconnected: false };
    });
  }

  /** A socket for this player connected. */
  attach(playerId: string): void {
    this.mutate(() => {
      const p = this.players.get(playerId);
      if (!p) return;
      p.sockets++;
      this.totalSockets++;
      this.emptySince = null;
      if (p.sockets === 1) this.onConnectionChange(p);
    });
  }

  /** A socket for this player went away. */
  detach(playerId: string): void {
    if (this.disposed) return;
    this.mutate(() => {
      const p = this.players.get(playerId);
      if (!p || p.sockets <= 0) return;
      p.sockets--;
      this.totalSockets = Math.max(0, this.totalSockets - 1);
      if (this.totalSockets === 0) this.emptySince = this.now();
      if (p.sockets === 0) this.onConnectionChange(p);
    });
  }

  connectedSockets(): number {
    return this.totalSockets;
  }

  /** Leave the room entirely. The record and token are kept so the player can return. */
  leave(playerId: string): void {
    this.mutate(() => {
      const p = this.member(playerId);
      this.vacate(p);
      p.inRoom = false;
      this.addLog('info', `${p.name} left the room`);
      this.systemChat(`${p.name} left`);
      if (this.hostId === p.id) this.passHost(p);
    });
  }

  rename(playerId: string, rawName: string): void {
    this.mutate(() => {
      const p = this.member(playerId);
      const base = normalizeName(rawName);
      if (!base || base.length > LIMITS.nameMaxLength) throw new RoomError(NAME_ERROR);
      if (base === p.name) return;
      const name = this.uniqueName(base, p.id);
      const old = p.name;
      p.name = name;
      this.addLog('info', `${old} is now ${name}`);
    });
  }

  // =================================================================== seats

  takeSeat(playerId: string, seat: number): { pending: boolean } {
    return this.mutate(() => {
      const p = this.member(playerId);
      if (p.seat !== null) throw new RoomError('You are already seated');
      if (p.pendingSeat !== null) throw new RoomError('You already asked for a seat — waiting for the host');
      if (!Number.isInteger(seat) || seat < 0 || seat >= this.settings.maxPlayers) {
        throw new RoomError('That seat does not exist');
      }
      if (this.freeSeats().length === 0) throw new RoomError('Table is full — you can watch until a seat opens');
      if (this.seatOccupant(seat) || this.seatReservedBy(seat)) throw new RoomError('That seat is taken');
      if (this.settings.requireApproval && p.id !== this.hostId) {
        p.pendingSeat = seat;
        this.addLog('info', `${p.name} asked to sit down`);
        this.notify(this.hostId, 'info', `${p.name} wants to sit down`);
        return { pending: true };
      }
      this.seatPlayer(p, seat);
      return { pending: false };
    });
  }

  /** Stand up (become a spectator), or cancel a pending seat request. */
  standUp(playerId: string): void {
    this.mutate(() => {
      const p = this.member(playerId);
      if (p.seat === null) {
        if (p.pendingSeat !== null) {
          p.pendingSeat = null;
          this.addLog('info', `${p.name} withdrew their seat request`);
          return;
        }
        throw new RoomError('You are not seated');
      }
      this.vacate(p);
      this.addLog('info', `${p.name} stood up`);
    });
  }

  setSitOut(playerId: string, sittingOut: boolean): void {
    this.mutate(() => {
      const p = this.member(playerId);
      if (p.seat === null) throw new RoomError('Take a seat first');
      if (p.sitOut === sittingOut) return;
      p.sitOut = sittingOut;
      if (!sittingOut) p.timeouts = 0;
      this.addLog('info', sittingOut ? `${p.name} is sitting out` : `${p.name} is back`);
    });
  }

  // =================================================================== hand play

  act(playerId: string, action: PlayerAction): void {
    this.mutate(() => {
      const p = this.member(playerId);
      const h = this.hand;
      if (!h || h.resultApplied) throw new RoomError('There is no hand in progress');
      if (!h.dealt.has(p.id) || h.left.has(p.id)) throw new RoomError('You are not in this hand');
      const res = h.engine.act(p.id, action);
      if (!res.ok) throw new RoomError(res.error);
      p.timeouts = 0;
      this.afterEngine();
    });
  }

  showCards(playerId: string): void {
    this.mutate(() => {
      const p = this.member(playerId);
      if (!this.canShow(p.id)) throw new RoomError('You can show your cards once the hand is over');
      const h = this.hand!;
      const cards = h.engine.getPlayer(p.id)!.holeCards;
      h.shown.set(p.id, [...cards]);
      this.addLog('action', `${p.name} shows ${cards.map(cardLabel).join(' ')}`, h.engine.handNumber);
    });
  }

  // =================================================================== buy-back votes

  requestBuyBack(playerId: string): { voteId: string } {
    return this.mutate(() => {
      const p = this.member(playerId);
      const block = this.buyBackBlock(p);
      if (block) throw new RoomError(block);
      const now = this.now();
      const voters = [...this.players.values()]
        .filter((o) => o.seat !== null && o.id !== p.id)
        .sort((a, b) => a.seat! - b.seat!)
        .map((o) => o.id);
      const v: Vote = {
        id: newShortId(),
        requesterId: p.id,
        amount: this.settings.buyIn,
        createdAt: now,
        deadline: now + this.settings.buyBackVoteSec * 1000,
        voters,
        votes: new Map(voters.map((id) => [id, null])),
        status: 'pending',
        resolvedReason: null,
        resolvedAt: null,
        timer: null,
      };
      this.votes.push(v);
      if (voters.length === 0) {
        this.resolveVote(v, 'approved', 'unanimous');
        return { voteId: v.id };
      }
      const msg = `${p.name} wants to buy back in for ${formatChips(v.amount)} — everyone at the table must agree within ${this.settings.buyBackVoteSec}s`;
      this.addLog('buyback', msg);
      this.systemChat(msg);
      v.timer = this.schedule(v.deadline - now, () => {
        v.timer = null;
        if (v.status === 'pending') this.resolveVote(v, 'rejected', 'timeout');
      });
      return { voteId: v.id };
    });
  }

  voteBuyBack(playerId: string, voteId: string, approve: boolean): void {
    this.mutate(() => {
      const p = this.member(playerId);
      const v = this.votes.find((x) => x.id === voteId);
      if (!v) throw new RoomError('That vote is over');
      if (v.status !== 'pending') throw new RoomError('That vote is already over');
      if (!v.votes.has(p.id)) throw new RoomError('You are not voting on this request');
      if (v.votes.get(p.id) !== null) throw new RoomError('You already voted');
      v.votes.set(p.id, approve ? 'yes' : 'no');
      this.evaluateVote(v);
    });
  }

  cancelBuyBack(playerId: string, voteId: string): void {
    this.mutate(() => {
      const p = this.member(playerId);
      const v = this.votes.find((x) => x.id === voteId);
      if (!v || v.status !== 'pending') throw new RoomError('That vote is already over');
      if (v.requesterId !== p.id) throw new RoomError('Only the player who asked can cancel');
      this.resolveVote(v, 'rejected', 'cancelled');
    });
  }

  // =================================================================== chat

  sendChat(playerId: string, text: string): ChatMessage {
    return this.mutate(() => {
      const p = this.member(playerId);
      const t = text.trim();
      if (!t) throw new RoomError('Message is empty');
      if (t.length > LIMITS.chatMaxLength) throw new RoomError(`Messages can be at most ${LIMITS.chatMaxLength} characters`);
      const m: ChatMessage = { id: newShortId(), playerId: p.id, name: p.name, text: t, ts: this.now(), system: false };
      this.pushChat(m);
      return m;
    });
  }

  // =================================================================== host controls

  start(playerId: string): void {
    this.mutate(() => {
      this.requireHost(playerId);
      if (this.status !== 'lobby') throw new RoomError('The game is already running');
      if (this.eligiblePlayers().length < 2) {
        throw new RoomError('You need at least 2 players sitting in with chips to start');
      }
      this.status = 'running';
      this.addLog('info', 'The game has started');
    });
  }

  pause(playerId: string): void {
    this.mutate(() => {
      this.requireHost(playerId);
      if (this.status === 'lobby') throw new RoomError('The game has not started yet');
      if (this.status === 'paused') throw new RoomError('The game is already paused');
      this.status = 'paused';
      const live = this.hand && !this.hand.resultApplied;
      this.addLog('info', live ? 'Host paused the game — this hand will finish first' : 'Host paused the game');
    });
  }

  resume(playerId: string): void {
    this.mutate(() => {
      this.requireHost(playerId);
      if (this.status !== 'paused') throw new RoomError('The game is not paused');
      this.status = 'running';
      this.addLog('info', 'Host resumed the game');
    });
  }

  updateSettings(playerId: string, patch: Partial<GameSettings>): void {
    this.mutate(() => {
      this.requireHost(playerId);
      const clean: Partial<GameSettings> = {};
      for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof GameSettings)[]) {
        if (patch[k] !== undefined) (clean as Record<string, unknown>)[k] = patch[k];
      }
      const next: GameSettings = { ...this.settings, ...clean };
      const err = checkSettings(next, {
        started: this.started,
        currentBuyIn: this.settings.buyIn,
        highestUsedSeat: this.highestUsedSeat(),
      });
      if (err) throw new RoomError(err);
      const prev = this.settings;
      this.settings = next;
      this.logSettingsChange(prev, next);
      if (prev.allowBuyBack && !next.allowBuyBack) {
        for (const v of this.votes) if (v.status === 'pending') this.resolveVote(v, 'rejected', 'cancelled');
      }
    });
  }

  approveSeat(playerId: string, targetId: string, approve: boolean): void {
    this.mutate(() => {
      this.requireHost(playerId);
      const t = this.players.get(targetId);
      if (!t || !t.inRoom || t.pendingSeat === null || t.seat !== null) {
        throw new RoomError('That seat request is no longer open');
      }
      if (!approve) {
        t.pendingSeat = null;
        this.addLog('info', `Host declined ${t.name}'s seat request`);
        this.notify(t.id, 'error', 'The host declined your seat request');
        return;
      }
      const wanted = t.pendingSeat;
      t.pendingSeat = null;
      let seat: number | null = wanted;
      if (wanted >= this.settings.maxPlayers || this.seatOccupant(wanted) || this.seatReservedBy(wanted)) {
        seat = this.freeSeats()[0] ?? null;
      }
      if (seat === null) {
        t.pendingSeat = wanted;
        throw new RoomError('Table is full — no free seat for this player');
      }
      this.seatPlayer(t, seat);
      this.notify(t.id, 'success', 'Host approved your seat');
    });
  }

  kick(playerId: string, targetId: string): void {
    this.mutate(() => {
      this.requireHost(playerId);
      if (targetId === playerId) throw new RoomError('You can’t remove yourself');
      const t = this.players.get(targetId);
      if (!t || t.kicked) throw new RoomError('Player not found');
      this.vacate(t);
      t.inRoom = false;
      t.kicked = true;
      if (t.token) this.tokens.delete(t.token);
      t.token = null;
      this.addLog('info', `Host removed ${t.name} from the room`);
      this.systemChat(`${t.name} was removed by the host`);
    });
  }

  transferHost(playerId: string, targetId: string): void {
    this.mutate(() => {
      this.requireHost(playerId);
      const t = this.players.get(targetId);
      if (!t || !t.inRoom) throw new RoomError('That player is not in the room');
      if (t.id === playerId) throw new RoomError('You are already the host');
      this.hostId = t.id;
      this.addLog('info', `${t.name} is now the host`);
      this.notify(t.id, 'success', 'You are now the host');
    });
  }

  rematch(playerId: string): void {
    this.mutate(() => {
      this.requireHost(playerId);
      const h = this.hand;
      if (h && !h.resultApplied) throw new RoomError('Wait for the current hand to finish');
      if (h) this.clearHand();
      for (const v of this.votes) this.cancelTimer(v.timer);
      this.votes = [];
      const buyIn = this.settings.buyIn;
      for (const p of this.players.values()) {
        this.cancelTimer(p.cooldownTimer);
        p.cooldownTimer = null;
        p.cooldownUntil = null;
        p.timeouts = 0;
        if (p.seat !== null) {
          p.hasSat = true;
          p.stack = buyIn;
          p.buyIns = 1;
          p.totalBuyIn = buyIn;
        } else {
          p.hasSat = false;
          p.stack = 0;
          p.buyIns = 0;
          p.totalBuyIn = 0;
        }
      }
      this.handNumber = 0;
      this.buttonSeat = null;
      this.status = 'lobby';
      this.started = false;
      const msg = `New game! Everyone at the table starts again with ${formatChips(buyIn)}`;
      this.addLog('info', msg);
      this.systemChat(msg);
    });
  }

  // =================================================================== read side

  getSettings(): GameSettings {
    return { ...this.settings };
  }

  getStatus(): RoomStatus {
    return this.status;
  }

  getHostId(): string {
    return this.hostId;
  }

  hasPlayer(playerId: string): boolean {
    const p = this.players.get(playerId);
    return !!p && p.inRoom && !p.kicked;
  }

  playerIdForToken(token: string): string | null {
    return this.tokens.get(token) ?? null;
  }

  history(): { chat: ChatMessage[]; log: LogEntry[] } {
    return { chat: this.chat.map((m) => ({ ...m })), log: this.log.map((e) => ({ ...e })) };
  }

  drainOutbox(): Outbox {
    const out = this.outbox;
    this.outbox = { log: [], chat: [], notices: [] };
    return out;
  }

  summary(): RoomSummary {
    return {
      roomId: this.id,
      hostName: this.players.get(this.hostId)?.name ?? 'Someone',
      seated: [...this.players.values()].filter((p) => p.seat !== null).length,
      maxPlayers: this.settings.maxPlayers,
      smallBlind: this.settings.smallBlind,
      bigBlind: this.settings.bigBlind,
      buyIn: this.settings.buyIn,
      status: this.status,
      started: this.started,
    };
  }

  /** Personalised snapshot. Never contains another player's face-down cards. */
  viewFor(playerId: string): RoomView {
    const meRec = this.players.get(playerId);
    if (!meRec || meRec.kicked) throw new RoomError('You are not in this room');
    const now = this.now();
    const h = this.hand;
    const e = h?.engine;
    const eps = new Map<string, EnginePlayerState>((e?.players ?? []).map((p) => [p.id, p]));
    const faceUp = e ? e.faceUpCards() : {};

    const seats: (string | null)[] = new Array<string | null>(this.settings.maxPlayers).fill(null);
    for (const p of this.players.values()) if (p.seat !== null && p.seat < seats.length) seats[p.seat] = p.id;

    const visible = [...this.players.values()]
      .filter(
        (p) =>
          p.inRoom &&
          !p.kicked &&
          (p.seat !== null || p.pendingSeat !== null || p.sockets > 0 || p.id === this.hostId || p.id === playerId),
      )
      .sort((a, b) => a.joinSeq - b.joinSeq);

    const players: PublicPlayer[] = visible.map((p) => {
      const inHand = !!h && h.dealt.has(p.id) && !h.left.has(p.id);
      const ep = inHand ? eps.get(p.id) : undefined;
      const shown = inHand ? (faceUp[p.id] ?? h!.shown.get(p.id) ?? null) : null;
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        seat: p.seat,
        stack: this.stackBehind(p, eps),
        isHost: p.id === this.hostId,
        connected: p.sockets > 0,
        sittingOut: p.sitOut || p.sockets === 0,
        pendingSeat: p.seat === null ? p.pendingSeat : null,
        buyIns: p.buyIns,
        busted: this.isBusted(p, eps),
        inHand,
        folded: ep?.folded ?? false,
        allIn: ep?.allIn ?? false,
        bet: ep && !h!.resultApplied ? ep.streetBet : 0,
        hasCards: !!ep && !ep.folded,
        shownCards: shown ? [...shown] : null,
        lastAction: ep?.lastAction ? { ...ep.lastAction } : null,
        timeouts: p.timeouts,
      };
    });

    let hand: HandView | null = null;
    if (h && e) {
      hand = {
        handNumber: e.handNumber,
        street: e.street,
        phase: PHASE_MAP[e.phase],
        board: e.board,
        pots: e.pots.map((pot) => ({ amount: pot.amount, eligiblePlayerIds: [...pot.eligible] })),
        totalPot: e.totalPot(),
        dealerSeat: e.dealerSeat,
        smallBlindSeat: e.smallBlind > 0 ? e.smallBlindSeat : null,
        bigBlindSeat: e.bigBlindSeat,
        smallBlind: e.smallBlind,
        bigBlind: e.bigBlind,
        toActPlayerId: e.phase === 'betting' ? e.toActId : null,
        turnDeadline: e.phase === 'betting' ? h.turnDeadline : null,
        turnDurationMs: e.phase === 'betting' ? h.turnDurationMs : null,
        currentBet: e.currentBet,
        minRaiseTo: e.minRaiseTo,
        winners: e.result ? e.result.winners.map((w) => ({ ...w, bestCards: w.bestCards ? [...w.bestCards] : null })) : null,
        runout: e.isRunout(),
      };
    }

    const buyBackVotes: BuyBackVoteView[] = this.votes.map((v) => ({
      id: v.id,
      requesterId: v.requesterId,
      requesterName: this.nameOf(v.requesterId),
      amount: v.amount,
      createdAt: v.createdAt,
      deadline: v.deadline,
      votes: Object.fromEntries(v.voters.map((id) => [id, v.votes.get(id) ?? null])),
      status: v.status,
      resolvedReason: v.resolvedReason,
      resolvedAt: v.resolvedAt,
    }));

    const ledger: LedgerRow[] = [...this.players.values()]
      .filter((p) => p.hasSat)
      .sort((a, b) => a.joinSeq - b.joinSeq)
      .map((p) => {
        const stack = this.currentChips(p, eps);
        return {
          playerId: p.id,
          name: p.name,
          buyIns: p.buyIns,
          totalBuyIn: p.totalBuyIn,
          stack,
          net: stack - p.totalBuyIn,
          inRoom: p.inRoom && !p.kicked,
        };
      });

    const myInHand = !!h && h.dealt.has(meRec.id);
    const me: MeView = {
      playerId: meRec.id,
      name: meRec.name,
      isHost: meRec.id === this.hostId,
      seat: meRec.seat,
      holeCards: myInHand && eps.get(meRec.id) ? [...eps.get(meRec.id)!.holeCards] : null,
      legal: e && myInHand && !h!.left.has(meRec.id) ? e.legalActions(meRec.id) : null,
      canRequestBuyBack: this.buyBackBlock(meRec) === null,
      buyBackCooldownUntil: meRec.cooldownUntil !== null && meRec.cooldownUntil > now ? meRec.cooldownUntil : null,
      votesAwaitingMe: this.votes
        .filter((v) => v.status === 'pending' && v.votes.has(meRec.id) && v.votes.get(meRec.id) === null)
        .map((v) => v.id),
      canShowCards: this.canShow(meRec.id),
    };

    return {
      roomId: this.id,
      serverTime: now,
      status: this.status,
      settings: { ...this.settings },
      started: this.started,
      hostId: this.hostId,
      seats,
      players,
      hand,
      buyBackVotes,
      ledger,
      gameOverWinnerId: this.gameOverWinnerId(),
      me,
    };
  }

  /** Clears every timer; the room becomes inert. */
  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.onChange = undefined;
  }

  // =================================================================== internals: mutation + timers

  private mutate<T>(fn: () => T): T {
    if (this.disposed) throw new RoomError('This room has closed');
    const result = fn();
    this.maybeStartHand();
    this.syncHostAway();
    this.onChange?.(this);
    return result;
  }

  private schedule(ms: number, fn: () => void): Timer {
    const t = setTimeout(
      () => {
        this.timers.delete(t);
        if (this.disposed) return;
        try {
          this.mutate(fn);
        } catch (err) {
          console.error(`[room ${this.id}] timer error`, err);
        }
      },
      Math.max(0, ms),
    );
    (t as { unref?: () => void }).unref?.();
    this.timers.add(t);
    return t;
  }

  private cancelTimer(t: Timer | null | undefined): void {
    if (!t) return;
    clearTimeout(t);
    this.timers.delete(t);
  }

  // =================================================================== internals: players

  private createPlayer(rawName: string): PlayerRec {
    const base = normalizeName(rawName);
    if (!base || base.length > LIMITS.nameMaxLength) throw new RoomError(NAME_ERROR);
    const id = newPlayerId();
    const token = newToken();
    const p: PlayerRec = {
      id,
      token,
      name: this.uniqueName(base, null),
      color: this.pickColor(id, null),
      seat: null,
      stack: 0,
      hasSat: false,
      buyIns: 0,
      totalBuyIn: 0,
      inRoom: true,
      kicked: false,
      sockets: 0,
      sitOut: false,
      pendingSeat: null,
      timeouts: 0,
      cooldownUntil: null,
      cooldownTimer: null,
      joinSeq: ++this.joinSeq,
    };
    this.players.set(id, p);
    this.tokens.set(token, id);
    return p;
  }

  private uniqueName(base: string, selfId: string | null): string {
    const taken = new Set<string>();
    for (const p of this.players.values()) if (p.id !== selfId) taken.add(p.name.toLowerCase());
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) {
      const suffix = ` ${n}`;
      const candidate = base.slice(0, LIMITS.nameMaxLength - suffix.length).trimEnd() + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private pickColor(selfId: string, current: number | null): number {
    const used = new Set<number>();
    for (const p of this.players.values()) if (p.id !== selfId && p.inRoom && !p.kicked) used.add(p.color);
    if (current !== null && !used.has(current)) return current;
    for (let i = 0; i < AVATAR_COLORS.length; i++) if (!used.has(i)) return i;
    return this.joinSeq % AVATAR_COLORS.length;
  }

  private member(playerId: string): PlayerRec {
    const p = this.players.get(playerId);
    if (!p || !p.inRoom || p.kicked) throw new RoomError('You are not in this room');
    return p;
  }

  private requireHost(playerId: string): PlayerRec {
    const p = this.member(playerId);
    if (p.id !== this.hostId) throw new RoomError('Only the host can do that');
    return p;
  }

  /** People counted against MAX_ROOM_MEMBERS: connected, seated, waiting for a seat, or with chips history. */
  private memberCount(): number {
    let n = 0;
    for (const p of this.players.values()) {
      if (!p.inRoom || p.kicked) continue;
      if (p.sockets > 0 || p.seat !== null || p.pendingSeat !== null || p.hasSat || p.id === this.hostId) n++;
    }
    return n;
  }

  /** Forgets offline spectators who never sat down once the room has accumulated many records. */
  private pruneGhosts(): void {
    if (this.players.size <= MAX_PLAYER_RECORDS) return;
    for (const p of [...this.players.values()]) {
      if (p.sockets > 0 || p.hasSat || p.seat !== null || p.pendingSeat !== null || p.id === this.hostId) continue;
      if (p.token) this.tokens.delete(p.token);
      this.players.delete(p.id);
    }
  }

  private nameOf(id: string): string {
    return this.players.get(id)?.name ?? 'Someone';
  }

  /** If the current host is gone (left/kicked), `candidate` takes over. */
  private ensureHostPresent(candidate: PlayerRec): void {
    const host = this.players.get(this.hostId);
    if (host && host.inRoom && !host.kicked) return;
    this.hostId = candidate.id;
    this.addLog('info', `${candidate.name} is now the host`);
  }

  /** Host left: next seated connected player clockwise, else any connected player. */
  private passHost(old: PlayerRec): void {
    const inRoom = [...this.players.values()].filter((p) => p.inRoom && !p.kicked && p.id !== old.id);
    const seated = inRoom.filter((p) => p.seat !== null && p.sockets > 0).sort((a, b) => a.seat! - b.seat!);
    const from = this.lastSeatOf.get(old.id) ?? -1;
    const next =
      seated.find((p) => p.seat! > from) ??
      seated[0] ??
      inRoom.filter((p) => p.sockets > 0).sort((a, b) => a.joinSeq - b.joinSeq)[0] ??
      inRoom.sort((a, b) => a.joinSeq - b.joinSeq)[0];
    if (!next) return; // nobody to pass to; the next person to join becomes host
    this.hostId = next.id;
    this.addLog('info', `${next.name} is now the host`);
    this.notify(next.id, 'success', 'You are now the host');
  }

  private readonly lastSeatOf = new Map<string, number>();

  /**
   * Host-away handover: once the host has been disconnected for `hostAwayTransferMs` while at
   * least one other member is connected, the next connected player (clockwise from the host's
   * seat) becomes host. Runs after every mutation; the timer only exists to trigger a re-check.
   */
  private syncHostAway(): void {
    const host = this.players.get(this.hostId);
    const othersOnline = [...this.players.values()].some(
      (p) => p.id !== this.hostId && p.inRoom && !p.kicked && p.sockets > 0,
    );
    const away = !!host && host.inRoom && !host.kicked && host.sockets === 0 && othersOnline;
    if (!away) {
      this.hostAwaySince = null;
      this.cancelTimer(this.hostAwayTimer);
      this.hostAwayTimer = null;
      return;
    }
    const now = this.now();
    if (this.hostAwaySince === null) this.hostAwaySince = now;
    const due = this.hostAwaySince + this.timing.hostAwayTransferMs;
    if (now >= due) {
      this.cancelTimer(this.hostAwayTimer);
      this.hostAwayTimer = null;
      this.hostAwaySince = null;
      this.handOverFromAwayHost(host!);
      return;
    }
    if (!this.hostAwayTimer) {
      this.hostAwayTimer = this.schedule(due - now, () => {
        this.hostAwayTimer = null; // mutate() -> syncHostAway() re-checks
      });
    }
  }

  private handOverFromAwayHost(old: PlayerRec): void {
    const online = [...this.players.values()].filter((p) => p.id !== old.id && p.inRoom && !p.kicked && p.sockets > 0);
    const seated = online.filter((p) => p.seat !== null).sort((a, b) => a.seat! - b.seat!);
    const from = old.seat ?? this.lastSeatOf.get(old.id) ?? -1;
    const next = seated.find((p) => p.seat! > from) ?? seated[0] ?? online.sort((a, b) => a.joinSeq - b.joinSeq)[0];
    if (!next) return;
    this.hostId = next.id;
    this.addLog('info', `${old.name} is away — ${next.name} is now the host`);
    this.notify(next.id, 'success', 'You are now the host');
  }

  private onConnectionChange(p: PlayerRec): void {
    const h = this.hand;
    if (!h || h.resultApplied || h.turnActorId !== p.id) return;
    if (p.sockets === 0 && h.turnKind === null) {
      this.startGrace(h, p.id);
    } else if (p.sockets > 0 && h.turnKind === 'grace') {
      this.cancelTimer(h.turnTimer);
      h.turnTimer = null;
      h.turnKind = null;
      h.turnDeadline = null;
      h.turnDurationMs = null;
    }
  }

  // =================================================================== internals: seats

  private seatOccupant(seat: number): PlayerRec | undefined {
    for (const p of this.players.values()) if (p.seat === seat) return p;
    return undefined;
  }

  private seatReservedBy(seat: number): PlayerRec | undefined {
    for (const p of this.players.values()) if (p.seat === null && p.pendingSeat === seat && p.inRoom && !p.kicked) return p;
    return undefined;
  }

  private freeSeats(): number[] {
    const out: number[] = [];
    for (let s = 0; s < this.settings.maxPlayers; s++) if (!this.seatOccupant(s) && !this.seatReservedBy(s)) out.push(s);
    return out;
  }

  /** Highest seat that is occupied, reserved by a pending request, or used by the live hand. */
  private highestUsedSeat(): number {
    let hi = -1;
    for (const p of this.players.values()) {
      if (p.seat !== null) hi = Math.max(hi, p.seat);
      if (p.seat === null && p.pendingSeat !== null && p.inRoom && !p.kicked) hi = Math.max(hi, p.pendingSeat);
    }
    const h = this.hand;
    if (h && !h.resultApplied) for (const ep of h.engine.players) hi = Math.max(hi, ep.seat);
    return hi;
  }

  private seatPlayer(p: PlayerRec, seat: number): void {
    const first = !p.hasSat;
    if (first) {
      p.hasSat = true;
      p.stack = this.settings.buyIn;
      p.buyIns = 1;
      p.totalBuyIn += this.settings.buyIn;
    }
    p.seat = seat;
    p.pendingSeat = null;
    p.sitOut = false;
    p.timeouts = 0;
    this.lastSeatOf.set(p.id, seat);
    const behind = this.stackBehind(p, this.enginePlayers());
    if (first) this.addLog('info', `${p.name} sat down with ${formatChips(behind)}`);
    else if (behind > 0) this.addLog('info', `${p.name} sat back down with ${formatChips(behind)}`);
    else this.addLog('info', `${p.name} sat back down with no chips`);
  }

  /** Removes a player from their seat (folding a live hand) and from buy-back votes. */
  private vacate(p: PlayerRec): void {
    p.pendingSeat = null;
    const h = this.hand;
    if (h && h.dealt.has(p.id) && !h.left.has(p.id)) {
      h.left.add(p.id);
      if (!h.resultApplied) {
        const ep = h.engine.getPlayer(p.id);
        if (ep && !ep.folded) {
          h.engine.forceFold(p.id);
          this.afterEngine();
        }
      }
    }
    if (p.seat !== null) this.lastSeatOf.set(p.id, p.seat);
    p.seat = null;
    for (const v of this.votes) {
      if (v.status !== 'pending') continue;
      if (v.requesterId === p.id) {
        this.resolveVote(v, 'rejected', 'cancelled');
      } else if (v.votes.has(p.id)) {
        v.votes.delete(p.id);
        v.voters = v.voters.filter((id) => id !== p.id);
        this.evaluateVote(v);
      }
    }
  }

  private enginePlayers(): Map<string, EnginePlayerState> {
    return new Map((this.hand?.engine.players ?? []).map((ep) => [ep.id, ep]));
  }

  /** Chips behind (excluding chips committed in a live hand). */
  private stackBehind(p: PlayerRec, eps: Map<string, EnginePlayerState>): number {
    const h = this.hand;
    if (h && !h.resultApplied && h.dealt.has(p.id)) return eps.get(p.id)?.stack ?? p.stack;
    return p.stack;
  }

  /** Chips behind + chips committed in the live hand (ledger "stack"). */
  private currentChips(p: PlayerRec, eps: Map<string, EnginePlayerState>): number {
    const h = this.hand;
    if (h && !h.resultApplied && h.dealt.has(p.id)) {
      const ep = eps.get(p.id);
      if (ep) return ep.stack + ep.totalCommitted;
    }
    return p.stack;
  }

  /** Dealt into an unfinished hand and still holding cards. */
  private isInvolved(p: PlayerRec, eps: Map<string, EnginePlayerState>): boolean {
    const h = this.hand;
    if (!h || h.resultApplied || !h.dealt.has(p.id) || h.left.has(p.id)) return false;
    return !(eps.get(p.id)?.folded ?? true);
  }

  private isBusted(p: PlayerRec, eps: Map<string, EnginePlayerState>): boolean {
    return p.seat !== null && this.stackBehind(p, eps) === 0 && !this.isInvolved(p, eps);
  }

  private eligiblePlayers(): PlayerRec[] {
    return [...this.players.values()]
      .filter((p) => p.seat !== null && p.inRoom && !p.kicked && p.stack > 0 && !p.sitOut && p.sockets > 0 && p.pendingSeat === null)
      .sort((a, b) => a.seat! - b.seat!);
  }

  private gameOverWinnerId(): string | null {
    if (!this.started || this.hand) return null;
    const withChips = [...this.players.values()].filter((p) => p.seat !== null && p.stack > 0);
    if (withChips.length >= 2) return null;
    return withChips[0]?.id ?? null;
  }

  private canShow(playerId: string): boolean {
    const h = this.hand;
    if (!h || !h.resultApplied || !h.dealt.has(playerId) || h.left.has(playerId)) return false;
    if (h.shown.has(playerId)) return false;
    return !h.engine.faceUpCards()[playerId];
  }

  // =================================================================== internals: buy-back

  /** Why `p` cannot request a buy-back right now (null = allowed). */
  private buyBackBlock(p: PlayerRec): string | null {
    if (!this.settings.allowBuyBack) return 'Buy-backs are turned off at this table';
    if (p.seat === null) return 'Take a seat first';
    const h = this.hand;
    if (h && !h.resultApplied && h.dealt.has(p.id)) return 'Wait until this hand is over';
    if (p.stack > 0) return 'You can only buy back in once you are out of chips';
    if (this.votes.some((v) => v.status === 'pending' && v.requesterId === p.id)) {
      return 'You already asked — waiting for everyone to vote';
    }
    const now = this.now();
    if (p.cooldownUntil !== null && p.cooldownUntil > now) {
      return `You can ask again in ${Math.ceil((p.cooldownUntil - now) / 1000)}s`;
    }
    return null;
  }

  private evaluateVote(v: Vote): void {
    if (v.status !== 'pending') return;
    const choices = v.voters.map((id) => v.votes.get(id) ?? null);
    if (choices.includes('no')) this.resolveVote(v, 'rejected', 'declined');
    else if (choices.every((c) => c === 'yes')) this.resolveVote(v, 'approved', 'unanimous');
  }

  private resolveVote(v: Vote, status: 'approved' | 'rejected', reason: NonNullable<Vote['resolvedReason']>): void {
    if (v.status !== 'pending') return;
    this.cancelTimer(v.timer);
    v.timer = null;
    v.status = status;
    v.resolvedReason = reason;
    v.resolvedAt = this.now();
    const p = this.players.get(v.requesterId);
    const name = this.nameOf(v.requesterId);
    let msg: string;
    if (status === 'approved' && p) {
      p.stack += v.amount;
      p.buyIns += 1;
      p.totalBuyIn += v.amount;
      msg =
        v.voters.length === 0
          ? `${name} bought back in for ${formatChips(v.amount)}`
          : `${name} bought back in for ${formatChips(v.amount)} — everyone agreed`;
      this.notify(p.id, 'success', `You're back in with ${formatChips(v.amount)}`);
    } else if (reason === 'declined') {
      const naysayers = v.voters.filter((id) => v.votes.get(id) === 'no').map((id) => this.nameOf(id));
      msg = `${name}'s buy-back was declined (${naysayers.join(', ')} said no)`;
      this.startCooldown(v.requesterId);
      this.notify(v.requesterId, 'error', 'Your buy-back request was declined');
    } else if (reason === 'timeout') {
      msg = `${name}'s buy-back was rejected — not everyone voted in time`;
      this.startCooldown(v.requesterId);
      this.notify(v.requesterId, 'error', 'Your buy-back request ran out of time');
    } else {
      msg = `${name}'s buy-back request was cancelled`;
    }
    this.addLog('buyback', msg);
    this.systemChat(msg);
    this.schedule(this.timing.resolvedVoteVisibleMs, () => {
      this.votes = this.votes.filter((x) => x !== v);
    });
  }

  private startCooldown(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    this.cancelTimer(p.cooldownTimer);
    p.cooldownUntil = this.now() + this.timing.buyBackCooldownMs;
    // re-broadcast when the cooldown ends so canRequestBuyBack flips back
    p.cooldownTimer = this.schedule(this.timing.buyBackCooldownMs, () => {
      p.cooldownTimer = null;
    });
  }

  // =================================================================== internals: hands

  private isIdle(): boolean {
    const h = this.hand;
    return !h || (h.resultApplied && !h.nextHandTimer);
  }

  private maybeStartHand(): void {
    if (this.disposed || this.status !== 'running' || !this.isIdle()) return;
    const eligible = this.eligiblePlayers();
    if (eligible.length < 2) return;
    this.startHand(eligible);
  }

  private startHand(eligible: PlayerRec[]): void {
    this.clearHand();
    const handNumber = this.handNumber + 1;
    const seats = eligible.map((p) => p.seat!);
    const dealerSeat =
      this.buttonSeat === null ? nextButtonSeat(null, seats, this.rand) : nextButtonSeat(this.buttonSeat, seats);
    const engine = createHand({
      handNumber,
      players: eligible.map((p) => ({ id: p.id, seat: p.seat!, stack: p.stack })),
      dealerSeat,
      smallBlind: this.settings.smallBlind,
      bigBlind: this.settings.bigBlind,
      deck: this.deckFactory?.(handNumber),
    });
    this.handNumber = handNumber;
    this.buttonSeat = dealerSeat;
    this.started = true;
    this.hand = {
      engine,
      dealt: new Set(eligible.map((p) => p.id)),
      left: new Set(),
      shown: new Map(),
      resultApplied: false,
      turnActorId: null,
      turnKind: null,
      turnDeadline: null,
      turnDurationMs: null,
      turnTimer: null,
      advanceTimer: null,
      nextHandTimer: null,
    };
    const dealer = eligible.find((p) => p.seat === dealerSeat)!;
    this.addLog('info', `Hand #${handNumber} — ${dealer.name} has the button`, handNumber);
    this.afterEngine();
  }

  /** Drops the current hand (and its timers). */
  private clearHand(): void {
    const h = this.hand;
    if (!h) return;
    this.cancelTimer(h.turnTimer);
    this.cancelTimer(h.advanceTimer);
    this.cancelTimer(h.nextHandTimer);
    this.hand = null;
  }

  /** Run after every engine call: log events, (re)start clocks, pace streets, finish hand. */
  private afterEngine(): void {
    const h = this.hand;
    if (!h) return;
    const e = h.engine;
    this.logEngineEvents(e.drainEvents(), e.handNumber);
    this.syncTurn(h);
    if (e.phase === 'roundComplete') {
      if (!h.advanceTimer) {
        const delay = e.isRunout() ? this.timing.runoutStreetDelayMs : this.timing.streetDelayMs;
        h.advanceTimer = this.schedule(delay, () => {
          h.advanceTimer = null;
          if (this.hand !== h || h.engine.phase !== 'roundComplete') return;
          h.engine.advance();
          this.afterEngine();
        });
      }
    } else if (h.advanceTimer) {
      this.cancelTimer(h.advanceTimer);
      h.advanceTimer = null;
    }
    if (e.phase === 'complete' && !h.resultApplied) this.finishHand(h);
  }

  private syncTurn(h: HandState): void {
    const e = h.engine;
    const actor = e.phase === 'betting' ? e.toActId : null;
    if (actor === h.turnActorId) return;
    this.cancelTimer(h.turnTimer);
    h.turnTimer = null;
    h.turnKind = null;
    h.turnDeadline = null;
    h.turnDurationMs = null;
    h.turnActorId = actor;
    if (!actor) return;
    const sec = this.settings.turnTimeSec;
    if (sec > 0) {
      const ms = sec * 1000;
      h.turnKind = 'clock';
      h.turnDeadline = this.now() + ms;
      h.turnDurationMs = ms;
      h.turnTimer = this.schedule(ms, () => this.onTurnExpired(h, actor, 'clock'));
    } else {
      const p = this.players.get(actor);
      if (!p || p.sockets === 0) this.startGrace(h, actor);
    }
  }

  private startGrace(h: HandState, actor: string): void {
    const ms = this.timing.disconnectActGraceMs;
    this.cancelTimer(h.turnTimer);
    h.turnKind = 'grace';
    h.turnDeadline = this.now() + ms;
    h.turnDurationMs = ms;
    h.turnTimer = this.schedule(ms, () => this.onTurnExpired(h, actor, 'grace'));
  }

  private onTurnExpired(h: HandState, actor: string, kind: 'clock' | 'grace'): void {
    h.turnTimer = null;
    const e = h.engine;
    if (this.hand !== h || h.resultApplied || e.phase !== 'betting' || e.toActId !== actor) return;
    const p = this.players.get(actor);
    const name = this.nameOf(actor);
    if (kind === 'clock') this.addLog('info', `${name} ran out of time`, e.handNumber);
    else this.addLog('info', `${name} is away`, e.handNumber);
    const legal = e.legalActions(actor);
    const res = e.act(actor, legal?.canCheck ? { type: 'check' } : { type: 'fold' });
    if (!res.ok) e.forceFold(actor);
    if (kind === 'clock' && p) {
      p.timeouts++;
      if (p.timeouts >= this.timing.maxConsecutiveTimeouts && !p.sitOut) {
        p.sitOut = true;
        this.addLog('info', `${p.name} is sitting out after ${p.timeouts} timeouts in a row`, e.handNumber);
        this.notify(p.id, 'info', `You were sat out after ${p.timeouts} timeouts`);
      }
    }
    h.turnActorId = null; // force a fresh clock even if the same player acts next
    this.afterEngine();
  }

  private finishHand(h: HandState): void {
    h.resultApplied = true;
    this.cancelTimer(h.turnTimer);
    this.cancelTimer(h.advanceTimer);
    h.turnTimer = null;
    h.advanceTimer = null;
    h.turnActorId = null;
    h.turnKind = null;
    h.turnDeadline = null;
    h.turnDurationMs = null;
    const r = h.engine.result!;
    for (const [id, stack] of Object.entries(r.finalStacks)) {
      const p = this.players.get(id);
      if (p) p.stack = stack;
    }
    const delay = r.showdown ? this.timing.showdownNextHandDelayMs : this.timing.nextHandDelayMs;
    h.nextHandTimer = this.schedule(delay, () => {
      h.nextHandTimer = null;
      if (this.hand === h) this.clearHand();
      // mutate() -> maybeStartHand() deals the next hand if possible
    });
  }

  // =================================================================== internals: log / chat / notices

  private addLog(kind: LogKind, text: string, handNumber: number | null = null): void {
    const entry: LogEntry = { id: ++this.logSeq, handNumber, ts: this.now(), kind, text };
    this.log.push(entry);
    if (this.log.length > LOG_KEEP) this.log.splice(0, this.log.length - LOG_KEEP);
    this.outbox.log.push(entry);
  }

  private pushChat(m: ChatMessage): void {
    this.chat.push(m);
    if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
    this.outbox.chat.push(m);
  }

  private systemChat(text: string): void {
    this.pushChat({ id: newShortId(), playerId: null, name: SYSTEM_NAME, text, ts: this.now(), system: true });
  }

  private notify(playerId: string, kind: NoticePayload['kind'], text: string): void {
    if (!playerId) return;
    this.outbox.notices.push({ playerId, notice: { kind, text } });
  }

  private logEngineEvents(events: EngineEvent[], handNumber: number): void {
    for (const ev of events) {
      const who = ev.playerId ? this.nameOf(ev.playerId) : '';
      const amt = formatChips(ev.amount ?? 0);
      switch (ev.kind) {
        case 'blind':
          this.addLog(
            'action',
            `${who} posts the ${ev.action === 'sb' ? 'small' : 'big'} blind ${amt}`,
            handNumber,
          );
          break;
        case 'action': {
          const text =
            ev.action === 'fold'
              ? `${who} folds`
              : ev.action === 'check'
                ? `${who} checks`
                : ev.action === 'call'
                  ? `${who} calls ${amt}`
                  : ev.action === 'bet'
                    ? `${who} bets ${amt}`
                    : ev.action === 'raise'
                      ? `${who} raises to ${amt}`
                      : `${who} is all-in (${amt})`;
          this.addLog('action', text, handNumber);
          break;
        }
        case 'street': {
          const cards = (ev.cards ?? []).map(cardLabel).join(' ');
          const label = ev.street === 'flop' ? 'Flop' : ev.street === 'turn' ? 'Turn' : 'River';
          const board = this.hand?.engine.board ?? [];
          const text =
            ev.street === 'flop' ? `Flop: ${cards}` : `${label}: ${cards} (board ${board.map(cardLabel).join(' ')})`;
          this.addLog('street', text, handNumber);
          break;
        }
        case 'uncalled':
          this.addLog('action', `Uncalled ${amt} returned to ${who}`, handNumber);
          break;
        case 'showdown':
          this.addLog(
            'action',
            `${who} shows ${(ev.cards ?? []).map(cardLabel).join(' ')}${ev.handName ? ` — ${ev.handName}` : ''}`,
            handNumber,
          );
          break;
        case 'win': {
          const pot = !ev.potIndex ? 'the main pot' : `side pot ${ev.potIndex}`;
          this.addLog('win', `${who} wins ${amt} from ${pot}${ev.handName ? ` with ${ev.handName}` : ''}`, handNumber);
          break;
        }
      }
    }
  }

  private logSettingsChange(prev: GameSettings, next: GameSettings): void {
    const live = !!this.hand && !this.hand.resultApplied;
    if (prev.smallBlind !== next.smallBlind || prev.bigBlind !== next.bigBlind) {
      const b = `${formatChips(next.smallBlind)}/${formatChips(next.bigBlind)}`;
      this.addLog('info', live ? `Blinds will be ${b} from the next hand` : `Blinds are now ${b}`);
    }
    if (prev.buyIn !== next.buyIn) this.addLog('info', `Buy-in is now ${formatChips(next.buyIn)}`);
    if (prev.maxPlayers !== next.maxPlayers) this.addLog('info', `The table now has ${next.maxPlayers} seats`);
    if (prev.turnTimeSec !== next.turnTimeSec) {
      this.addLog('info', next.turnTimeSec > 0 ? `Shot clock set to ${next.turnTimeSec}s` : 'Shot clock turned off');
    }
    if (prev.buyBackVoteSec !== next.buyBackVoteSec) {
      this.addLog('info', `Buy-back votes now last ${next.buyBackVoteSec}s`);
    }
    if (prev.requireApproval !== next.requireApproval) {
      this.addLog('info', next.requireApproval ? 'New players now need the host’s OK to sit down' : 'Anyone can now take a seat');
    }
    if (prev.allowBuyBack !== next.allowBuyBack) {
      this.addLog(
        'info',
        next.allowBuyBack ? 'Buy-backs are allowed again (everyone must agree)' : 'Buy-backs are turned off',
      );
    }
  }
}
