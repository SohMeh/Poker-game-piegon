import { describe, expect, it } from 'vitest';
import type { RoomView } from '../../shared/types';
import { scenarioState } from '../mock/fixtures';
import {
  amountToCall,
  bottomMode,
  buyBackAvailability,
  buyBackVoterCount,
  eligibleCount,
  firstFreeSeat,
  isGameOver,
  isStalled,
  myPendingRequest,
  myPlayer,
  nameResolver,
  pendingRequests,
  reservedSeats,
  seatNeedsApproval,
  seatsTaken,
} from './gameState';

const NOW = 1_700_000_000_000;
const room = (name: string): RoomView => {
  const r = scenarioState(name, NOW).room;
  if (!r) throw new Error(`scenario ${name} has no room`);
  return r;
};

describe('bottomMode', () => {
  it.each([
    ['preflop-my-turn', 'act'],
    ['flop-waiting', 'inHand'],
    ['lobby-host', 'lobby'],
    ['lobby-guest', 'lobby'],
    ['spectator-full', 'spectator'],
    ['spectator-open', 'spectator'],
    ['pending', 'pending'],
    ['busted', 'busted'],
    ['buyback-requester', 'busted'],
    ['game-over', 'gameOver'],
    ['allin-runout', 'allIn'],
    ['sitting-out', 'sittingOut'],
    ['showdown-split', 'waiting'],
  ])('%s -> %s', (scenario, mode) => {
    expect(bottomMode(room(scenario))).toBe(mode);
  });
});

describe('selectors', () => {
  it('finds free and reserved seats', () => {
    expect(firstFreeSeat(room('spectator-full'))).toBeNull();
    expect(firstFreeSeat(room('spectator-open'))).toBe(5);
    expect(firstFreeSeat(room('pending'))).toBeNull(); // seat 5 is reserved by my request
    expect([...reservedSeats(room('seat-request'))].sort()).toEqual([3, 4]);
    expect(pendingRequests(room('seat-request')).map((p) => p.name)).toEqual(['Dan', 'Eve']);
    expect(seatsTaken(room('lobby-host'))).toBe(4);
  });
  it('counts players ready to start', () => {
    expect(eligibleCount(room('lobby-host'))).toBe(4);
    expect(eligibleCount(room('seat-request'))).toBe(2);
  });
  it('computes the amount to call', () => {
    const r = room('flop-waiting');
    expect(amountToCall(r, myPlayer(r))).toBe(80);
    const r2 = room('lobby-host');
    expect(amountToCall(r2, myPlayer(r2))).toBe(0);
  });
  it('detects game over', () => {
    expect(isGameOver(room('game-over'))).toBe(true);
    expect(isGameOver(room('preflop-my-turn'))).toBe(false);
    expect(isGameOver(room('lobby-host'))).toBe(false);
  });
  it('resolves names, including players who left (ledger)', () => {
    const r = room('preflop-my-turn');
    const nameOf = nameResolver(r);
    expect(nameOf('p1')).toBe('Alice');
    expect(nameOf('nobody')).toBe('Someone');
  });
});

describe('buy-back availability', () => {
  it('allowed when the server says so', () => {
    const r = room('busted');
    expect(buyBackAvailability(r, NOW)).toEqual({ allowed: true });
    expect(buyBackVoterCount(r)).toBe(3);
  });
  it('blocked during cooldown, with the end time', () => {
    const b = buyBackAvailability(room('busted-cooldown'), NOW);
    expect(b.allowed).toBe(false);
    expect(b.allowed === false && b.cooldownUntil).toBe(NOW + 17_000);
  });
  it('blocked while my own request is pending', () => {
    const r = room('buyback-requester');
    expect(myPendingRequest(r)?.id).toBe('v2');
    expect(buyBackAvailability(r, NOW).allowed).toBe(false);
  });
  it('blocked when the host turned buy-backs off', () => {
    const r = room('busted');
    const off = { ...r, settings: { ...r.settings, allowBuyBack: false } };
    const b = buyBackAvailability(off, NOW);
    expect(b.allowed === false && b.reason).toMatch(/off/);
  });
});

describe('stalled vs game over', () => {
  /** A running game between hands where only `withChips` (by name) hold chips; the rest are busted. */
  function between(withChips: string[], standing: string[] = []): RoomView {
    const r = structuredClone(room('preflop-my-turn'));
    r.hand = null;
    r.gameOverWinnerId = null;
    r.status = 'running';
    r.started = true;
    r.me.legal = null;
    for (const p of r.players) {
      p.stack = withChips.includes(p.name) ? 1000 : 0;
      p.inHand = false;
      if (standing.includes(p.name)) {
        r.seats[p.seat!] = null;
        p.seat = null;
      }
    }
    r.ledger = r.players.map((p) => ({ playerId: p.id, name: p.name, buyIns: 1, totalBuyIn: 1000, stack: p.stack, net: p.stack - 1000, inRoom: true }));
    return r;
  }

  it('someone who stood up with chips keeps the game alive: waiting for players, not game over', () => {
    const r = between(['Sohum', 'Bob'], ['Bob']); // Sohum is "me"
    expect(isGameOver(r)).toBe(false);
    expect(isStalled(r)).toBe(true);
    expect(bottomMode(r)).toBe('waiting');
  });

  it('nobody in the room holds chips: game over even without a winner', () => {
    const r = between([]);
    expect(isGameOver(r)).toBe(true);
    expect(isStalled(r)).toBe(false);
  });

  it('two players with chips seated: neither stalled nor over (the next hand is coming)', () => {
    const r = between(['Sohum', 'Bob']);
    expect(isStalled(r)).toBe(false);
    expect(isGameOver(r)).toBe(false);
  });
});

describe('seat approval hint', () => {
  it('newcomers need the host once the game has started; returning players and the host do not', () => {
    const r = structuredClone(room('spectator-open'));
    const me = r.players.find((p) => p.id === r.me.playerId)!;
    r.settings.requireApproval = false;
    r.started = false;
    expect(seatNeedsApproval(r)).toBe(false);
    r.started = true;
    me.buyIns = 0;
    expect(seatNeedsApproval(r)).toBe(true);
    me.buyIns = 1; // stood up earlier: sits back down with the same chips
    expect(seatNeedsApproval(r)).toBe(false);
    r.settings.requireApproval = true;
    expect(seatNeedsApproval(r)).toBe(true);
    r.me.isHost = true;
    expect(seatNeedsApproval(r)).toBe(false);
  });
});
