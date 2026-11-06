// Per-room session tokens and the last used display name, in localStorage (with an in-memory
// fallback, see lib/storage).
import { readJSON, readString, removeKey, writeJSON, writeString } from '../lib/storage';

export interface StoredSession {
  token: string;
  playerId: string;
}

const sessionKey = (roomId: string) => `flock:session:${roomId.toUpperCase()}`;
const kickedKey = (roomId: string) => `flock:kicked:${roomId.toUpperCase()}`;
const NAME_KEY = 'flock:name';

export function loadSession(roomId: string): StoredSession | null {
  const s = readJSON<StoredSession>(sessionKey(roomId));
  if (!s || typeof s.token !== 'string' || typeof s.playerId !== 'string' || !s.token) return null;
  return s;
}

export function saveSession(roomId: string, s: StoredSession): void {
  writeJSON(sessionKey(roomId), { token: s.token, playerId: s.playerId });
}

export function clearSession(roomId: string): void {
  removeKey(sessionKey(roomId));
}

/**
 * The host removed this device from the room: remember it (with the token, which the server
 * refuses) so reopening the link shows "Removed from the table" instead of a fresh join form.
 */
export function markKicked(roomId: string, token: string | null | undefined): void {
  writeString(kickedKey(roomId), token || '-');
}

export function wasKicked(roomId: string): boolean {
  return readString(kickedKey(roomId)) !== null;
}

/** The kicked token for this room (sent along with a name join so the server can refuse it). */
export function kickedToken(roomId: string): string | undefined {
  const t = readString(kickedKey(roomId));
  return t && t !== '-' ? t : undefined;
}

export function loadName(): string {
  return readString(NAME_KEY) ?? '';
}

export function saveName(name: string): void {
  writeString(NAME_KEY, name.trim());
}
