import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROOM_ID_ALPHABET, TIMING } from '../../shared';
import { newPlayerId, newRoomId, newToken, normalizeRoomId } from './ids';
import { RoomManager } from './RoomManager';
import { checkSettings, normalizeName, parsePayload, schemas } from './validation';
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

  it('sweeps rooms with no connected sockets after the idle TTL', () => {
    const m = new RoomManager();
    const idle = m.create();
    const busy = m.create();
    const host = busy.addHost('Alice');
    busy.attach(host.playerId);
    const later = m.create();
    vi.advanceTimersByTime(TIMING.roomIdleTtlMs / 2);
    const fresh = m.create();
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

  it('caps the number of rooms', () => {
    const m = new RoomManager({ maxRooms: 2 });
    m.create();
    m.create();
    expect(() => m.create()).toThrow(/busy/);
    m.close();
  });
});
