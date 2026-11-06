import type { GameSettings } from './types';

export const APP_NAME = 'Flock Poker';

export const LIMITS = {
  minSeats: 2,
  maxSeats: 10,
  nameMaxLength: 16,
  chatMaxLength: 200,
  minBigBlind: 2,
  maxBigBlind: 1_000_000,
  /** buy-in must be between these multiples of the big blind */
  minBuyInBB: 10,
  maxBuyInBB: 1000,
  minTurnTimeSec: 10,
  maxTurnTimeSec: 300,
  minVoteSec: 10,
  maxVoteSec: 120,
  roomIdLength: 6,
} as const;

export const TURN_TIME_OPTIONS = [0, 15, 20, 30, 45, 60, 90, 120] as const;
export const VOTE_TIME_OPTIONS = [15, 20, 30, 45, 60, 90, 120] as const;

export const DEFAULT_SETTINGS: GameSettings = {
  smallBlind: 10,
  bigBlind: 20,
  buyIn: 2000,
  maxPlayers: 9,
  turnTimeSec: 30,
  buyBackVoteSec: 30,
  requireApproval: false,
  allowBuyBack: true,
};

/** Server pacing (ms). */
export const TIMING = {
  /** pause between a betting round closing and the next street being dealt */
  streetDelayMs: 700,
  /** pause per street during an all-in runout */
  runoutStreetDelayMs: 1600,
  /** results shown before next hand when the hand was won uncontested */
  nextHandDelayMs: 3000,
  /** results shown before next hand after a showdown */
  showdownNextHandDelayMs: 5500,
  /** when there is no shot clock, a disconnected actor is auto-folded/checked after this */
  disconnectActGraceMs: 30_000,
  /** a rejected buy-back requester must wait this long before asking again */
  buyBackCooldownMs: 30_000,
  /** resolved votes stay visible in RoomView this long */
  resolvedVoteVisibleMs: 6_000,
  /** empty / idle rooms are deleted after this */
  roomIdleTtlMs: 6 * 60 * 60 * 1000,
  /**
   * An abandoned table (never dealt a hand, nobody but its creator ever joined) is deleted after
   * this long with nobody connected, so throwaway tables cannot pile up.
   */
  abandonedRoomIdleTtlMs: 30 * 60 * 1000,
  /** consecutive shot-clock timeouts before a player is auto sat out */
  maxConsecutiveTimeouts: 2,
  /**
   * The host role moves to a connected player once the host has been disconnected this long
   * while others are still at the table (a locked phone must not stall approvals or rematches).
   */
  hostAwayTransferMs: 90_000,
} as const;

export const AVATAR_COLORS = [
  '#ff6b6b',
  '#ffa94d',
  '#ffd43b',
  '#69db7c',
  '#38d9a9',
  '#4dabf7',
  '#748ffc',
  '#b197fc',
  '#f783ac',
  '#20c997',
  '#ff922b',
  '#a9e34b',
] as const;

/**
 * room:join error for a stored token the room no longer knows (the record was pruned).
 * Only this error makes the client forget its session; any other join error keeps it.
 */
export const SESSION_EXPIRED_ERROR = 'Your session for this room has expired — enter a name to join again';

/**
 * room:join error for a token the host removed from the table. The device stays removed: it
 * cannot come back as a "new" player (with a fresh buy-in) from the same browser.
 */
export const KICKED_ERROR = 'The host removed you from this table';

/** Room code alphabet: no 0/O/1/I/L to avoid confusion when read aloud. */
export const ROOM_ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
