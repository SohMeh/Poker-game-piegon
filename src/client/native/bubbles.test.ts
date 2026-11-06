import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BuyBackVoteView, HandView, LogEntry, PublicPlayer } from '../../shared/types';
import type { BubbleKind, WebToNative } from './bridgeTypes';
import {
  awayNextActor,
  BUBBLE_DELIVERY,
  bubbleContext,
  buyBackRequestedBubble,
  currentGame,
  gameOverBubble,
  gameStartedBubble,
  inviteBubble,
  lastHandNumber,
  rematchBubble,
  tableUrl,
  yourTurnBubble,
  type BubbleContext,
  type BubbleEvent,
} from './bubbles';
import { fourPlayers, hand, ORIGIN, player, room, ROOM, sohum } from './testRooms';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../ios/FlockKit/Tests/FlockKitTests/Fixtures/bridge-events.json',
);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { version: number; webToNative: WebToNative[] };
const fixtureBubble = (kind: BubbleKind): BubbleEvent => {
  const e = fixture.webToNative.find((x): x is BubbleEvent => x.type === 'bubble' && x.kind === kind);
  if (!e) throw new Error(`fixture has no ${kind} bubble`);
  return e;
};

/** Keys and value types, recursively (key order ignored). */
function shapeOf(v: unknown): unknown {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.map(shapeOf);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, shapeOf(o[k])]));
  }
  return typeof v;
}

const ctx = (game = 1, lastHand = 0): BubbleContext => ({ origin: ORIGIN, game, lastHand });

/** The situations the fixture describes, rebuilt as RoomViews. */
function scenarios(): Record<BubbleKind, BubbleEvent> {
  const lobby = room({ players: [sohum()], status: 'lobby', started: false });
  const started = room({ players: fourPlayers(), hand: hand({ handNumber: 1 }) });
  const vote: BuyBackVoteView = {
    id: 'v_7f3a',
    requesterId: 'p_bob',
    requesterName: 'Bob',
    amount: 2000,
    createdAt: 0,
    deadline: 30_000,
    votes: { p_sohum: null, p_alice: null, p_carol: null },
    status: 'pending',
    resolvedReason: null,
    resolvedAt: null,
  };
  const buyBack = room({
    players: fourPlayers({ p_bob: { stack: 0, busted: true } }),
    me: 'p_bob',
    hand: hand({ handNumber: 14, phase: 'complete' }),
    votes: [vote],
  });
  const turn = room({
    players: fourPlayers({ p_carol: { connected: false, inHand: true } }),
    me: 'p_alice',
    hand: hand({ handNumber: 15, street: 'flop', totalPot: 340, toActPlayerId: 'p_carol' }),
  });
  const over = room({
    players: fourPlayers({ p_alice: { stack: 8000 }, p_sohum: { stack: 0, busted: true }, p_bob: { stack: 0, busted: true }, p_carol: { stack: 0, busted: true } }),
    hand: null,
    gameOverWinnerId: 'p_alice',
  });
  const rematch = room({ players: fourPlayers(), status: 'lobby', started: false });
  return {
    invite: inviteBubble(lobby, ctx()),
    gameStarted: gameStartedBubble(started, ctx()),
    buyBackRequested: buyBackRequestedBubble(buyBack, ctx(1, 14), 'v_7f3a'),
    yourTurn: yourTurnBubble(turn, ctx(1, 15), 'p_carol')!,
    gameOver: gameOverBubble(over, ctx(1, 41))!,
    rematch: rematchBubble(rematch, ctx(2, 0)),
  };
}

const KINDS = Object.keys(BUBBLE_DELIVERY) as BubbleKind[];

describe('bubbles match the shared bridge fixture', () => {
  it('the fixture has one bubble of every kind', () => {
    expect(fixture.version).toBe(1);
    expect(KINDS.sort()).toEqual(
      fixture.webToNative
        .filter((e) => e.type === 'bubble')
        .map((e) => (e as BubbleEvent).kind)
        .sort(),
    );
  });

  it.each(KINDS)('%s: exactly the keys and value types of the fixture event', (kind) => {
    const produced = scenarios()[kind];
    expect(shapeOf(produced)).toEqual(shapeOf(fixtureBubble(kind)));
    // no extra / missing keys at either level (shapeOf would hide a key order difference only)
    expect(Object.keys(produced).sort()).toEqual(Object.keys(fixtureBubble(kind)).sort());
    expect(Object.keys(produced.bubble).sort()).toEqual(Object.keys(fixtureBubble(kind).bubble).sort());
  });

  it.each(KINDS)('%s: the fixture situation produces the fixture event', (kind) => {
    expect(scenarios()[kind]).toEqual(fixtureBubble(kind));
  });

  it('kind -> delivery: invites are inserted with a plain link, everything else is sent without one', () => {
    for (const kind of KINDS) {
      const e = scenarios()[kind];
      if (kind === 'invite') expect([e.mode, e.plainLink]).toEqual(['insert', true]);
      else expect([e.mode, e.plainLink]).toEqual(['send', false]);
      expect([e.mode, e.plainLink]).toEqual([fixtureBubble(kind).mode, fixtureBubble(kind).plainLink]);
    }
  });

  it('dedupe keys use the fixture formats', () => {
    const s = scenarios();
    expect(s.invite.dedupeKey).toBe('invite:ABC123:1');
    expect(s.gameStarted.dedupeKey).toBe('gameStarted:ABC123:1');
    expect(s.buyBackRequested.dedupeKey).toBe('buyBackRequested:ABC123:v_7f3a');
    expect(s.yourTurn.dedupeKey).toBe('yourTurn:ABC123:15:p_carol');
    expect(s.gameOver.dedupeKey).toBe('gameOver:ABC123:1:p_alice');
    expect(s.rematch.dedupeKey).toBe('rematch:ABC123:2');
    // the game counter is part of the per-game keys
    const lobby = room({ players: [sohum()], status: 'lobby', started: false });
    expect(inviteBubble(lobby, ctx(3)).dedupeKey).toBe('invite:ABC123:3');
  });
});

describe('bubble content', () => {
  it('links to the absolute table URL, without the embed flag', () => {
    const lobby = room({ players: [sohum()], status: 'lobby', started: false });
    expect(inviteBubble(lobby, { origin: 'http://localhost:3100/', game: 1, lastHand: 0 }).bubble.url).toBe('http://localhost:3100/g/ABC123');
    expect(tableUrl('https://x.example', 'abc123')).toBe('https://x.example/g/ABC123');
    for (const e of Object.values(scenarios())) {
      expect(e.bubble.url).toBe(`${ORIGIN}/g/${ROOM}`);
      expect(e.bubble.url).not.toContain('embed');
      expect(e.bubble.roomId).toBe(ROOM);
    }
  });

  it('invite copy follows the table: full tables invite to watch, running games show the hand', () => {
    const full = room({
      players: [sohum(), player('p_a', 'Ann', 1)],
      status: 'running',
      hand: hand({ handNumber: 12 }),
      settings: { maxPlayers: 2, smallBlind: 5, bigBlind: 10, buyIn: 1000 },
    });
    const e = inviteBubble(full, ctx());
    expect(e.bubble.subtitle).toBe('5/10 · buy-in 1,000 · 2/2 seated — tap to watch');
    expect(e.bubble.trailing).toBe('Hand #12');
    expect(e.bubble.summary).toBe("Join Sohum's poker game");
    expect(e.bubble.handNumber).toBe(12);
    const paused = room({ players: [sohum()], status: 'paused', hand: null });
    expect(inviteBubble(paused, ctx(1, 7)).bubble).toMatchObject({ trailing: 'Paused', handNumber: 7, status: 'paused' });
  });

  it('buy-back subtitle uses the table vote timer; the requester name falls back to me', () => {
    const r = room({ players: fourPlayers({ p_bob: { stack: 0, busted: true } }), me: 'p_bob', settings: { buyBackVoteSec: 45 } });
    const e = buyBackRequestedBubble(r, ctx(), 'v_unknown');
    expect(e.bubble.title).toBe('Bob wants to buy back in');
    expect(e.bubble.subtitle).toBe('Everyone must approve within 45s — tap to vote');
    expect(e.dedupeKey).toBe('buyBackRequested:ABC123:v_unknown');
  });

  it('game over and your-turn bubbles need a winner / a hand', () => {
    const r = room({ players: fourPlayers(), hand: null });
    expect(gameOverBubble(r, ctx())).toBeNull();
    expect(yourTurnBubble(r, ctx(), 'p_bob')).toBeNull();
  });
});

describe('game counter from the hand log', () => {
  const entry = (id: number, handNumber: number | null, game?: number): LogEntry => ({
    id,
    handNumber,
    ts: id,
    kind: 'info',
    text: '',
    ...(game === undefined ? {} : { game }),
  });

  it('uses LogEntry.game, and 1 without it', () => {
    expect(currentGame([])).toBe(1);
    expect(currentGame([entry(1, null), entry(2, 3)])).toBe(1);
    expect(currentGame([entry(1, 5, 1), entry(2, null, 2)])).toBe(2);
  });

  it('the last hand counts only the current game (hand numbers restart after a rematch)', () => {
    const log = [entry(1, 40, 1), entry(2, 41, 1), entry(3, null, 2), entry(4, 2, 2)];
    expect(lastHandNumber(log, 2)).toBe(2);
    expect(lastHandNumber(log, 1)).toBe(41);
    expect(bubbleContext(log, ORIGIN)).toEqual({ origin: ORIGIN, game: 2, lastHand: 2 });
    expect(bubbleContext([entry(1, 9)], ORIGIN)).toEqual({ origin: ORIGIN, game: 1, lastHand: 9 });
  });
});

describe('awayNextActor (who to nudge after my action)', () => {
  const at = (h: Partial<HandView> | null, carol: Partial<PublicPlayer> = {}) =>
    room({ players: fourPlayers({ p_carol: { inHand: true, ...carol } }), me: 'p_alice', hand: h === null ? null : hand({ handNumber: 15, ...h }) });

  it('nudges the next actor only when their phone is away', () => {
    expect(awayNextActor(at({ toActPlayerId: 'p_carol' }, { connected: false }), 'p_alice', 15)).toBe('p_carol');
    expect(awayNextActor(at({ toActPlayerId: 'p_carol' }, { connected: true }), 'p_alice', 15)).toBeNull();
  });

  it('nobody to nudge when it is my turn again, the hand ended or moved on', () => {
    expect(awayNextActor(at({ toActPlayerId: 'p_alice' }), 'p_alice', 15)).toBeNull();
    expect(awayNextActor(at({ phase: 'complete' }, { connected: false }), 'p_alice', 15)).toBeNull();
    expect(awayNextActor(at(null), 'p_alice', 15)).toBeNull();
    expect(awayNextActor(at({ toActPlayerId: 'p_carol' }, { connected: false }), 'p_alice', 14)).toBeNull();
  });

  it('waits while the next street is being dealt', () => {
    expect(awayNextActor(at({ phase: 'dealing', toActPlayerId: null }), 'p_alice', 15)).toBeUndefined();
  });
});
