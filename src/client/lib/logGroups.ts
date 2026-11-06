// Groups the hand log into hands for the Log tab.
import type { LogEntry } from '../../shared/types';

export interface LogGroup {
  /** Unique, stable React key (the id of the group's first entry). */
  key: string;
  title: string;
  handNumber: number | null;
  entries: LogEntry[];
}

interface Building extends LogGroup {
  game: number;
  last: number;
}

/**
 * Groups the log (any order) for display. A hand is identified by (game, handNumber): hand numbers
 * restart at 1 after a rematch, so grouping by number alone would merge "Hand #1" of two different
 * games. A hand's group also starts fresh at its "Hand #N —" opening line (for servers that do not
 * tag entries with a game). Lines without a hand number form "Table" runs between hands.
 * Returned with the most recently updated group first; entries oldest first within a group.
 */
export function groupLog(log: readonly LogEntry[]): LogGroup[] {
  const sorted = [...log].sort((a, b) => a.id - b.id);
  const groups: Building[] = [];
  let cur: Building | null = null;
  let lastHand: Building | null = null;
  for (const e of sorted) {
    const game = e.game ?? 0;
    const hand = e.handNumber ?? null;
    if (hand === null) {
      if (!cur || cur.handNumber !== null || cur.game !== game) {
        cur = { key: `g${e.id}`, title: 'Table', handNumber: null, game, entries: [], last: e.id };
        groups.push(cur);
      }
    } else {
      const opening = e.text.startsWith(`Hand #${hand} `);
      if (lastHand && !opening && lastHand.handNumber === hand && lastHand.game === game) {
        cur = lastHand; // the same hand, possibly after a table line (someone joined…)
      } else {
        cur = { key: `g${e.id}`, title: `Hand #${hand}`, handNumber: hand, game, entries: [], last: e.id };
        groups.push(cur);
        lastHand = cur;
      }
    }
    cur.entries.push(e);
    cur.last = e.id;
  }
  return groups
    .sort((a, b) => b.last - a.last)
    .map(({ key, title, handNumber, entries }) => ({ key, title, handNumber, entries }));
}
