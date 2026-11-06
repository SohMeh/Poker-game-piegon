// Poker hand evaluator. PURE: no Node imports — the browser client uses it for hand hints.
//
// evaluateHand() takes 1..7 cards and returns the best five-card hand (fewer cards are
// allowed for client hints, e.g. preflop "Pair of Aces"; with fewer than five cards only
// high card / pairs / trips / quads are possible and best5 holds every card).
import { cardRankValue, suitOf, type Card, type Suit } from './cards';

export interface HandRank {
  /** Larger is better; equal scores tie. */
  score: number;
  /** 0 high card .. 8 straight flush. */
  category: number;
  /** e.g. "Flush, Ace high", "Straight, Five high", "Royal Flush". */
  name: string;
  /** The five cards making the hand, ordered by importance (e.g. pair cards first, then kickers). */
  best5: Card[];
}

export const HAND_CATEGORY_NAMES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
] as const;

export const HAND_CATEGORY = {
  highCard: 0,
  pair: 1,
  twoPair: 2,
  threeOfAKind: 3,
  straight: 4,
  flush: 5,
  fullHouse: 6,
  fourOfAKind: 7,
  straightFlush: 8,
} as const;

/** Indexed by rank value 2..14. */
const RANK_SINGULAR: readonly string[] = [
  '',
  '',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Jack',
  'Queen',
  'King',
  'Ace',
];
const RANK_PLURAL: readonly string[] = [
  '',
  '',
  'Twos',
  'Threes',
  'Fours',
  'Fives',
  'Sixes',
  'Sevens',
  'Eights',
  'Nines',
  'Tens',
  'Jacks',
  'Queens',
  'Kings',
  'Aces',
];

/** Suit order used only to make best5 deterministic within equal ranks. */
const SUIT_ORDER: Record<Suit, number> = { s: 0, h: 1, d: 2, c: 3 };

function singular(v: number): string {
  return RANK_SINGULAR[v] ?? '?';
}
function plural(v: number): string {
  return RANK_PLURAL[v] ?? '?';
}

/** Score = category * 16^5 + up to five tie-break rank values (base 16, most significant first). */
function makeScore(category: number, tiebreak: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 16 + (tiebreak[i] ?? 0);
  return score;
}

function byRankDesc(a: Card, b: Card): number {
  return cardRankValue(b) - cardRankValue(a) || SUIT_ORDER[suitOf(a)] - SUIT_ORDER[suitOf(b)];
}

/**
 * Given cards sorted by rank descending, returns the cards forming the highest straight
 * (ordered high -> low; the wheel is ordered 5,4,3,2,A) or null.
 */
function findStraight(sortedDesc: Card[]): Card[] | null {
  // one card per distinct rank, highest first
  const distinct: Card[] = [];
  for (const c of sortedDesc) {
    const last = distinct[distinct.length - 1];
    if (!last || cardRankValue(last) !== cardRankValue(c)) distinct.push(c);
  }
  if (distinct.length < 5) return null;
  for (let i = 0; i + 4 < distinct.length; i++) {
    const top = cardRankValue(distinct[i]!);
    if (cardRankValue(distinct[i + 4]!) === top - 4) return distinct.slice(i, i + 5);
  }
  // wheel: A-2-3-4-5
  const ace = distinct[0]!;
  if (cardRankValue(ace) === 14) {
    const low = distinct.slice(-4);
    if (low.map(cardRankValue).join(',') === '5,4,3,2') return [...low, ace];
  }
  return null;
}

function result(category: number, best5: Card[], tiebreak: number[], name: string): HandRank {
  return { score: makeScore(category, tiebreak), category, name, best5 };
}

/**
 * Best five-card hand from 1..7 cards (normally 5, 6 or 7: hole cards + board).
 * Throws a RangeError for 0 or more than 7 cards.
 */
export function evaluateHand(cards: readonly Card[]): HandRank {
  if (cards.length < 1 || cards.length > 7) {
    throw new RangeError(`evaluateHand expects 1..7 cards, got ${cards.length}`);
  }
  const sorted = [...cards].sort(byRankDesc);

  // ---- flush / straight flush ----
  const bySuit = new Map<Suit, Card[]>();
  for (const c of sorted) {
    const s = suitOf(c);
    const list = bySuit.get(s);
    if (list) list.push(c);
    else bySuit.set(s, [c]);
  }
  let flushCards: Card[] | null = null;
  for (const list of bySuit.values()) {
    if (list.length >= 5) flushCards = list; // at most one suit can have 5+ of 7 cards
  }
  if (flushCards) {
    const sf = findStraight(flushCards);
    if (sf) {
      const high = cardRankValue(sf[0]!);
      const name = high === 14 ? 'Royal Flush' : `Straight Flush, ${singular(high)} high`;
      return result(8, sf, [high], name);
    }
  }

  // ---- rank groups: count desc, rank desc ----
  const groupMap = new Map<number, Card[]>();
  for (const c of sorted) {
    const v = cardRankValue(c);
    const list = groupMap.get(v);
    if (list) list.push(c);
    else groupMap.set(v, [c]);
  }
  const groups = [...groupMap.entries()]
    .map(([value, list]) => ({ value, cards: list }))
    .sort((a, b) => b.cards.length - a.cards.length || b.value - a.value);
  const g0 = groups[0]!;
  const g1 = groups[1];

  /** Highest `count` cards not in `used`, rank descending. */
  const kickers = (used: Card[], count: number): Card[] => {
    const usedSet = new Set(used);
    return sorted.filter((c) => !usedSet.has(c)).slice(0, count);
  };

  // ---- four of a kind ----
  if (g0.cards.length === 4) {
    const quad = g0.cards;
    const k = kickers(quad, 1);
    return result(7, [...quad, ...k], [g0.value, ...k.map(cardRankValue)], `Four of a Kind, ${plural(g0.value)}`);
  }

  // ---- full house (best trips + best other group of 2+, handles two trips) ----
  if (g0.cards.length === 3) {
    let pairGroup: { value: number; cards: Card[] } | null = null;
    for (const g of groups.slice(1)) {
      if (g.cards.length >= 2 && (!pairGroup || g.value > pairGroup.value)) pairGroup = g;
    }
    if (pairGroup) {
      const best5 = [...g0.cards, ...pairGroup.cards.slice(0, 2)];
      return result(
        6,
        best5,
        [g0.value, pairGroup.value],
        `Full House, ${plural(g0.value)} full of ${plural(pairGroup.value)}`,
      );
    }
  }

  // ---- flush ----
  if (flushCards) {
    const best5 = flushCards.slice(0, 5);
    const high = cardRankValue(best5[0]!);
    return result(5, best5, best5.map(cardRankValue), `Flush, ${singular(high)} high`);
  }

  // ---- straight ----
  const straight = findStraight(sorted);
  if (straight) {
    const high = cardRankValue(straight[0]!);
    return result(4, straight, [high], `Straight, ${singular(high)} high`);
  }

  // ---- three of a kind ----
  if (g0.cards.length === 3) {
    const k = kickers(g0.cards, 2);
    return result(
      3,
      [...g0.cards, ...k],
      [g0.value, ...k.map(cardRankValue)],
      `Three of a Kind, ${plural(g0.value)}`,
    );
  }

  // ---- two pair ----
  if (g0.cards.length === 2 && g1 && g1.cards.length === 2) {
    const made = [...g0.cards, ...g1.cards];
    const k = kickers(made, 1);
    return result(
      2,
      [...made, ...k],
      [g0.value, g1.value, ...k.map(cardRankValue)],
      `Two Pair, ${plural(g0.value)} and ${plural(g1.value)}`,
    );
  }

  // ---- one pair ----
  if (g0.cards.length === 2) {
    const k = kickers(g0.cards, 3);
    return result(1, [...g0.cards, ...k], [g0.value, ...k.map(cardRankValue)], `Pair of ${plural(g0.value)}`);
  }

  // ---- high card ----
  const best5 = sorted.slice(0, 5);
  return result(0, best5, best5.map(cardRankValue), `High Card, ${singular(g0.value)}`);
}

/** > 0 when `a` beats `b`, < 0 when `b` wins, 0 for a tie. */
export function compareHands(a: HandRank, b: HandRank): number {
  return a.score - b.score;
}
