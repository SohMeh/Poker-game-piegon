// Crypto-random identifiers.
import { randomBytes, randomInt } from 'node:crypto';
import { LIMITS, ROOM_ID_ALPHABET } from '../../shared';

/** 6-char room code from ROOM_ID_ALPHABET (no 0/O/1/I/L). */
export function newRoomId(): string {
  let id = '';
  for (let i = 0; i < LIMITS.roomIdLength; i++) id += ROOM_ID_ALPHABET[randomInt(ROOM_ID_ALPHABET.length)];
  return id;
}

/** Public player id (safe to share with everyone in the room). */
export function newPlayerId(): string {
  return randomBytes(9).toString('base64url');
}

/** Secret reconnect token: 32 random bytes, base64url. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Short id for chat messages and buy-back votes. */
export function newShortId(): string {
  return randomBytes(8).toString('base64url');
}

const ROOM_ID_RE = new RegExp(`^[${ROOM_ID_ALPHABET}]{${LIMITS.roomIdLength}}$`);

/** Upper-cases and trims a room code; returns null if it can never be a valid code. */
export function normalizeRoomId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toUpperCase();
  return ROOM_ID_RE.test(id) ? id : null;
}
