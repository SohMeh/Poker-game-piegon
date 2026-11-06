// Helpers for Room tests (not used at runtime).
import { vi } from 'vitest';
import type { Card, GameSettings, PlayerAction, RoomView } from '../../shared';
import { dealOrder, stackedDeck } from '../engine';
import { Room } from './Room';

export const cards = (s: string): Card[] => (s.trim() ? (s.trim().split(/\s+/) as Card[]) : []);

/** Deck that deals `holeBySeat` (seat -> "As Kd") and `board` for the given seats and dealer. */
export function deckFor(seats: number[], dealer: number, holeBySeat: Record<number, string>, board = ''): Card[] {
  return stackedDeck(
    dealOrder(seats, dealer).map((s) => cards(holeBySeat[s] ?? '')),
    cards(board),
  );
}

export interface TableOptions {
  names?: string[];
  settings?: Partial<GameSettings>;
  /** handNumber -> deck */
  decks?: Record<number, Card[]>;
  /** default: always picks the lowest seat for the first button */
  rand?: () => number;
}

export interface Table {
  room: Room;
  /** player ids in seat order (seat i = ids[i]) */
  ids: string[];
  tokens: string[];
  view(id?: string): RoomView;
  act(id: string, type: PlayerAction['type'], amount?: number): void;
  toAct(): string | null;
  name(id: string): string;
}

/** Room with N seated, connected players at seats 0..N-1 (first is the host). */
export function makeTable(opts: TableOptions = {}): Table {
  const names = opts.names ?? ['Alice', 'Bob', 'Carol'];
  const room = new Room({
    id: 'ABCDEF',
    settings: { turnTimeSec: 0, ...opts.settings },
    deckFactory: (n) => opts.decks?.[n],
    rand: opts.rand ?? (() => 0),
  });
  const ids: string[] = [];
  const tokens: string[] = [];
  const host = room.addHost(names[0]!);
  room.attach(host.playerId);
  ids.push(host.playerId);
  tokens.push(host.token);
  for (let i = 1; i < names.length; i++) {
    const j = room.join({ name: names[i]! });
    room.attach(j.playerId);
    room.takeSeat(j.playerId, i);
    ids.push(j.playerId);
    tokens.push(j.token);
  }
  const t: Table = {
    room,
    ids,
    tokens,
    view: (id = ids[0]!) => room.viewFor(id),
    act: (id, type, amount) => room.act(id, amount === undefined ? { type } : { type, amount }),
    toAct: () => room.viewFor(ids[0]!).hand?.toActPlayerId ?? null,
    name: (id) => room.viewFor(ids[0]!).players.find((p) => p.id === id)?.name ?? '?',
  };
  return t;
}

/** Advances fake time in small steps until `pred()` holds (throws after maxMs). */
export function advanceUntil(pred: () => boolean, maxMs = 60_000, stepMs = 100): void {
  let waited = 0;
  while (!pred()) {
    if (waited >= maxMs) throw new Error(`condition not met after ${maxMs}ms`);
    vi.advanceTimersByTime(stepMs);
    waited += stepMs;
  }
}

export function player(view: RoomView, id: string) {
  const p = view.players.find((x) => x.id === id);
  if (!p) throw new Error(`player ${id} not visible`);
  return p;
}
