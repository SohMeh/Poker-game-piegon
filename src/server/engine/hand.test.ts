import { describe, expect, it } from 'vitest';
import { fullDeck } from '../../shared';
import { createHand, nextButtonSeat } from './hand';
import { act, advanceUntilAction, cards, checkDown, chipsInPlay, reject, setup, stack } from './test-helpers';

describe('positions and action order', () => {
  it('heads-up: dealer posts SB and acts first preflop, BB first postflop', () => {
    const e = setup({ stacks: [1000, 1000], dealer: 0 });
    expect(e.smallBlindSeat).toBe(0);
    expect(e.bigBlindSeat).toBe(1);
    expect(e.getPlayer('p0')!.streetBet).toBe(10);
    expect(e.getPlayer('p1')!.streetBet).toBe(20);
    expect(e.phase).toBe('betting');
    expect(e.street).toBe('preflop');
    expect(e.toActId).toBe('p0');
    expect(e.legalActions('p1')).toBeNull();
    act(e, 'p0', 'call');
    expect(e.toActId).toBe('p1');
    act(e, 'p1', 'check');
    expect(e.phase).toBe('roundComplete');
    expect(e.toActId).toBeNull();
    e.advance();
    expect(e.street).toBe('flop');
    expect(e.board).toHaveLength(3);
    expect(e.toActId).toBe('p1');
    act(e, 'p1', 'check');
    expect(e.toActId).toBe('p0');
    act(e, 'p0', 'check');
    e.advance();
    expect(e.street).toBe('turn');
    expect(e.toActId).toBe('p1');
  });

  it('heads-up with dealer on the higher seat', () => {
    const e = setup({ stacks: { 3: 500, 7: 500 }, dealer: 7 });
    expect(e.smallBlindSeat).toBe(7);
    expect(e.bigBlindSeat).toBe(3);
    expect(e.toActId).toBe('p7');
    act(e, 'p7', 'call');
    act(e, 'p3', 'check');
    e.advance();
    expect(e.toActId).toBe('p3');
  });

  it('3-max: dealer acts first preflop, SB first postflop', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    expect(e.smallBlindSeat).toBe(1);
    expect(e.bigBlindSeat).toBe(2);
    expect(e.toActId).toBe('p0');
    act(e, 'p0', 'call');
    expect(e.toActId).toBe('p1');
    act(e, 'p1', 'call');
    expect(e.toActId).toBe('p2');
    act(e, 'p2', 'check');
    e.advance();
    expect(e.toActId).toBe('p1');
    act(e, 'p1', 'check');
    act(e, 'p2', 'check');
    expect(e.toActId).toBe('p0');
  });

  it('6-max order with wrap-around and skipping folded players postflop', () => {
    const e = setup({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], dealer: 3 });
    expect(e.smallBlindSeat).toBe(4);
    expect(e.bigBlindSeat).toBe(5);
    const order: string[] = [];
    for (const id of ['p0', 'p1', 'p2', 'p3', 'p4']) {
      order.push(e.toActId!);
      act(e, id, id === 'p4' ? 'fold' : 'call');
    }
    expect(order).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    expect(e.toActId).toBe('p5');
    act(e, 'p5', 'check');
    e.advance();
    // SB (p4) folded -> first live player after the dealer is p5
    expect(e.toActId).toBe('p5');
  });

  it('non-contiguous seats', () => {
    const e = setup({ stacks: { 1: 500, 4: 500, 7: 500, 8: 500 }, dealer: 8 });
    expect(e.smallBlindSeat).toBe(1);
    expect(e.bigBlindSeat).toBe(4);
    expect(e.toActId).toBe('p7');
    expect(e.players.map((p) => p.seat)).toEqual([1, 4, 7, 8]);
  });

  it('deals cards one at a time starting left of the dealer (fixed deal order)', () => {
    const deck = fullDeck(); // 2c 3c 4c ... Ac 2d ...
    const e = createHand({
      handNumber: 7,
      players: [
        { id: 'a', seat: 0, stack: 100 },
        { id: 'b', seat: 1, stack: 100 },
      ],
      dealerSeat: 0,
      smallBlind: 1,
      bigBlind: 2,
      deck,
    });
    expect(e.handNumber).toBe(7);
    // heads-up: the BB (non-dealer) gets the first card
    expect(e.getPlayer('b')!.holeCards).toEqual(cards('2c 4c'));
    expect(e.getPlayer('a')!.holeCards).toEqual(cards('3c 5c'));
    checkDown(e);
    // burn 6c, flop 7c 8c 9c, burn Tc, turn Jc, burn Qc, river Kc
    expect(e.board).toEqual(cards('7c 8c 9c Jc Kc'));
  });

  it('3-handed deal order follows seats after the dealer', () => {
    const e = createHand({
      handNumber: 1,
      players: [
        { id: 'a', seat: 0, stack: 100 },
        { id: 'b', seat: 1, stack: 100 },
        { id: 'c', seat: 2, stack: 100 },
      ],
      dealerSeat: 1,
      smallBlind: 1,
      bigBlind: 2,
      deck: fullDeck(),
    });
    expect(e.getPlayer('c')!.holeCards).toEqual(cards('2c 5c'));
    expect(e.getPlayer('a')!.holeCards).toEqual(cards('3c 6c'));
    expect(e.getPlayer('b')!.holeCards).toEqual(cards('4c 7c'));
  });

  it('stacked deck deals the requested cards', () => {
    const e = setup({
      stacks: [100, 100, 100],
      dealer: 2,
      hole: { p0: 'As Ad', p1: 'Kh Kd', p2: '7c 2d' },
      board: 'Qs Jh 9c 4d 3s',
    });
    expect(e.getPlayer('p0')!.holeCards).toEqual(cards('As Ad'));
    expect(e.getPlayer('p1')!.holeCards).toEqual(cards('Kh Kd'));
    expect(e.getPlayer('p2')!.holeCards).toEqual(cards('7c 2d'));
    checkDown(e);
    expect(e.board).toEqual(cards('Qs Jh 9c 4d 3s'));
  });
});

describe('big blind option', () => {
  it('BB may check when limped to', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    act(e, 'p0', 'call');
    act(e, 'p1', 'call');
    const legal = e.legalActions('p2')!;
    expect(legal.canCheck).toBe(true);
    expect(legal.canCall).toBe(false);
    expect(legal.canRaise).toBe(true);
    expect(legal.minRaiseTo).toBe(40);
    act(e, 'p2', 'check');
    expect(e.phase).toBe('roundComplete');
  });

  it('BB may raise when limped to and action reopens', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    act(e, 'p0', 'call');
    act(e, 'p1', 'call');
    act(e, 'p2', 'raise', 60);
    expect(e.getPlayer('p2')!.lastAction).toEqual({ type: 'raise', amount: 60 });
    expect(e.toActId).toBe('p0');
    const legal = e.legalActions('p0')!;
    expect(legal.callAmount).toBe(40);
    expect(legal.canRaise).toBe(true);
    expect(legal.minRaiseTo).toBe(100);
    act(e, 'p0', 'call');
    act(e, 'p1', 'fold');
    expect(e.phase).toBe('roundComplete');
  });

  it('SB can complete or raise; posting does not count as acting', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    expect(e.getPlayer('p1')!.hasActed).toBe(false);
    expect(e.getPlayer('p1')!.lastAction).toEqual({ type: 'sb', amount: 10 });
    expect(e.getPlayer('p2')!.lastAction).toEqual({ type: 'bb', amount: 20 });
    act(e, 'p0', 'call');
    const legal = e.legalActions('p1')!;
    expect(legal.callAmount).toBe(10);
    expect(legal.canRaise).toBe(true);
    expect(legal.isBet).toBe(false);
    expect(legal.myBet).toBe(10);
  });
});

describe('bet and raise sizing', () => {
  it('preflop min raise and re-raise sizes', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    expect(e.currentBet).toBe(20);
    expect(e.lastRaiseSize).toBe(20);
    expect(e.minRaiseTo).toBe(40);
    reject(e, 'p0', { type: 'raise', amount: 39 }, /Minimum raise is to 40/);
    reject(e, 'p0', { type: 'raise', amount: 20 }, /more than the current bet/);
    act(e, 'p0', 'raise', 60); // raise by 40
    expect(e.currentBet).toBe(60);
    expect(e.lastRaiseSize).toBe(40);
    expect(e.legalActions('p1')!.minRaiseTo).toBe(100);
    reject(e, 'p1', { type: 'raise', amount: 99 });
    act(e, 'p1', 'raise', 150); // raise by 90
    expect(e.lastRaiseSize).toBe(90);
    expect(e.legalActions('p2')!.minRaiseTo).toBe(240);
    act(e, 'p2', 'raise', 240);
    expect(e.minRaiseTo).toBe(330);
  });

  it('postflop min bet is the big blind; raise sizing follows the bet', () => {
    const e = setup({ stacks: [1000, 1000], dealer: 0 });
    act(e, 'p0', 'call');
    act(e, 'p1', 'check');
    e.advance();
    const legal = e.legalActions('p1')!;
    expect(legal.isBet).toBe(true);
    expect(legal.canCheck).toBe(true);
    expect(legal.minRaiseTo).toBe(20);
    expect(legal.maxRaiseTo).toBe(980);
    expect(legal.pot).toBe(40);
    reject(e, 'p1', { type: 'raise', amount: 19 }, /Minimum bet is to 20/);
    reject(e, 'p1', { type: 'raise', amount: 0 }, /more than zero/);
    act(e, 'p1', 'raise', 30);
    expect(e.getPlayer('p1')!.lastAction).toEqual({ type: 'bet', amount: 30 });
    expect(e.legalActions('p0')!.minRaiseTo).toBe(60);
    expect(e.legalActions('p0')!.isBet).toBe(false);
    reject(e, 'p0', { type: 'raise', amount: 59 });
    act(e, 'p0', 'raise', 60);
    expect(e.getPlayer('p0')!.lastAction).toEqual({ type: 'raise', amount: 60 });
    expect(e.legalActions('p1')!.minRaiseTo).toBe(90);
  });

  it('raise above stack is rejected; exact all-in via raise is allowed', () => {
    const e = setup({ stacks: [1000, 300], dealer: 0 });
    act(e, 'p0', 'raise', 100);
    reject(e, 'p1', { type: 'raise', amount: 301 }, /at most to 300/);
    act(e, 'p1', 'raise', 300);
    expect(e.getPlayer('p1')!.allIn).toBe(true);
    expect(e.getPlayer('p1')!.lastAction).toEqual({ type: 'allin', amount: 300 });
  });

  it('all-in for less than a min raise is allowed via raise (= whole stack) and via allin', () => {
    const e = setup({ stacks: [1000, 50], dealer: 0 });
    act(e, 'p0', 'raise', 40);
    const legal = e.legalActions('p1')!;
    expect(legal.canRaise).toBe(true);
    expect(legal.minRaiseTo).toBe(50); // stack can't make a full raise (60)
    expect(legal.maxRaiseTo).toBe(50);
    reject(e, 'p1', { type: 'raise', amount: 45 });
    act(e, 'p1', 'allin');
    expect(e.currentBet).toBe(50);
    expect(e.lastRaiseSize).toBe(20); // incomplete raise leaves the size unchanged
  });

  it('postflop all-in bet smaller than the big blind', () => {
    const e = setup({ stacks: [1000, 1000, 35], dealer: 0 });
    act(e, 'p0', 'call');
    act(e, 'p1', 'call');
    act(e, 'p2', 'check');
    e.advance();
    act(e, 'p1', 'check');
    act(e, 'p2', 'allin'); // 15 chips
    expect(e.getPlayer('p2')!.lastAction).toEqual({ type: 'allin', amount: 15 });
    expect(e.currentBet).toBe(15);
    expect(e.lastRaiseSize).toBe(20);
    expect(e.toActId).toBe('p0');
    // p0 has not acted yet -> may raise, min to 35
    expect(e.legalActions('p0')!.canRaise).toBe(true);
    expect(e.legalActions('p0')!.minRaiseTo).toBe(35);
    act(e, 'p0', 'call');
    // p1 checked and faces an incomplete bet: call or fold only
    const legal = e.legalActions('p1')!;
    expect(legal.canRaise).toBe(false);
    expect(legal.callAmount).toBe(15);
  });
});

describe('re-opening the betting', () => {
  it('an incomplete all-in raise does not reopen betting for players who acted', () => {
    // dealer p0, SB p1 (150 chips), BB p2
    const e = setup({ stacks: [1000, 150, 1000], dealer: 0 });
    act(e, 'p0', 'raise', 100); // raise by 80
    act(e, 'p1', 'allin'); // to 150: +50, incomplete
    expect(e.currentBet).toBe(150);
    expect(e.lastRaiseSize).toBe(80);
    // BB has not acted: can re-raise
    const bb = e.legalActions('p2')!;
    expect(bb.canRaise).toBe(true);
    expect(bb.minRaiseTo).toBe(230);
    act(e, 'p2', 'call');
    const legal = e.legalActions('p0')!;
    expect(legal.canRaise).toBe(false);
    expect(legal.canCall).toBe(true);
    expect(legal.callAmount).toBe(50);
    reject(e, 'p0', { type: 'raise', amount: 400 }, /not re-opened/);
    reject(e, 'p0', { type: 'allin' }, /not re-opened/);
    act(e, 'p0', 'call');
    expect(e.phase).toBe('roundComplete');
  });

  it('a full raise after you acted reopens', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    act(e, 'p0', 'raise', 100);
    act(e, 'p1', 'call');
    act(e, 'p2', 'raise', 180); // full raise by 80
    expect(e.legalActions('p0')!.canRaise).toBe(true);
  });

  it('several incomplete all-ins adding up to a full raise reopen betting', () => {
    // dealer p0, SB p1, BB p2, UTG p3
    const e = setup({ stacks: [150, 200, 1000, 1000], dealer: 0 });
    act(e, 'p3', 'raise', 100); // +80
    act(e, 'p0', 'allin'); // 150: +50 incomplete
    expect(e.lastRaiseSize).toBe(80);
    act(e, 'p1', 'allin'); // 200: +50 incomplete
    expect(e.currentBet).toBe(200);
    expect(e.lastRaiseSize).toBe(80);
    act(e, 'p2', 'call');
    // p3 faced 100, now 200: +100 >= 80 -> reopened
    const legal = e.legalActions('p3')!;
    expect(legal.canRaise).toBe(true);
    expect(legal.minRaiseTo).toBe(280);
    act(e, 'p3', 'raise', 280);
    // p2 called 200 and now faces a full raise -> may raise again
    expect(e.legalActions('p2')!.canRaise).toBe(true);
  });

  it('cannot raise when everyone else is all-in', () => {
    const e = setup({ stacks: [1000, 300], dealer: 0 });
    act(e, 'p0', 'raise', 100);
    act(e, 'p1', 'allin');
    const legal = e.legalActions('p0')!;
    expect(legal.canRaise).toBe(false);
    expect(legal.callAmount).toBe(200);
    reject(e, 'p0', { type: 'raise', amount: 500 }, /all-in/);
    act(e, 'p0', 'call');
    expect(e.isRunout()).toBe(true);
  });

  it('cannot raise when the stack does not exceed the call', () => {
    const e = setup({ stacks: [1000, 1000, 80], dealer: 0 });
    act(e, 'p0', 'raise', 100);
    act(e, 'p1', 'fold');
    const legal = e.legalActions('p2')!;
    expect(legal.canRaise).toBe(false);
    expect(legal.callAmount).toBe(60); // capped at stack
    expect(legal.minRaiseTo).toBe(80);
    expect(legal.maxRaiseTo).toBe(80);
    act(e, 'p2', 'allin'); // a call for less
    expect(e.getPlayer('p2')!.lastAction).toEqual({ type: 'allin', amount: 80 });
    expect(e.currentBet).toBe(100);
    // round closed: p0 is the only one who can act and has the biggest bet
    expect(e.phase).toBe('roundComplete');
    expect(e.result).toBeNull();
    expect(stack(e, 'p0')).toBe(920); // 20 uncalled returned
  });
});

describe('short blinds', () => {
  it('short SB posts all-in; others match the full big blind', () => {
    const e = setup({ stacks: [1000, 5, 1000], dealer: 0 });
    expect(e.getPlayer('p1')!.streetBet).toBe(5);
    expect(e.getPlayer('p1')!.allIn).toBe(true);
    expect(e.currentBet).toBe(20);
    expect(e.toActId).toBe('p0');
    act(e, 'p0', 'call');
    expect(e.toActId).toBe('p2'); // SB is all-in, skipped
    act(e, 'p2', 'check');
    expect(e.phase).toBe('roundComplete');
    expect(e.isRunout()).toBe(false);
    e.advance();
    expect(e.pots).toEqual([
      { amount: 15, eligible: ['p0', 'p1', 'p2'] },
      { amount: 30, eligible: ['p0', 'p2'] },
    ]);
    expect(e.toActId).toBe('p2');
  });

  it('short BB posts all-in; currentBet and min raise stay at the full big blind', () => {
    const e = setup({ stacks: [1000, 1000, 15], dealer: 0 });
    expect(e.getPlayer('p2')!.streetBet).toBe(15);
    expect(e.getPlayer('p2')!.allIn).toBe(true);
    expect(e.currentBet).toBe(20);
    expect(e.lastRaiseSize).toBe(20);
    const legal = e.legalActions('p0')!;
    expect(legal.callAmount).toBe(20);
    expect(legal.minRaiseTo).toBe(40);
    act(e, 'p0', 'call');
    act(e, 'p1', 'call');
    expect(e.phase).toBe('roundComplete');
    e.advance();
    expect(e.pots).toEqual([
      { amount: 45, eligible: ['p0', 'p1', 'p2'] },
      { amount: 10, eligible: ['p0', 'p1'] },
    ]);
    expect(e.toActId).toBe('p1');
  });

  it('heads-up: SB all-in from the blind closes preflop immediately', () => {
    const e = setup({ stacks: [5, 1000], dealer: 0 });
    expect(e.phase).toBe('roundComplete');
    expect(e.toActId).toBeNull();
    expect(e.isRunout()).toBe(true);
    expect(Object.keys(e.faceUpCards()).sort()).toEqual(['p0', 'p1']);
    expect(stack(e, 'p1')).toBe(995); // 15 uncalled returned
    const ev = e.drainEvents();
    expect(ev.map((x) => x.kind)).toEqual(['blind', 'blind', 'uncalled']);
    expect(ev[2]).toMatchObject({ playerId: 'p1', amount: 15 });
    advanceUntilAction(e);
    expect(e.phase).toBe('complete');
    expect(chipsInPlay(e)).toBe(1005);
  });

  it('heads-up: BB shorter than SB', () => {
    const e = setup({ stacks: [1000, 8], dealer: 0 });
    expect(e.phase).toBe('roundComplete');
    expect(stack(e, 'p0')).toBe(992); // 2 uncalled
    expect(e.result).toBeNull();
    advanceUntilAction(e);
    expect(e.phase).toBe('complete');
    expect(e.result!.uncalledReturn).toEqual({ playerId: 'p0', amount: 2 });
  });

  it('both blinds all-in from posting', () => {
    const e = setup({ stacks: [5, 8], dealer: 0 });
    expect(e.phase).toBe('roundComplete');
    expect(e.isRunout()).toBe(true);
    advanceUntilAction(e);
    expect(e.result!.finalStacks.p0! + e.result!.finalStacks.p1!).toBe(13);
  });

  it('heads-up: SB calls all-in for less; BB gets no option', () => {
    const e = setup({ stacks: [15, 1000], dealer: 0 });
    act(e, 'p0', 'call');
    expect(e.getPlayer('p0')!.allIn).toBe(true);
    expect(e.phase).toBe('roundComplete');
    expect(stack(e, 'p1')).toBe(985);
  });
});

describe('uncontested hands', () => {
  it('everyone folds preflop: BB wins, uncalled blind returned, no reveal', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    e.drainEvents();
    act(e, 'p0', 'fold');
    act(e, 'p1', 'fold');
    expect(e.phase).toBe('complete');
    expect(e.toActId).toBeNull();
    const r = e.result!;
    expect(r.showdown).toBe(false);
    expect(r.revealed).toEqual({});
    expect(r.handNames).toEqual({});
    expect(r.uncalledReturn).toEqual({ playerId: 'p2', amount: 10 });
    expect(r.winners).toEqual([{ playerId: 'p2', amount: 20, potIndex: 0, handName: null, bestCards: null }]);
    expect(r.finalStacks).toEqual({ p0: 1000, p1: 990, p2: 1010 });
    expect(e.faceUpCards()).toEqual({});
    expect(e.totalPot()).toBe(0);
    expect(e.pots).toEqual([]);
    expect(e.getPlayer('p2')!.totalCommitted).toBe(0);
    const events = e.drainEvents();
    expect(events).toEqual([
      { kind: 'action', playerId: 'p0', action: 'fold', amount: 0 },
      { kind: 'action', playerId: 'p1', action: 'fold', amount: 0 },
      { kind: 'uncalled', playerId: 'p2', amount: 10 },
      { kind: 'win', playerId: 'p2', amount: 20, potIndex: 0 },
    ]);
    expect(e.drainEvents()).toEqual([]);
  });

  it('heads-up SB folds preflop', () => {
    const e = setup({ stacks: [1000, 1000], dealer: 0 });
    act(e, 'p0', 'fold');
    expect(e.result!.finalStacks).toEqual({ p0: 990, p1: 1010 });
  });

  it('everyone folds to a postflop bet', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    act(e, 'p0', 'call');
    act(e, 'p1', 'call');
    act(e, 'p2', 'check');
    e.advance();
    act(e, 'p1', 'raise', 50);
    act(e, 'p2', 'fold');
    act(e, 'p0', 'fold');
    expect(e.phase).toBe('complete');
    expect(e.street).toBe('flop');
    const r = e.result!;
    expect(r.uncalledReturn).toEqual({ playerId: 'p1', amount: 50 });
    expect(r.winners).toEqual([{ playerId: 'p1', amount: 60, potIndex: 0, handName: null, bestCards: null }]);
    expect(r.finalStacks).toEqual({ p0: 980, p1: 1040, p2: 980 });
    expect(e.faceUpCards()).toEqual({});
  });

  it('a raise folded around returns only the unmatched part', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    act(e, 'p0', 'raise', 60);
    act(e, 'p1', 'call');
    act(e, 'p2', 'raise', 200);
    act(e, 'p0', 'fold');
    act(e, 'p1', 'fold');
    const r = e.result!;
    expect(r.uncalledReturn).toEqual({ playerId: 'p2', amount: 140 });
    expect(r.winners[0]!.amount).toBe(180);
    expect(r.finalStacks).toEqual({ p0: 940, p1: 940, p2: 1120 });
  });
});

describe('all-in runouts', () => {
  it('preflop all-in: runout with face-up cards, advance through the river to showdown', () => {
    const e = setup({
      stacks: [1000, 500],
      dealer: 0,
      hole: { p0: 'As Ah', p1: 'Kd Kc' },
      board: '2c 7d 9h Js 3c',
    });
    act(e, 'p0', 'allin');
    expect(e.isRunout()).toBe(false);
    expect(e.faceUpCards()).toEqual({});
    act(e, 'p1', 'call');
    expect(e.getPlayer('p1')!.lastAction).toEqual({ type: 'allin', amount: 500 });
    expect(e.phase).toBe('roundComplete');
    expect(e.isRunout()).toBe(true);
    expect(e.faceUpCards()).toEqual({ p0: cards('As Ah'), p1: cards('Kd Kc') });
    expect(stack(e, 'p0')).toBe(500); // 500 uncalled returned
    expect(e.getPlayer('p0')!.allIn).toBe(false);
    e.drainEvents();
    e.advance();
    expect(e.street).toBe('flop');
    expect(e.phase).toBe('roundComplete');
    expect(e.toActId).toBeNull();
    expect(e.isRunout()).toBe(true);
    expect(e.board).toEqual(cards('2c 7d 9h'));
    e.advance();
    expect(e.street).toBe('turn');
    e.advance();
    expect(e.street).toBe('river');
    expect(e.isRunout()).toBe(true);
    expect(e.board).toEqual(cards('2c 7d 9h Js 3c'));
    e.advance();
    expect(e.phase).toBe('complete');
    expect(e.street).toBe('showdown');
    expect(e.isRunout()).toBe(false);
    const r = e.result!;
    expect(r.showdown).toBe(true);
    expect(r.revealed).toEqual({ p0: cards('As Ah'), p1: cards('Kd Kc') });
    expect(r.handNames).toEqual({ p0: 'Pair of Aces', p1: 'Pair of Kings' });
    expect(r.winners).toEqual([
      { playerId: 'p0', amount: 1000, potIndex: 0, handName: 'Pair of Aces', bestCards: cards('As Ah Js 9h 7d') },
    ]);
    expect(r.finalStacks).toEqual({ p0: 1500, p1: 0 });
    expect(e.faceUpCards()).toEqual({ p0: cards('As Ah'), p1: cards('Kd Kc') });
    const events = e.drainEvents();
    expect(events.filter((x) => x.kind === 'street').map((x) => x.street)).toEqual(['flop', 'turn', 'river']);
    expect(events.filter((x) => x.kind === 'showdown')).toHaveLength(2);
    expect(events.at(-1)).toEqual({ kind: 'win', playerId: 'p0', amount: 1000, potIndex: 0, handName: 'Pair of Aces' });
  });

  it('river all-in and call: cards face up while heading to showdown', () => {
    const e = setup({ stacks: [1000, 400], dealer: 0, hole: { p0: '2c 3d', p1: 'Ac Ad' }, board: 'Ks Qh 8c 7d 4s' });
    act(e, 'p0', 'call');
    act(e, 'p1', 'check');
    for (let i = 0; i < 2; i++) {
      e.advance();
      act(e, 'p1', 'check');
      act(e, 'p0', 'check');
    }
    e.advance();
    expect(e.street).toBe('river');
    act(e, 'p1', 'allin');
    act(e, 'p0', 'call');
    expect(e.phase).toBe('roundComplete');
    expect(e.isRunout()).toBe(true);
    expect(Object.keys(e.faceUpCards()).sort()).toEqual(['p0', 'p1']);
    e.advance();
    expect(e.phase).toBe('complete');
    expect(e.result!.finalStacks).toEqual({ p0: 600, p1: 800 });
  });

  it('a normal closed round is not a runout', () => {
    const e = setup({ stacks: [1000, 1000], dealer: 0 });
    act(e, 'p0', 'call');
    act(e, 'p1', 'check');
    expect(e.phase).toBe('roundComplete');
    expect(e.isRunout()).toBe(false);
    expect(e.faceUpCards()).toEqual({});
  });

  it('players still able to bet keep betting after a short all-in; side pot builds', () => {
    const e = setup({ stacks: [1000, 1000, 100], dealer: 0 });
    act(e, 'p0', 'call');
    act(e, 'p1', 'call');
    act(e, 'p2', 'allin'); // 100: +80, full raise
    expect(e.lastRaiseSize).toBe(80);
    act(e, 'p0', 'call');
    act(e, 'p1', 'call');
    expect(e.phase).toBe('roundComplete');
    expect(e.isRunout()).toBe(false);
    e.advance();
    expect(e.phase).toBe('betting');
    expect(e.toActId).toBe('p1');
    expect(e.pots).toEqual([{ amount: 300, eligible: ['p0', 'p1', 'p2'] }]);
    act(e, 'p1', 'raise', 200);
    act(e, 'p0', 'call');
    e.advance();
    expect(e.pots).toEqual([
      { amount: 300, eligible: ['p0', 'p1', 'p2'] },
      { amount: 400, eligible: ['p0', 'p1'] },
    ]);
  });
});

describe('side pots and showdown', () => {
  it('3-way all-in with different stacks', () => {
    // p1 best, p2 second, p0 worst
    const e = setup({
      stacks: [1000, 300, 600],
      dealer: 0,
      hole: { p0: '2c 3d', p1: 'As Ah', p2: 'Ks Kh' },
      board: '7c 8d Jh 4s 9c',
    });
    act(e, 'p0', 'allin');
    act(e, 'p1', 'call');
    act(e, 'p2', 'call');
    expect(e.phase).toBe('roundComplete');
    expect(e.isRunout()).toBe(true);
    expect(stack(e, 'p0')).toBe(400); // 1000 - 600 matched
    e.advance();
    expect(e.pots).toEqual([
      { amount: 900, eligible: ['p0', 'p1', 'p2'] },
      { amount: 600, eligible: ['p0', 'p2'] },
    ]);
    advanceUntilAction(e);
    const r = e.result!;
    expect(r.winners.map((w) => [w.playerId, w.potIndex, w.amount])).toEqual([
      ['p1', 0, 900],
      ['p2', 1, 600],
    ]);
    expect(r.finalStacks).toEqual({ p0: 400, p1: 900, p2: 600 });
    expect(r.uncalledReturn).toEqual({ playerId: 'p0', amount: 400 });
  });

  it('4-way all-in ladder: each side pot to the best eligible hand', () => {
    // dealer p3 -> SB p0, BB p1, UTG p2
    const e = setup({
      stacks: [100, 200, 300, 400],
      dealer: 3,
      hole: { p0: 'As Ah', p1: 'Ks Kh', p2: 'Qs Qh', p3: 'Js Jh' },
      board: '2c 5d 8h 9c 3d',
    });
    expect(e.toActId).toBe('p2');
    act(e, 'p2', 'allin');
    act(e, 'p3', 'allin');
    act(e, 'p0', 'call');
    act(e, 'p1', 'call');
    expect(e.phase).toBe('roundComplete');
    expect(e.result).toBeNull();
    e.advance();
    expect(e.pots).toEqual([
      { amount: 400, eligible: ['p0', 'p1', 'p2', 'p3'] },
      { amount: 300, eligible: ['p1', 'p2', 'p3'] },
      { amount: 200, eligible: ['p2', 'p3'] },
    ]);
    advanceUntilAction(e);
    const r = e.result!;
    expect(r.uncalledReturn).toEqual({ playerId: 'p3', amount: 100 });
    expect(r.winners.map((w) => [w.playerId, w.potIndex, w.amount])).toEqual([
      ['p0', 0, 400],
      ['p1', 1, 300],
      ['p2', 2, 200],
    ]);
    expect(r.finalStacks).toEqual({ p0: 400, p1: 300, p2: 200, p3: 100 });
    expect(r.handNames).toEqual({
      p0: 'Pair of Aces',
      p1: 'Pair of Kings',
      p2: 'Pair of Queens',
      p3: 'Pair of Jacks',
    });
  });

  it('4-way with folded contributors: dead chips stay in the pots, folders never win', () => {
    // dealer p0, SB p1 (200), BB p2, UTG p3
    const e = setup({
      stacks: [1000, 200, 500, 1000],
      dealer: 0,
      hole: { p0: 'Qs Qd', p1: 'As Ah', p2: 'Ks Kh', p3: 'Js Jh' },
      board: '2c 5d 8h 9c 3d',
    });
    act(e, 'p3', 'raise', 100);
    act(e, 'p0', 'call');
    act(e, 'p1', 'allin'); // 200: full raise by 100
    act(e, 'p2', 'fold'); // 20 dead
    act(e, 'p3', 'call');
    act(e, 'p0', 'call');
    expect(e.phase).toBe('roundComplete');
    e.advance();
    expect(e.pots).toEqual([{ amount: 620, eligible: ['p0', 'p1', 'p3'] }]);
    expect(e.toActId).toBe('p3');
    act(e, 'p3', 'raise', 300);
    act(e, 'p0', 'call');
    e.advance();
    expect(e.pots).toEqual([
      { amount: 620, eligible: ['p0', 'p1', 'p3'] },
      { amount: 600, eligible: ['p0', 'p3'] },
    ]);
    act(e, 'p3', 'check');
    act(e, 'p0', 'allin'); // 500
    act(e, 'p3', 'fold');
    // p0 is the only player left who can act and has the biggest bet -> uncalled, runout vs p1
    expect(e.phase).toBe('roundComplete');
    expect(e.isRunout()).toBe(true);
    expect(e.faceUpCards()).toEqual({ p0: cards('Qs Qd'), p1: cards('As Ah') });
    e.advance();
    expect(e.pots).toEqual([
      { amount: 620, eligible: ['p0', 'p1'] },
      { amount: 600, eligible: ['p0'] },
    ]);
    advanceUntilAction(e);
    const r = e.result!;
    expect(r.winners.map((w) => [w.playerId, w.potIndex, w.amount])).toEqual([
      ['p1', 0, 620],
      ['p0', 1, 600],
    ]);
    expect(r.finalStacks).toEqual({ p0: 1100, p1: 620, p2: 480, p3: 500 });
    expect(Object.keys(r.revealed).sort()).toEqual(['p0', 'p1']);
  });

  it('split pot: odd chip goes to the first winner left of the button', () => {
    // dealer p1 -> SB p2, BB p0, UTG p1. Board royal flush: everyone ties.
    const e = setup({
      stacks: [1000, 1000, 1000],
      dealer: 1,
      sb: 5,
      bb: 10,
      hole: { p0: '2c 3d', p1: '4c 5d', p2: '6c 7d' },
      board: 'As Ks Qs Js Ts',
    });
    expect(e.toActId).toBe('p1');
    act(e, 'p1', 'raise', 25);
    act(e, 'p2', 'call');
    act(e, 'p0', 'call');
    e.advance();
    expect(e.toActId).toBe('p2');
    act(e, 'p2', 'raise', 10);
    act(e, 'p0', 'call');
    act(e, 'p1', 'fold');
    e.advance();
    checkDown(e);
    const r = e.result!;
    // pot 95 split between p2 and p0; p2 is first clockwise from the dealer (seat 1)
    expect(r.winners).toEqual([
      { playerId: 'p2', amount: 48, potIndex: 0, handName: 'Royal Flush', bestCards: cards('As Ks Qs Js Ts') },
      { playerId: 'p0', amount: 47, potIndex: 0, handName: 'Royal Flush', bestCards: cards('As Ks Qs Js Ts') },
    ]);
    expect(r.finalStacks).toEqual({ p0: 1012, p1: 975, p2: 1013 });
  });

  it('kickers decide; best hand takes it all', () => {
    const e = setup({
      stacks: [1000, 1000, 1000],
      dealer: 0,
      hole: { p0: 'Ac Kd', p1: 'Ah Qd', p2: '7c 2d' },
      board: 'As 9h 6c 4d 3s',
    });
    checkDown(e);
    const r = e.result!;
    expect(r.winners).toEqual([
      {
        playerId: 'p0',
        amount: 60,
        potIndex: 0,
        handName: 'Pair of Aces',
        bestCards: cards('As Ac Kd 9h 6c'),
      },
    ]);
    expect(r.handNames.p2).toBe('High Card, Ace');
  });

  it('three-way split of a side pot and main pot', () => {
    const e = setup({
      stacks: [100, 1000, 1000],
      dealer: 0,
      hole: { p0: '2c 3d', p1: '4c 5d', p2: '6c 7h' },
      board: 'As Ks Qs Js Ts',
    });
    act(e, 'p0', 'allin');
    act(e, 'p1', 'call');
    act(e, 'p2', 'raise', 300);
    act(e, 'p1', 'call');
    advanceUntilAction(e);
    checkDown(e);
    const r = e.result!;
    // main 300 split three ways, side 400 split by p1/p2
    expect(r.winners.map((w) => [w.playerId, w.potIndex, w.amount])).toEqual([
      ['p1', 0, 100],
      ['p2', 0, 100],
      ['p0', 0, 100],
      ['p1', 1, 200],
      ['p2', 1, 200],
    ]);
    expect(r.finalStacks).toEqual({ p0: 100, p1: 1000, p2: 1000 });
  });

  it('lastAction is cleared at a new street for players still able to act', () => {
    const e = setup({ stacks: [1000, 1000, 100], dealer: 0 });
    act(e, 'p0', 'call');
    act(e, 'p1', 'fold');
    act(e, 'p2', 'allin');
    act(e, 'p0', 'call');
    e.advance();
    expect(e.getPlayer('p0')!.lastAction).toBeNull();
    expect(e.getPlayer('p1')!.lastAction).toEqual({ type: 'fold', amount: 0 });
    expect(e.getPlayer('p2')!.lastAction).toEqual({ type: 'allin', amount: 100 });
  });
});

describe('forceFold', () => {
  it('on turn: action moves to the next player', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    e.forceFold('p0');
    expect(e.getPlayer('p0')!.folded).toBe(true);
    expect(e.toActId).toBe('p1');
  });

  it('off turn: current actor keeps the turn and the folded player is skipped', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    e.forceFold('p2'); // BB, not their turn
    expect(e.toActId).toBe('p0');
    act(e, 'p0', 'call');
    act(e, 'p1', 'call');
    expect(e.phase).toBe('roundComplete');
    e.advance();
    expect(e.pots).toEqual([{ amount: 60, eligible: ['p0', 'p1'] }]);
  });

  it('leaving one player completes the hand uncontested', () => {
    const e = setup({ stacks: [1000, 1000], dealer: 0 });
    e.forceFold('p1');
    expect(e.phase).toBe('complete');
    expect(e.result!.winners).toEqual([{ playerId: 'p0', amount: 20, potIndex: 0, handName: null, bestCards: null }]);
    // BB's unmatched 10 goes back to the folded BB; pot of 20 to p0
    expect(e.result!.finalStacks).toEqual({ p0: 1010, p1: 990 });
    expect(e.result!.uncalledReturn).toEqual({ playerId: 'p1', amount: 10 });
  });

  it('off turn can close the round when nobody is left to act against', () => {
    // dealer p0, SB p1 (10 chips), BB p2, UTG p3
    const e = setup({ stacks: [15, 10, 1000, 1000], dealer: 0 });
    act(e, 'p3', 'call');
    act(e, 'p0', 'allin'); // 15: call for less
    expect(e.toActId).toBe('p2'); // SB all-in from the blind
    e.forceFold('p3');
    expect(e.phase).toBe('roundComplete');
    expect(e.isRunout()).toBe(true);
    e.advance();
    expect(e.pots).toEqual([
      { amount: 40, eligible: ['p0', 'p1', 'p2'] },
      { amount: 15, eligible: ['p0', 'p2'] },
      { amount: 10, eligible: ['p2'] },
    ]);
    advanceUntilAction(e);
    expect(e.phase).toBe('complete');
    expect(chipsInPlay(e)).toBe(2025);
  });

  it('during a runout, and no-ops for unknown / folded / finished', () => {
    const e = setup({ stacks: [1000, 500, 500], dealer: 0 });
    act(e, 'p0', 'allin');
    act(e, 'p1', 'call');
    act(e, 'p2', 'call');
    expect(e.isRunout()).toBe(true);
    e.forceFold('p2');
    expect(e.phase).toBe('roundComplete');
    expect(Object.keys(e.faceUpCards()).sort()).toEqual(['p0', 'p1']);
    e.forceFold('p2');
    e.forceFold('nobody');
    advanceUntilAction(e);
    expect(e.phase).toBe('complete');
    const before = JSON.stringify(e.result);
    e.forceFold('p0');
    expect(JSON.stringify(e.result)).toBe(before);
    expect(e.result!.winners.every((w) => w.playerId !== 'p2')).toBe(true);
    expect(chipsInPlay(e)).toBe(2000);
  });

  it('forceFold of the only opponent during a runout awards everything', () => {
    const e = setup({ stacks: [1000, 1000], dealer: 0 });
    act(e, 'p0', 'allin');
    act(e, 'p1', 'call');
    e.advance();
    e.forceFold('p1');
    expect(e.phase).toBe('complete');
    expect(e.result!.showdown).toBe(false);
    expect(e.result!.finalStacks).toEqual({ p0: 2000, p1: 0 });
  });
});

describe('illegal actions are rejected without changing state', () => {
  it('rejects out of turn and unknown players', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    reject(e, 'p1', { type: 'call' }, /Not your turn/);
    reject(e, 'zz', { type: 'call' }, /not in this hand/);
  });

  it('rejects check facing a bet and call with nothing to call', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    reject(e, 'p0', { type: 'check' }, /Cannot check/);
    act(e, 'p0', 'call');
    act(e, 'p1', 'call');
    reject(e, 'p2', { type: 'call' }, /Nothing to call/);
  });

  it('rejects bad amounts', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    for (const amount of [NaN, Infinity, -Infinity, -50, 45.5, undefined]) {
      reject(e, 'p0', { type: 'raise', amount: amount as number }, /whole number/);
    }
    reject(e, 'p0', { type: 'raise', amount: '100' as unknown as number }, /whole number/);
    reject(e, 'p0', { type: 'raise', amount: 5000 }, /at most/);
    reject(e, 'p0', { type: 'raise', amount: 30 }, /Minimum raise/);
  });

  it('rejects malformed actions', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    reject(e, 'p0', { type: 'dance' } as never, /Unknown action/);
    reject(e, 'p0', null as never, /Invalid action/);
    reject(e, 'p0', undefined as never, /Invalid action/);
    reject(e, 'p0', 'fold' as never, /Invalid action/);
  });

  it('rejects actions between streets and after the hand', () => {
    const e = setup({ stacks: [1000, 1000], dealer: 0 });
    act(e, 'p0', 'call');
    act(e, 'p1', 'check');
    expect(e.legalActions('p1')).toBeNull();
    reject(e, 'p1', { type: 'check' }, /Betting is closed/);
    e.advance();
    act(e, 'p1', 'raise', 20);
    act(e, 'p0', 'fold');
    expect(e.phase).toBe('complete');
    reject(e, 'p1', { type: 'check' }, /over/);
    expect(e.legalActions('p0')).toBeNull();
    // advance is a no-op outside roundComplete
    e.advance();
    expect(e.phase).toBe('complete');
  });

  it('advance is a no-op while betting', () => {
    const e = setup({ stacks: [1000, 1000], dealer: 0 });
    e.advance();
    expect(e.street).toBe('preflop');
    expect(e.toActId).toBe('p0');
  });
});

describe('state snapshots and legal actions', () => {
  it('exposes copies, not internal state', () => {
    const e = setup({ stacks: [1000, 1000], dealer: 0 });
    const p = e.getPlayer('p0')!;
    p.stack = 1;
    p.holeCards.push('2c');
    (e.players[1] as { stack: number }).stack = 5;
    e.board.push('2c');
    expect(e.getPlayer('p0')!.stack).toBe(990);
    expect(e.getPlayer('p0')!.holeCards).toHaveLength(2);
    expect(e.getPlayer('p1')!.stack).toBe(980);
    expect(e.board).toEqual([]);
  });

  it('legalActions fills every field', () => {
    const e = setup({ stacks: [1000, 1000, 1000], dealer: 0 });
    expect(e.legalActions('p0')).toEqual({
      canFold: true,
      canCheck: false,
      canCall: true,
      callAmount: 20,
      canRaise: true,
      isBet: false,
      minRaiseTo: 40,
      maxRaiseTo: 1000,
      currentBet: 20,
      myBet: 0,
      stack: 1000,
      pot: 30,
    });
  });

  it('fold is legal even when check is available', () => {
    const e = setup({ stacks: [1000, 1000], dealer: 0 });
    act(e, 'p0', 'call');
    act(e, 'p1', 'fold');
    expect(e.result!.finalStacks).toEqual({ p0: 1020, p1: 980 });
  });

  it('action events carry the street total', () => {
    const e = setup({ stacks: [1000, 1000], dealer: 0 });
    expect(e.drainEvents()).toEqual([
      { kind: 'blind', playerId: 'p0', action: 'sb', amount: 10 },
      { kind: 'blind', playerId: 'p1', action: 'bb', amount: 20 },
    ]);
    act(e, 'p0', 'raise', 60);
    act(e, 'p1', 'call');
    e.advance();
    act(e, 'p1', 'check');
    act(e, 'p0', 'raise', 40);
    act(e, 'p1', 'allin');
    expect(e.drainEvents()).toEqual([
      { kind: 'action', playerId: 'p0', action: 'raise', amount: 60 },
      { kind: 'action', playerId: 'p1', action: 'call', amount: 60 },
      { kind: 'street', street: 'flop', cards: e.board },
      { kind: 'action', playerId: 'p1', action: 'check', amount: 0 },
      { kind: 'action', playerId: 'p0', action: 'bet', amount: 40 },
      { kind: 'action', playerId: 'p1', action: 'allin', amount: 940 },
    ]);
  });

  it('createHand validates its config', () => {
    const base = {
      handNumber: 1,
      players: [
        { id: 'a', seat: 0, stack: 100 },
        { id: 'b', seat: 1, stack: 100 },
      ],
      dealerSeat: 0,
      smallBlind: 1,
      bigBlind: 2,
    };
    expect(() => createHand(base)).not.toThrow();
    expect(() => createHand({ ...base, players: [base.players[0]!] })).toThrow();
    expect(() => createHand({ ...base, dealerSeat: 5 })).toThrow();
    expect(() => createHand({ ...base, players: [base.players[0]!, { id: 'a', seat: 1, stack: 100 }] })).toThrow();
    expect(() => createHand({ ...base, players: [base.players[0]!, { id: 'b', seat: 0, stack: 100 }] })).toThrow();
    expect(() => createHand({ ...base, players: [base.players[0]!, { id: 'b', seat: 1, stack: 0 }] })).toThrow();
    expect(() => createHand({ ...base, deck: fullDeck().slice(0, 5) })).toThrow();
    expect(() => createHand({ ...base, deck: ['As', 'As', ...fullDeck()] })).toThrow();
    expect(() => createHand({ ...base, bigBlind: 0, smallBlind: 0 })).toThrow();
  });
});

describe('nextButtonSeat', () => {
  it('moves clockwise strictly after the previous seat, wrapping', () => {
    expect(nextButtonSeat(0, [0, 1, 2])).toBe(1);
    expect(nextButtonSeat(2, [0, 1, 2])).toBe(0);
    expect(nextButtonSeat(3, [1, 5, 8])).toBe(5);
    expect(nextButtonSeat(8, [1, 5, 8])).toBe(1);
    expect(nextButtonSeat(9, [1, 5, 8])).toBe(1);
    expect(nextButtonSeat(5, [8, 1])).toBe(8);
  });
  it('picks a random seat when there is no previous button', () => {
    expect(nextButtonSeat(null, [2, 4, 6], () => 0)).toBe(2);
    expect(nextButtonSeat(null, [2, 4, 6], () => 0.5)).toBe(4);
    expect(nextButtonSeat(null, [2, 4, 6], () => 0.9999)).toBe(6);
    expect([2, 4, 6]).toContain(nextButtonSeat(null, [2, 4, 6]));
  });
  it('throws with no seats', () => {
    expect(() => nextButtonSeat(null, [])).toThrow();
  });
});
