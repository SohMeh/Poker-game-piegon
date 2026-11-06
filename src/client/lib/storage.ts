// Safe localStorage access: private windows, blocked storage and quota errors must never crash the app.
// Every value is also kept in memory for the life of the page, so when storage is blocked (iOS
// "Block All Cookies", sandboxed webviews) a seat's token still survives reconnects.

const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readString(key: string): string | null {
  try {
    const v = storage()?.getItem(key);
    if (v != null) return v;
  } catch {
    /* fall back to memory */
  }
  return memory.get(key) ?? null;
}

export function writeString(key: string, value: string): void {
  memory.set(key, value);
  try {
    storage()?.setItem(key, value);
  } catch {
    /* ignore: the in-memory copy is used */
  }
}

export function readJSON<T>(key: string): T | null {
  const raw = readString(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown): void {
  let raw: string;
  try {
    raw = JSON.stringify(value);
  } catch {
    return;
  }
  writeString(key, raw);
}

export function removeKey(key: string): void {
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}
