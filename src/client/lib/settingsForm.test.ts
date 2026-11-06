import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import { hasErrors, minSeatsAllowed, parseIntInput, settingsDiff, validateName, validateSettings } from './settingsForm';

describe('validateSettings', () => {
  it('accepts the defaults', () => {
    expect(hasErrors(validateSettings(DEFAULT_SETTINGS))).toBe(false);
  });
  it('checks blinds, buy-in range and seats', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, bigBlind: 1 }).bigBlind).toBeTruthy();
    expect(validateSettings({ ...DEFAULT_SETTINGS, smallBlind: 30 }).smallBlind).toBeTruthy();
    expect(validateSettings({ ...DEFAULT_SETTINGS, buyIn: 100 }).buyIn).toBeTruthy(); // < 10 BB
    expect(validateSettings({ ...DEFAULT_SETTINGS, buyIn: 20_001 }).buyIn).toBeTruthy(); // > 1000 BB
    expect(validateSettings({ ...DEFAULT_SETTINGS, maxPlayers: 11 }).maxPlayers).toBeTruthy();
    expect(validateSettings({ ...DEFAULT_SETTINGS, maxPlayers: 1 }).maxPlayers).toBeTruthy();
    expect(validateSettings({ ...DEFAULT_SETTINGS, turnTimeSec: 5 }).turnTimeSec).toBeTruthy();
    expect(validateSettings({ ...DEFAULT_SETTINGS, turnTimeSec: 0 }).turnTimeSec).toBeUndefined();
    expect(validateSettings({ ...DEFAULT_SETTINGS, buyBackVoteSec: 200 }).buyBackVoteSec).toBeTruthy();
  });
  it('validates names', () => {
    expect(validateName('  ')).toBeTruthy();
    expect(validateName('Sohum')).toBeNull();
    expect(validateName('x'.repeat(17))).toBeTruthy();
  });
  it('diffs, parses and limits seat count', () => {
    expect(settingsDiff(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, bigBlind: 40, smallBlind: 20 })).toEqual({
      bigBlind: 40,
      smallBlind: 20,
    });
    expect(parseIntInput('2,000')).toBe(2000);
    expect(parseIntInput('abc')).toBeNaN();
    expect(minSeatsAllowed([null, 'a', null, null, 'b', null])).toBe(5);
    expect(minSeatsAllowed([null, null, null])).toBe(2);
    // a seat someone is waiting on host approval for also counts
    expect(minSeatsAllowed([null, 'a', null, null, null, null, null], new Set([5]))).toBe(6);
  });
});
