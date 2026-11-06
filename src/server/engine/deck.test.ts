import { describe, expect, it } from 'vitest';
import { fullDeck, isCard } from '../../shared';
import { boardDeckIndices, dealOrder, shuffledDeck, stackedDeck } from './deck';
import { cards } from './test-helpers';

describe('shuffledDeck', () => {
  it('returns 52 unique valid cards in varying order', () => {
    const a = shuffledDeck();
    const b = shuffledDeck();
    expect(a).toHaveLength(52);
    expect(new Set(a).size).toBe(52);
    expect(a.every(isCard)).toBe(true);
    expect(a.join()).not.toBe(b.join()); // 1 / 52! chance of a false failure
  });
  it('is roughly uniform for the top card', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 5200; i++) {
      const top = shuffledDeck()[0]!;
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    expect(counts.size).toBe(52);
    for (const c of counts.values()) expect(c).toBeGreaterThan(40); // expected 100
  });
});

describe('dealOrder', () => {
  it('starts left of the dealer and ends with the dealer', () => {
    expect(dealOrder([0, 1, 2], 0)).toEqual([1, 2, 0]);
    expect(dealOrder([0, 1, 2], 2)).toEqual([0, 1, 2]);
    expect(dealOrder([7, 1, 4], 4)).toEqual([7, 1, 4]);
    expect(dealOrder([3, 7], 7)).toEqual([3, 7]);
    expect(dealOrder([3, 7], 3)).toEqual([7, 3]);
  });
  it('works when the dealer seat is not dealt in', () => {
    expect(dealOrder([1, 4, 7], 5)).toEqual([7, 1, 4]);
    expect(dealOrder([1, 4, 7], 9)).toEqual([1, 4, 7]);
  });
});

describe('stackedDeck', () => {
  it('places hole cards and board at the documented indices', () => {
    const hole = [cards('As Ad'), cards('Ks Kd'), cards('Qs Qd')];
    const deck = stackedDeck(hole, cards('2c 3c 4c 5c 6c'));
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
    const n = 3;
    expect([deck[0], deck[n]]).toEqual(cards('As Ad'));
    expect([deck[1], deck[n + 1]]).toEqual(cards('Ks Kd'));
    expect([deck[2], deck[n + 2]]).toEqual(cards('Qs Qd'));
    expect(boardDeckIndices(n).map((i) => deck[i])).toEqual(cards('2c 3c 4c 5c 6c'));
  });
  it('fills unspecified positions with unused cards', () => {
    const deck = stackedDeck([cards('As'), []], cards('Kh'));
    expect(deck[0]).toBe('As');
    expect(deck[5]).toBe('Kh');
    expect(new Set(deck).size).toBe(52);
    expect([...deck].sort()).toEqual([...fullDeck()].sort());
  });
  it('rejects duplicates and invalid cards', () => {
    expect(() => stackedDeck([cards('As Ad'), cards('As Kd')], [])).toThrow(/duplicate/);
    expect(() => stackedDeck([cards('As Ad')], cards('Ad'))).toThrow(/duplicate/);
    expect(() => stackedDeck([['Xx' as never]], [])).toThrow(/invalid/);
    expect(() => stackedDeck([], cards('2c 3c 4c 5c 6c 7c'))).toThrow();
  });
});
