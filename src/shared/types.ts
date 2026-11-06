// Shared state shapes. The server is authoritative; every client receives a
// personalised RoomView (other players' hole cards are never sent unless shown).
import type { Card } from './cards';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

/** Everything that can appear as a player's last action in a hand. */
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
export type BlindType = 'sb' | 'bb';

/**
 * What a client sends when acting.
 * - `raise` is used both for an opening bet and for a raise. `amount` is the
 *   TOTAL the player wants their bet to be on this street ("raise to"), not the increment.
 * - `allin` pushes the whole stack (server decides whether that is a call, bet or raise).
 */
export interface PlayerAction {
  type: 'fold' | 'check' | 'call' | 'raise' | 'allin';
  amount?: number;
}

export interface GameSettings {
  smallBlind: number;
  bigBlind: number;
  /** Fixed starting stack. Every player gets exactly this one buy-in. Locked once the first hand is dealt. */
  buyIn: number;
  /** Table capacity (2..10). Extra people can watch as spectators. */
  maxPlayers: number;
  /** Seconds per decision; 0 = no shot clock. */
  turnTimeSec: number;
  /** Seconds every voter gets to accept/reject a buy-back request. Silence counts as "no". */
  buyBackVoteSec: number;
  /** When true, non-host players need host approval before taking a seat. */
  requireApproval: boolean;
  /** When false, busted players can never buy back. */
  allowBuyBack: boolean;
}

/** lobby = no hand dealt yet; running = hands are being dealt; paused = no new hands start. */
export type RoomStatus = 'lobby' | 'running' | 'paused';

export interface LastAction {
  type: ActionType | BlindType;
  /** Player's total bet on the street after this action (0 for fold/check). */
  amount: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  /** Avatar colour index, 0..11. */
  color: number;
  /** Seat index 0..maxPlayers-1, or null when spectating. */
  seat: number | null;
  /** Chips behind (not counting chips already bet this street). */
  stack: number;
  isHost: boolean;
  connected: boolean;
  /** Not being dealt in (explicit sit out, or auto-away after disconnect / timeouts). */
  sittingOut: boolean;
  /** Seat this player asked for while waiting on host approval. */
  pendingSeat: number | null;
  /** Total buy-ins taken: 1 for the original buy-in + approved buy-backs. 0 if never seated. */
  buyIns: number;
  /** Seated with no chips and not in the current hand. */
  busted: boolean;
  // ---- current hand (false/0/null when not in a hand) ----
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Chips in front of the player on the current street. */
  bet: number;
  /** Holding face-down cards (render card backs for others). */
  hasCards: boolean;
  /** Face-up hole cards visible to everyone (showdown, all-in runout, or voluntarily shown). */
  shownCards: Card[] | null;
  lastAction: LastAction | null;
  /** Consecutive shot-clock timeouts (2 in a row => auto sit-out). */
  timeouts: number;
}

export interface PotView {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface HandWinner {
  playerId: string;
  amount: number;
  /** 0 = main pot, 1+ = side pots. */
  potIndex: number;
  /** e.g. "Full House, Kings full of Twos"; null when won uncontested. */
  handName: string | null;
  /** Best five cards; null when won uncontested. */
  bestCards: Card[] | null;
}

export type HandPhase = 'betting' | 'dealing' | 'complete';

export interface HandView {
  handNumber: number;
  street: Street;
  /** betting = someone must act; dealing = between streets / all-in runout; complete = showing results. */
  phase: HandPhase;
  board: Card[];
  /** Pots collected from completed streets (main pot first). */
  pots: PotView[];
  /** Every chip in the middle, including bets on the current street. */
  totalPot: number;
  dealerSeat: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number;
  smallBlind: number;
  bigBlind: number;
  toActPlayerId: string | null;
  /** Epoch ms (server clock) when the current actor auto-acts, or null if no clock. */
  turnDeadline: number | null;
  turnDurationMs: number | null;
  currentBet: number;
  minRaiseTo: number;
  /** Populated when phase === 'complete'. */
  winners: HandWinner[] | null;
  /** True during an all-in runout (no more betting possible). */
  runout: boolean;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Extra chips needed to call (already capped at the player's stack). */
  callAmount: number;
  /** Can bet or raise (a full raise, or all-in). */
  canRaise: boolean;
  /** True when nobody has bet yet this street (UI says "Bet" instead of "Raise"). */
  isBet: boolean;
  /** Minimum legal "raise to" street total (or all-in total if the stack is smaller). */
  minRaiseTo: number;
  /** Maximum "raise to" street total (= myBet + stack). */
  maxRaiseTo: number;
  currentBet: number;
  myBet: number;
  stack: number;
  /** Total pot including all current-street bets (for pot-size presets). */
  pot: number;
}

export type VoteChoice = 'yes' | 'no';

export interface BuyBackVoteView {
  id: string;
  requesterId: string;
  requesterName: string;
  amount: number;
  createdAt: number;
  deadline: number;
  /** voterId -> choice; null = not voted yet. Requester is never a voter. */
  votes: Record<string, VoteChoice | null>;
  status: 'pending' | 'approved' | 'rejected';
  resolvedReason: 'unanimous' | 'declined' | 'timeout' | 'cancelled' | null;
  resolvedAt: number | null;
}

export interface LedgerRow {
  playerId: string;
  name: string;
  buyIns: number;
  totalBuyIn: number;
  /** Current chips (stack + chips committed in the current hand). */
  stack: number;
  /** stack - totalBuyIn */
  net: number;
  /** Still in the room (false if they left; their stack is frozen). */
  inRoom: boolean;
}

export interface ChatMessage {
  id: string;
  playerId: string | null;
  name: string;
  text: string;
  ts: number;
  system: boolean;
}

export type LogKind = 'action' | 'street' | 'win' | 'info' | 'buyback';

export interface LogEntry {
  id: number;
  handNumber: number | null;
  ts: number;
  kind: LogKind;
  text: string;
}

export interface MeView {
  playerId: string;
  name: string;
  isHost: boolean;
  seat: number | null;
  holeCards: Card[] | null;
  /** Non-null only when it is my turn. */
  legal: LegalActions | null;
  /** Busted, seated, buy-backs allowed, no pending request, not cooling down. */
  canRequestBuyBack: boolean;
  /** Epoch ms until another buy-back request is allowed (after a rejection). */
  buyBackCooldownUntil: number | null;
  /** Ids of pending buy-back votes waiting for MY vote. */
  votesAwaitingMe: string[];
  /** Can I show my hole cards right now (hand complete or I folded, and they are not shown yet). */
  canShowCards: boolean;
}

export interface RoomView {
  roomId: string;
  /** Server clock at send time (epoch ms) so clients can correct for skew. */
  serverTime: number;
  status: RoomStatus;
  settings: GameSettings;
  /** True once the first hand was dealt (buy-in amount is then locked). */
  started: boolean;
  hostId: string;
  /** Length = settings.maxPlayers; player id or null per seat. */
  seats: (string | null)[];
  /** Everyone in the room: seated players and spectators. */
  players: PublicPlayer[];
  hand: HandView | null;
  /** Pending votes plus votes resolved in the last few seconds. */
  buyBackVotes: BuyBackVoteView[];
  ledger: LedgerRow[];
  /**
   * Set between hands when the game has been started and fewer than two seated players
   * have chips left: the one player holding chips (null if nobody). Busted players may still
   * request a buy-back (which needs everyone's approval), or the host can start a rematch.
   */
  gameOverWinnerId: string | null;
  /** Personal view (always present for a joined socket). */
  me: MeView;
}

/** GET /api/rooms/:roomId — public info shown on the join screen before joining. */
export interface RoomSummary {
  roomId: string;
  hostName: string;
  seated: number;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  buyIn: number;
  status: RoomStatus;
  started: boolean;
}
