import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import type {
  AckResponse,
  Card,
  ChatMessage,
  ClientToServerEvents,
  LogEntry,
  NoticePayload,
  RoomView,
  ServerToClientEvents,
} from '../shared';
import { KICKED_ERROR } from '../shared';
import { createAppServer, type AppServerHandle } from './app';
import { addressKey, clientAddress, WindowLimiter } from './socket';
import { deckFor } from './room/test-utils';

let server: AppServerHandle;
let url: string;
const clients: TestClient[] = [];

beforeAll(async () => {
  server = createAppServer({
    clientDir: null,
    rand: () => 0, // first button = lowest seat
    socketLimits: { burst: 500, perSecond: 500, chatMessages: 5, chatWindowMs: 5000 },
    // hand #1 of every game: Alice (seat 0) holds aces, Bob (seat 1) 7-2
    deckFactory: (n) => (n === 1 ? deckFor([0, 1, 2], 0, { 0: 'As Ah', 1: '7c 2d', 2: '8s 8h' }, 'Kd 9s 5h 3c Jd') : undefined),
    timing: { streetDelayMs: 20, runoutStreetDelayMs: 20, nextHandDelayMs: 150, showdownNextHandDelayMs: 150 },
  });
  const port = await server.listen(0);
  url = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => T | null | undefined | false, ms = 5000, what = 'condition'): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

class TestClient {
  readonly socket: ClientSocket<ServerToClientEvents, ClientToServerEvents>;
  states: RoomView[] = [];
  logs: LogEntry[] = [];
  chats: ChatMessage[] = [];
  notices: NoticePayload[] = [];
  histories: { chat: ChatMessage[]; log: LogEntry[] }[] = [];
  kicked: string | null = null;

  constructor() {
    this.socket = ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.socket.on('state', (s) => this.states.push(s));
    this.socket.on('log', (e) => this.logs.push(...e));
    this.socket.on('chat', (m) => this.chats.push(m));
    this.socket.on('notice', (n) => this.notices.push(n));
    this.socket.on('history', (h) => this.histories.push(h));
    this.socket.on('kicked', (k) => (this.kicked = k.reason));
    clients.push(this);
  }

  get state(): RoomView {
    const s = this.states.at(-1);
    if (!s) throw new Error('no state yet');
    return s;
  }

  async connected(): Promise<this> {
    if (!this.socket.connected) await new Promise<void>((r) => this.socket.once('connect', () => r()));
    return this;
  }

  /** Loose emit: lets tests send malformed payloads. */
  emit<T = Record<string, never>>(event: string, payload?: unknown): Promise<AckResponse<T>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 3000);
      (this.socket.emit as unknown as (e: string, p: unknown, cb: (r: AckResponse<T>) => void) => void).call(
        this.socket,
        event,
        payload,
        (r: AckResponse<T>) => {
          clearTimeout(timer);
          resolve(r);
        },
      );
    });
  }

  async ok<T = Record<string, never>>(event: string, payload?: unknown): Promise<T> {
    const r = await this.emit<T>(event, payload);
    if (!r.ok) throw new Error(`${event} failed: ${r.error}`);
    return r.data;
  }

  waitState(pred: (s: RoomView) => boolean, what = 'state'): Promise<RoomView> {
    return until(() => this.states.slice().reverse().find(pred) && this.state && pred(this.state) && this.state, 5000, what);
  }

  close(): void {
    this.socket.close();
  }
}

/**
 * Plays hand `handNumber` to completion. The current actor is whichever client's own latest view
 * has `me.legal` (each client's own view is authoritative for itself).
 */
async function playHand(
  players: TestClient[],
  handNumber: number,
  choose: (legal: NonNullable<RoomView['me']['legal']>) => { type: string } = (l) => ({ type: l.canCheck ? 'check' : 'call' }),
  onTurn?: (actor: TestClient) => Promise<void>,
): Promise<RoomView> {
  const watcher = players[0]!;
  for (let guard = 0; guard < 400; guard++) {
    const w = watcher.state;
    if (w.hand && (w.hand.handNumber > handNumber || (w.hand.handNumber === handNumber && w.hand.phase === 'complete'))) break;
    if (!w.hand && w.started && guard > 0) break;
    const actor = players.find((c) => {
      const st = c.states.at(-1);
      return st?.me.legal && st.hand?.handNumber === handNumber && st.hand.toActPlayerId === st.me.playerId;
    });
    if (!actor) {
      await sleep(5);
      continue;
    }
    if (onTurn) await onTurn(actor);
    await actor.ok('game:action', choose(actor.state.me.legal!));
    await actor.waitState((v) => v.me.legal === null, 'turn passed');
  }
  return watcher.waitState(
    (s) => !!s.hand && (s.hand.handNumber > handNumber || (s.hand.handNumber === handNumber && s.hand.phase === 'complete')),
    `hand ${handNumber} complete`,
  );
}

/** Every card string a viewer can see, excluding legitimately face-up places. */
function hiddenCardStrings(view: RoomView): string {
  const copy = structuredClone(view);
  for (const p of copy.players) p.shownCards = null;
  if (copy.hand?.winners) for (const w of copy.hand.winners) w.bestCards = null;
  copy.me.holeCards = null;
  return JSON.stringify(copy);
}

describe('socket integration', () => {
  let alice: TestClient;
  let bob: TestClient;
  let carol: TestClient;
  let roomId: string;
  const ids = { alice: '', bob: '', carol: '' };
  const tokens = { alice: '', bob: '', carol: '' };

  it('create, join, sit, start and play a full hand with legal actions', async () => {
    alice = await new TestClient().connected();
    bob = await new TestClient().connected();
    carol = await new TestClient().connected();

    const created = await alice.ok<{ roomId: string; token: string; playerId: string }>('room:create', {
      name: 'Alice',
      settings: { smallBlind: 5, bigBlind: 10, buyIn: 1000, turnTimeSec: 30 },
    });
    roomId = created.roomId;
    expect(roomId).toMatch(/^[A-Z2-9]{6}$/);
    ids.alice = created.playerId;
    tokens.alice = created.token;
    await alice.waitState((s) => s.roomId === roomId && s.me.seat === 0, 'alice seated');
    expect(alice.histories).toHaveLength(1);

    // the client re-joins with its token right after creating (same socket): idempotent
    const again = await alice.ok<{ token: string; playerId: string }>('room:join', { roomId, token: created.token });
    expect(again.playerId).toBe(ids.alice);
    expect(alice.histories).toHaveLength(2);

    const jb = await bob.ok<{ token: string; playerId: string }>('room:join', { roomId: roomId.toLowerCase(), name: 'Bob' });
    const jc = await carol.ok<{ token: string; playerId: string }>('room:join', { roomId, name: 'Carol' });
    ids.bob = jb.playerId;
    ids.carol = jc.playerId;
    tokens.bob = jb.token;
    tokens.carol = jc.token;
    expect(await bob.ok('seat:take', { seat: 1 })).toEqual({ pending: false });
    expect(await carol.ok('seat:take', { seat: 2 })).toEqual({ pending: false });
    await alice.waitState((s) => s.seats.filter(Boolean).length === 3, 'three seated');
    expect(alice.logs.map((l) => l.text)).toEqual(expect.arrayContaining(['Bob joined', 'Carol joined']));
    // spectators joining are logged, not announced in the chat (drive-by joins can't flood it)
    expect(alice.chats.some((c) => c.text.endsWith('joined'))).toBe(false);

    const startErr = await bob.emit('host:start', {});
    expect(startErr).toEqual({ ok: false, error: 'Only the host can do that' });
    await alice.ok('host:start', {});
    await alice.waitState((s) => s.hand?.handNumber === 1, 'hand 1');

    // play: everyone checks / calls down; on every turn a player acting out of turn is rejected
    let rejected = 0;
    await playHand([alice, bob, carol], 1, undefined, async (actor) => {
      const other = [alice, bob, carol].find((c) => c !== actor)!;
      const r = await other.emit('game:action', { type: 'check' });
      expect(r.ok).toBe(false);
      rejected++;
    });
    expect(rejected).toBeGreaterThanOrEqual(6);
    const done = await alice.waitState((s) => s.hand?.phase === 'complete', 'hand complete');
    expect(done.hand?.street).toBe('showdown');
    expect(done.hand?.winners?.length).toBeGreaterThan(0);
    // chips conserved
    expect(done.ledger.reduce((sum, r) => sum + r.stack, 0)).toBe(3000);
    // everyone saw the showdown cards of all three players
    for (const c of [alice, bob, carol]) {
      const st = await c.waitState((s) => s.hand?.phase === 'complete', 'complete');
      for (const p of st.players) expect(p.shownCards).toHaveLength(2);
    }
    expect(alice.logs.some((l) => l.text === 'Hand #1 — Alice has the button')).toBe(true);
    expect(alice.logs.some((l) => l.kind === 'win')).toBe(true);
    // the next hand starts automatically with the button moved
    const h2 = await alice.waitState((s) => s.hand?.handNumber === 2, 'hand 2');
    expect(h2.hand?.dealerSeat).toBe(1);
  });

  it('no client ever received another player\'s hole cards except via shownCards', () => {
    // hole cards per hand from each owner's own states
    const holes = new Map<string, Card[]>(); // `${hand}:${playerId}` -> cards
    for (const c of [alice, bob, carol]) {
      for (const s of c.states) {
        if (s.hand && s.me.holeCards) holes.set(`${s.hand.handNumber}:${s.me.playerId}`, s.me.holeCards);
      }
    }
    expect(holes.size).toBeGreaterThanOrEqual(6);
    let checked = 0;
    for (const c of [alice, bob, carol]) {
      for (const s of c.states) {
        if (!s.hand) continue;
        const text = hiddenCardStrings(s);
        for (const [key, cards] of holes) {
          const [hand, pid] = key.split(':');
          if (Number(hand) !== s.hand.handNumber || pid === s.me.playerId) continue;
          for (const card of cards) expect(text.includes(`"${card}"`)).toBe(false);
          checked++;
        }
        if (s.hand.phase === 'betting') {
          for (const p of s.players) if (p.id !== s.me.playerId) expect(p.shownCards).toBeNull();
        }
      }
      // logs and chat never carry face-down cards either (only showdown reveals happened)
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('reconnecting with the token restores the seat and cards', async () => {
    const before = carol.state;
    carol.close();
    await alice.waitState((s) => s.players.find((p) => p.id === ids.carol)?.connected === false, 'carol offline');
    const carol2 = await new TestClient().connected();
    const r = await carol2.ok<{ token: string; playerId: string }>('room:join', { roomId, token: tokens.carol });
    expect(r).toEqual({ token: tokens.carol, playerId: ids.carol });
    const s = await carol2.waitState((v) => v.me.playerId === ids.carol, 'carol state');
    expect(s.me.seat).toBe(2);
    expect(carol2.histories).toHaveLength(1);
    expect(carol2.histories[0]!.log.length).toBeGreaterThan(5);
    if (before.hand && s.hand && before.hand.handNumber === s.hand.handNumber && before.me.holeCards) {
      expect(s.me.holeCards).toEqual(before.me.holeCards);
    }
    await alice.waitState((v) => v.players.find((p) => p.id === ids.carol)?.connected === true, 'carol online');
    carol = carol2;
    // a second tab for the same player also receives state
    const tab2 = await new TestClient().connected();
    await tab2.ok('room:join', { roomId, token: tokens.carol });
    await carol.ok('chat:send', { text: 'two tabs' });
    await until(() => tab2.chats.some((m) => m.text === 'two tabs'), 3000, 'tab2 chat');
    await tab2.waitState((v) => v.me.playerId === ids.carol, 'tab2 state');
    tab2.close();
  });

  it('invalid payloads get ack errors and the server survives', async () => {
    const stranger = await new TestClient().connected();
    expect(await stranger.emit('seat:take', { seat: 1 })).toEqual({ ok: false, error: 'Join a room first' });
    expect(await stranger.emit('room:join', 42)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await stranger.emit('room:join', { roomId: 'ZZZZZZ', name: 'X' })).toEqual({
      ok: false,
      error: 'Room not found — check the link or code',
    });
    expect(await stranger.emit('room:join', { roomId, token: 'bogus' })).toEqual({
      ok: false,
      error: 'Your session for this room has expired — enter a name to join again',
    });
    expect((await stranger.emit('room:create', { name: '' })).ok).toBe(false);
    expect(await stranger.emit('room:create', { name: 'X', settings: { bigBlind: 'huge' } })).toEqual({
      ok: false,
      error: 'Big blind must be a number',
    });
    expect((await stranger.emit('room:create', { name: 'X', settings: { smallBlind: 50, bigBlind: 10 } })).ok).toBe(false);

    expect(await alice.emit('seat:take', { seat: 'x' })).toEqual({ ok: false, error: 'Pick a seat' });
    expect(await alice.emit('game:action', null)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await alice.emit('game:action', { type: 'dance' })).toEqual({ ok: false, error: 'Unknown action' });
    expect((await alice.emit('host:updateSettings', { buyIn: 5000 })).ok).toBe(false); // locked
    expect(await alice.emit('buyback:vote', { voteId: 'nope', approve: true })).toEqual({ ok: false, error: 'That vote is over' });
    expect((await alice.emit('chat:send', { text: 'x'.repeat(5000) })).ok).toBe(false);
    expect((await alice.emit('host:kick', { playerId: 123 })).ok).toBe(false);
    expect((await alice.emit('player:sitOut', { sittingOut: 'yes' })).ok).toBe(false);

    // no ack callback, bare function as payload, unknown events, garbage
    (alice.socket.emit as unknown as (e: string, p?: unknown) => void).call(alice.socket, 'host:start', {});
    (alice.socket.emit as unknown as (e: string, p?: unknown) => void).call(alice.socket, 'game:action');
    (alice.socket.emit as unknown as (e: string, p?: unknown) => void).call(alice.socket, 'nonsense', { a: 1 });
    // ack passed as the only argument: treated as an empty payload
    const bare = await new Promise<AckResponse>((resolve) =>
      (alice.socket.emit as unknown as (e: string, cb: (r: AckResponse) => void) => void).call(
        alice.socket,
        'buyback:request',
        resolve,
      ),
    );
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.error).toMatch(/out of chips|hand is over/);

    const health = await fetch(`${url}/api/health`);
    expect(await health.json()).toEqual({ ok: true });
    await alice.ok('chat:send', { text: 'still alive' });
    stranger.close();
  });

  it('per-socket event rate limit with the default limits (burst ~20)', async () => {
    const s2 = createAppServer({ clientDir: null });
    const port = await s2.listen(0);
    const c = ioc(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise<void>((r) => c.once('connect', () => r()));
    const results = await Promise.all(
      Array.from({ length: 30 }, () => new Promise<AckResponse>((r) => c.emit('seat:leave', {}, r))),
    );
    const limited = results.filter((r) => !r.ok && r.error === 'Slow down a little — too many requests').length;
    expect(limited).toBeGreaterThanOrEqual(8);
    expect(results.filter((r) => !r.ok && r.error === 'Join a room first').length).toBeGreaterThanOrEqual(19);
    c.close();
    await s2.close();
  });

  it('chat is rate limited (5 messages / 5 s)', async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) results.push((await bob.emit('chat:send', { text: `m${i}` })).ok);
    expect(results).toEqual([true, true, true, true, true, false]);
    const r = await bob.emit('chat:send', { text: 'again' });
    expect(r).toEqual({ ok: false, error: 'You’re sending messages too fast — wait a moment' });
  });

  it('buy-back request reaches voters and resolves over sockets; kick notifies the kicked player', async () => {
    // Bust Bob quickly: pause, wait for the hand in progress to end, then rematch so stacks are known
    await alice.ok('host:pause', {});
    const byId: Record<string, TestClient> = { [ids.alice]: alice, [ids.bob]: bob, [ids.carol]: carol };
    const current = alice.state.hand;
    if (current && current.phase !== 'complete') await playHand([alice, bob, carol], current.handNumber);
    await alice.waitState((s) => s.hand === null, 'table cleared');
    await alice.ok('host:rematch', {});
    await alice.waitState((s) => s.status === 'lobby' && s.ledger.every((r) => r.stack === 1000), 'rematch');
    await alice.ok('host:start', {});
    // hand 1 of the new game, dealer seat 0 (Alice): UTG is Alice
    await alice.waitState((s) => s.hand?.handNumber === 1 && s.hand.toActPlayerId === ids.alice, 'alice to act');
    await alice.ok('game:action', { type: 'allin' });
    await bob.waitState((s) => s.me.legal !== null, 'bob to act');
    await bob.ok('game:action', { type: 'allin' });
    await carol.waitState((s) => s.me.legal !== null, 'carol to act');
    await carol.ok('game:action', { type: 'fold' });
    const end = await alice.waitState((s) => s.hand?.phase === 'complete', 'all-in hand over');
    expect(end.players.find((p) => p.id === ids.bob)).toMatchObject({ stack: 0, busted: true });
    const loserId = ids.bob;
    const loser = byId[loserId]!;
    const voters = Object.values(byId).filter((c) => c !== loser);
    await loser.waitState((s) => s.me.canRequestBuyBack, 'can request');
    const { voteId } = await loser.ok<{ voteId: string }>('buyback:request', {});
    for (const v of voters) {
      await v.waitState((s) => s.me.votesAwaitingMe.includes(voteId), 'vote awaiting');
      await v.ok('buyback:vote', { voteId, approve: true });
    }
    const after = await loser.waitState(
      (s) => s.buyBackVotes.some((v) => v.id === voteId && v.status === 'approved'),
      'approved',
    );
    expect(after.ledger.find((r) => r.playerId === loserId)).toMatchObject({ buyIns: 2, totalBuyIn: 2000 });
    expect(loser.notices.some((n) => n.kind === 'success' && n.text.includes('back in'))).toBe(true);
    expect(alice.chats.some((m) => m.system && m.text.includes('everyone agreed'))).toBe(true);

    // kick Carol
    await alice.ok('host:kick', { playerId: ids.carol });
    await until(() => carol.kicked, 3000, 'kicked event');
    expect(carol.kicked).toBe('The host removed you from the table');
    expect(await carol.emit('chat:send', { text: 'hello?' })).toEqual({ ok: false, error: 'Join a room first' });
    const rejoin = await carol.emit('room:join', { roomId, token: tokens.carol });
    expect(rejoin.ok).toBe(false);
    await alice.waitState((s) => !s.players.some((p) => p.id === ids.carol), 'carol gone');
  });

  it('a socket is in at most one room: creating another room leaves the first', async () => {
    const dan = await new TestClient().connected();
    const j = await dan.ok<{ playerId: string }>('room:join', { roomId, name: 'Dan' });
    await alice.waitState((s) => s.players.some((p) => p.id === j.playerId && p.connected), 'dan visible');
    const other = await dan.ok<{ roomId: string }>('room:create', { name: 'Dan' });
    expect(other.roomId).not.toBe(roomId);
    // Dan (a spectator) is now offline in the first room, so he is no longer listed there
    await alice.waitState((s) => !s.players.some((p) => p.id === j.playerId), 'dan gone from room 1');
    await dan.waitState((s) => s.roomId === other.roomId, 'dan in room 2');
    const before = dan.states.length;
    await alice.ok('chat:send', { text: 'only room 1' });
    await sleep(50);
    expect(dan.chats.some((m) => m.text === 'only room 1')).toBe(false);
    expect(dan.states.slice(before).every((st) => st.roomId === other.roomId)).toBe(true);
    dan.close();
  });

  it('room:leave detaches the socket and keeps the ledger row', async () => {
    await bob.ok('room:leave', {});
    await alice.waitState((s) => s.ledger.find((r) => r.playerId === ids.bob)?.inRoom === false, 'bob left');
    expect(await bob.emit('seat:leave', {})).toEqual({ ok: false, error: 'Join a room first' });
    const back = await bob.ok<{ playerId: string }>('room:join', { roomId, token: tokens.bob });
    expect(back.playerId).toBe(ids.bob);
    await bob.waitState((s) => s.me.seat === null && s.ledger.find((r) => r.playerId === ids.bob)?.inRoom === true, 'bob back');
  });
});

describe('limits that hold across sockets', () => {
  let s2: AppServerHandle;
  let url2: string;
  const mine: ClientSocket<ServerToClientEvents, ClientToServerEvents>[] = [];

  beforeAll(async () => {
    s2 = createAppServer({
      clientDir: null,
      trustProxyHops: 1,
      socketLimits: {
        burst: 500,
        perSecond: 500,
        chatMessages: 5,
        chatWindowMs: 5000,
        createsPerWindow: 3,
        createWindowMs: 60_000,
        newPlayersPerMinute: 4,
        seatChangesPerMinute: 4,
        seatChangesPerAddressPerMinute: 6,
      },
      timing: { disconnectActGraceMs: 30_000 },
    });
    url2 = `http://127.0.0.1:${await s2.listen(0)}`;
  });
  afterAll(async () => {
    for (const c of mine) c.close();
    await s2.close();
  });

  /** A raw client claiming to come from `ip` (the test server trusts one proxy hop). */
  async function client(ip = '203.0.113.7') {
    const c = ioc(url2, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { 'x-forwarded-for': ip } });
    mine.push(c);
    await new Promise<void>((r) => c.once('connect', () => r()));
    const emit = <T,>(event: string, payload?: unknown) =>
      new Promise<AckResponse<T>>((resolve) =>
        (c.emit as unknown as (e: string, p: unknown, cb: (r: AckResponse<T>) => void) => void).call(c, event, payload, resolve),
      );
    return { c, emit };
  }

  it('room creation is limited per client address, not per connection', async () => {
    const results: AckResponse<{ roomId: string }>[] = [];
    for (let i = 0; i < 4; i++) {
      const { emit } = await client('198.51.100.1');
      results.push(await emit('room:create', { name: `Spam ${i}` }));
    }
    expect(results.slice(0, 3).every((r) => r.ok)).toBe(true);
    expect(results[3]).toEqual({ ok: false, error: 'You’re creating tables too fast — wait a few minutes' });
    // spoofed entries to the left of the trusted hop do not buy a new budget
    const spoof = await client('10.0.0.99, 198.51.100.1');
    expect((await spoof.emit('room:create', { name: 'Spam' })).ok).toBe(false);
    // somebody else is not affected
    const other = await client('198.51.100.2');
    expect((await other.emit('room:create', { name: 'Real host' })).ok).toBe(true);
  });

  it('chat rate limit is per player, shared by all of their tabs', async () => {
    const host = await client('192.0.2.10');
    const created = await host.emit<{ roomId: string; token: string }>('room:create', { name: 'Host' });
    if (!created.ok) throw new Error(created.error);
    const { roomId, token } = created.data;
    const tabs = [host];
    for (let i = 0; i < 2; i++) {
      const tab = await client('192.0.2.10');
      expect((await tab.emit('room:join', { roomId, token })).ok).toBe(true);
      tabs.push(tab);
    }
    const results: AckResponse<unknown>[] = [];
    for (let i = 0; i < 6; i++) results.push(await tabs[i % 3]!.emit('chat:send', { text: `m${i}` }));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, true, true, false]);
    expect(results[5]).toEqual({ ok: false, error: 'You’re sending messages too fast — wait a moment' });
  });

  it('new identities from one address are limited per room; the chat history survives', async () => {
    const host = await client('192.0.2.20');
    const created = await host.emit<{ roomId: string }>('room:create', { name: 'Host' });
    if (!created.ok) throw new Error(created.error);
    const { roomId } = created.data;
    await host.emit('chat:send', { text: 'real message' });
    const results: AckResponse<{ token: string }>[] = [];
    const flood = await client('192.0.2.99');
    for (let i = 0; i < 8; i++) results.push(await flood.emit('room:join', { roomId, name: `you suck ${i}` }));
    expect(results.filter((r) => r.ok)).toHaveLength(4);
    expect(results.at(-1)).toEqual({ ok: false, error: 'Too many people joined from your network — wait a minute' });
    // a known token (reconnect) is never limited
    const first = results[0]!;
    if (!first.ok) throw new Error('first join failed');
    expect((await flood.emit('room:join', { roomId, token: first.data.token })).ok).toBe(true);
    const room = s2.rooms.get(roomId)!;
    expect(room.history().chat.map((m) => m.text)).toEqual(['real message']);
    // a friend on another network can still join
    const friend = await client('192.0.2.21');
    expect((await friend.emit('room:join', { roomId, name: 'Friend' })).ok).toBe(true);
  });

  it('seat and name changes are limited per player and per address, so the hand log cannot be flooded', async () => {
    const host = await client('192.0.2.50');
    const created = await host.emit<{ roomId: string }>('room:create', { name: 'Host' });
    if (!created.ok) throw new Error(created.error);
    const { roomId } = created.data;
    const a = await client('192.0.2.51');
    expect((await a.emit('room:join', { roomId, name: 'Flip' })).ok).toBe(true);
    const flips: boolean[] = [];
    for (let i = 0; i < 5; i++) flips.push((await a.emit(i % 2 ? 'seat:leave' : 'seat:take', { seat: 3 })).ok);
    expect(flips).toEqual([true, true, true, true, false]);
    expect(await a.emit('player:rename', { name: 'Flop' })).toEqual({ ok: false, error: 'Slow down a little — too many changes' });
    // a second identity from the same address shares the address budget (6): 2 more changes
    const b = await client('192.0.2.51');
    expect((await b.emit('room:join', { roomId, name: 'Flap' })).ok).toBe(true);
    expect((await b.emit('player:rename', { name: 'Flap 1' })).ok).toBe(true);
    expect((await b.emit('player:rename', { name: 'Flap 2' })).ok).toBe(true);
    expect((await b.emit('player:rename', { name: 'Flap 3' })).ok).toBe(false);
    // someone else at the table is unaffected
    expect((await host.emit('player:rename', { name: 'Hostess' })).ok).toBe(true);
  });

  it('a kicked device gets a distinct error, even when it also sends a name', async () => {
    const host = await client('192.0.2.30');
    const created = await host.emit<{ roomId: string }>('room:create', { name: 'Host' });
    if (!created.ok) throw new Error(created.error);
    const { roomId } = created.data;
    const bob = await client('192.0.2.31');
    const j = await bob.emit<{ token: string; playerId: string }>('room:join', { roomId, name: 'Bob' });
    if (!j.ok) throw new Error(j.error);
    expect((await host.emit('host:kick', { playerId: j.data.playerId })).ok).toBe(true);
    expect(await bob.emit('room:join', { roomId, token: j.data.token })).toEqual({ ok: false, error: KICKED_ERROR });
    expect(await bob.emit('room:join', { roomId, token: j.data.token, name: 'Bobby' })).toEqual({ ok: false, error: KICKED_ERROR });
  });

  it('room:detach keeps the seat but counts the player as away (auto-act grace, host hand-over)', async () => {
    const host = await client('192.0.2.40');
    const created = await host.emit<{ roomId: string; playerId: string }>('room:create', {
      name: 'Host',
      settings: { turnTimeSec: 0 },
    });
    if (!created.ok) throw new Error(created.error);
    const { roomId, playerId: hostId } = created.data;
    const bob = await client('192.0.2.41');
    const states: RoomView[] = [];
    bob.c.on('state', (s) => states.push(s));
    const j = await bob.emit<{ playerId: string }>('room:join', { roomId, name: 'Bob' });
    if (!j.ok) throw new Error(j.error);
    expect((await bob.emit('seat:take', { seat: 1 })).ok).toBe(true);
    expect((await host.emit('host:start', {})).ok).toBe(true);
    // heads-up preflop: the button (small blind) acts first; make it the host's turn
    await until(() => states.at(-1)?.hand?.handNumber === 1, 3000, 'hand 1');
    if (states.at(-1)!.hand!.toActPlayerId !== hostId) {
      expect((await bob.emit('game:action', { type: 'call' })).ok).toBe(true);
    }
    await until(() => states.at(-1)?.hand?.toActPlayerId === hostId, 3000, 'host to act');
    expect(states.at(-1)!.hand!.turnDeadline).toBeNull(); // no shot clock, host connected
    expect((await host.emit('room:detach', {})).ok).toBe(true);
    const away = await until(
      () => {
        const s = states.at(-1);
        return s && s.players.find((p) => p.id === hostId)?.connected === false && s.hand?.turnDeadline ? s : null;
      },
      3000,
      'host away with a grace clock',
    );
    expect(away.hand!.turnDeadline! - away.serverTime).toBeGreaterThan(25_000);
    expect(away.seats[0]).toBe(hostId); // still seated
    // the detached socket is no longer in the room
    expect(await host.emit('chat:send', { text: 'hi' })).toEqual({ ok: false, error: 'Join a room first' });
  });
});

describe('WindowLimiter', () => {
  it('counts hits per key inside a sliding window and forgets idle keys', () => {
    const l = new WindowLimiter(2, 1000);
    expect([l.take('a', 0), l.take('a', 10), l.take('a', 20), l.take('b', 20)]).toEqual([true, true, false, true]);
    expect(l.take('a', 1000)).toBe(true); // the first hit left the window
    expect(l.allows('a', 1005)).toBe(false);
    l.prune(5000);
    expect(l.allows('a', 5000)).toBe(true);
    l.deleteWhere((k) => k === 'b');
    expect(l.take('b', 5001)).toBe(true);
  });
});

describe('client address', () => {
  it('normalizes IPv4, IPv4-mapped IPv6 and groups IPv6 by /64', () => {
    expect(addressKey('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(addressKey('203.0.113.9')).toBe('203.0.113.9');
    expect(addressKey('203.0.113.9:4567')).toBe('203.0.113.9');
    expect(addressKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:DB8:1:2:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64');
    expect(addressKey('[2001:db8::1]')).toBe('2001:db8:0:0::/64');
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
  });
  it('uses the right-most trusted X-Forwarded-For hop, never client-controlled entries', () => {
    const hs = (xff?: string) => ({ address: '10.1.1.1', headers: xff ? { 'x-forwarded-for': xff } : {} });
    expect(clientAddress(hs('1.2.3.4'), 0)).toBe('10.1.1.1');
    expect(clientAddress(hs('6.6.6.6, 1.2.3.4'), 1)).toBe('1.2.3.4');
    expect(clientAddress(hs('6.6.6.6, 1.2.3.4, 172.16.0.1'), 2)).toBe('1.2.3.4');
    expect(clientAddress(hs(), 1)).toBe('10.1.1.1');
  });
});
