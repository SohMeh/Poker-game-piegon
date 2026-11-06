import { describe, expect, it } from 'vitest';
import { cardLabel, fullDeck, isCard } from './cards';

describe('cards', () => {
  it('builds a 52 card deck of unique valid cards', () => {
    const deck = fullDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
    expect(deck.every(isCard)).toBe(true);
  });
  it('labels cards', () => {
    expect(cardLabel('As')).toBe('A♠');
    expect(cardLabel('Td')).toBe('10♦');
    expect(isCard('1s')).toBe(false);
  });
});
