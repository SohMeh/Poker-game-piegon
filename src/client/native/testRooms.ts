// RoomView builders for the native bridge unit tests (not part of the app bundle).
import { DEFAULT_SETTINGS } from '../../shared/constants';
import type { BuyBackVoteView, GameSettings, HandView, LedgerRow, PublicPlayer, RoomView } from '../../shared/types';

export const ORIGIN = 'https://flock-poker.onrender.com';
export const ROOM = 'ABC123';

export function player(id: string, name: string, seat: number | null, p: Partial<PublicPlayer> = {}): PublicPlayer {
  return {
    id,
    name,
    color: 0,
    seat,
    stack: 2000,
    isHost: false,
    connected: true,
    sittingOut: false,
    pendingSeat: null,
    buyIns: seat === null ? 0 : 1,
    busted: false,
    inHand: false,
    folded: false,
    allIn: false,
    bet: 0,
    hasCards: false,
    shownCards: null,
    lastAction: null,
    timeouts: 0,
    ...p,
  };
}

export function hand(p: Partial<HandView>): HandView {
  return {
    handNumber: 1,
    street: 'preflop',
    phase: 'betting',
    board: [],
    pots: [],
    totalPot: 30,
    dealerSeat: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    smallBlind: 10,
    bigBlind: 20,
    toActPlayerId: null,
    turnDeadline: null,
    turnDurationMs: null,
    currentBet: 20,
    minRaiseTo: 40,
    winners: null,
    runout: false,
    ...p,
  };
}

export interface RoomOpts {
  players: PublicPlayer[];
  me?: string;
  status?: RoomView['status'];
  started?: boolean;
  hand?: HandView | null;
  votes?: BuyBackVoteView[];
  gameOverWinnerId?: string | null;
  settings?: Partial<GameSettings>;
}

export function room(o: RoomOpts): RoomView {
  const settings: GameSettings = { ...DEFAULT_SETTINGS, smallBlind: 10, bigBlind: 20, buyIn: 2000, maxPlayers: 9, buyBackVoteSec: 30, ...o.settings };
  const seats: (string | null)[] = Array.from({ length: settings.maxPlayers }, () => null);
  for (const p of o.players) if (p.seat !== null) seats[p.seat] = p.id;
  const players = o.players.map((p) => ({ ...p, isHost: p.id === 'p_sohum' }));
  const me = players.find((p) => p.id === (o.me ?? 'p_sohum'))!;
  const ledger: LedgerRow[] = players.map((p) => ({
    playerId: p.id,
    name: p.name,
    buyIns: p.buyIns,
    totalBuyIn: p.buyIns * settings.buyIn,
    stack: p.stack,
    net: p.stack - p.buyIns * settings.buyIn,
    inRoom: true,
  }));
  return {
    roomId: ROOM,
    serverTime: 1_700_000_000_000,
    status: o.status ?? 'running',
    settings,
    started: o.started ?? true,
    hostId: 'p_sohum',
    seats,
    players,
    hand: o.hand === undefined ? null : o.hand,
    buyBackVotes: o.votes ?? [],
    ledger,
    gameOverWinnerId: o.gameOverWinnerId ?? null,
    me: {
      playerId: me.id,
      name: me.name,
      isHost: me.isHost,
      seat: me.seat,
      holeCards: null,
      legal: null,
      canRequestBuyBack: false,
      buyBackCooldownUntil: null,
      votesAwaitingMe: [],
      canShowCards: false,
    },
  };
}

export const sohum = (p: Partial<PublicPlayer> = {}) => player('p_sohum', 'Sohum', 0, p);
export const fourPlayers = (p: Record<string, Partial<PublicPlayer>> = {}) => [
  sohum(p.p_sohum),
  player('p_alice', 'Alice', 1, p.p_alice),
  player('p_bob', 'Bob', 2, p.p_bob),
  player('p_carol', 'Carol', 3, p.p_carol),
];
