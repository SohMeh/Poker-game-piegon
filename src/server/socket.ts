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
  /** Token bucket: burst size. */
  burst: number;
  /** Token bucket: refill per second. */
  perSecond: number;
  /** Chat: max messages per window. */
  chatMessages: number;
  chatWindowMs: number;
}

export const DEFAULT_SOCKET_LIMITS: SocketLimits = { burst: 20, perSecond: 10, chatMessages: 5, chatWindowMs: 5000 };

/** Max rooms one socket may create per minute. */
const CREATES_PER_MINUTE = 5;

export const KICK_REASON = 'The host removed you from the table';
const GENERIC_ERROR = 'Something went wrong — please try again';

type HandlerResult = { data?: object; after?: () => void } | void;
type Handler = (payload: unknown) => HandlerResult;

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
  limits: SocketLimits = DEFAULT_SOCKET_LIMITS,
): SocketLayer {
  /** roomId -> sockets attached to that room. */
  const members = new Map<string, Set<AppSocket>>();
  const channel = (roomId: string) => `room:${roomId}`;

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
    const chatTimes: number[] = [];
    const createTimes: number[] = [];

    const member = (): { room: Room; playerId: string } => {
      const { roomId, playerId } = socket.data;
      const room = roomId ? rooms.get(roomId) : undefined;
      if (!room || room.disposed || !playerId) throw new RoomError('Join a room first');
      return { room, playerId };
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
      const now = Date.now();
      while (createTimes.length && now - createTimes[0]! >= 60_000) createTimes.shift();
      if (createTimes.length >= CREATES_PER_MINUTE) throw new RoomError('You’re creating tables too fast — wait a minute');
      const room = rooms.create(p.settings);
      createTimes.push(now);
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
      const res = room.join({ token: p.token, name: p.name });
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

    // ---------------------------------------------------------- seats
    on('seat:take', (payload) => {
      const { seat } = parse(schemas.seatTake, payload);
      const { room, playerId } = member();
      return { data: room.takeSeat(playerId, seat) };
    });

    on('seat:leave', (payload) => {
      parse(schemas.empty, payload);
      const { room, playerId } = member();
      room.standUp(playerId);
    });

    on('player:sitOut', (payload) => {
      const { sittingOut } = parse(schemas.sitOut, payload);
      const { room, playerId } = member();
      room.setSitOut(playerId, sittingOut);
    });

    on('player:rename', (payload) => {
      const { name } = parse(schemas.rename, payload);
      const { room, playerId } = member();
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
      const now = Date.now();
      while (chatTimes.length && now - chatTimes[0]! >= limits.chatWindowMs) chatTimes.shift();
      if (chatTimes.length >= limits.chatMessages) {
        throw new RoomError('You’re sending messages too fast — wait a moment');
      }
      room.sendChat(playerId, text);
      chatTimes.push(now);
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
