import { describe, expect, it } from 'vitest';
import type { LegalActions } from '../../shared/types';
import { armPreAction, preActionApplies, preActionStale, resolvePreAction, type PreAction } from './preActions';

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

describe('arming during the "Dealing…" pause', () => {
  it('a toggle armed while the flop is dealt applies to the flop, not the finished preflop', () => {
    const p = armPreAction('checkFold', { handNumber: 3, street: 'preflop', phase: 'dealing' }, 40);
    expect(p).toEqual({ kind: 'checkFold', handNumber: 3, street: 'preflop', toCall: 0, nextStreet: true });
    // still dealing: kept
    expect(preActionStale(p, 3, 'preflop', 0)).toBe(false);
    // the flop arrives: kept, and it fires on my turn there
    expect(preActionStale(p, 3, 'flop', 0)).toBe(false);
    expect(preActionApplies(p, 3, 'flop')).toBe(true);
    expect(resolvePreAction(p, base)).toEqual({ type: 'check' });
    // ...but never two streets later, or in another hand
    expect(preActionStale(p, 3, 'turn', 0)).toBe(true);
    expect(preActionStale(p, 4, 'flop', 0)).toBe(true);
  });
  it('an exact "Check" armed while dealing is dropped once someone bets on the new street', () => {
    const p = armPreAction('call', { handNumber: 3, street: 'flop', phase: 'dealing' }, 0);
    expect(preActionStale(p, 3, 'turn', 0)).toBe(false);
    expect(preActionStale(p, 3, 'turn', 60)).toBe(true);
  });
  it('while betting, arming is for the current street as before', () => {
    const p = armPreAction('call', { handNumber: 3, street: 'flop', phase: 'betting' }, 50);
    expect(p).toEqual({ kind: 'call', handNumber: 3, street: 'flop', toCall: 50 });
    expect(preActionStale(p, 3, 'turn', 0)).toBe(true);
    expect(preActionApplies(p, 3, 'turn')).toBe(false);
  });
});

describe('pre-actions against a real room', () => {
  it('a toggle tapped during "Dealing…" survives the flop and fires for the first player to act', async () => {
    const { vi } = await import('vitest');
    const { advanceUntil, makeTable } = await import('../../server/room/test-utils');
    const { amountToCall, bottomMode, myPlayer } = await import('./gameState');
    vi.useFakeTimers();
    try {
      const t = makeTable({ names: ['Alice', 'Bob'] });
      const [a] = t.ids as [string, string];
      t.room.start(a);
      // heads-up preflop: the button calls, the big blind checks -> the flop is being dealt
      t.act(t.toAct()!, 'call');
      t.act(t.toAct()!, 'check');
      const firstOnFlop = t.ids.find((id) => id !== a)!; // big blind acts first after the flop
      const v = t.view(firstOnFlop);
      expect(v.hand?.phase).toBe('dealing');
      expect(bottomMode(v)).toBe('inHand');
      const pre = armPreAction('checkFold', v.hand!, amountToCall(v, myPlayer(v)));
      advanceUntil(() => t.view().hand?.street === 'flop' && t.view().hand?.phase === 'betting');
      const flop = t.view(firstOnFlop);
      expect(flop.me.legal).not.toBeNull();
      expect(preActionStale(pre, flop.hand!.handNumber, flop.hand!.street, amountToCall(flop, myPlayer(flop)))).toBe(false);
      expect(preActionApplies(pre, flop.hand!.handNumber, flop.hand!.street)).toBe(true);
      expect(resolvePreAction(pre, flop.me.legal!)).toEqual({ type: 'check' });
      t.room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
