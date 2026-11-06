// Randomised whole-hand fuzzing: thousands of hands with 2..10 players, random stacks,
// blinds and legal (plus some illegal) actions, checking invariants after every step.
import { describe, expect, it } from 'vitest';
import { evaluateHand, fullDeck, type Card, type PlayerAction } from '../../shared';
import { createHand } from './hand';
import { computePots } from './pots';
import type { EngineEvent, EnginePot, HandEngine } from './types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Ctx {
  rnd: () => number;
  int: (lo: number, hi: number) => number;
  pick: <T>(xs: readonly T[]) => T;
}

function ctx(seed: number): Ctx {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  return { rnd, int, pick: (xs) => xs[Math.floor(rnd() * xs.length)]! };
}

function randomStack(c: Ctx, bb: number): number {
  const r = c.rnd();
  if (r < 0.15) return c.int(1, bb * 2); // very short, often all-in from the blinds
  if (r < 0.5) return c.int(bb * 2, bb * 20);
  return c.int(bb * 20, bb * 200);
}

function shuffled(c: Ctx): Card[] {
  const d = fullDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(c.rnd() * (i + 1));
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d;
}

/** Cheap assertion for the hot loop (vitest's expect() is too slow for ~100k checks). */
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function checkInvariants(e: HandEngine, startTotal: number, label: string): void {
  const players = e.players;
  const stacks = players.reduce((s, p) => s + p.stack, 0);
  const pot = e.totalPot();
  assert(stacks + pot === startTotal, `${label}: chip conservation ${stacks} + ${pot} != ${startTotal}`);
  for (const p of players) {
    assert(Number.isInteger(p.stack) && p.stack >= 0, `${label}: ${p.id} bad stack ${p.stack}`);
    assert(p.streetBet >= 0 && p.totalCommitted >= p.streetBet, `${label}: ${p.id} bad bets`);
    // (after payout an all-in winner keeps the allIn flag for display, so only check mid-hand)
    if (e.phase !== 'complete') assert(!p.allIn || p.stack === 0, `${label}: all-in ${p.id} has chips`);
  }
  if (e.phase === 'complete') {
    assert(pot === 0 && e.toActId === null && e.result !== null, `${label}: bad complete state`);
    return;
  }
  assert(e.result === null, `${label}: result before completion`);
  const pots = e.pots;
  const streetBets = players.reduce((s, p) => s + p.streetBet, 0);
  const potSum = pots.reduce((s, p) => s + p.amount, 0);
  assert(potSum + streetBets === pot, `${label}: pots ${potSum} + bets ${streetBets} != totalPot ${pot}`);
  for (const pt of pots) {
    assert(pt.amount > 0, `${label}: empty pot`);
    for (const id of pt.eligible) assert(!e.getPlayer(id)!.folded, `${label}: folded ${id} eligible`);
  }
  assert(e.currentBet >= Math.max(...players.map((p) => p.streetBet)), `${label}: currentBet below a bet`);
  if (e.phase === 'betting') {
    const actor = e.getPlayer(e.toActId!);
    assert(actor && !actor.folded && !actor.allIn, `${label}: bad actor ${e.toActId}`);
    for (const p of players) {
      if (p.id !== actor.id) assert(e.legalActions(p.id) === null, `${label}: ${p.id} has legal actions off turn`);
    }
  } else {
    assert(e.toActId === null, `${label}: actor set in roundComplete`);
    for (const p of players) assert(e.legalActions(p.id) === null, `${label}: legal actions in roundComplete`);
  }
  assert(players.filter((p) => !p.folded).length >= 2, `${label}: fewer than 2 live players mid-hand`);
}

/** Side-pot property: a live player can win from each opponent at most what they put in. */
function checkPotStructure(pots: readonly EnginePot[], entries: { id: string; committed: number; folded: boolean }[]) {
  const live = entries.filter((x) => !x.folded);
  const maxLive = Math.max(...live.map((x) => x.committed));
  for (const x of live) {
    const eligibleSum = pots.filter((p) => p.eligible.includes(x.id)).reduce((s, p) => s + p.amount, 0);
    let expected = entries.reduce((s, y) => s + Math.min(y.committed, x.committed), 0);
    if (x.committed === maxLive) expected += entries.reduce((s, y) => s + Math.max(0, y.committed - maxLive), 0);
    expect(eligibleSum).toBe(expected);
  }
}

function randomIllegal(c: Ctx, e: HandEngine, id: string): PlayerAction | null {
  const legal = e.legalActions(id)!;
  const options: (PlayerAction | null)[] = [
    { type: 'raise', amount: NaN },
    { type: 'raise', amount: -c.int(1, 100) },
    { type: 'raise', amount: legal.maxRaiseTo + c.int(1, 100) },
    { type: 'raise', amount: legal.currentBet + 0.5 },
    legal.canCheck ? { type: 'call' } : { type: 'check' },
    legal.canRaise && legal.minRaiseTo < legal.maxRaiseTo && legal.minRaiseTo - 1 > legal.currentBet
      ? { type: 'raise', amount: legal.minRaiseTo - 1 }
      : null,
    !legal.canRaise && legal.maxRaiseTo > legal.currentBet ? { type: 'raise', amount: legal.maxRaiseTo } : null,
  ];
  return c.pick(options);
}

function randomLegal(c: Ctx, e: HandEngine, id: string): PlayerAction {
  const legal = e.legalActions(id)!;
  const r = c.rnd();
  if (r < 0.12) return { type: 'fold' };
  if (legal.canRaise && r < 0.42) {
    const s = c.rnd();
    let amount: number;
    if (s < 0.3) amount = legal.minRaiseTo;
    else if (s < 0.4) amount = legal.maxRaiseTo;
    else if (s < 0.7) amount = Math.min(legal.maxRaiseTo, legal.currentBet + legal.pot);
    else amount = c.int(legal.minRaiseTo, legal.maxRaiseTo);
    amount = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, amount));
    return { type: 'raise', amount };
  }
  if (r < 0.5 && (legal.canRaise || legal.maxRaiseTo <= legal.currentBet)) return { type: 'allin' };
  return legal.canCheck ? { type: 'check' } : { type: 'call' };
}

interface HandStats {
  steps: number;
  showdown: boolean;
  sidePots: boolean;
  runout: boolean;
  uncalled: boolean;
  forcedFolds: number;
  players: number;
}

function playRandomHand(seed: number): HandStats {
  const c = ctx(seed);
  const n = c.int(2, 10);
  const bb = c.pick([2, 4, 10, 20, 50, 100, c.int(2, 200)]);
  const sb = c.rnd() < 0.8 ? Math.max(1, Math.floor(bb / 2)) : c.int(1, bb);
  const seats = [...Array(10).keys()].sort(() => c.rnd() - 0.5).slice(0, n);
  const players = seats.map((seat, i) => ({ id: `p${i}`, seat, stack: randomStack(c, bb) }));
  const startTotal = players.reduce((s, p) => s + p.stack, 0);
  const label = `seed ${seed}`;
  const e = createHand({
    handNumber: seed,
    players,
    dealerSeat: c.pick(seats),
    smallBlind: sb,
    bigBlind: bb,
    deck: shuffled(c),
  });

  const allEvents: EngineEvent[] = [];
  let prevStacks = startTotal - e.totalPot();
  const accountEvents = () => {
    const evs = e.drainEvents();
    allEvents.push(...evs);
    // every chip that moves back to a stack is explained by an 'uncalled' or 'win' event
    const returned = evs
      .filter((x) => x.kind === 'uncalled' || x.kind === 'win')
      .reduce((s, x) => s + (x.amount ?? 0), 0);
    const stacks = e.players.reduce((s, p) => s + p.stack, 0);
    const pot = e.totalPot();
    // stacks only grow by returned chips; they shrink only by chips that went into the pot
    assert(stacks + pot === startTotal, `${label}: conservation after events`);
    assert(stacks - prevStacks <= returned, `${label}: chips returned without uncalled/win events`);
    prevStacks = stacks;
  };
  accountEvents();
  checkInvariants(e, startTotal, label);

  let steps = 0;
  let runout = false;
  let forcedFolds = 0;
  let finalPotsSnapshot: { pots: EnginePot[]; entries: { id: string; committed: number; folded: boolean }[] } | null =
    null;
  while (e.phase !== 'complete') {
    if (++steps > 400) throw new Error(`${label}: hand did not terminate`);
    // occasional kick / leave out of turn
    if (c.rnd() < 0.03) {
      const target = c.pick(e.players.filter((p) => !p.folded));
      e.forceFold(target.id);
      forcedFolds++;
    } else if (e.phase === 'roundComplete') {
      const before = e.players;
      if (e.street === 'river') {
        const entries = before.map((p) => ({ id: p.id, committed: p.totalCommitted, folded: p.folded }));
        finalPotsSnapshot = { pots: computePots(entries), entries };
      }
      if (e.isRunout()) {
        runout = true;
        const up = e.faceUpCards();
        const liveIds = before.filter((p) => !p.folded).map((p) => p.id);
        assert(
          Object.keys(up).length === liveIds.length && liveIds.every((id) => up[id]?.length === 2),
          `${label}: runout face-up cards`,
        );
      } else {
        assert(Object.keys(e.faceUpCards()).length === 0, `${label}: cards face up outside runout`);
      }
      e.advance();
    } else {
      const id = e.toActId!;
      const legal = e.legalActions(id);
      assert(legal, `${label}: no legal actions for actor`);
      assert(legal.callAmount <= legal.stack, `${label}: callAmount above stack`);
      assert(legal.minRaiseTo <= legal.maxRaiseTo, `${label}: minRaiseTo above max`);
      assert(legal.pot === e.totalPot(), `${label}: legal.pot`);
      if (c.rnd() < 0.08) {
        const bad = randomIllegal(c, e, id);
        if (bad) {
          const snap = JSON.stringify({ p: e.players, t: e.toActId, b: e.currentBet, ph: e.phase });
          const res = e.act(id, bad);
          assert(!res.ok, `${label}: illegal ${JSON.stringify(bad)} accepted`);
          assert(
            JSON.stringify({ p: e.players, t: e.toActId, b: e.currentBet, ph: e.phase }) === snap,
            `${label}: rejected action changed state`,
          );
        }
      }
      if (c.rnd() < 0.02) {
        // wrong player acting
        const other = e.players.find((p) => p.id !== id)!;
        assert(!e.act(other.id, { type: 'fold' }).ok, `${label}: out-of-turn fold accepted`);
      }
      const action = randomLegal(c, e, id);
      const res = e.act(id, action);
      if (!res.ok) throw new Error(`${label}: legal action ${JSON.stringify(action)} rejected: ${res.error}`);
    }
    accountEvents();
    checkInvariants(e, startTotal, `${label} step ${steps}`);
  }

  // ---- completed hand checks ----
  const r = e.result!;
  const finalSum = Object.values(r.finalStacks).reduce((s, x) => s + x, 0);
  expect(finalSum).toBe(startTotal);
  for (const p of e.players) {
    expect(r.finalStacks[p.id]).toBe(p.stack);
    expect(p.totalCommitted).toBe(0);
    expect(p.streetBet).toBe(0);
  }
  const winEvents = allEvents.filter((x) => x.kind === 'win');
  expect(winEvents.map((w) => [w.playerId, w.amount, w.potIndex])).toEqual(
    r.winners.map((w) => [w.playerId, w.amount, w.potIndex]),
  );
  const live = e.players.filter((p) => !p.folded);
  if (r.showdown) {
    expect(live.length).toBeGreaterThanOrEqual(2);
    expect(e.board).toHaveLength(5);
    expect(Object.keys(r.revealed).sort()).toEqual(live.map((p) => p.id).sort());
    expect(e.faceUpCards()).toEqual(r.revealed);
    if (finalPotsSnapshot) {
      const { pots, entries } = finalPotsSnapshot;
      checkPotStructure(pots, entries);
      pots.forEach((pot, i) => {
        const potWinners = r.winners.filter((w) => w.potIndex === i);
        expect(potWinners.reduce((s, w) => s + w.amount, 0)).toBe(pot.amount);
        const scores = new Map(
          pot.eligible.map((id) => [id, evaluateHand([...e.getPlayer(id)!.holeCards, ...e.board]).score]),
        );
        const best = Math.max(...scores.values());
        const expectedWinners = pot.eligible.filter((id) => scores.get(id) === best).sort();
        expect(potWinners.map((w) => w.playerId).sort()).toEqual(expectedWinners);
        const amounts = potWinners.map((w) => w.amount);
        expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
      });
    }
  } else {
    expect(live).toHaveLength(1);
    expect(r.revealed).toEqual({});
    expect(e.faceUpCards()).toEqual({});
    expect(r.winners.every((w) => w.playerId === live[0]!.id && w.handName === null)).toBe(true);
  }
  return {
    steps,
    showdown: r.showdown,
    sidePots: (finalPotsSnapshot?.pots.length ?? 0) > 1,
    runout,
    uncalled: r.uncalledReturn !== null,
    forcedFolds,
    players: n,
  };
}

describe('engine fuzz', () => {
  it('plays thousands of random hands without breaking invariants', () => {
    const hands = 6000;
    const totals = { showdown: 0, sidePots: 0, runout: 0, uncalled: 0, forcedFolds: 0, steps: 0 };
    const sizes = new Set<number>();
    for (let seed = 1; seed <= hands; seed++) {
      const st = playRandomHand(seed);
      totals.steps += st.steps;
      totals.forcedFolds += st.forcedFolds;
      if (st.showdown) totals.showdown++;
      if (st.sidePots) totals.sidePots++;
      if (st.runout) totals.runout++;
      if (st.uncalled) totals.uncalled++;
      sizes.add(st.players);
    }
    // sanity: the fuzzer really exercises every interesting path
    expect([...sizes].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(totals.showdown).toBeGreaterThan(hands * 0.1);
    expect(totals.showdown).toBeLessThan(hands * 0.95);
    expect(totals.sidePots).toBeGreaterThan(hands * 0.02);
    expect(totals.runout).toBeGreaterThan(hands * 0.05);
    expect(totals.uncalled).toBeGreaterThan(hands * 0.2);
    expect(totals.forcedFolds).toBeGreaterThan(hands * 0.1);
    expect(totals.steps).toBeGreaterThan(hands * 3);
  });
});
