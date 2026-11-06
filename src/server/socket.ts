// Socket.IO event handlers: validation, rate limits, room membership, coalesced broadcasts.
import type { Server, Socket } from 'socket.io';
import type { AckResponse, ClientToServerEvents, RoomView, ServerToClientEvents } from '../shared';
import { Room, RoomError } from './room/Room';
import type { RoomManager } from './room/RoomManager';
import { parsePayload, schemas } from './room/validation';
import type { z } from 'zod';

export interface SocketData {
  roomId: string | null;
  playerId: string | null;
}

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface SocketLimits {
  /** Token bucket (per socket): burst size. */
  burst: number;
  /** Token bucket (per socket): refill per second. */
  perSecond: number;
  /** Chat: max messages per window, per player (shared by all of that player's sockets). */
  chatMessages: number;
  chatWindowMs: number;
  /** Rooms one client address may create per createWindowMs. */
  createsPerWindow?: number;
  createWindowMs?: number;
  /** New identities (name joins) one client address may create in one room per minute. */
  newPlayersPerMinute?: number;
  /** Seat take / stand up / sit out / rename changes per player per minute. */
  seatChangesPerMinute?: number;
  /** The same, summed over every player from one client address in one room. */
  seatChangesPerAddressPerMinute?: number;
}

export const DEFAULT_SOCKET_LIMITS: SocketLimits = {
  burst: 20,
  perSecond: 10,
  chatMessages: 5,
  chatWindowMs: 5000,
  createsPerWindow: 20,
  createWindowMs: 10 * 60_000,
  newPlayersPerMinute: 10,
  seatChangesPerMinute: 20,
  seatChangesPerAddressPerMinute: 30,
};

export interface SocketOptions {
  /**
   * Reverse proxies in front of the server that append to X-Forwarded-For (Render, a load
   * balancer…). 0 = use the TCP peer address. The client address is the entry this many hops from
   * the right; entries further left are client-controlled and never used.
   */
  trustProxyHops?: number;
}

export const KICK_REASON = 'The host removed you from the table';
const GENERIC_ERROR = 'Something went wrong — please try again';

type HandlerResult = { data?: object; after?: () => void } | void;
type Handler = (payload: unknown) => HandlerResult;

/** Sliding-window counter per key (rate limits shared across sockets). */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastPrune = 0;
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  /** Records a hit for `key` and returns true, or returns false when the key is over its limit. */
  take(key: string, now = Date.now()): boolean {
    if (!this.allows(key, now)) return false;
    this.hits.get(key)!.push(now);
    return true;
  }
  /** True when `key` may take another hit (does not record one). */
  allows(key: string, now = Date.now()): boolean {
    let list = this.hits.get(key);
    if (!list) {
      // forget idle keys now and then, so the map stays small without a timer
      if (this.hits.size >= 5000 && now - this.lastPrune >= 1000) this.prune(now);
      this.hits.set(key, (list = []));
    }
    while (list.length && now - list[0]! >= this.windowMs) list.shift();
    return list.length < this.max;
  }
  record(key: string, now = Date.now()): void {
    const list = this.hits.get(key);
    if (list) list.push(now);
    else this.hits.set(key, [now]);
  }
  /** Drops keys whose hits have all expired. */
  prune(now = Date.now()): void {
    this.lastPrune = now;
    for (const [k, list] of this.hits) if (!list.length || now - list[list.length - 1]! >= this.windowMs) this.hits.delete(k);
  }
  deleteWhere(pred: (key: string) => boolean): void {
    for (const k of [...this.hits.keys()]) if (pred(k)) this.hits.delete(k);
  }
}

/**
 * Rate-limit key for an IP address: IPv4 as is (IPv4-mapped IPv6 unwrapped), IPv6 by its /64
 * (one subscriber usually owns a whole /64, so per-address limits must not be per /128).
 */
export function addressKey(raw: string): string {
  let a = raw.trim().toLowerCase();
  if (a.startsWith('[')) a = a.slice(1, a.indexOf(']') > 0 ? a.indexOf(']') : undefined);
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.exec(a);
  if (v4) return v4[1]!;
  if (a.includes(':')) {
    const [head = '', tail] = a.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const groups = tail === undefined ? h : [...h, ...new Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    if (groups.length >= 4 && groups.slice(0, 4).every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
      return `${groups
        .slice(0, 4)
        .map((g) => parseInt(g, 16).toString(16))
        .join(':')}::/64`;
    }
  }
  return a || 'unknown';
}

/** The client's address as seen through `trustProxyHops` trusted proxies (see SocketOptions). */
export function clientAddress(
  handshake: { address: string; headers: Record<string, string | string[] | undefined> },
  trustProxyHops = 0,
): string {
  if (trustProxyHops > 0) {
    const raw = handshake.headers['x-forwarded-for'];
    const list = (Array.isArray(raw) ? raw.join(',') : (raw ?? ''))
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    const entry = list[list.length - trustProxyHops];
    if (entry) return addressKey(entry);
  }
  return addressKey(handshake.address ?? '');
}

class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
  ) {
    this.tokens = capacity;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const r = parsePayload(schema, payload);
  if (!r.ok) throw new RoomError(r.error);
  return r.data;
}

export interface SocketLayer {
  /** Sends any pending broadcasts right away (tests / shutdown). */
  flushNow(): void;
}

export function registerSocketHandlers(
  io: AppServer,
  rooms: RoomManager,
  limitsIn: SocketLimits = DEFAULT_SOCKET_LIMITS,
  opts: SocketOptions = {},
): SocketLayer {
  const limits = { ...DEFAULT_SOCKET_LIMITS, ...limitsIn } as Required<SocketLimits>;
  /** roomId -> sockets attached to that room. */
  const members = new Map<string, Set<AppSocket>>();
  const channel = (roomId: string) => `room:${roomId}`;

  // Rate limits that must hold across sockets: a client opening many connections (or one player
  // on several tabs) shares one budget. Keys: client address, or `${roomId}:${playerId}`.
  const createLimiter = new WindowLimiter(limits.createsPerWindow, limits.createWindowMs);
  const newPlayerLimiter = new WindowLimiter(limits.newPlayersPerMinute, 60_000);
  const chatLimiter = new WindowLimiter(limits.chatMessages, limits.chatWindowMs);
  const seatLimiter = new WindowLimiter(limits.seatChangesPerMinute, 60_000);
  const seatAddressLimiter = new WindowLimiter(limits.seatChangesPerAddressPerMinute, 60_000);
  const playerKey = (roomId: string, playerId: string) => `${roomId}:${playerId}`;

  // ------------------------------------------------------------ coalesced broadcast
  const dirty = new Set<Room>();
  let scheduled = false;

  rooms.onRoomChange = (room) => {
    dirty.add(room);
    if (!scheduled) {
      scheduled = true;
      setImmediate(flushAll);
    }
  };
  rooms.onRoomDeleted = (room) => {
    const set = members.get(room.id);
    if (set) for (const s of set) {
      s.data.roomId = null;
      s.data.playerId = null;
      void s.leave(channel(room.id));
    }
    members.delete(room.id);
    dirty.delete(room);
    const prefix = `${room.id}:`;
    for (const l of [newPlayerLimiter, chatLimiter, seatLimiter, seatAddressLimiter]) l.deleteWhere((k) => k.startsWith(prefix));
  };

  function flushAll(): void {
    scheduled = false;
    const list = [...dirty];
    dirty.clear();
    for (const room of list) {
      try {
        flushRoom(room);
      } catch (err) {
        console.error(`[socket] broadcast for room ${room.id} failed`, err);
      }
    }
  }

  function flushRoom(room: Room): void {
    const out = room.drainOutbox();
    if (room.disposed) return;
    const sockets = [...(members.get(room.id) ?? [])];
    if (sockets.length === 0) return;
    for (const s of sockets) {
      if (out.log.length) s.emit('log', out.log);
      for (const m of out.chat) s.emit('chat', m);
    }
    for (const n of out.notices) {
      for (const s of sockets) if (s.data.playerId === n.playerId) s.emit('notice', n.notice);
    }
    const views = new Map<string, RoomView | null>();
    for (const s of sockets) {
      const pid = s.data.playerId;
      if (!pid) continue;
      let view = views.get(pid);
      if (view === undefined) {
        try {
          view = room.viewFor(pid);
        } catch {
          view = null;
        }
        views.set(pid, view);
      }
      if (view) s.emit('state', view);
    }
  }

  // ------------------------------------------------------------ membership helpers
  function attachSocket(socket: AppSocket, room: Room, playerId: string): void {
    if (socket.data.roomId === room.id && socket.data.playerId === playerId) return;
    detachSocket(socket);
    socket.data.roomId = room.id;
    socket.data.playerId = playerId;
    void socket.join(channel(room.id));
    let set = members.get(room.id);
    if (!set) members.set(room.id, (set = new Set()));
    set.add(socket);
    room.attach(playerId);
  }

  function detachSocket(socket: AppSocket): void {
    const { roomId, playerId } = socket.data;
    if (!roomId) return;
    socket.data.roomId = null;
    socket.data.playerId = null;
    void socket.leave(channel(roomId));
    const set = members.get(roomId);
    if (set) {
      set.delete(socket);
      if (set.size === 0) members.delete(roomId);
    }
    const room = rooms.get(roomId);
    if (room && playerId && !room.disposed) room.detach(playerId);
  }

  function socketsOf(roomId: string, playerId: string): AppSocket[] {
    return [...(members.get(roomId) ?? [])].filter((s) => s.data.playerId === playerId);
  }

  // ------------------------------------------------------------ connection
  io.on('connection', (rawSocket) => {
    const socket = rawSocket as AppSocket;
    socket.data = { roomId: null, playerId: null };
    const bucket = new TokenBucket(limits.burst, limits.perSecond);
    const address = clientAddress(socket.handshake, opts.trustProxyHops ?? 0);

    const member = (): { room: Room; playerId: string } => {
      const { roomId, playerId } = socket.data;
      const room = roomId ? rooms.get(roomId) : undefined;
      if (!room || room.disposed || !playerId) throw new RoomError('Join a room first');
      return { room, playerId };
    };

    /**
     * Seat / name changes write log lines for everyone: a budget per player, and one per client
     * address (many throwaway identities from one phone share it), keep the hand log readable.
     */
    const seatChange = (room: Room, playerId: string) => {
      const pk = playerKey(room.id, playerId);
      const ak = `${room.id}:${address}`;
      if (!seatLimiter.allows(pk) || !seatAddressLimiter.allows(ak)) throw new RoomError('Slow down a little — too many changes');
      seatLimiter.record(pk);
      seatAddressLimiter.record(ak);
    };

    const on = (event: keyof ClientToServerEvents, handler: Handler) => {
      (socket as unknown as { on(ev: string, fn: (...args: unknown[]) => void): void }).on(event, (...args) => {
        let payload: unknown = args[0];
        let ack: unknown = args[1];
        if (typeof payload === 'function' && ack === undefined) {
          ack = payload;
          payload = undefined;
        }
        const reply = (res: AckResponse<object>) => {
          if (typeof ack !== 'function') return;
          try {
            (ack as (r: AckResponse<object>) => void)(res);
          } catch (err) {
            console.error(`[socket] ack for ${event} threw`, err);
          }
        };
        try {
          if (!bucket.take()) {
            reply({ ok: false, error: 'Slow down a little — too many requests' });
            return;
          }
          const result = handler(payload);
          reply({ ok: true, data: (result && result.data) ?? {} });
          if (result && result.after) result.after();
        } catch (err) {
          if (err instanceof RoomError) {
            reply({ ok: false, error: err.message });
          } else {
            console.error(`[socket] ${event} failed`, err);
            reply({ ok: false, error: GENERIC_ERROR });
          }
        }
      });
    };

    // ---------------------------------------------------------- rooms
    on('room:create', (payload) => {
      const p = parse(schemas.createRoom, payload);
      // per client address, not per socket: reconnecting must not reset the budget
      if (!createLimiter.allows(address)) throw new RoomError('You’re creating tables too fast — wait a few minutes');
      const room = rooms.create(p.settings);
      createLimiter.record(address);
      const { playerId, token } = room.addHost(p.name);
      attachSocket(socket, room, playerId);
      return {
        data: { roomId: room.id, token, playerId },
        after: () => socket.emit('history', room.history()),
      };
    });

    on('room:join', (payload) => {
      const p = parse(schemas.joinRoom, payload);
      const room = rooms.get(p.roomId);
      if (!room || room.disposed) throw new RoomError('Room not found — check the link or code');
      const known = p.token ? room.playerIdForToken(p.token) : null;
      const newKey = `${room.id}:${address}`;
      if (!known && p.name !== undefined && !newPlayerLimiter.allows(newKey)) {
        throw new RoomError('Too many people joined from your network — wait a minute');
      }
      const res = room.join({ token: p.token, name: p.name });
      if (!res.reconnected) newPlayerLimiter.record(newKey);
      attachSocket(socket, room, res.playerId);
      rooms.onRoomChange?.(room);
      return {
        data: { token: res.token, playerId: res.playerId },
        after: () => socket.emit('history', room.history()),
      };
    });

    on('room:leave', (payload) => {
      parse(schemas.empty, payload);
      const { room, playerId } = member();
      room.leave(playerId);
      for (const s of socketsOf(room.id, playerId)) detachSocket(s);
    });

    // This tab stopped showing the room (went back home / to another room): the player keeps
    // their seat and stack, but counts as away exactly as if the connection had dropped.
    on('room:detach', (payload) => {
      parse(schemas.empty, payload);
      detachSocket(socket);
    });

    // ---------------------------------------------------------- seats
    on('seat:take', (payload) => {
      const { seat } = parse(schemas.seatTake, payload);
      const { room, playerId } = member();
      seatChange(room, playerId);
      return { data: room.takeSeat(playerId, seat) };
    });

    on('seat:leave', (payload) => {
      parse(schemas.empty, payload);
      const { room, playerId } = member();
      seatChange(room, playerId);
      room.standUp(playerId);
    });

    on('player:sitOut', (payload) => {
      const { sittingOut } = parse(schemas.sitOut, payload);
      const { room, playerId } = member();
      seatChange(room, playerId);
      room.setSitOut(playerId, sittingOut);
    });

    on('player:rename', (payload) => {
      const { name } = parse(schemas.rename, payload);
      const { room, playerId } = member();
      seatChange(room, playerId);
      room.rename(playerId, name);
    });

    // ---------------------------------------------------------- play
    on('game:action', (payload) => {
      const a = parse(schemas.action, payload);
      const { room, playerId } = member();
      room.act(playerId, a.amount === undefined ? { type: a.type } : { type: a.type, amount: a.amount });
    });

    on('game:showCards', (payload) => {
      parse(schemas.empty, payload);
      const { room, playerId } = member();
      room.showCards(playerId);
    });

    // ---------------------------------------------------------- buy-back
    on('buyback:request', (payload) => {
      parse(schemas.empty, payload);
      const { room, playerId } = member();
      return { data: room.requestBuyBack(playerId) };
    });

    on('buyback:vote', (payload) => {
      const { voteId, approve } = parse(schemas.vote, payload);
      const { room, playerId } = member();
      room.voteBuyBack(playerId, voteId, approve);
    });

    on('buyback:cancel', (payload) => {
      const { voteId } = parse(schemas.voteRef, payload);
      const { room, playerId } = member();
      room.cancelBuyBack(playerId, voteId);
    });

    // ---------------------------------------------------------- chat
    on('chat:send', (payload) => {
      const { text } = parse(schemas.chat, payload);
      const { room, playerId } = member();
      const key = playerKey(room.id, playerId);
      if (!chatLimiter.allows(key)) throw new RoomError('You’re sending messages too fast — wait a moment');
      room.sendChat(playerId, text);
      chatLimiter.record(key);
    });

    // ---------------------------------------------------------- host
    on('host:start', (payload) => {
      parse(schemas.empty, payload);
      const { room, playerId } = member();
      room.start(playerId);
    });

    on('host:pause', (payload) => {
      parse(schemas.empty, payload);
      const { room, playerId } = member();
      room.pause(playerId);
    });

    on('host:resume', (payload) => {
      parse(schemas.empty, payload);
      const { room, playerId } = member();
      room.resume(playerId);
    });

    on('host:updateSettings', (payload) => {
      const patch = parse(schemas.settings, payload);
      const { room, playerId } = member();
      room.updateSettings(playerId, patch);
    });

    on('host:approveSeat', (payload) => {
      const { playerId: target, approve } = parse(schemas.approveSeat, payload);
      const { room, playerId } = member();
      room.approveSeat(playerId, target, approve);
    });

    on('host:kick', (payload) => {
      const { playerId: target } = parse(schemas.playerRef, payload);
      const { room, playerId } = member();
      room.kick(playerId, target);
      for (const s of socketsOf(room.id, target)) {
        s.emit('kicked', { reason: KICK_REASON });
        detachSocket(s);
      }
    });

    on('host:transfer', (payload) => {
      const { playerId: target } = parse(schemas.playerRef, payload);
      const { room, playerId } = member();
      room.transferHost(playerId, target);
    });

    on('host:rematch', (payload) => {
      parse(schemas.empty, payload);
      const { room, playerId } = member();
      room.rematch(playerId);
    });

    socket.on('disconnect', () => {
      try {
        detachSocket(socket);
      } catch (err) {
        console.error('[socket] disconnect cleanup failed', err);
      }
    });
  });

  return { flushNow: flushAll };
}
