import { describe, expect, it } from 'vitest';
import type { LegalActions } from '../../shared/types';
import {
  callIsAllIn,
  clampRaise,
  onlyAllIn,
  potRaiseTo,
  raiseAction,
  raiseLabel,
  raisePresets,
  snapRaise,
  stepRaise,
} from './raise';

function legal(p: Partial<LegalActions> = {}): LegalActions {
  return {
    canFold: true,
    canCheck: false,
    canCall: true,
    callAmount: 40,
    canRaise: true,
    isBet: false,
    minRaiseTo: 80,
    maxRaiseTo: 1000,
    currentBet: 40,
    myBet: 0,
    stack: 1000,
    pot: 70,
    ...p,
  };
}

describe('potRaiseTo', () => {
  it('pot raise = currentBet + pot + call', () => {
    // pot 70 (blinds 10/20 + a 40 open), facing 40: pot-size raise to 40 + 70 + 40 = 150
    expect(potRaiseTo(legal(), 1)).toBe(150);
    expect(potRaiseTo(legal(), 0.5)).toBe(95);
    expect(potRaiseTo(legal(), 0.75)).toBe(Math.round(40 + 0.75 * 110));
  });
  it('opening bet uses the pot only', () => {
    const l = legal({ currentBet: 0, callAmount: 0, canCheck: true, canCall: false, isBet: true, minRaiseTo: 20, pot: 300 });
    expect(potRaiseTo(l, 1)).toBe(300);
    expect(potRaiseTo(l, 0.5)).toBe(150);
  });
  it('clamps to min and max', () => {
    expect(potRaiseTo(legal({ pot: 0, callAmount: 0, currentBet: 0, minRaiseTo: 20 }), 0.5)).toBe(20);
    expect(potRaiseTo(legal({ maxRaiseTo: 120 }), 1)).toBe(120);
  });
});

describe('clamp / snap / step', () => {
  it('clamps and rounds', () => {
    expect(clampRaise(10, legal())).toBe(80);
    expect(clampRaise(5000, legal())).toBe(1000);
    expect(clampRaise(123.6, legal())).toBe(124);
    expect(clampRaise(Number.NaN, legal())).toBe(80);
  });
  it('snaps to big blind multiples but keeps the ends reachable', () => {
    expect(snapRaise(131, legal(), 20)).toBe(140);
    expect(snapRaise(80, legal(), 20)).toBe(80);
    expect(snapRaise(1000, legal({ maxRaiseTo: 1000 }), 20)).toBe(1000);
    expect(snapRaise(995, legal({ maxRaiseTo: 997 }), 20)).toBe(997);
  });
  it('steps by the big blind', () => {
    expect(stepRaise(80, legal(), 20)).toBe(100);
    expect(stepRaise(80, legal(), -20)).toBe(80);
    expect(stepRaise(990, legal(), 20)).toBe(1000);
  });
});

describe('presets, labels and actions', () => {
  it('lists Min, half, three-quarter, pot and all-in', () => {
    const p = raisePresets(legal());
    expect(p.map((x) => x.label)).toEqual(['Min', '½ Pot', '¾ Pot', 'Pot', 'All-in']);
    expect(p[0]!.amount).toBe(80);
    expect(p[4]!.amount).toBe(1000);
  });
  it('labels raise / bet / all-in', () => {
    expect(raiseLabel(120, legal())).toBe('Raise to 120');
    expect(raiseLabel(120, legal({ isBet: true }))).toBe('Bet 120');
    expect(raiseLabel(1000, legal())).toBe('All-in 1,000');
  });
  it('sends allin at the max and raise otherwise', () => {
    expect(raiseAction(1000, legal())).toEqual({ type: 'allin' });
    expect(raiseAction(200, legal())).toEqual({ type: 'raise', amount: 200 });
    expect(raiseAction(10, legal())).toEqual({ type: 'raise', amount: 80 });
  });
  it('detects all-in only situations', () => {
    expect(onlyAllIn(legal({ minRaiseTo: 300, maxRaiseTo: 250 }))).toBe(true);
    expect(onlyAllIn(legal())).toBe(false);
    expect(callIsAllIn(legal({ callAmount: 300, stack: 300 }))).toBe(true);
    expect(callIsAllIn(legal())).toBe(false);
  });
});
