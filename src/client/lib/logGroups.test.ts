import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../shared/types';
import { groupLog } from './logGroups';

let id = 0;
const e = (handNumber: number | null, text: string, game?: number): LogEntry => ({
  id: ++id,
  handNumber,
  ts: id * 1000,
  kind: 'info',
  text,
  ...(game === undefined ? {} : { game }),
});

describe('groupLog', () => {
  it('keeps hands of different games apart after a rematch (hand numbers restart)', () => {
    const log = [
      e(null, 'Hana created the table', 1),
      e(1, 'Hand #1 — Hana has the button', 1),
      e(1, 'Hana wins 400', 1),
      e(null, 'New game! Everyone at the table starts again with 200', 2),
      e(1, 'Hand #1 — Bot has the button', 2),
      e(1, 'Bot wins 20', 2),
      e(2, 'Hand #2 — Hana has the button', 2),
    ];
    const groups = groupLog(log);
    expect(groups.map((g) => g.title)).toEqual(['Hand #2', 'Hand #1', 'Table', 'Hand #1', 'Table']);
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
    expect(groups[1]!.entries.map((x) => x.text)).toEqual(['Hand #1 — Bot has the button', 'Bot wins 20']);
    expect(groups[3]!.entries.map((x) => x.text)).toEqual(['Hand #1 — Hana has the button', 'Hana wins 400']);
  });

  it('without game tags, the "Hand #N —" opening line still starts a new group', () => {
    const groups = groupLog([e(1, 'Hand #1 — A has the button'), e(1, 'A wins 40'), e(1, 'Hand #1 — B has the button'), e(1, 'B folds')]);
    expect(groups.map((g) => g.entries.map((x) => x.text))).toEqual([
      ['Hand #1 — B has the button', 'B folds'],
      ['Hand #1 — A has the button', 'A wins 40'],
    ]);
  });

  it('a table line in the middle of a hand does not split it in two', () => {
    const groups = groupLog([e(3, 'Hand #3 — A has the button', 1), e(null, 'Dan joined', 1), e(3, 'A raises to 60', 1)]);
    expect(groups.map((g) => g.title)).toEqual(['Hand #3', 'Table']);
    expect(groups[0]!.entries.map((x) => x.text)).toEqual(['Hand #3 — A has the button', 'A raises to 60']);
  });

  it('sorts by id and keeps keys stable as entries arrive', () => {
    const a = e(4, 'Hand #4 — a', 1);
    const b = e(4, 'b', 1);
    const first = groupLog([b, a]);
    expect(first).toHaveLength(1);
    expect(first[0]!.entries.map((x) => x.text)).toEqual(['Hand #4 — a', 'b']);
    const later = groupLog([a, b, e(4, 'c', 1)]);
    expect(later[0]!.key).toBe(first[0]!.key);
  });
});

describe('groupLog with a real room', () => {
  it('a rematch shows the new game’s hand #1 separately from the old one', async () => {
    const { vi } = await import('vitest');
    const { advanceUntil, deckFor, makeTable } = await import('../../server/room/test-utils');
    vi.useFakeTimers();
    try {
      const t = makeTable({ names: ['Hosty', 'Bot'], decks: { 1: deckFor([0, 1], 0, { 0: 'As Ah', 1: '7c 2d' }, 'Kd 9s 5h 3c Jd') } });
      const [a, b] = t.ids as [string, string];
      t.room.start(a);
      t.act(a, 'allin');
      t.act(b, 'allin');
      advanceUntil(() => t.view().gameOverWinnerId === a);
      t.room.rematch(a);
      t.room.start(a);
      const toAct = t.toAct()!;
      t.act(toAct, 'fold');
      const groups = groupLog(t.room.history().log);
      const hand1 = groups.filter((g) => g.title === 'Hand #1');
      expect(hand1).toHaveLength(2);
      expect(hand1[0]!.entries.some((x) => x.text.includes('folds'))).toBe(true);
      expect(hand1[0]!.entries.some((x) => x.kind === 'street')).toBe(false); // the old runout stays in the old group
      expect(hand1[1]!.entries.some((x) => x.kind === 'street')).toBe(true);
      expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
      t.room.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
