import { describe, expect, it } from 'vitest';
import { computePots, splitAmount } from './pots';

const c = (id: string, committed: number, folded = false) => ({ id, committed, folded });

describe('computePots', () => {
  it('single pot when everyone matched', () => {
    expect(computePots([c('a', 100), c('b', 100), c('c', 100)])).toEqual([
      { amount: 300, eligible: ['a', 'b', 'c'] },
    ]);
  });
  it('empty when nothing committed', () => {
    expect(computePots([c('a', 0), c('b', 0)])).toEqual([]);
  });
  it('layers by distinct live commitment levels', () => {
    expect(computePots([c('a', 100), c('b', 300), c('c', 600), c('d', 600)])).toEqual([
      { amount: 400, eligible: ['a', 'b', 'c', 'd'] },
      { amount: 600, eligible: ['b', 'c', 'd'] },
      { amount: 600, eligible: ['c', 'd'] },
    ]);
  });
  it('folded chips count but folded players are never eligible', () => {
    expect(computePots([c('a', 100), c('b', 250, true), c('c', 400)])).toEqual([
      { amount: 300, eligible: ['a', 'c'] },
      { amount: 450, eligible: ['c'] },
    ]);
  });
  it('merges adjacent layers with the same eligible set', () => {
    // folded player's level does not create a cut; equal sets merge
    expect(computePots([c('a', 50, true), c('b', 200), c('c', 200)])).toEqual([
      { amount: 450, eligible: ['b', 'c'] },
    ]);
  });
  it('folded chips above every live level go to the top pot', () => {
    expect(computePots([c('a', 500, true), c('b', 100), c('c', 300)])).toEqual([
      { amount: 300, eligible: ['b', 'c'] },
      { amount: 600, eligible: ['c'] },
    ]);
  });
  it('total always equals the sum of commitments', () => {
    let seed = 7;
    const rnd = (k: number) => {
      seed = (seed * 16807) % 2147483647;
      return seed % k;
    };
    for (let t = 0; t < 500; t++) {
      const n = 2 + rnd(9);
      const entries = Array.from({ length: n }, (_, i) => c(`p${i}`, rnd(5) * 100 + rnd(3), rnd(4) === 0));
      if (entries.every((e) => e.folded)) entries[0]!.folded = false;
      const pots = computePots(entries);
      const total = entries.reduce((s, e) => s + e.committed, 0);
      expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(total);
      for (const p of pots) {
        expect(p.amount).toBeGreaterThan(0);
        expect(p.eligible.length).toBeGreaterThan(0);
        for (const id of p.eligible) expect(entries.find((e) => e.id === id)!.folded).toBe(false);
      }
    }
  });
});

describe('splitAmount', () => {
  it('splits evenly with odd chips in the given order', () => {
    expect(splitAmount(100, ['a', 'b'])).toEqual([
      { playerId: 'a', amount: 50 },
      { playerId: 'b', amount: 50 },
    ]);
    expect(splitAmount(101, ['b', 'a'])).toEqual([
      { playerId: 'b', amount: 51 },
      { playerId: 'a', amount: 50 },
    ]);
    expect(splitAmount(11, ['a', 'b', 'c'])).toEqual([
      { playerId: 'a', amount: 4 },
      { playerId: 'b', amount: 4 },
      { playerId: 'c', amount: 3 },
    ]);
    expect(splitAmount(5, [])).toEqual([]);
  });
});
