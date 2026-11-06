import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A window whose localStorage access throws, like iOS Safari with "Block All Cookies". */
function blockedWindow() {
  return {
    get localStorage(): Storage {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  };
}

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('sessions with blocked storage', () => {
  it('the seat token survives in memory for the life of the page', async () => {
    vi.stubGlobal('window', blockedWindow());
    const s = await import('./session');
    s.saveSession('abcdef', { token: 't1', playerId: 'p1' });
    expect(s.loadSession('ABCDEF')).toEqual({ token: 't1', playerId: 'p1' });
    s.saveName(' Sam ');
    expect(s.loadName()).toBe('Sam');
    s.clearSession('ABCDEF');
    expect(s.loadSession('ABCDEF')).toBeNull();
  });

  it('works the same when a quota error makes writes fail', async () => {
    const store = fakeStorage();
    store.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    vi.stubGlobal('window', { localStorage: store });
    const s = await import('./session');
    s.saveSession('ABCDEF', { token: 't2', playerId: 'p2' });
    expect(s.loadSession('abcdef')?.token).toBe('t2');
  });

  it('uses real storage when it works (shared with other tabs)', async () => {
    const store = fakeStorage();
    vi.stubGlobal('window', { localStorage: store });
    const s = await import('./session');
    s.saveSession('ABCDEF', { token: 't3', playerId: 'p3' });
    expect(JSON.parse(store.getItem('flock:session:ABCDEF')!)).toEqual({ token: 't3', playerId: 'p3' });
    store.setItem('flock:session:ZZZZZZ', JSON.stringify({ token: 'other-tab', playerId: 'p9' }));
    expect(s.loadSession('ZZZZZZ')?.token).toBe('other-tab');
  });
});

describe('kicked marker', () => {
  it('remembers the removal (and the refused token) per room', async () => {
    vi.stubGlobal('window', { localStorage: fakeStorage() });
    const s = await import('./session');
    expect(s.wasKicked('ABCDEF')).toBe(false);
    s.markKicked('abcdef', 'tok');
    expect(s.wasKicked('ABCDEF')).toBe(true);
    expect(s.kickedToken('ABCDEF')).toBe('tok');
    s.markKicked('BCDEFG', null);
    expect(s.wasKicked('BCDEFG')).toBe(true);
    expect(s.kickedToken('BCDEFG')).toBeUndefined();
    expect(s.wasKicked('CDEFGH')).toBe(false);
  });
});
