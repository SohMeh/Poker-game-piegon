import { describe, expect, it } from 'vitest';
import type { Card } from './cards';
import { compareHands, evaluateHand, HAND_CATEGORY_NAMES } from './evaluator';

const h = (s: string): Card[] => s.trim().split(/\s+/) as Card[];
const ev = (s: string) => evaluateHand(h(s));
/** sign of a vs b */
const cmp = (a: string, b: string) => Math.sign(compareHands(ev(a), ev(b)));

describe('evaluateHand categories and names', () => {
  const cases: [string, number, string][] = [
    ['As Ks Qs Js Ts', 8, 'Royal Flush'],
    ['Kh Qh Jh Th 9h', 8, 'Straight Flush, King high'],
    ['5d 4d 3d 2d Ad', 8, 'Straight Flush, Five high'],
    ['Ac Ad Ah As 2c', 7, 'Four of a Kind, Aces'],
    ['Kc Kd Kh 2s 2c', 6, 'Full House, Kings full of Twos'],
    ['Ah 9h 7h 4h 2h', 5, 'Flush, Ace high'],
    ['5c 4d 3h 2s Ac', 4, 'Straight, Five high'],
    ['Ac Kd Qh Js Tc', 4, 'Straight, Ace high'],
    ['7c 7d 7h Ks 2c', 3, 'Three of a Kind, Sevens'],
    ['Ac Ad 7h 7s 2c', 2, 'Two Pair, Aces and Sevens'],
    ['Tc Td 7h 5s 2c', 1, 'Pair of Tens'],
    ['Ac Jd 7h 5s 2c', 0, 'High Card, Ace'],
    ['6c 6d 6h 6s Kc', 7, 'Four of a Kind, Sixes'],
    ['Qc Jd 9h 5s 3c', 0, 'High Card, Queen'],
  ];
  it.each(cases)('%s -> %s', (cards, category, name) => {
    const r = ev(cards);
    expect(r.category).toBe(category);
    expect(r.name).toBe(name);
    expect(r.best5).toHaveLength(5);
  });

  it('category names table', () => {
    expect(HAND_CATEGORY_NAMES).toEqual([
      'High Card',
      'Pair',
      'Two Pair',
      'Three of a Kind',
      'Straight',
      'Flush',
      'Full House',
      'Four of a Kind',
      'Straight Flush',
    ]);
  });

  it('categories are ordered', () => {
    const ordered = [
      'Ac Jd 7h 5s 2c',
      'Tc Td 7h 5s 2c',
      'Ac Ad 7h 7s 2c',
      '7c 7d 7h Ks 2c',
      '5c 4d 3h 2s Ac',
      'Ah 9h 7h 4h 2h',
      'Kc Kd Kh 2s 2c',
      'Ac Ad Ah As 2c',
      '5d 4d 3d 2d Ad',
      'As Ks Qs Js Ts',
    ];
    for (let i = 1; i < ordered.length; i++) expect(cmp(ordered[i]!, ordered[i - 1]!)).toBe(1);
  });
});

describe('tie-breaking', () => {
  it('high card compares all five cards', () => {
    expect(cmp('Ac Kd 9h 5s 3c', 'Ah Kc 9d 5h 2d')).toBe(1);
    expect(cmp('Ac Kd 9h 5s 3c', 'Ah Kc 9d 5h 3d')).toBe(0);
  });
  it('pair kickers', () => {
    expect(cmp('Ac Ad Kh 5s 3c', 'Ah As Qc Jd Td')).toBe(1);
    expect(cmp('Ac Ad Kh 5s 4c', 'Ah As Kc 5d 3d')).toBe(1);
    expect(cmp('Kc Kd Ah 5s 4c', 'Ah As 2c 3d 4d')).toBe(-1);
  });
  it('two pair: high pair, low pair, then kicker', () => {
    expect(cmp('Ac Ad 3h 3s Kc', 'Kh Ks Qc Qd Ad')).toBe(1);
    expect(cmp('Ac Ad 7h 7s 2c', 'Ah As 6c 6d Kd')).toBe(1);
    expect(cmp('Ac Ad 7h 7s Kc', 'Ah As 7c 7d Qd')).toBe(1);
    expect(cmp('Ac Ad 7h 7s Kc', 'Ah As 7c 7d Kd')).toBe(0);
  });
  it('trips kickers', () => {
    expect(cmp('7c 7d 7h As 2c', '7s 7d 7h Ks Qc')).toBe(1);
    expect(cmp('8c 8d 8h 2s 3c', '7s 7d 7h As Kc')).toBe(1);
  });
  it('straights by top card; wheel is lowest', () => {
    expect(cmp('6c 5d 4h 3s 2c', '5c 4d 3h 2s Ac')).toBe(1);
    expect(cmp('Ac Kd Qh Js Tc', 'Kc Qd Jh Ts 9c')).toBe(1);
    expect(cmp('Ac Kd Qh Js Tc', 'As Kh Qd Jc Th')).toBe(0);
  });
  it('flush ranked by all five cards', () => {
    expect(cmp('Ah Kh 9h 5h 3h', 'Ac Kc 9c 5c 2c')).toBe(1);
    expect(cmp('Ah Qh Jh Th 8h', 'Ac Kc 4c 3c 2c')).toBe(-1);
    expect(cmp('Ah Kh 9h 5h 3h', 'As Ks 9s 5s 3s')).toBe(0);
  });
  it('flush beats straight; full house beats flush', () => {
    expect(cmp('2h 4h 6h 8h Th', 'Ac Kd Qh Js Tc')).toBe(1);
    expect(cmp('2c 2d 2h 3s 3c', 'Ah Kh Qh Jh 9h')).toBe(1);
  });
  it('full house: trips first, then pair', () => {
    expect(cmp('3c 3d 3h 2s 2c', '2h 2d 2s As Ac')).toBe(1);
    expect(cmp('Kc Kd Kh 3s 3c', 'Kc Kd Kh 2s 2c')).toBe(1);
  });
  it('quads kicker', () => {
    expect(cmp('9c 9d 9h 9s Ac', '9c 9d 9h 9s Kc')).toBe(1);
    expect(cmp('Tc Td Th Ts 2c', '9c 9d 9h 9s Ac')).toBe(1);
  });
  it('straight flush by top card; steel wheel lowest', () => {
    expect(cmp('6d 5d 4d 3d 2d', '5h 4h 3h 2h Ah')).toBe(1);
    expect(cmp('As Ks Qs Js Ts', 'Kh Qh Jh Th 9h')).toBe(1);
  });
});

describe('7-card selection', () => {
  it('picks the best five of seven', () => {
    const r = ev('Ah Kh 2c 3d 7h 9h Qh');
    expect(r.name).toBe('Flush, Ace high');
    expect(r.best5).toEqual(h('Ah Kh Qh 9h 7h'));
  });
  it('flush uses the best five suited cards of six', () => {
    const r = ev('Ah 2h 3h 4h 9h Th Kc');
    expect(r.best5).toEqual(h('Ah Th 9h 4h 3h'));
  });
  it('picks the highest straight from six connected cards', () => {
    expect(ev('4c 5d 6h 7s 8c 9d 2h').name).toBe('Straight, Nine high');
  });
  it('wheel with extra cards, best5 ordered 5,4,3,2,A', () => {
    const r = ev('Ac 2d 3h 4s 5c Kd Kh');
    expect(r.name).toBe('Straight, Five high');
    expect(r.best5).toEqual(h('5c 4s 3h 2d Ac'));
  });
  it('six-high straight beats wheel when both present', () => {
    expect(ev('Ac 2d 3h 4s 5c 6d Kh').name).toBe('Straight, Six high');
  });
  it('straight flush beats a higher plain straight in the same 7', () => {
    const r = ev('5s 6s 7s 8s 9s Td Jc');
    expect(r.name).toBe('Straight Flush, Nine high');
    expect(r.best5).toEqual(h('9s 8s 7s 6s 5s'));
  });
  it('steel wheel from seven cards', () => {
    const r = ev('As 2s 3s 4s 5s Kd Kh');
    expect(r.name).toBe('Straight Flush, Five high');
    expect(r.best5).toEqual(h('5s 4s 3s 2s As'));
  });
  it('royal flush from seven cards', () => {
    expect(ev('As Ks Qs Js Ts 9s 2d').name).toBe('Royal Flush');
  });
  it('two trips -> best full house', () => {
    const r = ev('Kc Kd Kh 2s 2c 2d 9h');
    expect(r.name).toBe('Full House, Kings full of Twos');
    expect(r.best5.slice(0, 3).every((c) => c[0] === 'K')).toBe(true);
    expect(r.best5.slice(3).every((c) => c[0] === '2')).toBe(true);
  });
  it('two trips: lower trips play as the pair even above a pair', () => {
    expect(ev('7c 7d 7h 9s 9c 9d Ah').name).toBe('Full House, Nines full of Sevens');
  });
  it('trips + two pairs -> trips full of the higher pair', () => {
    expect(ev('5c 5d 5h Qs Qc 8d 8h').name).toBe('Full House, Fives full of Queens');
  });
  it('three pairs -> two best pairs with best kicker', () => {
    const r = ev('Ac Ad Kh Ks Qc Qd 2h');
    expect(r.name).toBe('Two Pair, Aces and Kings');
    expect(r.best5[4]![0]).toBe('Q');
  });
  it('quads with a pair uses the highest kicker', () => {
    const r = ev('4c 4d 4h 4s 2c 2d Kh');
    expect(r.name).toBe('Four of a Kind, Fours');
    expect(r.best5[4]).toBe('Kh');
  });
  it('quads beat a full house in the same seven', () => {
    expect(ev('Jc Jd Jh Js Qc Qd Qh').name).toBe('Four of a Kind, Jacks');
  });
  it('flush beats straight in the same seven', () => {
    expect(ev('9h 8h 7c 6h 5d 2h Kh').name).toBe('Flush, King high');
  });
  it('best5 is ordered by importance', () => {
    expect(ev('2c 9d 9h Ks 3c 7d 4h').best5).toEqual(h('9h 9d Ks 7d 4h'));
    expect(ev('2c 9d 9h Ks Kc 7d 4h').best5).toEqual(h('Ks Kc 9h 9d 7d'));
    expect(ev('Tc Td Th 3s 3c').best5.map((c) => c[0])).toEqual(['T', 'T', 'T', '3', '3']);
  });
  it('board plays: both players split', () => {
    const board = 'Ac Kd Qh Js Tc';
    expect(cmp(`2c 3d ${board}`, `4h 5s ${board}`)).toBe(0);
  });
  it('kicker on the board vs kicker in hand', () => {
    const board = 'Ac Ad 9h 7s 2c';
    expect(cmp(`Kc 3d ${board}`, `Qh Js ${board}`)).toBe(1);
    // both kickers lower than the board's: board's kickers play, split
    expect(cmp(`4c 3d Ac Ad Kh Qs Jc`, `5h 3s Ac Ad Kh Qs Jc`)).toBe(0);
  });
  it('6-card input works', () => {
    expect(ev('Ac Ad Ah Kc Kd 2s').name).toBe('Full House, Aces full of Kings');
  });
  it('fewer than five cards (client hints)', () => {
    expect(ev('Ac Ad').name).toBe('Pair of Aces');
    expect(ev('Ac Kd').name).toBe('High Card, Ace');
    expect(ev('Ac Ad Kc Kd').name).toBe('Two Pair, Aces and Kings');
    expect(cmp('Ac Ad', 'Kc Kd')).toBe(1);
  });
  it('rejects empty or oversize input', () => {
    expect(() => evaluateHand([])).toThrow(RangeError);
    expect(() => ev('Ac Ad Ah As Kc Kd Kh Ks')).toThrow(RangeError);
  });
  it('random 7-card hands agree with brute force over every 5-card subset', () => {
    const deck = h(
      '2c 3c 4c 5c 6c 7c 8c 9c Tc Jc Qc Kc Ac 2d 3d 4d 5d 6d 7d 8d 9d Td Jd Qd Kd Ad 2h 3h 4h 5h 6h 7h 8h 9h Th Jh Qh Kh Ah 2s 3s 4s 5s 6s 7s 8s 9s Ts Js Qs Ks As',
    );
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 2000; t++) {
      const d = [...deck];
      for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [d[i], d[j]] = [d[j]!, d[i]!];
      }
      const seven = d.slice(0, 7);
      const r = evaluateHand(seven);
      let best = -1;
      for (let a = 0; a < 7; a++)
        for (let b = a + 1; b < 7; b++) {
          const five = seven.filter((_, i) => i !== a && i !== b);
          best = Math.max(best, evaluateHand(five).score);
        }
      expect(r.score).toBe(best);
      expect(evaluateHand(r.best5).score).toBe(r.score);
      expect(new Set(r.best5).size).toBe(5);
      expect(r.best5.every((c) => seven.includes(c))).toBe(true);
    }
  });
});
