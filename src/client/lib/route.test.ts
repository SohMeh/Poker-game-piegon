import { describe, expect, it } from 'vitest';
import { extractRoomCode, hasEmbedFlag, isValidRoomCode, normalizeRoomCode, parsePath, roomPath, withEmbedFlag } from './route';

describe('routes', () => {
  it('parses home and room paths, normalising to upper case', () => {
    expect(parsePath('/')).toEqual({ name: 'home' });
    expect(parsePath('/whatever')).toEqual({ name: 'home' });
    expect(parsePath('/g/abcdef')).toEqual({ name: 'room', roomId: 'ABCDEF', valid: true });
    expect(parsePath('/g/ABC234/')).toEqual({ name: 'room', roomId: 'ABC234', valid: true });
  });
  it('flags invalid codes', () => {
    expect(parsePath('/g/abc')).toMatchObject({ name: 'room', valid: false });
    expect(parsePath('/g/ABCDE0')).toMatchObject({ valid: false }); // 0 is not in the alphabet
    expect(isValidRoomCode('HJKMNP')).toBe(true);
  });
  it('normalises typed and pasted codes', () => {
    expect(normalizeRoomCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(extractRoomCode('https://x.example/g/qwerty?x=1')).toBe('QWERTY');
    expect(roomPath('abcdef')).toBe('/g/ABCDEF');
  });
  it('keeps the iMessage embed flag on client-side paths', () => {
    expect(hasEmbedFlag('?embed=imessage')).toBe(true);
    expect(hasEmbedFlag('?create=1&embed=imessage')).toBe(true);
    expect(hasEmbedFlag('')).toBe(false);
    expect(hasEmbedFlag('?embed=other')).toBe(false);
    expect(withEmbedFlag('/g/ABCDEF')).toBe('/g/ABCDEF?embed=imessage');
    expect(withEmbedFlag('/')).toBe('/?embed=imessage');
    expect(withEmbedFlag('/?embed=imessage')).toBe('/?embed=imessage');
    expect(withEmbedFlag('/g/ABCDEF?x=1#top')).toBe('/g/ABCDEF?x=1&embed=imessage#top');
    // the room is still parsed from the path alone
    expect(parsePath(withEmbedFlag('/g/abcdef').split('?')[0]!)).toEqual({ name: 'room', roomId: 'ABCDEF', valid: true });
  });
});
