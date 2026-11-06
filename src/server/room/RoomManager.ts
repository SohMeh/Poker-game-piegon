// Registry of live rooms + idle sweep.
import { TIMING, type Card, type GameSettings } from '../../shared';
import { newRoomId, normalizeRoomId } from './ids';
import { Room, RoomError, type Timing } from './Room';

export interface RoomManagerOptions {
  timing?: Partial<Timing>;
  now?: () => number;
  /** Max number of concurrent rooms. */
  maxRooms?: number;
  /** How often idle rooms are swept (ms). */
  sweepIntervalMs?: number;
  /** Test hooks forwarded to every room. */
  deckFactory?: (handNumber: number) => Card[] | undefined;
  rand?: () => number;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly opts: RoomManagerOptions;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly abandonedTtlMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** Called whenever any room changes (wired by the socket layer). */
  onRoomChange: ((room: Room) => void) | null = null;
  /** Called right before a room is deleted. */
  onRoomDeleted: ((room: Room) => void) | null = null;

  constructor(opts: RoomManagerOptions = {}) {
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
    this.ttlMs = opts.timing?.roomIdleTtlMs ?? TIMING.roomIdleTtlMs;
    this.abandonedTtlMs = Math.min(this.ttlMs, opts.timing?.abandonedRoomIdleTtlMs ?? TIMING.abandonedRoomIdleTtlMs);
    this.sweepTimer = setInterval(() => this.sweep(), opts.sweepIntervalMs ?? 60_000);
    (this.sweepTimer as { unref?: () => void }).unref?.();
  }

  /**
   * Creates a room. At the room cap, idle rooms make way first (expired ones, then the one that
   * has been empty longest, preferring tables that never dealt a hand); only when every room has
   * somebody connected is the request refused. So throwaway tables can never lock everyone out.
   */
  create(settings?: Partial<GameSettings>): Room {
    const max = this.opts.maxRooms ?? 5000;
    if (this.rooms.size >= max) this.sweep();
    if (this.rooms.size >= max && !this.evictIdle()) {
      throw new RoomError('The server is busy right now — try again in a bit');
    }
    let id = newRoomId();
    for (let i = 0; this.rooms.has(id); i++) {
      if (i > 50) throw new RoomError('Could not create a room — try again');
      id = newRoomId();
    }
    const room = new Room({
      id,
      settings,
      timing: this.opts.timing,
      now: this.opts.now,
      deckFactory: this.opts.deckFactory,
      rand: this.opts.rand,
      onChange: (r) => this.onRoomChange?.(r),
    });
    this.rooms.set(id, room);
    return room;
  }

  /** Case-insensitive lookup. */
  get(roomId: unknown): Room | undefined {
    const id = normalizeRoomId(roomId);
    return id ? this.rooms.get(id) : undefined;
  }

  delete(roomId: string): boolean {
    const id = normalizeRoomId(roomId);
    const room = id ? this.rooms.get(id) : undefined;
    if (!room || !id) return false;
    this.onRoomDeleted?.(room);
    room.dispose();
    this.rooms.delete(id);
    return true;
  }

  get size(): number {
    return this.rooms.size;
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  /**
   * Deletes rooms that have had no connected socket for roomIdleTtlMs (abandonedRoomIdleTtlMs for
   * a table where nothing ever happened). Returns deleted ids.
   */
  sweep(): string[] {
    const now = this.now();
    const deleted: string[] = [];
    for (const room of [...this.rooms.values()]) {
      if (room.connectedSockets() !== 0 || room.emptySince === null) continue;
      const ttl = room.isAbandoned() ? this.abandonedTtlMs : this.ttlMs;
      if (now - room.emptySince >= ttl) {
        this.delete(room.id);
        deleted.push(room.id);
      }
    }
    return deleted;
  }

  /** Deletes the idle room that should go first (see create). Returns false when none is idle. */
  private evictIdle(): boolean {
    let best: Room | null = null;
    const rank = (r: Room) => (r.hasDealt() ? 1 : 0);
    for (const room of this.rooms.values()) {
      if (room.connectedSockets() !== 0 || room.emptySince === null) continue;
      if (!best || rank(room) < rank(best) || (rank(room) === rank(best) && room.emptySince < best.emptySince!)) best = room;
    }
    if (!best) return false;
    this.delete(best.id);
    return true;
  }

  close(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }
}
