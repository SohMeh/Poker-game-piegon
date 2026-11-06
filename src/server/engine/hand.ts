// Pure No-Limit Texas Hold'em engine: runs exactly one hand.
//
// Seats are clockwise in increasing index order (wrapping).
// - 3+ players: SB = first player after the dealer, BB = next; preflop the first player
//   after the BB acts first.
// - Heads-up: the dealer posts the SB and acts first preflop; the BB acts first on later streets.
// - Postflop the first non-folded, non-all-in player after the dealer acts first.
// The deck is dealt as documented in ./deck.ts.
import {
  evaluateHand,
  isCard,
  type ActionType,
  type BlindType,
  type Card,
  type HandRank,
  type LegalActions,
  type PlayerAction,
  type Street,
} from '../../shared';
import { boardDeckIndices, dealOrder, shuffledDeck } from './deck';
import { computePots, splitAmount } from './pots';
import type {
  EngineConfig,
  EngineEvent,
  EnginePhase,
  EnginePlayerState,
  EnginePot,
  EngineResult,
  EngineWinner,
  HandEngine,
} from './types';

interface InternalPlayer extends EnginePlayerState {
  /** Position in the seat-sorted players array. */
  index: number;
  /** currentBet left standing after this player's last action on this street (re-opening rule). */
  betFaced: number;
}

type ActResult = { ok: true } | { ok: false; error: string };

const NEXT_STREET: Partial<Record<Street, Street>> = { preflop: 'flop', flop: 'turn', turn: 'river' };

/**
 * Next dealer button: the first seat in `seats` strictly clockwise after `prev`
 * (next higher index, wrapping). `prev === null` picks a random seat.
 */
export function nextButtonSeat(prev: number | null, seats: readonly number[], rand: () => number = Math.random): number {
  const sorted = [...new Set(seats)].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error('nextButtonSeat: no seats');
  if (prev === null) {
    const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(rand() * sorted.length)));
    return sorted[i]!;
  }
  return sorted.find((s) => s > prev) ?? sorted[0]!;
}

export function createHand(config: EngineConfig): HandEngine {
  return new Hand(config);
}

function isWholeChips(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

class Hand implements HandEngine {
  readonly handNumber: number;
  readonly dealerSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  readonly smallBlind: number;
  readonly bigBlind: number;

  private readonly ps: InternalPlayer[];
  private readonly byId = new Map<string, InternalPlayer>();
  private readonly deck: Card[];
  private readonly dealerIndex: number;
  private readonly sbIndex: number;
  private readonly bbIndex: number;

  private _phase: EnginePhase = 'betting';
  private _street: Street = 'preflop';
  private _board: Card[] = [];
  private _currentBet = 0;
  private _lastRaiseSize: number;
  private _toActId: string | null = null;
  private _result: EngineResult | null = null;
  private uncalled: { playerId: string; amount: number } | null = null;
  private events: EngineEvent[] = [];

  constructor(config: EngineConfig) {
    validateConfig(config);
    this.handNumber = config.handNumber;
    this.dealerSeat = config.dealerSeat;
    this.smallBlind = config.smallBlind;
    this.bigBlind = config.bigBlind;
    this._lastRaiseSize = config.bigBlind;

    const sorted = [...config.players].sort((a, b) => a.seat - b.seat);
    this.ps = sorted.map((p, index) => ({
      id: p.id,
      seat: p.seat,
      stack: p.stack,
      holeCards: [],
      streetBet: 0,
      totalCommitted: 0,
      folded: false,
      allIn: false,
      hasActed: false,
      lastAction: null,
      index,
      betFaced: 0,
    }));
    for (const p of this.ps) this.byId.set(p.id, p);
    const n = this.ps.length;

    this.dealerIndex = this.ps.findIndex((p) => p.seat === config.dealerSeat);
    if (n === 2) {
      this.sbIndex = this.dealerIndex;
      this.bbIndex = (this.dealerIndex + 1) % n;
    } else {
      this.sbIndex = (this.dealerIndex + 1) % n;
      this.bbIndex = (this.dealerIndex + 2) % n;
    }
    this.smallBlindSeat = this.ps[this.sbIndex]!.seat;
    this.bigBlindSeat = this.ps[this.bbIndex]!.seat;

    // ---- deal hole cards (see deck.ts for the fixed order) ----
    this.deck = config.deck ? [...config.deck] : shuffledDeck();
    const order = dealOrder(
      this.ps.map((p) => p.seat),
      config.dealerSeat,
    );
    order.forEach((seat, i) => {
      const p = this.ps.find((x) => x.seat === seat)!;
      p.holeCards = [this.deck[i]!, this.deck[n + i]!];
    });

    // ---- blinds (posting is not acting) ----
    this.postBlind(this.ps[this.sbIndex]!, 'sb', config.smallBlind);
    this.postBlind(this.ps[this.bbIndex]!, 'bb', config.bigBlind);
    this._currentBet = config.bigBlind;
    this._lastRaiseSize = config.bigBlind;

    // ---- first actor ----
    if (this.roundClosed()) {
      this.closeRound();
    } else {
      const start = n === 2 ? this.sbIndex : (this.bbIndex + 1) % n;
      this._toActId = this.findNeedsAction(start)?.id ?? null;
      if (!this._toActId) this.closeRound();
    }
  }

  // ------------------------------------------------------------------ getters

  get phase(): EnginePhase {
    return this._phase;
  }
  get street(): Street {
    return this._street;
  }
  get board(): Card[] {
    return [...this._board];
  }
  get players(): readonly EnginePlayerState[] {
    return this.ps.map(snapshot);
  }
  get pots(): readonly EnginePot[] {
    if (this._phase === 'complete') return [];
    return computePots(
      this.ps.map((p) => ({ id: p.id, committed: p.totalCommitted - p.streetBet, folded: p.folded })),
    );
  }
  get currentBet(): number {
    return this._currentBet;
  }
  get lastRaiseSize(): number {
    return this._lastRaiseSize;
  }
  get minRaiseTo(): number {
    return this._currentBet + this._lastRaiseSize;
  }
  get toActId(): string | null {
    return this._toActId;
  }
  get result(): EngineResult | null {
    return this._result;
  }

  getPlayer(id: string): EnginePlayerState | undefined {
    const p = this.byId.get(id);
    return p ? snapshot(p) : undefined;
  }

  totalPot(): number {
    if (this._phase === 'complete') return 0;
    return this.ps.reduce((s, p) => s + p.totalCommitted, 0);
  }

  legalActions(playerId: string): LegalActions | null {
    if (this._phase !== 'betting' || playerId !== this._toActId) return null;
    const p = this.byId.get(playerId);
    if (!p) return null;
    const toCall = Math.max(0, this._currentBet - p.streetBet);
    const maxRaiseTo = p.streetBet + p.stack;
    return {
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount: Math.min(toCall, p.stack),
      canRaise: this.raiseBlockReason(p) === null,
      isBet: this._currentBet === 0,
      minRaiseTo: Math.min(this.minRaiseTo, maxRaiseTo),
      maxRaiseTo,
      currentBet: this._currentBet,
      myBet: p.streetBet,
      stack: p.stack,
      pot: this.totalPot(),
    };
  }

  isRunout(): boolean {
    if (this._phase !== 'roundComplete') return false;
    let live = 0;
    let actable = 0;
    for (const p of this.ps) {
      if (p.folded) continue;
      live++;
      if (!p.allIn) actable++;
    }
    return live >= 2 && actable <= 1;
  }

  faceUpCards(): Record<string, Card[]> {
    if (this.isRunout()) {
      const out: Record<string, Card[]> = {};
      for (const p of this.ps) if (!p.folded) out[p.id] = [...p.holeCards];
      return out;
    }
    if (this._phase === 'complete' && this._result?.showdown) {
      const out: Record<string, Card[]> = {};
      for (const [id, cards] of Object.entries(this._result.revealed)) out[id] = [...cards];
      return out;
    }
    return {};
  }

  drainEvents(): EngineEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ------------------------------------------------------------------ actions

  act(playerId: string, action: PlayerAction): ActResult {
    try {
      return this.applyAction(playerId, action);
    } catch (err) {
      // Defensive only: validation happens before any mutation.
      return { ok: false, error: `Internal engine error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private applyAction(playerId: string, action: PlayerAction): ActResult {
    if (this._phase === 'complete') return { ok: false, error: 'The hand is over' };
    if (this._phase !== 'betting') return { ok: false, error: 'Betting is closed; wait for the next card' };
    const p = this.byId.get(playerId);
    if (!p) return { ok: false, error: 'You are not in this hand' };
    if (playerId !== this._toActId) return { ok: false, error: 'Not your turn' };
    if (!action || typeof action !== 'object') return { ok: false, error: 'Invalid action' };

    const toCall = Math.max(0, this._currentBet - p.streetBet);
    switch (action.type) {
      case 'fold':
        this.doFold(p);
        break;
      case 'check':
        if (toCall > 0) return { ok: false, error: `Cannot check: ${toCall} to call` };
        p.hasActed = true;
        p.betFaced = this._currentBet;
        p.lastAction = { type: 'check', amount: 0 };
        this.emitAction(p, 'check', 0);
        break;
      case 'call':
        if (toCall === 0) return { ok: false, error: 'Nothing to call; check instead' };
        this.doCall(p);
        break;
      case 'raise': {
        const amount = action.amount;
        if (typeof amount !== 'number' || !Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0) {
          return { ok: false, error: 'Bet amount must be a whole number of chips' };
        }
        const blocked = this.raiseBlockReason(p);
        if (blocked) return { ok: false, error: blocked };
        const verb = this._currentBet === 0 ? 'Bet' : 'Raise';
        const maxTo = p.streetBet + p.stack;
        if (amount <= this._currentBet) {
          return {
            ok: false,
            error:
              this._currentBet === 0
                ? 'Bet must be more than zero'
                : `${verb} must be to more than the current bet of ${this._currentBet}`,
          };
        }
        if (amount > maxTo) return { ok: false, error: `You can ${verb.toLowerCase()} at most to ${maxTo}` };
        if (amount < this.minRaiseTo && amount !== maxTo) {
          return { ok: false, error: `Minimum ${verb.toLowerCase()} is to ${this.minRaiseTo} (or all-in)` };
        }
        this.doRaise(p, amount);
        break;
      }
      case 'allin': {
        if (p.stack <= 0) return { ok: false, error: 'You have no chips behind' };
        const maxTo = p.streetBet + p.stack;
        if (maxTo <= this._currentBet) {
          this.doCall(p);
        } else {
          const blocked = this.raiseBlockReason(p);
          if (blocked) return { ok: false, error: blocked };
          this.doRaise(p, maxTo);
        }
        break;
      }
      default:
        return { ok: false, error: 'Unknown action' };
    }
    this.afterAction(p);
    return { ok: true };
  }

  forceFold(playerId: string): void {
    if (this._phase === 'complete') return;
    const p = this.byId.get(playerId);
    if (!p || p.folded) return;
    const wasTurn = this._phase === 'betting' && this._toActId === p.id;
    this.doFold(p);
    if (wasTurn) {
      this.afterAction(p);
      return;
    }
    if (this.liveCount() <= 1) {
      this.finishUncontested();
      return;
    }
    if (this._phase === 'betting' && this.roundClosed()) this.closeRound();
  }

  advance(): void {
    if (this._phase !== 'roundComplete') return;
    // collect the street's bets into the pots
    for (const p of this.ps) p.streetBet = 0;

    const next = NEXT_STREET[this._street];
    if (!next) {
      this.showdown();
      return;
    }
    const n = this.ps.length;
    const idx = boardDeckIndices(n);
    const newCards: Card[] =
      next === 'flop' ? [this.deck[idx[0]!]!, this.deck[idx[1]!]!, this.deck[idx[2]!]!] : [this.deck[next === 'turn' ? idx[3]! : idx[4]!]!];
    this._street = next;
    this._board.push(...newCards);
    this.events.push({ kind: 'street', street: next, cards: [...newCards] });

    this._currentBet = 0;
    this._lastRaiseSize = this.bigBlind;
    for (const p of this.ps) {
      p.hasActed = false;
      p.betFaced = 0;
      if (!p.folded && !p.allIn) p.lastAction = null;
    }
    if (this.actableCount() < 2) {
      // all-in runout: stay in roundComplete, caller keeps calling advance()
      this._toActId = null;
      return;
    }
    this._phase = 'betting';
    this._toActId = this.findNeedsAction((this.dealerIndex + 1) % n)?.id ?? null;
    if (!this._toActId) this.closeRound();
  }

  // ------------------------------------------------------------------ internals

  private postBlind(p: InternalPlayer, type: BlindType, size: number): void {
    const amount = Math.min(size, p.stack);
    if (amount <= 0) return;
    this.commit(p, amount);
    p.lastAction = { type, amount: p.streetBet };
    this.events.push({ kind: 'blind', playerId: p.id, action: type, amount: p.streetBet });
  }

  private commit(p: InternalPlayer, amount: number): void {
    p.stack -= amount;
    p.streetBet += amount;
    p.totalCommitted += amount;
    if (p.stack === 0) p.allIn = true;
  }

  private emitAction(p: InternalPlayer, type: ActionType, amount: number): void {
    this.events.push({ kind: 'action', playerId: p.id, action: type, amount });
  }

  private doFold(p: InternalPlayer): void {
    p.folded = true;
    p.hasActed = true;
    p.lastAction = { type: 'fold', amount: 0 };
    this.emitAction(p, 'fold', 0);
  }

  private doCall(p: InternalPlayer): void {
    const amount = Math.min(this._currentBet - p.streetBet, p.stack);
    this.commit(p, amount);
    p.hasActed = true;
    p.betFaced = this._currentBet;
    const type: ActionType = p.allIn ? 'allin' : 'call';
    p.lastAction = { type, amount: p.streetBet };
    this.emitAction(p, type, p.streetBet);
  }

  /** `to` is the street total; caller has validated it. */
  private doRaise(p: InternalPlayer, to: number): void {
    const prevBet = this._currentBet;
    const increment = to - prevBet;
    this.commit(p, to - p.streetBet);
    if (increment >= this._lastRaiseSize) this._lastRaiseSize = increment; // full raise
    this._currentBet = to;
    p.hasActed = true;
    p.betFaced = to;
    const type: ActionType = p.allIn ? 'allin' : prevBet === 0 ? 'bet' : 'raise';
    p.lastAction = { type, amount: p.streetBet };
    this.emitAction(p, type, p.streetBet);
  }

  private afterAction(actor: InternalPlayer): void {
    if (this.liveCount() <= 1) {
      this.finishUncontested();
      return;
    }
    if (this.roundClosed()) {
      this.closeRound();
      return;
    }
    const next = this.findNeedsAction((actor.index + 1) % this.ps.length);
    if (next) this._toActId = next.id;
    else this.closeRound();
  }

  /** Null when `p` may bet/raise now, otherwise the reason they may not. */
  private raiseBlockReason(p: InternalPlayer): string | null {
    const toCall = Math.max(0, this._currentBet - p.streetBet);
    if (p.stack <= toCall) return 'Not enough chips to raise; you can only call all-in or fold';
    if (!this.ps.some((o) => o !== p && !o.folded && !o.allIn)) {
      return 'Everyone else is all-in; you can only call or fold';
    }
    if (p.hasActed && this._currentBet - p.betFaced < this._lastRaiseSize) {
      return 'Betting was not re-opened (the all-in was less than a full raise); you can only call or fold';
    }
    return null;
  }

  private liveCount(): number {
    return this.ps.reduce((n, p) => n + (p.folded ? 0 : 1), 0);
  }

  private actableCount(): number {
    return this.ps.reduce((n, p) => n + (!p.folded && !p.allIn ? 1 : 0), 0);
  }

  private needsAction(p: InternalPlayer): boolean {
    return !p.folded && !p.allIn && (!p.hasActed || p.streetBet < this._currentBet);
  }

  /** First player needing action clockwise from `startIndex` (inclusive). */
  private findNeedsAction(startIndex: number): InternalPlayer | null {
    const n = this.ps.length;
    for (let k = 0; k < n; k++) {
      const p = this.ps[(startIndex + k) % n]!;
      if (this.needsAction(p)) return p;
    }
    return null;
  }

  private roundClosed(): boolean {
    const actable = this.ps.filter((p) => !p.folded && !p.allIn);
    if (actable.length === 0) return true;
    if (actable.length === 1) {
      const only = actable[0]!;
      const othersMax = this.ps.reduce((m, p) => (p === only ? m : Math.max(m, p.streetBet)), 0);
      if (only.streetBet >= othersMax) return true;
    }
    return actable.every((p) => !this.needsAction(p));
  }

  private closeRound(): void {
    this.returnUncalled();
    this._phase = 'roundComplete';
    this._toActId = null;
  }

  /** Returns the part of the highest street bet that nobody (folded players included) matched. */
  private returnUncalled(): void {
    let top: InternalPlayer | null = null;
    let topBet = 0;
    let second = 0;
    for (const p of this.ps) {
      if (p.streetBet > topBet) {
        second = topBet;
        topBet = p.streetBet;
        top = p;
      } else if (p.streetBet > second) {
        second = p.streetBet;
      }
    }
    if (!top || topBet <= second) return;
    const amount = topBet - second;
    top.streetBet -= amount;
    top.totalCommitted -= amount;
    top.stack += amount;
    if (top.stack > 0) top.allIn = false;
    if (top.lastAction && top.lastAction.amount > top.streetBet) {
      top.lastAction = { ...top.lastAction, amount: top.streetBet };
    }
    if (this.uncalled && this.uncalled.playerId === top.id) this.uncalled = { playerId: top.id, amount: this.uncalled.amount + amount };
    else this.uncalled = { playerId: top.id, amount };
    this.events.push({ kind: 'uncalled', playerId: top.id, amount });
  }

  /** Clockwise position starting with the first seat left of the dealer (0) and ending with the dealer. */
  private posFromDealer(p: InternalPlayer): number {
    const n = this.ps.length;
    return (p.index - this.dealerIndex - 1 + n) % n;
  }

  private finalPots(): EnginePot[] {
    return computePots(this.ps.map((p) => ({ id: p.id, committed: p.totalCommitted, folded: p.folded })));
  }

  private finishUncontested(): void {
    this.returnUncalled();
    const winner = this.ps.find((p) => !p.folded)!;
    const pots = this.finalPots();
    const winners: EngineWinner[] = [];
    pots.forEach((pot, potIndex) => {
      // With one live player every pot has the same eligible set, so this is a single pot.
      const id = pot.eligible[0] ?? winner.id;
      const w = this.byId.get(id)!;
      w.stack += pot.amount;
      winners.push({ playerId: id, amount: pot.amount, potIndex, handName: null, bestCards: null });
      this.events.push({ kind: 'win', playerId: id, amount: pot.amount, potIndex });
    });
    this.complete({ winners, showdown: false, revealed: {}, handNames: {} });
  }

  private showdown(): void {
    this._street = 'showdown';
    const live = this.ps.filter((p) => !p.folded).sort((a, b) => this.posFromDealer(a) - this.posFromDealer(b));
    const ranks = new Map<string, HandRank>();
    const revealed: Record<string, Card[]> = {};
    const handNames: Record<string, string> = {};
    for (const p of live) {
      const rank = evaluateHand([...p.holeCards, ...this._board]);
      ranks.set(p.id, rank);
      revealed[p.id] = [...p.holeCards];
      handNames[p.id] = rank.name;
      this.events.push({ kind: 'showdown', playerId: p.id, cards: [...p.holeCards], handName: rank.name });
    }
    const pots = this.finalPots();
    const winners: EngineWinner[] = [];
    pots.forEach((pot, potIndex) => {
      let best = -Infinity;
      for (const id of pot.eligible) best = Math.max(best, ranks.get(id)?.score ?? -Infinity);
      const potWinners = pot.eligible
        .map((id) => this.byId.get(id)!)
        .filter((p) => (ranks.get(p.id)?.score ?? -Infinity) === best)
        .sort((a, b) => this.posFromDealer(a) - this.posFromDealer(b));
      for (const share of splitAmount(
        pot.amount,
        potWinners.map((p) => p.id),
      )) {
        const w = this.byId.get(share.playerId)!;
        w.stack += share.amount;
        const rank = ranks.get(w.id);
        winners.push({
          playerId: w.id,
          amount: share.amount,
          potIndex,
          handName: rank?.name ?? null,
          bestCards: rank ? [...rank.best5] : null,
        });
        this.events.push({ kind: 'win', playerId: w.id, amount: share.amount, potIndex, handName: rank?.name });
      }
    });
    this.complete({ winners, showdown: true, revealed, handNames });
  }

  private complete(partial: Pick<EngineResult, 'winners' | 'showdown' | 'revealed' | 'handNames'>): void {
    // Everything has been paid out: nothing is committed any more.
    for (const p of this.ps) {
      p.streetBet = 0;
      p.totalCommitted = 0;
    }
    const finalStacks: Record<string, number> = {};
    for (const p of this.ps) finalStacks[p.id] = p.stack;
    this._result = { ...partial, uncalledReturn: this.uncalled, finalStacks };
    this._phase = 'complete';
    this._toActId = null;
  }
}

function snapshot(p: InternalPlayer): EnginePlayerState {
  return {
    id: p.id,
    seat: p.seat,
    stack: p.stack,
    holeCards: [...p.holeCards],
    streetBet: p.streetBet,
    totalCommitted: p.totalCommitted,
    folded: p.folded,
    allIn: p.allIn,
    hasActed: p.hasActed,
    lastAction: p.lastAction ? { ...p.lastAction } : null,
  };
}

function validateConfig(config: EngineConfig): void {
  const { players, smallBlind, bigBlind, dealerSeat, deck } = config;
  if (!Array.isArray(players) || players.length < 2) throw new Error('createHand: need at least 2 players');
  if (!isWholeChips(smallBlind) || !isWholeChips(bigBlind) || bigBlind < 1 || smallBlind > bigBlind) {
    throw new Error('createHand: blinds must be whole numbers with 0 <= smallBlind <= bigBlind and bigBlind >= 1');
  }
  const ids = new Set<string>();
  const seats = new Set<number>();
  for (const p of players) {
    if (typeof p.id !== 'string' || ids.has(p.id)) throw new Error(`createHand: duplicate or invalid player id ${p.id}`);
    if (!Number.isInteger(p.seat) || seats.has(p.seat)) throw new Error(`createHand: duplicate or invalid seat ${p.seat}`);
    if (!isWholeChips(p.stack) || p.stack <= 0) throw new Error(`createHand: player ${p.id} needs a positive whole stack`);
    ids.add(p.id);
    seats.add(p.seat);
  }
  if (!seats.has(dealerSeat)) throw new Error(`createHand: dealer seat ${dealerSeat} is not a dealt-in seat`);
  const needed = 2 * players.length + 8;
  if (needed > 52) throw new Error('createHand: too many players for one deck');
  if (deck) {
    if (deck.length < needed) throw new Error(`createHand: deck needs at least ${needed} cards`);
    const seen = new Set<string>();
    for (const c of deck) {
      if (!isCard(c) || seen.has(c)) throw new Error(`createHand: invalid or duplicate card in deck: ${String(c)}`);
      seen.add(c);
    }
  }
}
