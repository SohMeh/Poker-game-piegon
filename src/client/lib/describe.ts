// Pure text helpers: action bubbles, result lines, vote outcomes, hand-strength hints.
import { cardRankValue, rankOf, suitOf, type Card } from '../../shared/cards';
import { evaluateHand } from '../../shared/evaluator';
import { formatChips } from '../../shared/format';
import type { BuyBackVoteView, HandWinner, LastAction, RoomStatus } from '../../shared/types';

/** Speech-bubble text for a seat's last action ("Raise 120", "Check", "All-in"); null for blinds. */
export function lastActionLabel(a: LastAction | null | undefined): string | null {
  if (!a) return null;
  switch (a.type) {
    case 'fold':
      return 'Fold';
    case 'check':
      return 'Check';
    case 'call':
      return `Call ${formatChips(a.amount, true)}`;
    case 'bet':
      return `Bet ${formatChips(a.amount, true)}`;
    case 'raise':
      return `Raise ${formatChips(a.amount, true)}`;
    case 'allin':
      return 'All-in';
    default:
      return null;
  }
}

/** "Flush, Ace high" -> "a Flush, Ace high"; "Two Pair, ..." stays as is. */
export function withArticle(handName: string): string {
  if (/^(Flush|Full House|Straight|Pair|Royal|Straight Flush)\b/.test(handName)) return `a ${handName}`;
  return handName;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/**
 * Result lines for a finished hand, e.g.
 *   ["Alice wins 1,240 with a Flush, Ace high"]
 *   ["Main pot: Alice & Bob split 900 with a Straight, Ten high", "Side pot: Bob wins 340"]
 */
export function winnerLines(winners: HandWinner[], nameOf: (id: string) => string): string[] {
  if (winners.length === 0) return [];
  const ids = new Set(winners.map((w) => w.playerId));
  if (ids.size === 1) {
    const total = winners.reduce((s, w) => s + w.amount, 0);
    const hand = winners.find((w) => w.handName)?.handName ?? null;
    const name = nameOf(winners[0]!.playerId);
    return [`${name} wins ${formatChips(total)}${hand ? ` with ${withArticle(hand)}` : ''}`];
  }
  const byPot = new Map<number, HandWinner[]>();
  for (const w of winners) {
    const list = byPot.get(w.potIndex);
    if (list) list.push(w);
    else byPot.set(w.potIndex, [w]);
  }
  const potIndexes = [...byPot.keys()].sort((a, b) => a - b);
  const multiPot = potIndexes.length > 1;
  const sidePots = potIndexes.filter((i) => i > 0).length;
  return potIndexes.map((potIndex) => {
    const group = byPot.get(potIndex)!;
    const prefix = !multiPot
      ? ''
      : potIndex === 0
        ? 'Main pot: '
        : sidePots > 1
          ? `Side pot ${potIndex}: `
          : 'Side pot: ';
    const total = group.reduce((s, w) => s + w.amount, 0);
    const names = group.map((w) => nameOf(w.playerId));
    const hands = [...new Set(group.map((w) => w.handName).filter((h): h is string => !!h))];
    const handText = hands.length === 1 ? ` with ${withArticle(hands[0]!)}` : '';
    if (group.length === 1) return `${prefix}${names[0]} wins ${formatChips(total)}${handText}`;
    return `${prefix}${joinNames(names)} split ${formatChips(total)}${handText}`;
  });
}

/** Total won per player across all pots. */
export function winningsByPlayer(winners: HandWinner[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of winners ?? []) out.set(w.playerId, (out.get(w.playerId) ?? 0) + w.amount);
  return out;
}

export interface VoteTally {
  yes: number;
  no: number;
  waiting: number;
  total: number;
}

export function tallyVote(vote: Pick<BuyBackVoteView, 'votes'>): VoteTally {
  let yes = 0;
  let no = 0;
  let waiting = 0;
  for (const v of Object.values(vote.votes)) {
    if (v === 'yes') yes++;
    else if (v === 'no') no++;
    else waiting++;
  }
  return { yes, no, waiting, total: yes + no + waiting };
}

/** Headline for a resolved (or pending) buy-back vote. */
export function voteOutcomeText(vote: BuyBackVoteView, nameOf: (id: string) => string): string {
  if (vote.status === 'pending') {
    const t = tallyVote(vote);
    return `${t.yes}/${t.total} agreed`;
  }
  if (vote.status === 'approved') return 'Approved by everyone';
  switch (vote.resolvedReason) {
    case 'timeout':
      return 'Timed out — not everyone answered';
    case 'cancelled':
      return `${vote.requesterName} cancelled the request`;
    case 'declined':
    default: {
      const noIds = Object.entries(vote.votes)
        .filter(([, v]) => v === 'no')
        .map(([id]) => nameOf(id));
      return noIds.length ? `Rejected by ${joinNames(noIds)}` : 'Rejected';
    }
  }
}

const RANK_PLURAL_SHORT: Record<number, string> = {
  2: 'Deuces',
  3: 'Threes',
  4: 'Fours',
  5: 'Fives',
  6: 'Sixes',
  7: 'Sevens',
  8: 'Eights',
  9: 'Nines',
  10: 'Tens',
  11: 'Jacks',
  12: 'Queens',
  13: 'Kings',
  14: 'Aces',
};
const RANK_SHORT: Record<number, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

/** Preflop hint: "Pocket Kings", "A-K suited", "Q-9 offsuit". */
export function preflopHint(hole: Card[]): string | null {
  if (hole.length !== 2) return null;
  const [a, b] = hole as [Card, Card];
  const va = cardRankValue(a);
  const vb = cardRankValue(b);
  if (rankOf(a) === rankOf(b)) return `Pocket ${RANK_PLURAL_SHORT[va]}`;
  const hi = Math.max(va, vb);
  const lo = Math.min(va, vb);
  const suited = suitOf(a) === suitOf(b);
  return `${RANK_SHORT[hi]}-${RANK_SHORT[lo]} ${suited ? 'suited' : 'offsuit'}`;
}

/** "You have" hint for my hole cards plus the board. */
export function handHint(hole: Card[] | null | undefined, board: Card[]): string | null {
  if (!hole || hole.length === 0) return null;
  if (board.length === 0) return preflopHint(hole);
  const cards = [...hole, ...board].slice(0, 7);
  try {
    return evaluateHand(cards).name;
  } catch {
    return null;
  }
}

/** Cards that make up the winning hand(s), for highlighting at showdown. */
export function winningCards(winners: HandWinner[] | null | undefined): Set<Card> {
  const set = new Set<Card>();
  for (const w of winners ?? []) {
    if (w.potIndex !== 0) continue;
    for (const c of w.bestCards ?? []) set.add(c);
  }
  return set;
}

export function statusLabel(status: RoomStatus, gameOver: boolean): string {
  if (gameOver) return 'Game over';
  if (status === 'lobby') return 'Lobby';
  if (status === 'paused') return 'Paused';
  return 'Live';
}

export function initialOf(name: string): string {
  const ch = [...name.trim()][0];
  return ch ? ch.toUpperCase() : '?';
}
