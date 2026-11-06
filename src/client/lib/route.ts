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

/** Query flag the iMessage extension loads the page with (`?embed=imessage`); sticky for the page session. */
export const EMBED_PARAM = 'embed';
export const EMBED_IMESSAGE = 'imessage';

export function hasEmbedFlag(search: string): boolean {
  try {
    return new URLSearchParams(search).get(EMBED_PARAM) === EMBED_IMESSAGE;
  } catch {
    return false;
  }
}

/** "/g/ABC123" -> "/g/ABC123?embed=imessage" (keeps any other query and the hash). */
export function withEmbedFlag(path: string): string {
  const hashAt = path.indexOf('#');
  const hash = hashAt >= 0 ? path.slice(hashAt) : '';
  const rest = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const q = rest.indexOf('?');
  const pathname = q >= 0 ? rest.slice(0, q) : rest;
  const params = new URLSearchParams(q >= 0 ? rest.slice(q + 1) : '');
  params.set(EMBED_PARAM, EMBED_IMESSAGE);
  return `${pathname}?${params.toString()}${hash}`;
}

/** Accepts a bare code or a pasted link (".../g/ABC123") and returns a normalised code. */
export function extractRoomCode(input: string): string {
  const m = /\/g\/([A-Za-z0-9]+)/.exec(input);
  return normalizeRoomCode(m ? m[1]! : input);
}
