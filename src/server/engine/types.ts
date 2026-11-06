// Contract for the pure No-Limit Hold'em hand engine.
// The engine knows nothing about sockets, rooms, timers or names: it runs exactly
// ONE hand for a set of seated players and reports what happened.
import type { ActionType, BlindType, Card, LegalActions, PlayerAction, Street } from '../../shared';

export interface EngineSeatPlayer {
  id: string;
  seat: number;
  /** Chips available at the start of the hand. Must be > 0. */
  stack: number;
}

export interface EngineConfig {
  handNumber: number;
  /** Players dealt into this hand (any order; unique seats; >= 2 players; every stack > 0). */
  players: EngineSeatPlayer[];
  /** Seat holding the dealer button. Must be the seat of one of `players`. */
  dealerSeat: number;
  smallBlind: number;
  bigBlind: number;
  /** Optional deck order for tests (top of deck = index 0). Defaults to a crypto-secure shuffle. */
  deck?: Card[];
}

export interface EnginePlayerState {
  id: string;
  seat: number;
  /** Chips behind. */
  stack: number;
  holeCards: Card[];
  /** Chips committed on the current street. */
  streetBet: number;
  /** Chips committed during the whole hand (includes streetBet). */
  totalCommitted: number;
  folded: boolean;
  allIn: boolean;
  /** Has voluntarily acted on the current street (posting a blind does not count). */
  hasActed: boolean;
  lastAction: { type: ActionType | BlindType; amount: number } | null;
}

export interface EnginePot {
  amount: number;
  /** Non-folded players who can win this pot. */
  eligible: string[];
}

export interface EngineWinner {
  playerId: string;
  amount: number;
  potIndex: number;
  handName: string | null;
  bestCards: Card[] | null;
}

export interface EngineResult {
  winners: EngineWinner[];
  /** True when 2+ players reached showdown. */
  showdown: boolean;
  /** Hole cards of every player who reached showdown (they are revealed). */
  revealed: Record<string, Card[]>;
  /** Hand description per showdown player, e.g. "Two Pair, Aces and Sevens". */
  handNames: Record<string, string>;
  /** Uncalled bet returned to its bettor (if any). */
  uncalledReturn: { playerId: string; amount: number } | null;
  /** Stack of every player after payouts (chips behind; nothing is still committed). */
  finalStacks: Record<string, number>;
}

/**
 * betting       – `toActId` must act.
 * roundComplete – betting on this street is closed; caller must call `advance()` (after a UI delay).
 * complete      – hand over; `result` is set and stacks are final.
 */
export type EnginePhase = 'betting' | 'roundComplete' | 'complete';

export type EngineEventKind = 'blind' | 'action' | 'street' | 'showdown' | 'win' | 'uncalled';

/** Log events, using player ids (the room layer turns ids into names). */
export interface EngineEvent {
  kind: EngineEventKind;
  playerId?: string;
  /** For actions/blinds. */
  action?: ActionType | BlindType;
  /** Street total for bets/raises/calls, blind size, won amount, returned amount. */
  amount?: number;
  street?: Street;
  /** New board cards for 'street' events, hole cards for 'showdown'. */
  cards?: Card[];
  handName?: string;
  potIndex?: number;
}

export interface HandRank {
  /** Larger is better; equal scores tie. */
  score: number;
  /** 0 high card .. 8 straight flush. */
  category: number;
  /** e.g. "Flush, Ace high", "Straight, Five high", "Royal Flush". */
  name: string;
  /** The five cards making the hand, ordered by importance (e.g. pair cards first, then kickers). */
  best5: Card[];
}

export interface HandEngine {
  readonly handNumber: number;
  readonly dealerSeat: number;
  /** Heads-up: the dealer posts the small blind. */
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  readonly smallBlind: number;
  readonly bigBlind: number;

  readonly phase: EnginePhase;
  readonly street: Street;
  readonly board: Card[];
  /** Ordered by seat ascending. */
  readonly players: readonly EnginePlayerState[];
  /** Pots collected from completed streets (main pot first). Does not include current street bets. */
  readonly pots: readonly EnginePot[];
  /** Highest streetBet on the current street. */
  readonly currentBet: number;
  /** Size of the last FULL bet/raise on this street (big blind at street start). */
  readonly lastRaiseSize: number;
  /** currentBet + lastRaiseSize (a "raise to" below this is only legal as an all-in). */
  readonly minRaiseTo: number;
  readonly toActId: string | null;
  readonly result: EngineResult | null;

  getPlayer(id: string): EnginePlayerState | undefined;
  /** Every chip in the middle: collected pots + all current street bets. */
  totalPot(): number;
  /** Legal options for `playerId`, or null if it is not their turn / hand not in betting phase. */
  legalActions(playerId: string): LegalActions | null;
  /** Apply an action for the player whose turn it is. Never throws for bad input. */
  act(playerId: string, action: PlayerAction): { ok: true } | { ok: false; error: string };
  /**
   * Fold a player regardless of whose turn it is (kick / leave). No-op if already folded
   * or the hand is complete. If it was their turn, action moves on.
   */
  forceFold(playerId: string): void;
  /** Only valid in phase 'roundComplete': collect bets into pots, then deal the next street or resolve showdown. */
  advance(): void;
  /**
   * True when no further betting is possible but the board is not complete
   * (all-in runout). Hole cards of all non-folded players should be face up.
   */
  isRunout(): boolean;
  /** Hole cards that are currently face up for everyone (runout or showdown). */
  faceUpCards(): Record<string, Card[]>;
  /** Returns and clears accumulated log events. */
  drainEvents(): EngineEvent[];
}
