// Pot construction and splitting helpers (pure).
import type { EnginePot } from './types';

export interface PotContribution {
  id: string;
  /** Chips this player has put into the pot(s) being built. */
  committed: number;
  folded: boolean;
}

/**
 * Builds main + side pots from per-player commitments (input order is kept for `eligible`;
 * the engine passes players by seat ascending).
 * - Layers are cut at every distinct commitment level of NON-folded players.
 * - Folded players' chips count toward the layers they reach, but they are never eligible.
 * - Chips above the highest non-folded level (only possible from folded players) go to the top pot.
 * - Adjacent layers with identical eligible sets are merged.
 */
export function computePots(entries: readonly PotContribution[]): EnginePot[] {
  const total = entries.reduce((s, e) => s + e.committed, 0);
  if (total <= 0) return [];
  const live = entries.filter((e) => !e.folded);
  const levels = [...new Set(live.map((e) => e.committed).filter((c) => c > 0))].sort((a, b) => a - b);
  if (levels.length === 0) {
    // Nobody still in the hand has chips in yet; everything sits in one pot.
    return [{ amount: total, eligible: live.map((e) => e.id) }];
  }
  const pots: EnginePot[] = [];
  let prev = 0;
  levels.forEach((level, i) => {
    const isTop = i === levels.length - 1;
    let amount = 0;
    for (const e of entries) {
      const upper = isTop ? e.committed : Math.min(e.committed, level);
      amount += Math.max(0, upper - Math.min(e.committed, prev));
    }
    const eligible = live.filter((e) => e.committed >= level).map((e) => e.id);
    const last = pots[pots.length - 1];
    if (last && sameIds(last.eligible, eligible)) last.amount += amount;
    else if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  });
  return pots;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Splits `amount` evenly between `winnersInOrder`; odd chips go one at a time to the
 * winners in the given order (the engine orders them clockwise starting left of the dealer).
 */
export function splitAmount(amount: number, winnersInOrder: readonly string[]): { playerId: string; amount: number }[] {
  const k = winnersInOrder.length;
  if (k === 0) return [];
  const share = Math.floor(amount / k);
  let odd = amount - share * k;
  return winnersInOrder.map((playerId) => {
    const extra = odd > 0 ? 1 : 0;
    odd -= extra;
    return { playerId, amount: share + extra };
  });
}
