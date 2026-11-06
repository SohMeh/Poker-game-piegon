// Per-room session tokens and the last used display name, in localStorage.
import { readJSON, readString, removeKey, writeJSON, writeString } from '../lib/storage';

export interface StoredSession {
  token: string;
  playerId: string;
}

const sessionKey = (roomId: string) => `flock:session:${roomId.toUpperCase()}`;
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

export function loadName(): string {
  return readString(NAME_KEY) ?? '';
}

export function saveName(name: string): void {
  writeString(NAME_KEY, name.trim());
}
