import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING, type RoomView } from '../../shared';
import { Room, RoomError } from './Room';
import { advanceUntil, deckFor, makeTable, player, type Table } from './test-utils';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const BUY_IN = 2000;

function expectError(fn: () => unknown, msg: string | RegExp): void {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(RoomError);
  if (typeof msg === 'string') expect((err as Error).message).toBe(msg);
  else expect((err as Error).message).toMatch(msg);
}

function logTexts(t: Table): string[] {
  return t.room.history().log.map((e) => e.text);
}
function chatTexts(t: Table): string[] {
  return t.room.history().chat.map((m) => m.text);
}

/** Hand 1 (dealer seat 0): Alice shoves, Bob calls all-in, Carol folds; Bob's aces bust Alice. */
function bustAlice(settings = {}): Table {
  const t = makeTable({
    settings,
    decks: { 1: deckFor([0, 1, 2], 0, { 0: '7c 2d', 1: 'As Ah', 2: '8s 8h' }, 'Kd 9s 5h 3c Jd') },
  });
  const [a, b, c] = t.ids as [string, string, string];
  t.room.start(a);
  expect(t.toAct()).toBe(a);
  t.act(a, 'allin');
  t.act(b, 'allin');
  t.act(c, 'fold');
  advanceUntil(() => t.view().hand?.phase === 'complete');
  expect(player(t.view(), a).stack).toBe(0);
  return t;
}

/** Hand 1: three-way all-in; Carol's aces win everything, Alice and Bob bust. */
function bustAliceAndBob(settings = {}): Table {
  const t = makeTable({
    settings,
    decks: { 1: deckFor([0, 1, 2], 0, { 0: '7c 2d', 1: '8s 3h', 2: 'As Ah' }, 'Kd 9s 5h 3c Jd') },
  });
  const [a, b, c] = t.ids as [string, string, string];
  t.room.start(a);
  t.act(a, 'allin');
  t.act(b, 'allin');
  t.act(c, 'allin');
  advanceUntil(() => t.view().hand?.phase === 'complete');
  return t;
}

// ===================================================================== seating

describe('joining and seating', () => {
  it('creates the host seated at seat 0 with one buy-in', () => {
    const room = new Room({ id: 'ABCDEF' });
    const { playerId, token } = room.addHost('  Alice   Smith ');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    room.attach(playerId);
    const v = room.viewFor(playerId);
    expect(v.hostId).toBe(playerId);
    expect(v.me.isHost).toBe(true);
    expect(v.me.name).toBe('Alice Smith');
    expect(v.seats[0]).toBe(playerId);
    expect(v.seats).toHaveLength(9);
    expect(player(v, playerId)).toMatchObject({ seat: 0, stack: BUY_IN, buyIns: 1, busted: false, color: 0 });
    expect(v.ledger).toEqual([
      { playerId, name: 'Alice Smith', buyIns: 1, totalBuyIn: BUY_IN, stack: BUY_IN, net: 0, inRoom: true },
    ]);
    expect(v.status).toBe('lobby');
    expect(v.started).toBe(false);
    expect(v.hand).toBeNull();
    room.dispose();
  });

  it('rejects invalid create settings', () => {
    expect(() => new Room({ id: 'ABCDEF', settings: { smallBlind: 30, bigBlind: 20 } })).toThrow(RoomError);
    expect(() => new Room({ id: 'ABCDEF', settings: { buyIn: 100 } })).toThrow(/Buy-in must be/);
  });

  it('new joiners are spectators with unique names and colors; seating gives one buy-in', () => {
    const room = new Room({ id: 'ABCDEF' });
    const host = room.addHost('Bob');
    const j1 = room.join({ name: 'bob' });
    const j2 = room.join({ name: 'BOB' });
    room.attach(j1.playerId);
    room.attach(j2.playerId);
    const v = room.viewFor(j1.playerId);
    expect(player(v, j1.playerId)).toMatchObject({ name: 'bob 2', seat: null, stack: 0, buyIns: 0, color: 1 });
    expect(player(v, j2.playerId)).toMatchObject({ name: 'BOB 3', color: 2 });
    expect(v.ledger.map((r) => r.playerId)).toEqual([host.playerId]);
    expect(room.takeSeat(j1.playerId, 4)).toEqual({ pending: false });
    const v2 = room.viewFor(j1.playerId);
    expect(player(v2, j1.playerId)).toMatchObject({ seat: 4, stack: BUY_IN, buyIns: 1 });
    expect(v2.seats[4]).toBe(j1.playerId);
    expect(v2.ledger).toHaveLength(2);
    room.dispose();
  });

  it('long duplicate names are truncated to fit the suffix', () => {
    const room = new Room({ id: 'ABCDEF' });
    room.addHost('ABCDEFGHIJKLMNOP');
    const j = room.join({ name: 'abcdefghijklmnop' });
    expect(room.viewFor(j.playerId).me.name).toBe('abcdefghijklmn 2');
    room.dispose();
  });

  it('validates names and tokens on join', () => {
    const room = new Room({ id: 'ABCDEF' });
    room.addHost('Alice');
    expectError(() => room.join({ name: '   ' }), /Enter a name/);
    expectError(() => room.join({ name: 'x'.repeat(17) }), /Enter a name/);
    expectError(() => room.join({}), /Enter a name/);
    expectError(() => room.join({ token: 'nope' }), /session for this room has expired/);
    const j = room.join({ token: 'nope', name: 'Dan' });
    expect(j.reconnected).toBe(false);
    room.dispose();
  });

  it('seat rules: taken, invalid, already seated, full table', () => {
    const t = makeTable({ names: ['Alice', 'Bob'], settings: { maxPlayers: 3 } });
    const [a] = t.ids as [string, string];
    const c = t.room.join({ name: 'Carol' }).playerId;
    const d = t.room.join({ name: 'Dan' }).playerId;
    expectError(() => t.room.takeSeat(c, 1), 'That seat is taken');
    expectError(() => t.room.takeSeat(c, 3), 'That seat does not exist');
    expectError(() => t.room.takeSeat(c, -1), 'That seat does not exist');
    expectError(() => t.room.takeSeat(a, 2), 'You are already seated');
    t.room.takeSeat(c, 2);
    expectError(() => t.room.takeSeat(d, 2), 'Table is full — you can watch until a seat opens');
    // spectators can still watch and chat
    t.room.attach(d);
    expect(t.view(d).me.seat).toBeNull();
    t.room.sendChat(d, 'nice hand');
    expect(chatTexts(t)).toContain('nice hand');
    // a seat opens -> the spectator can sit
    t.room.standUp(c);
    t.room.takeSeat(d, 2);
    expect(t.view(d).me.seat).toBe(2);
    t.room.dispose();
  });

  it('requireApproval: pending seat is reserved, host approves or denies; host never needs approval', () => {
    const room = new Room({ id: 'ABCDEF', settings: { requireApproval: true } });
    const host = room.addHost('Alice').playerId;
    room.attach(host);
    const b = room.join({ name: 'Bob' }).playerId;
    const c = room.join({ name: 'Carol' }).playerId;
    room.attach(b);
    room.attach(c);
    room.drainOutbox();
    expect(room.takeSeat(b, 3)).toEqual({ pending: true });
    expect(room.drainOutbox().notices).toEqual([{ playerId: host, notice: { kind: 'info', text: 'Bob wants to sit down' } }]);
    let v = room.viewFor(host);
    expect(player(v, b)).toMatchObject({ seat: null, pendingSeat: 3, stack: 0 });
    expect(v.seats[3]).toBeNull();
    expectError(() => room.takeSeat(c, 3), 'That seat is taken');
    expectError(() => room.takeSeat(b, 4), /already asked for a seat/);
    expectError(() => room.approveSeat(b, b, true), 'Only the host can do that');
    // the host itself moves seats without approval
    room.standUp(host);
    expect(room.takeSeat(host, 5)).toEqual({ pending: false });
    room.approveSeat(host, b, true);
    v = room.viewFor(b);
    expect(player(v, b)).toMatchObject({ seat: 3, pendingSeat: null, stack: BUY_IN, buyIns: 1 });
    expect(room.drainOutbox().notices).toContainEqual({ playerId: b, notice: { kind: 'success', text: 'Host approved your seat' } });
    // deny
    room.takeSeat(c, 0);
    room.approveSeat(host, c, false);
    expect(player(room.viewFor(c), c)).toMatchObject({ seat: null, pendingSeat: null });
    expect(room.drainOutbox().notices).toContainEqual({
      playerId: c,
      notice: { kind: 'error', text: 'The host declined your seat request' },
    });
    expectError(() => room.approveSeat(host, c, true), 'That seat request is no longer open');
    // a pending player can withdraw by "standing up"
    room.takeSeat(c, 1);
    room.standUp(c);
    expect(player(room.viewFor(c), c).pendingSeat).toBeNull();
    room.dispose();
  });

  it('approval seats the player in the first free seat if theirs was taken, or errors when full', () => {
    const room = new Room({ id: 'ABCDEF', settings: { requireApproval: true, maxPlayers: 2 } });
    const host = room.addHost('Alice').playerId;
    const b = room.join({ name: 'Bob' }).playerId;
    room.takeSeat(b, 1);
    // force a collision: host stands and re-sits in the reserved seat is impossible, so shrink is blocked
    expectError(() => room.updateSettings(host, { maxPlayers: 1 }), /Seats must be|taken/);
    room.approveSeat(host, b, true);
    expect(room.viewFor(b).me.seat).toBe(1);
    const c = room.join({ name: 'Carol' }).playerId;
    expectError(() => room.takeSeat(c, 0), 'Table is full — you can watch until a seat opens');
    room.dispose();
  });
});

// ===================================================================== start + hands

describe('starting and playing hands', () => {
  it('start needs the host and at least 2 eligible players', () => {
    const room = new Room({ id: 'ABCDEF' });
    const a = room.addHost('Alice').playerId;
    room.attach(a);
    const b = room.join({ name: 'Bob' }).playerId;
    expectError(() => room.start(a), /at least 2 players/);
    room.takeSeat(b, 1);
    // Bob is seated but not connected -> not eligible
    expectError(() => room.start(a), /at least 2 players/);
    room.attach(b);
    room.setSitOut(b, true);
    expectError(() => room.start(a), /at least 2 players/);
    room.setSitOut(b, false);
    expectError(() => room.start(b), 'Only the host can do that');
    room.start(a);
    const v = room.viewFor(a);
    expect(v.status).toBe('running');
    expect(v.started).toBe(true);
    expect(v.hand?.handNumber).toBe(1);
    expectError(() => room.start(a), 'The game is already running');
    room.dispose();
  });

  it('plays a full hand to showdown with a stacked deck, then rotates the button', () => {
    const t = makeTable({
      decks: { 1: deckFor([0, 1, 2], 0, { 0: 'Ah Kh', 1: 'Qs Qd', 2: '7c 2d' }, 'Ac 9h 4s 3d 8c') },
    });
    const [a, b, c] = t.ids as [string, string, string];
    t.room.start(a);
    let v = t.view();
    expect(v.hand).toMatchObject({
      handNumber: 1,
      street: 'preflop',
      phase: 'betting',
      dealerSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      smallBlind: 10,
      bigBlind: 20,
      currentBet: 20,
      minRaiseTo: 40,
      totalPot: 30,
      toActPlayerId: a,
      turnDeadline: null,
      runout: false,
    });
    expect(player(v, b)).toMatchObject({ bet: 10, stack: 1990, inHand: true, hasCards: true, lastAction: { type: 'sb', amount: 10 } });
    expect(v.me.holeCards).toEqual(['Ah', 'Kh']);
    expect(v.me.legal).toMatchObject({ canCall: true, callAmount: 20, canCheck: false, minRaiseTo: 40, maxRaiseTo: 2000 });
    expect(t.view(b).me.legal).toBeNull();
    expectError(() => t.act(b, 'call'), 'Not your turn');

    t.act(a, 'call');
    t.act(b, 'call');
    t.act(c, 'check');
    v = t.view();
    expect(v.hand?.phase).toBe('dealing');
    expect(v.hand?.toActPlayerId).toBeNull();
    vi.advanceTimersByTime(TIMING.streetDelayMs - 1);
    expect(t.view().hand?.street).toBe('preflop');
    vi.advanceTimersByTime(1);
    v = t.view();
    expect(v.hand).toMatchObject({ street: 'flop', phase: 'betting', board: ['Ac', '9h', '4s'], toActPlayerId: b, totalPot: 60 });
    expect(v.hand?.pots).toEqual([{ amount: 60, eligiblePlayerIds: [a, b, c] }]);

    t.act(b, 'check');
    t.act(c, 'check');
    t.act(a, 'raise', 40);
    t.act(b, 'call');
    t.act(c, 'fold');
    vi.advanceTimersByTime(TIMING.streetDelayMs);
    expect(t.view().hand?.street).toBe('turn');
    t.act(b, 'check');
    t.act(a, 'check');
    vi.advanceTimersByTime(TIMING.streetDelayMs);
    expect(t.view().hand?.street).toBe('river');
    t.act(b, 'check');
    t.act(a, 'check');
    vi.advanceTimersByTime(TIMING.streetDelayMs);
    v = t.view(c);
    expect(v.hand).toMatchObject({ street: 'showdown', phase: 'complete', totalPot: 0, pots: [] });
    expect(v.hand?.winners).toEqual([
      { playerId: a, amount: 140, potIndex: 0, handName: 'Pair of Aces', bestCards: ['Ah', 'Ac', 'Kh', '9h', '8c'] },
    ]);
    expect(player(v, a)).toMatchObject({ stack: 2080, shownCards: ['Ah', 'Kh'] });
    expect(player(v, b)).toMatchObject({ stack: 1940, shownCards: ['Qs', 'Qd'] });
    expect(player(v, c)).toMatchObject({ stack: 1980, shownCards: null, folded: true, hasCards: false });
    expect(v.ledger.map((r) => [r.stack, r.net])).toEqual([
      [2080, 80],
      [1940, -60],
      [1980, -20],
    ]);

    const log = logTexts(t);
    expect(log).toEqual(
      expect.arrayContaining([
        'Hand #1 — Alice has the button',
        'Bob posts the small blind 10',
        'Carol posts the big blind 20',
        'Alice calls 20',
        'Bob calls 20',
        'Carol checks',
        'Flop: A♣ 9♥ 4♠',
        'Alice bets 40',
        'Carol folds',
        'Turn: 3♦ (board A♣ 9♥ 4♠ 3♦)',
        'River: 8♣ (board A♣ 9♥ 4♠ 3♦ 8♣)',
        'Alice shows A♥ K♥ — Pair of Aces',
        'Bob shows Q♠ Q♦ — Pair of Queens',
        'Alice wins 140 from the main pot with Pair of Aces',
      ]),
    );
    const handLog = t.room.history().log.filter((e) => e.handNumber === 1);
    expect(handLog.length).toBeGreaterThan(10);

    // Carol (folded) may show; Alice (already face up) may not
    expect(t.view(c).me.canShowCards).toBe(true);
    expect(t.view(a).me.canShowCards).toBe(false);
    t.room.showCards(c);
    expect(player(t.view(a), c).shownCards).toEqual(['7c', '2d']);
    expect(logTexts(t)).toContain('Carol shows 7♣ 2♦');
    expectError(() => t.room.showCards(c), /once the hand is over/);

    // next hand after the showdown delay, button moves to Bob
    vi.advanceTimersByTime(TIMING.showdownNextHandDelayMs - 1);
    expect(t.view().hand?.handNumber).toBe(1);
    vi.advanceTimersByTime(1);
    v = t.view();
    expect(v.hand).toMatchObject({ handNumber: 2, dealerSeat: 1, smallBlindSeat: 2, bigBlindSeat: 0, phase: 'betting' });
    expect(logTexts(t)).toContain('Hand #2 — Bob has the button');
    expect(player(v, c).shownCards).toBeNull();
    t.room.dispose();
  });

  it('first button is random among eligible seats', () => {
    const t = makeTable({ names: ['A', 'B', 'C', 'D'], rand: () => 0.6 });
    t.room.start(t.ids[0]!);
    expect(t.view().hand?.dealerSeat).toBe(2);
    t.room.dispose();
  });

  it('uncontested hand: next hand after nextHandDelayMs; uncalled bet returned', () => {
    const t = makeTable();
    const [a, b, c] = t.ids as [string, string, string];
    t.room.start(a);
    t.act(a, 'raise', 100);
    t.act(b, 'fold');
    t.act(c, 'fold');
    const v = t.view();
    expect(v.hand).toMatchObject({ phase: 'complete', street: 'preflop' });
    expect(v.hand?.winners).toEqual([{ playerId: a, amount: 50, potIndex: 0, handName: null, bestCards: null }]);
    expect(player(v, a)).toMatchObject({ stack: 2030, shownCards: null, hasCards: true });
    expect(logTexts(t)).toEqual(expect.arrayContaining(['Alice raises to 100', 'Uncalled 80 returned to Alice', 'Alice wins 50 from the main pot']));
    expect(t.view(a).me.canShowCards).toBe(true);
    vi.advanceTimersByTime(TIMING.nextHandDelayMs - 1);
    expect(t.view().hand?.handNumber).toBe(1);
    vi.advanceTimersByTime(1);
    expect(t.view().hand?.handNumber).toBe(2);
    t.room.dispose();
  });

  it('all-in runout: cards face up, one street per runout delay', () => {
    const t = makeTable({
      names: ['Alice', 'Bob'],
      decks: { 1: deckFor([0, 1], 0, { 0: 'As Ad', 1: 'Ks Kd' }, '2c 7h 9s 3d 4c') },
    });
    const [a, b] = t.ids as [string, string];
    t.room.start(a);
    // heads-up: dealer (Alice) is SB and acts first
    expect(t.view().hand).toMatchObject({ dealerSeat: 0, smallBlindSeat: 0, bigBlindSeat: 1, toActPlayerId: a });
    t.act(a, 'allin');
    t.act(b, 'call');
    let v = t.view(a);
    expect(v.hand).toMatchObject({ phase: 'dealing', runout: true, board: [] });
    expect(player(v, b).shownCards).toEqual(['Ks', 'Kd']);
    vi.advanceTimersByTime(TIMING.runoutStreetDelayMs);
    expect(t.view().hand?.board).toHaveLength(3);
    vi.advanceTimersByTime(TIMING.runoutStreetDelayMs);
    expect(t.view().hand?.board).toHaveLength(4);
    vi.advanceTimersByTime(TIMING.runoutStreetDelayMs);
    expect(t.view().hand?.board).toHaveLength(5);
    vi.advanceTimersByTime(TIMING.runoutStreetDelayMs);
    v = t.view(b);
    expect(v.hand?.phase).toBe('complete');
    expect(player(v, a).stack).toBe(4000);
    expect(player(v, b)).toMatchObject({ stack: 0, busted: true });
    // only one player with chips: game over once the result display ends
    expect(v.gameOverWinnerId).toBeNull();
    vi.advanceTimersByTime(TIMING.showdownNextHandDelayMs);
    v = t.view(b);
    expect(v.hand).toBeNull();
    expect(v.gameOverWinnerId).toBe(a);
    expect(v.me.canRequestBuyBack).toBe(true);
    t.room.dispose();
  });

  it('pending blinds apply from the next hand; HandView shows the current blinds', () => {
    const t = makeTable();
    const [a, b, c] = t.ids as [string, string, string];
    t.room.start(a);
    t.room.updateSettings(a, { smallBlind: 25, bigBlind: 50 });
    let v = t.view();
    expect(v.settings).toMatchObject({ smallBlind: 25, bigBlind: 50 });
    expect(v.hand).toMatchObject({ smallBlind: 10, bigBlind: 20 });
    expect(logTexts(t)).toContain('Blinds will be 25/50 from the next hand');
    t.act(a, 'fold');
    t.act(b, 'fold');
    vi.advanceTimersByTime(TIMING.nextHandDelayMs);
    v = t.view();
    expect(v.hand).toMatchObject({ handNumber: 2, smallBlind: 25, bigBlind: 50, smallBlindSeat: 2 });
    // Carol won 10 in hand 1, then posted the new 25 small blind
    expect(player(v, c)).toMatchObject({ stack: 1985, bet: 25 });
    t.room.dispose();
  });

  it('pause stops new hands after the current one; resume restarts', () => {
    const t = makeTable();
    const [a, b] = t.ids as [string, string];
    expectError(() => t.room.pause(a), 'The game has not started yet');
    t.room.start(a);
    expectError(() => t.room.pause(b), 'Only the host can do that');
    t.room.pause(a);
    expect(t.view().status).toBe('paused');
    expectError(() => t.room.pause(a), 'The game is already paused');
    t.act(a, 'fold');
    t.act(b, 'fold');
    expect(t.view().hand?.phase).toBe('complete');
    vi.advanceTimersByTime(TIMING.nextHandDelayMs + 10_000);
    expect(t.view().hand).toBeNull();
    expect(t.view().gameOverWinnerId).toBeNull();
    t.room.resume(a);
    expect(t.view()).toMatchObject({ status: 'running', hand: { handNumber: 2 } });
    expectError(() => t.room.resume(a), 'The game is not paused');
    t.room.dispose();
  });

  it('waits when fewer than 2 are eligible and restarts when someone sits or returns', () => {
    const t = makeTable({ names: ['Alice', 'Bob'] });
    const [a, b] = t.ids as [string, string];
    t.room.start(a);
    t.room.setSitOut(b, true); // applies from next hand
    expect(player(t.view(), b)).toMatchObject({ sittingOut: true, inHand: true });
    t.act(a, 'fold');
    vi.advanceTimersByTime(TIMING.nextHandDelayMs);
    expect(t.view().hand).toBeNull();
    expect(t.view().status).toBe('running');
    t.room.setSitOut(b, false);
    expect(t.view().hand?.handNumber).toBe(2);
    t.room.dispose();
  });

  it('disconnected players are not dealt in (auto-away); reconnecting deals them back', () => {
    const t = makeTable();
    const [a, b, c] = t.ids as [string, string, string];
    t.room.start(a);
    t.room.detach(c);
    expect(player(t.view(), c)).toMatchObject({ connected: false, sittingOut: true, inHand: true });
    t.act(a, 'fold');
    t.act(b, 'fold');
    vi.advanceTimersByTime(TIMING.nextHandDelayMs);
    let v = t.view();
    expect(v.hand?.handNumber).toBe(2);
    expect(player(v, c).inHand).toBe(false);
    t.room.attach(c);
    expect(player(t.view(), c)).toMatchObject({ connected: true, sittingOut: false });
    // finish hand 2 (heads-up Alice vs Bob): Bob is the button/SB and acts first
    t.act(t.toAct()!, 'fold');
    vi.advanceTimersByTime(TIMING.nextHandDelayMs);
    v = t.view();
    expect(v.hand?.handNumber).toBe(3);
    expect(player(v, c).inHand).toBe(true);
    t.room.dispose();
  });
});

// ===================================================================== clocks

describe('shot clock and disconnect grace', () => {
  it('auto-folds facing a bet, auto-checks otherwise, and sits out after 2 timeouts', () => {
    const t = makeTable({ settings: { turnTimeSec: 10 } });
    const [a, b, c] = t.ids as [string, string, string];
    t.room.start(a);
    let v = t.view();
    const now = Date.now();
    expect(v.hand).toMatchObject({ toActPlayerId: a, turnDeadline: now + 10_000, turnDurationMs: 10_000 });
    vi.advanceTimersByTime(9_999);
    expect(t.toAct()).toBe(a);
    vi.advanceTimersByTime(1);
    v = t.view();
    expect(player(v, a)).toMatchObject({ folded: true, timeouts: 1 });
    expect(v.hand).toMatchObject({ toActPlayerId: b, turnDeadline: now + 20_000 });
    expect(logTexts(t)).toEqual(expect.arrayContaining(['Alice ran out of time', 'Alice folds']));
    t.act(b, 'call');
    // Carol (BB) can check -> auto-check
    vi.advanceTimersByTime(10_000);
    expect(player(t.view(), c)).toMatchObject({ folded: false, timeouts: 1, lastAction: { type: 'check', amount: 0 } });
    vi.advanceTimersByTime(TIMING.streetDelayMs);
    expect(t.view().hand?.street).toBe('flop');
    t.room.drainOutbox();
    t.act(b, 'check');
    vi.advanceTimersByTime(10_000); // Carol's 2nd timeout in a row
    v = t.view();
    expect(player(v, c)).toMatchObject({ timeouts: 2, sittingOut: true, inHand: true, folded: false });
    expect(t.room.drainOutbox().notices).toContainEqual({
      playerId: c,
      notice: { kind: 'info', text: 'You were sat out after 2 timeouts' },
    });
    // finish the hand, Carol is not dealt into the next one
    vi.advanceTimersByTime(TIMING.streetDelayMs);
    t.act(b, 'check');
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(TIMING.streetDelayMs);
    t.act(b, 'check');
    vi.advanceTimersByTime(10_000);
    advanceUntil(() => t.view().hand?.handNumber === 2);
    v = t.view();
    expect(player(v, c).inHand).toBe(false);
    expect(player(v, a).inHand).toBe(true);
    // heads-up hand 2: Bob has the button (SB) and acts first, Alice is the BB
    expect(v.hand).toMatchObject({ dealerSeat: 1, toActPlayerId: b });
    expect(player(v, a).timeouts).toBe(1);
    t.act(b, 'call');
    t.act(a, 'check'); // a voluntary action resets the counter
    expect(player(t.view(), a).timeouts).toBe(0);
    t.room.setSitOut(c, false);
    expect(player(t.view(), c)).toMatchObject({ timeouts: 0, sittingOut: false });
    t.room.dispose();
  });

  it('with no shot clock, a disconnected actor auto-acts after the grace period', () => {
    const t = makeTable({ settings: { turnTimeSec: 0 } });
    const [a, b] = t.ids as [string, string];
    t.room.start(a);
    expect(t.view(b).hand?.turnDeadline).toBeNull();
    t.room.detach(a);
    const now = Date.now();
    expect(t.view(b).hand).toMatchObject({ toActPlayerId: a, turnDeadline: now + TIMING.disconnectActGraceMs });
    vi.advanceTimersByTime(TIMING.disconnectActGraceMs - 1);
    expect(t.view(b).hand?.toActPlayerId).toBe(a);
    vi.advanceTimersByTime(1);
    expect(player(t.view(b), a)).toMatchObject({ folded: true, timeouts: 0 });
    expect(logTexts(t)).toContain('Alice is away');
    // Bob disconnects while acting, then comes back before the grace ends
    expect(t.toAct()).toBe(b);
    t.room.detach(b);
    vi.advanceTimersByTime(10_000);
    t.room.attach(b);
    expect(t.view(b).hand?.turnDeadline).toBeNull();
    vi.advanceTimersByTime(TIMING.disconnectActGraceMs * 2);
    expect(t.toAct()).toBe(b);
    t.room.dispose();
  });

  it('when the disconnected player\'s turn comes later, the grace clock starts then', () => {
    const t = makeTable({ settings: { turnTimeSec: 0 } });
    const [a, b, c] = t.ids as [string, string, string];
    t.room.start(a);
    t.room.detach(c);
    t.act(a, 'call');
    t.act(b, 'call');
    expect(t.toAct()).toBe(c);
    vi.advanceTimersByTime(TIMING.disconnectActGraceMs);
    // BB could check -> auto-check, betting round closes
    expect(player(t.view(), c).lastAction).toEqual({ type: 'check', amount: 0 });
    t.room.dispose();
  });
});

// ===================================================================== standing / leaving

describe('standing up, leaving and returning', () => {
  it('standing up mid-hand folds, frees the seat and remembers the stack', () => {
    const t = makeTable();
    const [a, b, c] = t.ids as [string, string, string];
    t.room.start(a);
    t.act(a, 'raise', 60);
    t.act(b, 'call');
    // Carol (BB, 20 in) stands up when it is her turn
    t.room.standUp(c);
    let v = t.view();
    expect(v.seats[2]).toBeNull();
    expect(player(v, c)).toMatchObject({ seat: null, inHand: false, stack: 1980 });
    expect(v.hand?.phase).toBe('dealing');
    // ledger counts chips committed in the live hand until it is settled
    expect(v.ledger.find((r) => r.playerId === c)).toMatchObject({ stack: 2000, net: 0, inRoom: true });
    expectError(() => t.room.standUp(c), 'You are not seated');
    // she sits back down (different seat) with the same chips, no new buy-in
    t.room.takeSeat(c, 5);
    v = t.view();
    expect(player(v, c)).toMatchObject({ seat: 5, stack: 1980, buyIns: 1, inHand: false });
    expect(v.ledger.find((r) => r.playerId === c)).toMatchObject({ buyIns: 1, totalBuyIn: BUY_IN });
    expect(logTexts(t)).toContain('Carol sat back down with 1,980');
    t.room.dispose();
  });

  it('leaving the room keeps the record; the token brings back the same stack as a spectator', () => {
    const t = makeTable();
    const [a, b, c] = t.ids as [string, string, string];
    t.room.start(a);
    t.act(a, 'fold');
    t.act(b, 'call');
    t.room.leave(c); // BB with 20 committed, folds
    let v = t.view();
    expect(v.players.find((p) => p.id === c)).toBeUndefined();
    expect(v.ledger.find((r) => r.playerId === c)).toMatchObject({ inRoom: false, stack: 1980 });
    expect(v.hand?.phase).toBe('complete');
    expect(player(v, b).stack).toBe(2020);
    expect(chatTexts(t)).toContain('Carol left');
    expectError(() => t.room.act(c, { type: 'check' }), 'You are not in this room');
    const back = t.room.join({ token: t.tokens[2] });
    expect(back).toEqual({ playerId: c, token: t.tokens[2], reconnected: true });
    t.room.attach(c);
    v = t.view(c);
    expect(player(v, c)).toMatchObject({ seat: null, stack: 1980, buyIns: 1 });
    expect(v.ledger.find((r) => r.playerId === c)?.inRoom).toBe(true);
    t.room.takeSeat(c, 2);
    expect(player(t.view(), c).stack).toBe(1980);
    t.room.dispose();
  });

  it('reconnecting with a token restores the seat, stack and hole cards', () => {
    const t = makeTable({ decks: { 1: deckFor([0, 1, 2], 0, { 1: 'Jc Jd' }) } });
    const [a, b] = t.ids as [string, string];
    t.room.start(a);
    t.room.detach(b);
    const r = t.room.join({ token: t.tokens[1], name: 'Ignored' });
    expect(r).toMatchObject({ playerId: b, reconnected: true });
    t.room.attach(b);
    const v = t.view(b);
    expect(v.me).toMatchObject({ seat: 1, name: 'Bob', holeCards: ['Jc', 'Jd'] });
    expect(player(v, b)).toMatchObject({ stack: 1990, bet: 10, connected: true });
    t.room.dispose();
  });

  it('host leaving passes the host to the next seated connected player', () => {
    const t = makeTable({ names: ['Alice', 'Bob', 'Carol', 'Dan'] });
    const [a, b, c] = t.ids as [string, string, string, string];
    t.room.detach(b); // Bob is offline
    t.room.drainOutbox();
    t.room.leave(a);
    let v = t.view(c);
    expect(v.hostId).toBe(c);
    expect(v.me.isHost).toBe(true);
    expect(t.room.drainOutbox().notices).toContainEqual({ playerId: c, notice: { kind: 'success', text: 'You are now the host' } });
    // explicit transfer
    expectError(() => t.room.transferHost(b, c), 'Only the host can do that');
    expectError(() => t.room.transferHost(c, a), 'That player is not in the room');
    t.room.transferHost(c, b);
    v = t.view(c);
    expect(v.hostId).toBe(b);
    expect(player(v, b).isHost).toBe(true);
    t.room.dispose();
  });

  it('a host who stays disconnected hands the host role to the next connected player', () => {
    const t = makeTable({ names: ['Alice', 'Bob', 'Carol'] });
    const [a, b, c] = t.ids as [string, string, string];
    t.room.detach(a);
    vi.advanceTimersByTime(TIMING.hostAwayTransferMs - 1);
    expect(t.view(b).hostId).toBe(a);
    // coming back in time keeps the role and resets the clock
    t.room.attach(a);
    t.room.detach(a);
    vi.advanceTimersByTime(TIMING.hostAwayTransferMs - 1);
    expect(t.view(b).hostId).toBe(a);
    t.room.drainOutbox();
    vi.advanceTimersByTime(1);
    const v = t.view(b);
    expect(v.hostId).toBe(b);
    expect(v.me.isHost).toBe(true);
    expect(logTexts(t)).toContain('Alice is away — Bob is now the host');
    expect(t.room.drainOutbox().notices).toContainEqual({ playerId: b, notice: { kind: 'success', text: 'You are now the host' } });
    // the old host returns as a regular player and can be handed the role back
    t.room.attach(a);
    expectError(() => t.room.start(a), 'Only the host can do that');
    t.room.transferHost(b, a);
    expect(t.view(c).hostId).toBe(a);
    t.room.dispose();
  });

  it('the host role does not move while nobody else is connected', () => {
    const t = makeTable({ names: ['Alice', 'Bob'] });
    const [a, b] = t.ids as [string, string];
    t.room.detach(b);
    t.room.detach(a);
    vi.advanceTimersByTime(TIMING.hostAwayTransferMs * 3);
    expect(t.room.getHostId()).toBe(a);
    // Bob comes back: the host clock starts only now
    t.room.attach(b);
    vi.advanceTimersByTime(TIMING.hostAwayTransferMs - 1);
    expect(t.room.getHostId()).toBe(a);
    vi.advanceTimersByTime(1);
    expect(t.room.getHostId()).toBe(b);
    t.room.dispose();
  });

  it('host leaving with nobody connected: the next person to join becomes host', () => {
    const room = new Room({ id: 'ABCDEF' });
    const a = room.addHost('Alice').playerId;
    room.leave(a);
    const d = room.join({ name: 'Dan' }).playerId;
    expect(room.viewFor(d).hostId).toBe(d);
    room.dispose();
  });
});

// ===================================================================== kick

describe('kick', () => {
  it('kick folds the hand, frees the seat, invalidates the token, keeps the ledger row', () => {
    const t = makeTable();
    const [a, b, c] = t.ids as [string, string, string];
    t.room.start(a);
    expectError(() => t.room.kick(b, c), 'Only the host can do that');
    expectError(() => t.room.kick(a, a), 'You can’t remove yourself');
    expectError(() => t.room.kick(a, 'nobody'), 'Player not found');
    t.act(a, 'raise', 100);
    t.room.kick(a, c);
    const v = t.view();
    expect(v.seats[2]).toBeNull();
    expect(v.players.find((p) => p.id === c)).toBeUndefined();
    expect(v.ledger.find((r) => r.playerId === c)).toMatchObject({ inRoom: false, stack: 2000 });
    expect(v.hand?.toActPlayerId).toBe(b);
    expect(chatTexts(t)).toContain('Carol was removed by the host');
    expectError(() => t.room.viewFor(c), 'You are not in this room');
    expectError(() => t.room.join({ token: t.tokens[2] }), /expired/);
    expect(t.room.playerIdForToken(t.tokens[2]!)).toBeNull();
    t.act(b, 'fold');
    expect(t.view().ledger.find((r) => r.playerId === c)).toMatchObject({ inRoom: false, stack: 1980, net: -20 });
    t.room.dispose();
  });
});

// ===================================================================== buy-back

describe('buy-back votes', () => {
  it('cannot be requested while still in the unfinished hand', () => {
    const t = makeTable({
      decks: { 1: deckFor([0, 1, 2], 0, { 0: '7c 2d', 1: 'As Ah' }, 'Kd 9s 5h 3c Jd') },
    });
    const [a, b, c] = t.ids as [string, string, string];
    t.room.start(a);
    t.act(a, 'allin');
    t.act(b, 'allin');
    t.act(c, 'fold');
    expect(player(t.view(a), a)).toMatchObject({ stack: 0, allIn: true, busted: false });
    expect(t.view(a).me.canRequestBuyBack).toBe(false);
    expectError(() => t.room.requestBuyBack(a), 'Wait until this hand is over');
    t.room.dispose();
  });

  it('unanimous yes approves: +1 buy-in, ledger updated, dealt into the next hand', () => {
    const t = bustAlice();
    const [a, b, c] = t.ids as [string, string, string];
    let v = t.view(a);
    expect(player(v, a).busted).toBe(true);
    expect(v.me).toMatchObject({ canRequestBuyBack: true, buyBackCooldownUntil: null });
    const { voteId } = t.room.requestBuyBack(a);
    v = t.view(b);
    const now = Date.now();
    expect(v.buyBackVotes).toEqual([
      {
        id: voteId,
        requesterId: a,
        requesterName: 'Alice',
        amount: BUY_IN,
        createdAt: now,
        deadline: now + 30_000,
        votes: { [b]: null, [c]: null },
        status: 'pending',
        resolvedReason: null,
        resolvedAt: null,
      },
    ]);
    expect(v.me.votesAwaitingMe).toEqual([voteId]);
    expect(t.view(a).me).toMatchObject({ canRequestBuyBack: false, votesAwaitingMe: [] });
    expectError(() => t.room.requestBuyBack(a), /already asked/);
    expectError(() => t.room.voteBuyBack(a, voteId, true), 'You are not voting on this request');
    t.room.voteBuyBack(b, voteId, true);
    expectError(() => t.room.voteBuyBack(b, voteId, false), 'You already voted');
    expect(t.view(b).me.votesAwaitingMe).toEqual([]);
    expect(t.view(c).me.votesAwaitingMe).toEqual([voteId]);
    t.room.drainOutbox();
    t.room.voteBuyBack(c, voteId, true);
    v = t.view(a);
    expect(v.buyBackVotes[0]).toMatchObject({ status: 'approved', resolvedReason: 'unanimous', resolvedAt: Date.now() });
    expect(player(v, a)).toMatchObject({ stack: BUY_IN, buyIns: 2, busted: false });
    expect(v.ledger.find((r) => r.playerId === a)).toMatchObject({ buyIns: 2, totalBuyIn: 4000, stack: 2000, net: -2000 });
    const msg = 'Alice bought back in for 2,000 — everyone agreed';
    expect(logTexts(t)).toContain(msg);
    expect(chatTexts(t)).toContain(msg);
    expect(t.room.drainOutbox().notices).toContainEqual({ playerId: a, notice: { kind: 'success', text: "You're back in with 2,000" } });
    expectError(() => t.room.voteBuyBack(b, voteId, true), 'That vote is already over');
    // still in the result display: hand 2 includes Alice
    advanceUntil(() => t.view().hand?.handNumber === 2);
    expect(player(t.view(), a).inHand).toBe(true);
    // resolved votes are pruned after a few seconds
    vi.advanceTimersByTime(TIMING.resolvedVoteVisibleMs);
    expect(t.view().buyBackVotes).toEqual([]);
    t.room.dispose();
  });

  it('any "no" rejects immediately and starts a cooldown', () => {
    const t = bustAlice();
    const [a, b] = t.ids as [string, string, string];
    const { voteId } = t.room.requestBuyBack(a);
    t.room.voteBuyBack(b, voteId, false);
    let v = t.view(a);
    expect(v.buyBackVotes[0]).toMatchObject({ status: 'rejected', resolvedReason: 'declined' });
    expect(player(v, a)).toMatchObject({ stack: 0, buyIns: 1 });
    expect(v.me.buyBackCooldownUntil).toBe(Date.now() + TIMING.buyBackCooldownMs);
    expect(v.me.canRequestBuyBack).toBe(false);
    expect(chatTexts(t)).toContain("Alice's buy-back was declined (Bob said no)");
    expectError(() => t.room.requestBuyBack(a), 'You can ask again in 30s');
    vi.advanceTimersByTime(TIMING.buyBackCooldownMs);
    v = t.view(a);
    expect(v.me).toMatchObject({ canRequestBuyBack: true, buyBackCooldownUntil: null });
    t.room.requestBuyBack(a);
    t.room.dispose();
  });

  it('silence counts as no: rejected with reason timeout when the timer expires', () => {
    const t = bustAlice({ buyBackVoteSec: 20 });
    const [a, b, c] = t.ids as [string, string, string];
    const { voteId } = t.room.requestBuyBack(a);
    t.room.voteBuyBack(b, voteId, true);
    vi.advanceTimersByTime(19_999);
    expect(t.view().buyBackVotes[0]?.status).toBe('pending');
    vi.advanceTimersByTime(1);
    const v = t.view(a);
    expect(v.buyBackVotes[0]).toMatchObject({
      status: 'rejected',
      resolvedReason: 'timeout',
      votes: { [b]: 'yes', [c]: null },
    });
    expect(player(v, a).stack).toBe(0);
    expect(v.me.buyBackCooldownUntil).not.toBeNull();
    expect(chatTexts(t)).toContain("Alice's buy-back was rejected — not everyone voted in time");
    t.room.dispose();
  });

  it('turning buy-backs off cancels pending requests', () => {
    const t = bustAlice();
    const [a, b] = t.ids as [string, string, string];
    const { voteId } = t.room.requestBuyBack(a);
    t.room.updateSettings(a, { allowBuyBack: false });
    const v = t.view(a);
    expect(v.buyBackVotes[0]).toMatchObject({ id: voteId, status: 'rejected', resolvedReason: 'cancelled' });
    expect(player(v, a).stack).toBe(0);
    expectError(() => t.room.voteBuyBack(b, voteId, true), 'That vote is already over');
    expect(v.me.canRequestBuyBack).toBe(false);
    t.room.dispose();
  });

  it('the requester can cancel (no cooldown)', () => {
    const t = bustAlice();
    const [a, b] = t.ids as [string, string, string];
    const { voteId } = t.room.requestBuyBack(a);
    expectError(() => t.room.cancelBuyBack(b, voteId), 'Only the player who asked can cancel');
    t.room.cancelBuyBack(a, voteId);
    const v = t.view(a);
    expect(v.buyBackVotes[0]).toMatchObject({ status: 'rejected', resolvedReason: 'cancelled' });
    expect(v.me.buyBackCooldownUntil).toBeNull();
    expectError(() => t.room.cancelBuyBack(a, voteId), 'That vote is already over');
    expect(t.room.requestBuyBack(a).voteId).not.toBe(voteId);
    t.room.dispose();
  });

  it('a voter standing up is removed and the vote re-evaluated', () => {
    const t = bustAlice();
    const [a, b, c] = t.ids as [string, string, string];
    const { voteId } = t.room.requestBuyBack(a);
    t.room.voteBuyBack(b, voteId, true);
    t.room.standUp(c);
    const v = t.view(a);
    expect(v.buyBackVotes[0]).toMatchObject({ status: 'approved', resolvedReason: 'unanimous', votes: { [b]: 'yes' } });
    expect(player(v, a).stack).toBe(BUY_IN);
    t.room.dispose();
  });

  it('a voter leaving the room before voting shrinks the voter list (still pending)', () => {
    const t = bustAlice();
    const [a, b, c] = t.ids as [string, string, string];
    const { voteId } = t.room.requestBuyBack(a);
    t.room.leave(c);
    expect(t.view(a).buyBackVotes[0]).toMatchObject({ status: 'pending', votes: { [b]: null } });
    t.room.voteBuyBack(b, voteId, true);
    expect(t.view(a).buyBackVotes[0]?.status).toBe('approved');
    t.room.dispose();
  });

  it('a kicked voter is removed as well', () => {
    const t = bustAlice();
    const [a, b, c] = t.ids as [string, string, string];
    const { voteId } = t.room.requestBuyBack(a);
    t.room.voteBuyBack(c, voteId, true);
    t.room.kick(a, b);
    expect(t.view(a).buyBackVotes[0]).toMatchObject({ status: 'approved', votes: { [c]: 'yes' } });
    t.room.dispose();
  });

  it('the requester standing up, leaving or being kicked cancels the request', () => {
    const t = bustAlice();
    const [a] = t.ids as [string, string, string];
    t.room.requestBuyBack(a);
    t.room.standUp(a);
    expect(t.view(a).buyBackVotes[0]).toMatchObject({ status: 'rejected', resolvedReason: 'cancelled' });
    expect(t.view(a).me.canRequestBuyBack).toBe(false); // not seated
    expectError(() => t.room.requestBuyBack(a), 'Take a seat first');
    t.room.takeSeat(a, 0);
    t.room.requestBuyBack(a);
    t.room.leave(a);
    expect(t.view(t.ids[1]).buyBackVotes.filter((v) => v.resolvedReason === 'cancelled')).toHaveLength(2);
    t.room.dispose();
  });

  it('zero voters: approved immediately', () => {
    const t = bustAlice();
    const [a, b, c] = t.ids as [string, string, string];
    t.room.standUp(b);
    t.room.leave(c);
    const { voteId } = t.room.requestBuyBack(a);
    const v = t.view(a);
    expect(v.buyBackVotes.find((x) => x.id === voteId)).toMatchObject({ status: 'approved', resolvedReason: 'unanimous', votes: {} });
    expect(player(v, a)).toMatchObject({ stack: BUY_IN, buyIns: 2 });
    expect(logTexts(t)).toContain('Alice bought back in for 2,000');
    t.room.dispose();
  });

  it('spectators and pending-approval players do not vote; busted / sitting-out / offline seated players do', () => {
    const t = bustAliceAndBob();
    const [a, b, c] = t.ids as [string, string, string];
    t.room.updateSettings(a, { requireApproval: true });
    const d = t.room.join({ name: 'Dan' }).playerId;
    const e = t.room.join({ name: 'Eve' }).playerId;
    t.room.takeSeat(e, 6); // pending approval
    t.room.detach(c);
    t.room.setSitOut(b, true);
    const { voteId } = t.room.requestBuyBack(a);
    const vote = t.view(a).buyBackVotes.find((v) => v.id === voteId)!;
    expect(Object.keys(vote.votes).sort()).toEqual([b, c].sort());
    expect(vote.votes[d]).toBeUndefined();
    expect(vote.votes[e]).toBeUndefined();
    t.room.dispose();
  });

  it('disallowed: has chips, buy-backs off, not seated', () => {
    const t = makeTable();
    const [a] = t.ids as [string, string, string];
    expect(t.view(a).me.canRequestBuyBack).toBe(false);
    expectError(() => t.room.requestBuyBack(a), 'You can only buy back in once you are out of chips');
    const d = t.room.join({ name: 'Dan' }).playerId;
    expectError(() => t.room.requestBuyBack(d), 'Take a seat first');
    t.room.dispose();

    const t2 = bustAlice({ allowBuyBack: false });
    expect(t2.view(t2.ids[0]).me.canRequestBuyBack).toBe(false);
    expectError(() => t2.room.requestBuyBack(t2.ids[0]!), 'Buy-backs are turned off at this table');
    t2.room.dispose();
  });

  it('concurrent requests from different players resolve independently; ledger and game-over', () => {
    const t = bustAliceAndBob();
    const [a, b, c] = t.ids as [string, string, string];
    let v = t.view(c);
    expect(player(v, c).stack).toBe(6000);
    expect(v.gameOverWinnerId).toBeNull(); // still showing the result
    vi.advanceTimersByTime(TIMING.showdownNextHandDelayMs);
    v = t.view(c);
    expect(v.hand).toBeNull();
    expect(v.gameOverWinnerId).toBe(c);
    const ra = t.room.requestBuyBack(a).voteId;
    const rb = t.room.requestBuyBack(b).voteId;
    expect(t.view(a).me.votesAwaitingMe).toEqual([rb]);
    expect(t.view(b).me.votesAwaitingMe).toEqual([ra]);
    expect(t.view(c).me.votesAwaitingMe).toEqual([ra, rb]);
    t.room.voteBuyBack(a, rb, true);
    t.room.voteBuyBack(b, ra, false); // Bob says no to Alice
    t.room.voteBuyBack(c, rb, true);
    v = t.view(c);
    expect(v.buyBackVotes.find((x) => x.id === ra)).toMatchObject({ status: 'rejected', resolvedReason: 'declined' });
    expect(v.buyBackVotes.find((x) => x.id === rb)).toMatchObject({ status: 'approved', resolvedReason: 'unanimous' });
    // Bob is back: two players with chips -> a new hand starts right away
    expect(v.gameOverWinnerId).toBeNull();
    expect(v.hand?.handNumber).toBe(2);
    expect(player(v, a).inHand).toBe(false);
    const rows = Object.fromEntries(v.ledger.map((r) => [r.playerId, r]));
    expect(rows[a]).toMatchObject({ buyIns: 1, totalBuyIn: 2000, stack: 0, net: -2000 });
    expect(rows[b]).toMatchObject({ buyIns: 2, totalBuyIn: 4000, stack: 2000, net: -2000 });
    expect(rows[c]).toMatchObject({ buyIns: 1, totalBuyIn: 2000, stack: 6000, net: 4000 });
    expect(v.ledger.reduce((s, r) => s + r.net, 0)).toBe(0);
    t.room.dispose();
  });

  it('ledger stack includes chips committed in the live hand', () => {
    const t = makeTable();
    const [a, b] = t.ids as [string, string, string];
    t.room.start(a);
    t.act(a, 'raise', 300);
    const v = t.view();
    expect(player(v, a)).toMatchObject({ stack: 1700, bet: 300 });
    expect(v.ledger.find((r) => r.playerId === a)).toMatchObject({ stack: 2000, net: 0 });
    expect(v.ledger.find((r) => r.playerId === b)).toMatchObject({ stack: 2000, net: 0 });
    t.room.dispose();
  });
});

// ===================================================================== rematch / settings

describe('rematch', () => {
  it('resets stacks, buy-ins, ledger, hand counter and status', () => {
    const t = bustAliceAndBob();
    const [a, b, c] = t.ids as [string, string, string];
    const d = t.room.join({ name: 'Dan' }).playerId;
    t.room.attach(d);
    t.room.takeSeat(d, 3); // sits during the result display
    t.room.standUp(d); // ...and stands again: has a ledger row but is not seated
    expect(t.view().ledger.map((r) => r.playerId)).toContain(d);
    const voteId = t.room.requestBuyBack(a).voteId;
    expectError(() => t.room.rematch(b), 'Only the host can do that');
    t.room.rematch(a);
    const v = t.view();
    expect(v).toMatchObject({ status: 'lobby', started: false, hand: null, gameOverWinnerId: null, buyBackVotes: [] });
    expect(v.ledger).toEqual([
      { playerId: a, name: 'Alice', buyIns: 1, totalBuyIn: 2000, stack: 2000, net: 0, inRoom: true },
      { playerId: b, name: 'Bob', buyIns: 1, totalBuyIn: 2000, stack: 2000, net: 0, inRoom: true },
      { playerId: c, name: 'Carol', buyIns: 1, totalBuyIn: 2000, stack: 2000, net: 0, inRoom: true },
    ]);
    expect(chatTexts(t)).toContain('New game! Everyone at the table starts again with 2,000');
    expectError(() => t.room.voteBuyBack(b, voteId, true), 'That vote is over');
    // buy-in is unlocked again
    t.room.updateSettings(a, { buyIn: 3000 });
    t.room.start(a);
    expect(t.view().hand?.handNumber).toBe(1);
    // Dan never sat in this game: sitting now gives a fresh buy-in at the new amount
    t.room.takeSeat(d, 3);
    expect(t.view().ledger.find((r) => r.playerId === d)).toMatchObject({ buyIns: 1, totalBuyIn: 3000 });
    t.room.dispose();
  });

  it('is only allowed between hands', () => {
    const t = makeTable();
    t.room.start(t.ids[0]!);
    expectError(() => t.room.rematch(t.ids[0]!), 'Wait for the current hand to finish');
    t.room.dispose();
  });
});

describe('settings', () => {
  it('validates every field and locks the buy-in once started', () => {
    const t = makeTable({ settings: { turnTimeSec: 30 } });
    const [a, b] = t.ids as [string, string, string];
    const up = (p: Parameters<Room['updateSettings']>[1]) => t.room.updateSettings(a, p);
    expectError(() => t.room.updateSettings(b, { turnTimeSec: 60 }), 'Only the host can do that');
    expectError(() => up({ smallBlind: 0 }), 'Small blind must be at least 1');
    expectError(() => up({ smallBlind: 30 }), 'Small blind can’t be bigger than the big blind');
    expectError(() => up({ smallBlind: 1, bigBlind: 1 }), /Big blind must be 2/);
    expectError(() => up({ buyIn: 150 }), /Buy-in must be 200–20,000/);
    expectError(() => up({ buyIn: 20_001 }), /Buy-in must be/);
    expectError(() => up({ maxPlayers: 11 }), 'Seats must be 2–10');
    expectError(() => up({ maxPlayers: 2 }), /Seat 3 is taken/);
    expectError(() => up({ turnTimeSec: 5 }), /Shot clock must be off or 10–300/);
    expectError(() => up({ turnTimeSec: 301 }), /Shot clock/);
    expectError(() => up({ buyBackVoteSec: 5 }), /Vote timer must be 10–120/);
    expectError(() => up({ buyBackVoteSec: 121 }), /Vote timer/);
    expectError(() => up({ smallBlind: 1.5 }), /whole number/);
    up({ maxPlayers: 3, turnTimeSec: 0, buyBackVoteSec: 60, requireApproval: true, allowBuyBack: false, buyIn: 3000 });
    let v = t.view();
    expect(v.settings).toMatchObject({ maxPlayers: 3, turnTimeSec: 0, buyBackVoteSec: 60, requireApproval: true, allowBuyBack: false, buyIn: 3000 });
    expect(v.seats).toHaveLength(3);
    expect(logTexts(t)).toEqual(
      expect.arrayContaining(['The table now has 3 seats', 'Shot clock turned off', 'Buy-in is now 3,000', 'Buy-backs are turned off']),
    );
    up({ maxPlayers: 6 });
    expect(t.view().seats).toHaveLength(6);
    // the room was created before the buy-in change, so seated players keep their stacks
    t.room.start(a);
    expectError(() => up({ buyIn: 4000 }), /buy-in is locked/);
    up({ buyIn: 3000, smallBlind: 50, bigBlind: 100 }); // unchanged buy-in is fine
    expectError(() => up({ smallBlind: 200, bigBlind: 400 }), /With a 3,000 buy-in the big blind must be 3–300/);
    v = t.view();
    expect(v.settings.bigBlind).toBe(100);
    t.room.dispose();
  });

  it('cannot shrink below a seat still used by the live hand', () => {
    const t = makeTable({ names: ['A', 'B', 'C', 'D', 'E'] });
    const [a, , , , e] = t.ids as [string, string, string, string, string];
    t.room.start(a);
    t.room.standUp(e); // seat 4 is empty now but still part of hand #1
    expectError(() => t.room.updateSettings(a, { maxPlayers: 4 }), /Seat 5 is taken/);
    t.room.dispose();
  });

  it('a pending seat request blocks shrinking below it', () => {
    const room = new Room({ id: 'ABCDEF', settings: { requireApproval: true } });
    const a = room.addHost('Alice').playerId;
    const b = room.join({ name: 'Bob' }).playerId;
    room.takeSeat(b, 7);
    expectError(() => room.updateSettings(a, { maxPlayers: 6 }), /Seat 8 is taken/);
    room.updateSettings(a, { maxPlayers: 8 });
    room.dispose();
  });
});

// ===================================================================== privacy

describe('hole-card privacy', () => {
  function assertNoForeignCards(t: Table, viewer: string, foreign: Map<string, string[]>, allowed: Set<string>): void {
    const v: RoomView = t.view(viewer);
    const json = JSON.stringify(v);
    for (const [owner, cs] of foreign) {
      if (owner === viewer || allowed.has(owner)) continue;
      for (const card of cs) {
        // board cards can legitimately match nothing here (deck is stacked so hole cards are unique)
        expect(json.includes(`"${card}"`), `${viewer} sees ${owner}'s ${card}`).toBe(false);
      }
    }
  }

  it("no other player's hole cards appear in a RoomView unless face up or shown", () => {
    const hole: Record<number, string> = { 0: 'As Kd', 1: 'Qh Jc', 2: '9s 9d', 3: '4c 3c' };
    const t = makeTable({
      names: ['Alice', 'Bob', 'Carol', 'Dan'],
      decks: { 1: deckFor([0, 1, 2, 3], 0, hole, '2h 7h 8h Tc 5s') },
    });
    const ids = t.ids as [string, string, string, string];
    const [a, b, c, d] = ids;
    const spectator = t.room.join({ name: 'Spec' }).playerId;
    t.room.attach(spectator);
    const foreign = new Map(ids.map((id, seat) => [id, hole[seat]!.split(' ')]));
    const viewers = [...ids, spectator];
    const check = (allowed: Set<string>) => viewers.forEach((viewer) => assertNoForeignCards(t, viewer, foreign, allowed));

    t.room.start(a);
    check(new Set());
    // own cards are visible to the owner only
    expect(t.view(b).me.holeCards).toEqual(['Qh', 'Jc']);
    expect(t.view(spectator).me.holeCards).toBeNull();
    for (const viewer of viewers) {
      for (const p of t.view(viewer).players) if (p.id !== viewer) expect(p.shownCards).toBeNull();
    }
    // 4-handed, dealer seat 0: UTG is Dan (seat 3)
    t.act(d, 'fold');
    t.act(a, 'raise', 2000);
    t.act(b, 'fold');
    t.act(c, 'allin');
    check(new Set([a, c])); // runout: Alice and Carol face up; Bob and Dan folded and stay hidden
    expect(player(t.view(spectator), a).shownCards).toEqual(['As', 'Kd']);
    expect(player(t.view(spectator), c).shownCards).toEqual(['9s', '9d']);
    advanceUntil(() => t.view().hand?.phase === 'complete');
    check(new Set([a, c]));
    // Bob voluntarily shows after the hand -> visible to everyone
    t.room.showCards(b);
    check(new Set([a, b, c]));
    // history / log never contains face-down cards of folded players
    const hist = JSON.stringify(t.room.history());
    expect(hist).not.toContain('4♣ 3♣');
    expect(hist).toContain('Bob shows Q♥ J♣');
    t.room.dispose();
  });

  it('an uncontested winner does not reveal cards', () => {
    const t = makeTable({ decks: { 1: deckFor([0, 1, 2], 0, { 0: 'As Kd', 1: 'Qh Jc', 2: '9s 9d' }) } });
    const [a, b, c] = t.ids as [string, string, string];
    t.room.start(a);
    t.act(a, 'fold');
    t.act(b, 'fold');
    expect(t.view(c).hand?.phase).toBe('complete');
    for (const viewer of [a, b]) {
      const json = JSON.stringify(t.view(viewer));
      expect(json).not.toContain('"9s"');
      expect(json).not.toContain('"9d"');
    }
    t.room.dispose();
  });
});

// ===================================================================== misc

describe('misc', () => {
  it('summary, rename, chat limits, sit out validation', () => {
    const t = makeTable();
    const [a, b] = t.ids as [string, string, string];
    expect(t.room.summary()).toEqual({
      roomId: 'ABCDEF',
      hostName: 'Alice',
      seated: 3,
      maxPlayers: 9,
      smallBlind: 10,
      bigBlind: 20,
      buyIn: 2000,
      status: 'lobby',
      started: false,
    });
    t.room.rename(b, 'alice');
    expect(t.view().players.find((p) => p.id === b)?.name).toBe('alice 2');
    expectError(() => t.room.rename(b, ''), /Enter a name/);
    expectError(() => t.room.sendChat(a, '   '), 'Message is empty');
    expectError(() => t.room.sendChat(a, 'x'.repeat(201)), /at most 200/);
    const m = t.room.sendChat(a, '  hi all ');
    expect(m).toMatchObject({ playerId: a, name: 'Alice', text: 'hi all', system: false });
    for (let i = 0; i < 120; i++) t.room.sendChat(a, `m${i}`);
    expect(t.room.history().chat).toHaveLength(100);
    const d = t.room.join({ name: 'Dan' }).playerId;
    expectError(() => t.room.setSitOut(d, true), 'Take a seat first');
    t.room.dispose();
  });

  it('offline drive-by spectators do not fill the room and are eventually forgotten', () => {
    const room = new Room({ id: 'ABCDEF' });
    const host = room.addHost('Alice').playerId;
    const first = room.join({ name: 'Ghost' });
    for (let i = 0; i < 250; i++) room.join({ name: `G${i}` }); // join and never connect
    // still joinable
    const live = room.join({ name: 'Live' }).playerId;
    room.attach(live);
    expect(room.viewFor(host).players.map((p) => p.name)).toEqual(['Alice', 'Live']);
    expectError(() => room.join({ token: first.token }), /expired/);
    // active (connected) spectators are capped
    for (let i = 0; i < 58; i++) room.attach(room.join({ name: `S${i}` }).playerId);
    expectError(() => room.join({ name: 'One too many' }), 'This room is full');
    room.dispose();
  });

  it('log keeps the last 500 entries with increasing ids; outbox carries new entries once', () => {
    const t = makeTable();
    const [a] = t.ids as [string, string, string];
    t.room.drainOutbox();
    for (let i = 0; i < 300; i++) {
      t.room.setSitOut(a, i % 2 === 0);
    }
    const log = t.room.history().log;
    expect(log.length).toBeLessThanOrEqual(500);
    for (let i = 1; i < log.length; i++) expect(log[i]!.id).toBe(log[i - 1]!.id + 1);
    expect(t.room.drainOutbox().log).toHaveLength(300);
    expect(t.room.drainOutbox().log).toHaveLength(0);
    t.room.dispose();
  });

  it('dispose clears timers and blocks further changes', () => {
    const t = makeTable({ settings: { turnTimeSec: 30 } });
    t.room.start(t.ids[0]!);
    const before = vi.getTimerCount();
    expect(before).toBeGreaterThan(0);
    t.room.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expectError(() => t.room.start(t.ids[0]!), 'This room has closed');
  });

  it('a long random session keeps chips conserved and never throws unexpectedly', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const t = makeTable({ names: ['A', 'B', 'C', 'D', 'E'], settings: { turnTimeSec: 10 }, rand: rnd });
    const ids = t.ids;
    t.room.start(ids[0]!);
    const seen = { hands: new Set<number>(), approved: 0, rejected: 0, showdowns: 0 };
    for (let step = 0; step < 6000; step++) {
      const v = t.view();
      const total = v.ledger.reduce((s, r) => s + r.stack, 0);
      const bought = v.ledger.reduce((s, r) => s + r.totalBuyIn, 0);
      expect(total).toBe(bought);
      if (v.hand) seen.hands.add(v.hand.handNumber);
      if (v.hand?.phase === 'complete' && v.hand.street === 'showdown') seen.showdowns++;
      for (const vote of v.buyBackVotes) {
        if (vote.status === 'approved') seen.approved++;
        if (vote.status === 'rejected') seen.rejected++;
      }
      const actor = v.hand?.toActPlayerId;
      const r = rnd();
      try {
        if (actor && r < 0.85) {
          const legal = t.view(actor).me.legal!;
          const pick = rnd();
          if (pick < 0.2) t.act(actor, 'fold');
          else if (pick < 0.55) t.act(actor, legal.canCheck ? 'check' : 'call');
          else if (pick < 0.75 && legal.canRaise) t.act(actor, 'raise', legal.minRaiseTo);
          else if (pick < 0.8) t.act(actor, 'allin');
          else t.act(actor, 'raise', Math.floor(rnd() * 5000));
        } else if (r < 0.88) {
          const id = ids[Math.floor(rnd() * ids.length)]!;
          if (t.view(id).me.canRequestBuyBack) t.room.requestBuyBack(id);
        } else if (r < 0.92) {
          const vote = t.view().buyBackVotes.find((x) => x.status === 'pending');
          if (vote) {
            const voter = Object.keys(vote.votes).find((k) => vote.votes[k] === null);
            if (voter) t.room.voteBuyBack(voter, vote.id, rnd() < 0.7);
          }
        } else if (r < 0.94) {
          const id = ids[1 + Math.floor(rnd() * (ids.length - 1))]!;
          const me = t.view(id).me;
          if (me.seat === null) t.room.takeSeat(id, t.view().seats.findIndex((s) => s === null));
          else t.room.standUp(id);
        } else {
          vi.advanceTimersByTime(Math.floor(rnd() * 4000));
        }
      } catch (err) {
        expect(err).toBeInstanceOf(RoomError);
      }
    }
    expect(seen.hands.size).toBeGreaterThan(40);
    expect(seen.showdowns).toBeGreaterThan(0);
    expect(seen.approved).toBeGreaterThan(0);
    expect(seen.rejected).toBeGreaterThan(0);
    t.room.dispose();
  });
});
