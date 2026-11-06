import { LIMITS, ROOM_ID_ALPHABET } from '../../shared/constants';

export type Route = { name: 'home' } | { name: 'room'; roomId: string; valid: boolean };

const ROOM_RE = new RegExp(`^[${ROOM_ID_ALPHABET}]{${LIMITS.roomIdLength}}$`);

/** Upper-cases and strips anything that cannot be part of a room code. */
export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, LIMITS.roomIdLength);
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_RE.test(code);
}

/** "/" -> home; "/g/abc123" -> room ABC123. Anything else -> home. */
export function parsePath(pathname: string): Route {
  const m = /^\/g\/([^/?#]+)\/?$/i.exec(pathname);
  if (m) {
    let raw = m[1]!;
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    const upper = raw.trim().toUpperCase();
    return { name: 'room', roomId: upper, valid: isValidRoomCode(upper) };
  }
  return { name: 'home' };
}

export function roomPath(roomId: string): string {
  return `/g/${roomId.toUpperCase()}`;
}

/** Accepts a bare code or a pasted link (".../g/ABC123") and returns a normalised code. */
export function extractRoomCode(input: string): string {
  const m = /\/g\/([A-Za-z0-9]+)/.exec(input);
  return normalizeRoomCode(m ? m[1]! : input);
}
