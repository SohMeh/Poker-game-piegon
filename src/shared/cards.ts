// Card primitives shared by server and client.
// A card is a 2-char string: rank + suit, e.g. "As" (ace of spades), "Td" (ten of diamonds).

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['c', 'd', 'h', 's'] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
export type Card = `${Rank}${Suit}`;

const RANK_SET = new Set<string>(RANKS);
const SUIT_SET = new Set<string>(SUITS);

export function isCard(value: unknown): value is Card {
  return (
    typeof value === 'string' && value.length === 2 && RANK_SET.has(value[0]!) && SUIT_SET.has(value[1]!)
  );
}

export function rankOf(card: Card): Rank {
  return card[0] as Rank;
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

/** 2..14 (ace high). */
export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 2;
}

export function cardRankValue(card: Card): number {
  return rankValue(rankOf(card));
}

/** Fresh, ordered 52-card deck. */
export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(`${r}${s}` as Card);
  return deck;
}

export const SUIT_SYMBOL: Record<Suit, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
export const SUIT_NAME: Record<Suit, string> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
export const RANK_LABEL: Record<Rank, string> = {
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  T: '10',
  J: 'J',
  Q: 'Q',
  K: 'K',
  A: 'A',
};

/** Human readable, e.g. "A♠", "10♦". */
export function cardLabel(card: Card): string {
  return `${RANK_LABEL[rankOf(card)]}${SUIT_SYMBOL[suitOf(card)]}`;
}

export function isRedSuit(card: Card): boolean {
  const s = suitOf(card);
  return s === 'd' || s === 'h';
}
