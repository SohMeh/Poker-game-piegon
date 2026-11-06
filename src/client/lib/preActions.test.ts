import { describe, expect, it } from 'vitest';
import type { LegalActions } from '../../shared/types';
import { preActionStale, resolvePreAction, type PreAction } from './preActions';

const base: LegalActions = {
  canFold: true,
  canCheck: true,
  canCall: false,
  callAmount: 0,
  canRaise: true,
  isBet: true,
  minRaiseTo: 20,
  maxRaiseTo: 1000,
  currentBet: 0,
  myBet: 0,
  stack: 1000,
  pot: 100,
};
const facingBet: LegalActions = { ...base, canCheck: false, canCall: true, callAmount: 50, currentBet: 50, isBet: false, minRaiseTo: 100 };
const pre = (kind: PreAction['kind'], toCall = 0): PreAction => ({ kind, handNumber: 3, street: 'flop', toCall });

describe('resolvePreAction', () => {
  it('check/fold checks when free and folds when facing a bet', () => {
    expect(resolvePreAction(pre('checkFold'), base)).toEqual({ type: 'check' });
    expect(resolvePreAction(pre('checkFold'), facingBet)).toEqual({ type: 'fold' });
  });
  it('call any checks or calls', () => {
    expect(resolvePreAction(pre('callAny'), base)).toEqual({ type: 'check' });
    expect(resolvePreAction(pre('callAny'), facingBet)).toEqual({ type: 'call' });
  });
  it('exact call only fires for the armed amount', () => {
    expect(resolvePreAction(pre('call', 50), facingBet)).toEqual({ type: 'call' });
    expect(resolvePreAction(pre('call', 30), facingBet)).toBeNull();
    expect(resolvePreAction(pre('call', 0), base)).toEqual({ type: 'check' });
    expect(resolvePreAction(pre('call', 0), facingBet)).toBeNull();
  });
});

describe('preActionStale', () => {
  it('drops toggles on a new street or hand', () => {
    expect(preActionStale(pre('checkFold'), 3, 'flop', 0)).toBe(false);
    expect(preActionStale(pre('checkFold'), 3, 'turn', 0)).toBe(true);
    expect(preActionStale(pre('callAny'), 4, 'flop', 0)).toBe(true);
    expect(preActionStale(pre('callAny'), null, null, 0)).toBe(true);
  });
  it('drops an exact call when the bet changes', () => {
    expect(preActionStale(pre('call', 50), 3, 'flop', 50)).toBe(false);
    expect(preActionStale(pre('call', 50), 3, 'flop', 150)).toBe(true);
    expect(preActionStale(pre('checkFold'), 3, 'flop', 150)).toBe(false);
  });
});
