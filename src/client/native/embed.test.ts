// Embed-mode wiring: which bubble is posted after which ack, and when.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomView } from '../../shared/types';
import type { WebToNative } from './bridgeTypes';
import { fourPlayers, hand, ORIGIN, room, sohum } from './testRooms';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A page inside the extension (native injected + handler), recording what it posts. */
async function embeddedPage(opts: { native?: boolean; search?: string } = {}) {
  const posted: WebToNative[] = [];
  const w = new EventTarget() as EventTarget & Record<string, unknown>;
  w.location = { search: opts.search ?? '', origin: ORIGIN };
  if (opts.native !== false) {
    w.__FLOCK_NATIVE__ = { platform: 'imessage', version: 1, name: 'Sohum', presentation: 'expanded' };
    w.webkit = { messageHandlers: { flock: { postMessage: (m: WebToNative) => void posted.push(m) } } };
  }
  vi.stubGlobal('window', w);
  vi.stubGlobal('document', { documentElement: { dataset: {} as Record<string, string> }, addEventListener: () => undefined });
  const { useStore } = await import('../state/store');
  const embed = await import('./embed');
  return { posted, useStore, embed, w };
}

const bubbleKinds = (posted: WebToNative[]) => posted.flatMap((e) => (e.type === 'bubble' ? [`${e.kind} ${e.dedupeKey}`] : []));

describe('after an action is accepted', () => {
  it('nudges the next actor once they are away, after waiting out the next street being dealt', async () => {
    const { posted, useStore, embed } = await embeddedPage();
    const before = room({ players: fourPlayers({ p_alice: { inHand: true }, p_carol: { inHand: true, connected: false } }), me: 'p_alice', hand: hand({ handNumber: 15, toActPlayerId: 'p_alice' }) });
    useStore.setState({ room: before, log: [] });
    const done = embed.afterAction(embed.snapshot());
    // the street closes first: nothing yet
    useStore.setState({ room: { ...before, hand: hand({ handNumber: 15, phase: 'dealing', toActPlayerId: null }) } });
    await Promise.resolve();
    expect(posted).toEqual([]);
    const carolsTurn: RoomView = { ...before, hand: hand({ handNumber: 15, street: 'flop', totalPot: 340, toActPlayerId: 'p_carol' }) };
    useStore.setState({ room: carolsTurn });
    await done;
    expect(bubbleKinds(posted)).toEqual(['yourTurn yourTurn:ABC123:15:p_carol']);
    expect(posted[0]).toMatchObject({ bubble: { title: "Carol, it's your turn", subtitle: 'Pot 340 · flop — tap to act', url: `${ORIGIN}/g/ABC123` } });

    // the same player in the same hand is nudged at most once
    useStore.setState({ room: { ...before } });
    const again = embed.afterAction(embed.snapshot());
    useStore.setState({ room: { ...carolsTurn } });
    await again;
    expect(posted).toHaveLength(1);
  });

  it('does not nudge a player whose phone is at the table, or when it is my turn again', async () => {
    const { posted, useStore, embed } = await embeddedPage();
    const before = room({ players: fourPlayers(), me: 'p_alice', hand: hand({ handNumber: 3, toActPlayerId: 'p_alice' }) });
    useStore.setState({ room: before, log: [] });
    let done = embed.afterAction(embed.snapshot());
    useStore.setState({ room: { ...before, hand: hand({ handNumber: 3, toActPlayerId: 'p_carol' }) } });
    await done;
    done = embed.afterAction(embed.snapshot());
    useStore.setState({ room: { ...before, hand: hand({ handNumber: 3, street: 'flop', toActPlayerId: 'p_alice' }) } });
    await done;
    expect(posted).toEqual([]);
  });

  it('host start / buy-back request / rematch wait for the state that follows the ack', async () => {
    const { posted, useStore, embed } = await embeddedPage();
    const lobby = room({ players: fourPlayers(), status: 'lobby', started: false });
    useStore.setState({ room: lobby, log: [{ id: 1, handNumber: null, ts: 0, kind: 'info', text: '', game: 1 }] });
    const start = embed.afterStart(embed.snapshot());
    await Promise.resolve();
    expect(posted).toEqual([]); // the ack comes before the broadcast
    useStore.setState({ room: room({ players: fourPlayers(), hand: hand({ handNumber: 1 }) }) });
    await start;

    const busted = room({ players: fourPlayers({ p_sohum: { stack: 0, busted: true } }), hand: null });
    useStore.setState({ room: busted });
    const ask = embed.afterBuyBackRequest(embed.snapshot(), 'v_1');
    useStore.setState({
      room: {
        ...busted,
        buyBackVotes: [
          {
            id: 'v_1',
            requesterId: 'p_sohum',
            requesterName: 'Sohum',
            amount: 2000,
            createdAt: 0,
            deadline: 30_000,
            votes: { p_alice: null },
            status: 'pending',
            resolvedReason: null,
            resolvedAt: null,
          },
        ],
      },
    });
    await ask;

    const over = room({ players: fourPlayers(), hand: null, gameOverWinnerId: 'p_alice' });
    useStore.setState({ room: over });
    const rematch = embed.afterRematch(embed.snapshot());
    // log first (the new game), then the lobby state, like the server sends them
    useStore.setState({ log: [...useStore.getState().log, { id: 2, handNumber: null, ts: 1, kind: 'info', text: 'New game!', game: 2 }] });
    useStore.setState({ room: room({ players: fourPlayers(), status: 'lobby', started: false }) });
    await rematch;

    expect(bubbleKinds(posted)).toEqual([
      'gameStarted gameStarted:ABC123:1',
      'buyBackRequested buyBackRequested:ABC123:v_1',
      'rematch rematch:ABC123:2',
    ]);
    expect(posted[0]).toMatchObject({ bubble: { status: 'running', handNumber: 1, trailing: 'Hand #1' } });
  });

  it('a buy-back nobody had to vote on is not announced', async () => {
    const { posted, useStore, embed } = await embeddedPage();
    const alone = room({ players: [sohum({ stack: 0, busted: true })], hand: null });
    useStore.setState({ room: alone, log: [] });
    const ask = embed.afterBuyBackRequest(embed.snapshot(), 'v_2');
    useStore.setState({
      room: {
        ...alone,
        buyBackVotes: [
          {
            id: 'v_2',
            requesterId: 'p_sohum',
            requesterName: 'Sohum',
            amount: 2000,
            createdAt: 0,
            deadline: 0,
            votes: {},
            status: 'approved',
            resolvedReason: 'unanimous',
            resolvedAt: 0,
          },
        ],
      },
    });
    await ask;
    expect(posted).toEqual([]);
  });

  it('falls back to the latest state when the expected one never comes', async () => {
    vi.useFakeTimers();
    const { posted, useStore, embed } = await embeddedPage();
    const lobby = room({ players: fourPlayers(), status: 'lobby', started: false });
    useStore.setState({ room: lobby, log: [] });
    const start = embed.afterStart(embed.snapshot());
    await vi.advanceTimersByTimeAsync(5000);
    await start;
    expect(bubbleKinds(posted)).toEqual(['gameStarted gameStarted:ABC123:1']);
  });
});

describe('outside Messages', () => {
  it('every hook is a no-op', async () => {
    const { posted, useStore, embed } = await embeddedPage({ native: false });
    const r = room({ players: fourPlayers(), me: 'p_alice', hand: hand({ handNumber: 2, toActPlayerId: 'p_alice' }) });
    useStore.setState({ room: r, log: [] });
    expect(embed.snapshot()).toBeNull();
    await embed.afterAction(embed.snapshot());
    await embed.afterStart(embed.snapshot());
    await embed.afterRematch(embed.snapshot());
    await embed.afterBuyBackRequest(embed.snapshot(), 'v');
    await embed.afterCreate('ABC123');
    embed.rememberName('Sam');
    expect(embed.sendInvite(r)).toBe(false);
    embed.initEmbed();
    expect(posted).toEqual([]);
  });
});

describe('boot and names', () => {
  it('posts ready on boot and on route changes; the host device announces game over once', async () => {
    const { posted, useStore, embed } = await embeddedPage();
    useStore.setState({ route: { name: 'home' } });
    embed.initEmbed();
    embed.initEmbed(); // idempotent
    useStore.setState({ route: { name: 'home' } }); // same route again: no new ready
    useStore.setState({ route: { name: 'room', roomId: 'ABC123', valid: true } });
    const playing = room({ players: fourPlayers(), hand: null });
    useStore.setState({ room: playing });
    useStore.setState({ room: { ...playing, gameOverWinnerId: 'p_alice' } });
    useStore.setState({ room: { ...playing, gameOverWinnerId: 'p_alice', serverTime: 2 } });
    expect(posted.filter((e) => e.type === 'ready')).toEqual([
      { type: 'ready', version: 1, route: 'home' },
      { type: 'ready', version: 1, route: 'table' },
    ]);
    expect(bubbleKinds(posted)).toEqual(['gameOver gameOver:ABC123:1:p_alice']);
  });

  it('a guest device does not announce game over', async () => {
    const { posted, useStore, embed } = await embeddedPage();
    embed.initEmbed();
    const playing = room({ players: fourPlayers(), me: 'p_bob', hand: null });
    useStore.setState({ room: playing });
    useStore.setState({ room: { ...playing, gameOverWinnerId: 'p_alice' } });
    expect(bubbleKinds(posted)).toEqual([]);
  });

  it('prefills the native name and remembers the one used', async () => {
    const { posted, embed } = await embeddedPage();
    expect(embed.preferredName()).toBe('Sohum');
    embed.rememberName('  Sam ');
    embed.rememberName('   ');
    expect(posted).toEqual([{ type: 'rememberName', name: 'Sam' }]);
  });
});
