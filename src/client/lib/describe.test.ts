import { describe, expect, it } from 'vitest';
import type { BuyBackVoteView, HandWinner } from '../../shared/types';
import {
  handHint,
  lastActionLabel,
  preflopHint,
  tallyVote,
  voteOutcomeText,
  winnerLines,
  winningsByPlayer,
  withArticle,
} from './describe';

const names: Record<string, string> = { a: 'Alice', b: 'Bob', c: 'Carol' };
const nameOf = (id: string) => names[id] ?? 'Someone';
const w = (playerId: string, amount: number, potIndex = 0, handName: string | null = null): HandWinner => ({
  playerId,
  amount,
  potIndex,
  handName,
  bestCards: null,
});

describe('lastActionLabel', () => {
  it('labels actions and hides blinds', () => {
    expect(lastActionLabel({ type: 'raise', amount: 120 })).toBe('Raise 120');
    expect(lastActionLabel({ type: 'check', amount: 0 })).toBe('Check');
    expect(lastActionLabel({ type: 'call', amount: 40 })).toBe('Call 40');
    expect(lastActionLabel({ type: 'allin', amount: 900 })).toBe('All-in');
    expect(lastActionLabel({ type: 'bb', amount: 20 })).toBeNull();
    expect(lastActionLabel(null)).toBeNull();
  });
});

describe('winnerLines', () => {
  it('single winner with and without a hand name', () => {
    expect(winnerLines([w('a', 1240, 0, 'Flush, Ace high')], nameOf)).toEqual(['Alice wins 1,240 with a Flush, Ace high']);
    expect(winnerLines([w('b', 60)], nameOf)).toEqual(['Bob wins 60']);
    expect(winnerLines([w('a', 900, 0, 'Two Pair, Aces and Sevens'), w('a', 300, 1, 'Two Pair, Aces and Sevens')], nameOf)).toEqual([
      'Alice wins 1,200 with Two Pair, Aces and Sevens',
    ]);
  });
  it('split pots and side pots', () => {
    expect(
      winnerLines([w('a', 620, 0, 'Straight, Ten high'), w('b', 620, 0, 'Straight, Ten high')], nameOf),
    ).toEqual(['Alice & Bob split 1,240 with a Straight, Ten high']);
    expect(
      winnerLines([w('a', 900, 0, 'Pair of Kings'), w('b', 340, 1, 'Pair of Queens')], nameOf),
    ).toEqual(['Main pot: Alice wins 900 with a Pair of Kings', 'Side pot: Bob wins 340 with a Pair of Queens']);
  });
  it('sums winnings per player', () => {
    const m = winningsByPlayer([w('a', 10), w('a', 5, 1), w('b', 3)]);
    expect(m.get('a')).toBe(15);
    expect(m.get('b')).toBe(3);
  });
});

describe('withArticle', () => {
  it('adds "a" where English needs it', () => {
    expect(withArticle('Full House, Kings full of Twos')).toBe('a Full House, Kings full of Twos');
    expect(withArticle('Royal Flush')).toBe('a Royal Flush');
    expect(withArticle('Three of a Kind, Sevens')).toBe('Three of a Kind, Sevens');
    expect(withArticle('High Card, Ace')).toBe('High Card, Ace');
  });
});

describe('votes', () => {
  const vote = (p: Partial<BuyBackVoteView>): BuyBackVoteView => ({
    id: 'v1',
    requesterId: 'c',
    requesterName: 'Carol',
    amount: 2000,
    createdAt: 0,
    deadline: 30_000,
    votes: { a: 'yes', b: null },
    status: 'pending',
    resolvedReason: null,
    resolvedAt: null,
    ...p,
  });
  it('tallies', () => {
    expect(tallyVote(vote({}))).toEqual({ yes: 1, no: 0, waiting: 1, total: 2 });
  });
  it('describes outcomes', () => {
    expect(voteOutcomeText(vote({}), nameOf)).toBe('1/2 agreed');
    expect(voteOutcomeText(vote({ status: 'approved', resolvedReason: 'unanimous', votes: { a: 'yes', b: 'yes' } }), nameOf)).toBe(
      'Approved by everyone',
    );
    expect(voteOutcomeText(vote({ status: 'rejected', resolvedReason: 'declined', votes: { a: 'yes', b: 'no' } }), nameOf)).toBe(
      'Rejected by Bob',
    );
    expect(voteOutcomeText(vote({ status: 'rejected', resolvedReason: 'timeout' }), nameOf)).toBe(
      'Timed out — not everyone answered',
    );
    expect(voteOutcomeText(vote({ status: 'rejected', resolvedReason: 'cancelled' }), nameOf)).toBe('Carol cancelled the request');
  });
});

describe('hand hints', () => {
  it('preflop', () => {
    expect(preflopHint(['Kh', 'Kd'])).toBe('Pocket Kings');
    expect(preflopHint(['As', 'Ks'])).toBe('A-K suited');
    expect(preflopHint(['9c', 'Qd'])).toBe('Q-9 offsuit');
  });
  it('postflop uses the evaluator', () => {
    expect(handHint(['Kh', 'Kd'], ['2c', '7s', '9d'])).toBe('Pair of Kings');
    expect(handHint(['Ah', 'Kh'], ['2h', '7h', '9h'])).toBe('Flush, Ace high');
    expect(handHint(null, [])).toBeNull();
  });
});
