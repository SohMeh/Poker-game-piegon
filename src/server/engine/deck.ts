// Deck helpers for the hand engine.
//
// DEAL ORDER (fixed — the engine and stackedDeck() both rely on it):
//   Let `order` = dealOrder(seats, dealerSeat): every dealt-in seat, starting with the first
//   seat clockwise after the dealer (next higher seat index, wrapping), so the dealer is last.
//   Heads-up this means the non-dealer (big blind) gets the first card.
//   With n players and the deck top at index 0:
//     deck[i]       = first hole card of order[i]     (i = 0..n-1)
//     deck[n + i]   = second hole card of order[i]
//     deck[2n]      = burn
//     deck[2n+1..3] = flop
//     deck[2n+4]    = burn
//     deck[2n+5]    = turn
//     deck[2n+6]    = burn
//     deck[2n+7]    = river
import { randomInt } from 'node:crypto';
import { fullDeck, isCard, type Card } from '../../shared';

/** Fresh 52-card deck shuffled with a crypto-secure Fisher-Yates. */
export function shuffledDeck(): Card[] {
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

/**
 * Seats in deal order: starting with the first seat strictly clockwise after `dealerSeat`
 * (next higher index, wrapping), ending with the dealer. `dealerSeat` need not be in `seats`.
 */
export function dealOrder(seats: readonly number[], dealerSeat: number): number[] {
  const sorted = [...new Set(seats)].sort((a, b) => a - b);
  const start = sorted.findIndex((s) => s > dealerSeat);
  if (start <= 0) return sorted; // nobody after the dealer -> wrap to the lowest seat
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

/** Deck index of every board card (flop x3, turn, river) for `n` dealt-in players. */
export function boardDeckIndices(n: number): number[] {
  return [2 * n + 1, 2 * n + 2, 2 * n + 3, 2 * n + 5, 2 * n + 7];
}

/**
 * Test helper: builds a full 52-card deck that makes the engine deal exactly these cards.
 * - `holeInDealOrder[i]` = hole cards for the i-th player in dealOrder() (0..2 cards each;
 *   missing cards are filled).
 * - `board` = up to 5 board cards (flop, flop, flop, turn, river); missing cards are filled.
 * Burns and every unspecified position are filled with the remaining cards in fullDeck() order.
 * Throws on invalid or duplicate cards.
 */
export function stackedDeck(holeInDealOrder: readonly (readonly Card[])[], board: readonly Card[] = []): Card[] {
  const n = holeInDealOrder.length;
  if (2 * n + 8 > 52) throw new Error(`stackedDeck: too many players (${n})`);
  if (board.length > 5) throw new Error('stackedDeck: board has more than 5 cards');
  const deck: (Card | null)[] = new Array<Card | null>(52).fill(null);
  const used = new Set<Card>();
  const place = (index: number, card: Card) => {
    if (!isCard(card)) throw new Error(`stackedDeck: invalid card "${String(card)}"`);
    if (used.has(card)) throw new Error(`stackedDeck: duplicate card ${card}`);
    used.add(card);
    deck[index] = card;
  };
  holeInDealOrder.forEach((cards, i) => {
    if (cards.length > 2) throw new Error('stackedDeck: more than 2 hole cards for a player');
    if (cards[0] !== undefined) place(i, cards[0]);
    if (cards[1] !== undefined) place(n + i, cards[1]);
  });
  const boardIdx = boardDeckIndices(n);
  board.forEach((card, k) => place(boardIdx[k]!, card));
  const rest = fullDeck().filter((c) => !used.has(c));
  let r = 0;
  return deck.map((c) => c ?? rest[r++]!);
}
