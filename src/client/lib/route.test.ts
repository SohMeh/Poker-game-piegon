import { describe, expect, it } from 'vitest';
import { extractRoomCode, isValidRoomCode, normalizeRoomCode, parsePath, roomPath } from './route';

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
});
