import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_ID_ALPHABET, TIMING } from '../../shared';
import { newPlayerId, newRoomId, newToken, normalizeRoomId } from './ids';
import { RoomManager } from './RoomManager';
import { checkSettings, nameSkeleton, normalizeName, parsePayload, schemas } from './validation';
import { DEFAULT_SETTINGS } from '../../shared';

describe('ids', () => {
  it('room ids are 6 chars from the alphabet; tokens are 32 random bytes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = newRoomId();
      expect(id).toHaveLength(6);
      for (const ch of id) expect(ROOM_ID_ALPHABET).toContain(ch);
      seen.add(id);
    }
    expect(seen.size).toBeGreaterThan(490);
    expect(Buffer.from(newToken(), 'base64url')).toHaveLength(32);
    expect(newPlayerId()).not.toBe(newPlayerId());
    expect(normalizeRoomId(' abcdef ')).toBe('ABCDEF');
    expect(normalizeRoomId('ABCDE0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeRoomId('ABC')).toBeNull();
    expect(normalizeRoomId(42)).toBeNull();
  });
});

describe('validation', () => {
  it('normalizes names and chat', () => {
    expect(normalizeName('  Bob \n\t  Smith​ ')).toBe('Bob Smith');
    expect(parsePayload(schemas.rename, { name: '   ' })).toEqual({ ok: false, error: 'Enter a name (1–16 characters)' });
    expect(parsePayload(schemas.rename, { name: 'x'.repeat(17) }).ok).toBe(false);
    expect(parsePayload(schemas.rename, { name: 7 }).ok).toBe(false);
    expect(parsePayload(schemas.chat, { text: '  hi\nthere ' })).toEqual({ ok: true, data: { text: 'hi there' } });
    expect(parsePayload(schemas.chat, { text: '' })).toEqual({ ok: false, error: 'Message is empty' });
    expect(parsePayload(schemas.seatTake, { seat: 1.5 })).toEqual({ ok: false, error: 'That seat does not exist' });
    expect(parsePayload(schemas.seatTake, null)).toEqual({ ok: false, error: 'Invalid request' });
    expect(parsePayload(schemas.action, { type: 'raise', amount: 'lots' }).ok).toBe(false);
    expect(parsePayload(schemas.empty, undefined).ok).toBe(true);
    expect(parsePayload(schemas.empty, {}).ok).toBe(true);
    expect(parsePayload(schemas.empty, 'x').ok).toBe(false);
    expect(parsePayload(schemas.settings, { bigBlind: 'big' })).toEqual({ ok: false, error: 'Big blind must be a number' });
  });

  it('rejects blank-rendering names and strips invisible characters', () => {
    for (const name of ['ㅤ', 'ᅟ', '⠀', '\u00ad', 'ﾠ', '\u034f', '\u180e', '\u200d', ' \u2800 \u3164 ']) {
      expect(parsePayload(schemas.rename, { name })).toEqual({ ok: false, error: 'Enter a name (1–16 characters)' });
    }
    expect(normalizeName('Al\u00adice')).toBe('Alice');
    expect(normalizeName('Bo\u200db')).toBe('Bob');
    expect(normalizeName('Ｂｏｂ')).toBe('Bob'); // NFKC folds full-width look-alikes
    expect(normalizeName('❤️ Kim')).toBe('❤️ Kim'); // emoji presentation selector kept
    expect([...normalizeName(`a${'\u0301'.repeat(15)}`)]).toHaveLength(4); // capped combining marks
    expect(parsePayload(schemas.rename, { name: 'José' })).toEqual({ ok: true, data: { name: 'José' } });
    expect(nameSkeleton('ALICE\ufe0f')).toBe(nameSkeleton('alice'));
  });

  it('checkSettings accepts the defaults', () => {
    expect(checkSettings(DEFAULT_SETTINGS, { started: false, currentBuyIn: 2000, highestUsedSeat: 0 })).toBeNull();
  });
});

describe('RoomManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('creates, finds (case-insensitive) and deletes rooms', () => {
    const m = new RoomManager();
    const room = m.create({ bigBlind: 50, smallBlind: 25, buyIn: 5000 });
    expect(m.get(room.id.toLowerCase())).toBe(room);
    expect(m.get('nope')).toBeUndefined();
    expect(room.getSettings()).toMatchObject({ bigBlind: 50, buyIn: 5000 });
    expect(() => m.create({ buyIn: 1 })).toThrow(/Buy-in/);
    expect(m.size).toBe(1);
    expect(m.delete(room.id)).toBe(true);
    expect(room.disposed).toBe(true);
    expect(m.get(room.id)).toBeUndefined();
    m.close();
  });

  /** A room where something happened (a friend joined), so it gets the full idle TTL. */
  function usedRoom(m: RoomManager) {
    const room = m.create();
    const host = room.addHost('Alice');
    room.join({ name: 'Bob' });
    return { room, host };
  }

  /** Two players seated and connected, one hand dealt, then everybody's phone goes away. */
  function dealtRoom(m: RoomManager) {
    const room = m.create();
    const host = room.addHost('Alice').playerId;
    const bob = room.join({ name: 'Bob' }).playerId;
    room.attach(host);
    room.attach(bob);
    room.takeSeat(bob, 1);
    room.start(host);
    room.detach(host);
    room.detach(bob);
    return room;
  }

  it('sweeps rooms with no connected sockets after the idle TTL', () => {
    const m = new RoomManager();
    const idle = usedRoom(m).room;
    const { room: busy, host } = usedRoom(m);
    busy.attach(host.playerId);
    const later = usedRoom(m).room;
    vi.advanceTimersByTime(TIMING.roomIdleTtlMs / 2);
    const fresh = usedRoom(m).room;
    vi.advanceTimersByTime(TIMING.roomIdleTtlMs / 2 + 60_000);
    expect(m.get(idle.id)).toBeUndefined();
    expect(m.get(later.id)).toBeUndefined();
    expect(m.get(busy.id)).toBe(busy);
    expect(m.get(fresh.id)).toBe(fresh);
    // the last socket leaves -> the countdown starts then
    busy.detach(host.playerId);
    vi.advanceTimersByTime(TIMING.roomIdleTtlMs - 120_000);
    expect(m.get(busy.id)).toBe(busy);
    vi.advanceTimersByTime(180_000);
    expect(m.get(busy.id)).toBeUndefined();
    expect(busy.disposed).toBe(true);
    m.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('abandoned tables (no hand dealt, nobody joined) are swept after a short TTL', () => {
    const m = new RoomManager();
    const lonely = m.create();
    const lonelyHost = lonely.addHost('Alice').playerId;
    lonely.attach(lonelyHost);
    lonely.detach(lonelyHost);
    const used = usedRoom(m).room;
    const dealt = dealtRoom(m);
    expect(lonely.isAbandoned()).toBe(true);
    expect(used.isAbandoned()).toBe(false);
    expect(dealt.hasDealt()).toBe(true);
    vi.advanceTimersByTime(TIMING.abandonedRoomIdleTtlMs - 60_000);
    expect(m.get(lonely.id)).toBe(lonely);
    vi.advanceTimersByTime(120_000);
    expect(m.get(lonely.id)).toBeUndefined();
    expect(m.get(used.id)).toBe(used);
    expect(m.get(dealt.id)).toBe(dealt);
    // a real game keeps the long TTL, even after a rematch reset its hand counter
    dealt.rematch(dealt.getHostId());
    expect(dealt.hasDealt()).toBe(true);
    vi.advanceTimersByTime(TIMING.roomIdleTtlMs / 2);
    expect(m.get(dealt.id)).toBe(dealt);
    m.close();
  });

  it('at the room cap, idle rooms make way (never-dealt first, longest empty first)', () => {
    const m = new RoomManager({ maxRooms: 4 });
    const dealt = dealtRoom(m); // empty since t=0, but a real game
    vi.advanceTimersByTime(1000);
    const old = m.create(); // empty since t=1s, nothing happened
    vi.advanceTimersByTime(1000);
    const newer = m.create();
    const live = m.create();
    live.attach(live.addHost('Alice').playerId);
    // full: the oldest empty never-dealt room goes first
    const r5 = m.create();
    expect(m.get(old.id)).toBeUndefined();
    expect(m.get(newer.id)).toBe(newer);
    expect(m.get(dealt.id)).toBe(dealt);
    expect(m.size).toBe(4);
    r5.attach(r5.addHost('Bo').playerId);
    m.create(); // evicts `newer`
    expect(m.get(newer.id)).toBeUndefined();
    expect(m.get(dealt.id)).toBe(dealt);
    m.close();
  });

  it('only refuses new rooms when every room has somebody connected', () => {
    const m = new RoomManager({ maxRooms: 2 });
    for (let i = 0; i < 2; i++) {
      const r = m.create();
      r.attach(r.addHost(`H${i}`).playerId);
    }
    expect(() => m.create()).toThrow(/busy/);
    m.close();
  });

  it('a flood of throwaway rooms cannot lock out the next host', () => {
    const m = new RoomManager({ maxRooms: 50 });
    for (let i = 0; i < 500; i++) {
      const r = m.create();
      const h = r.addHost('Spam').playerId;
      r.attach(h);
      r.detach(h);
    }
    expect(m.size).toBe(50);
    const mine = m.create();
    expect(m.get(mine.id)).toBe(mine);
    m.close();
  });
});
