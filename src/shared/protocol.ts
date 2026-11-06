// Socket.IO contract. Every client->server event takes a payload and an ack callback.
import type { ChatMessage, GameSettings, LogEntry, PlayerAction, RoomView } from './types';

export type AckResponse<T = Record<string, never>> = { ok: true; data: T } | { ok: false; error: string };
export type Ack<T = Record<string, never>> = (res: AckResponse<T>) => void;

export interface CreateRoomPayload {
  /** Host display name */
  name: string;
  settings?: Partial<GameSettings>;
}
export interface CreateRoomResult {
  roomId: string;
  /** Secret, stored in localStorage; used to reconnect as the same player. */
  token: string;
  playerId: string;
}

export interface JoinRoomPayload {
  roomId: string;
  /** Present when re-connecting as an existing player. */
  token?: string;
  /** Required when joining as a new player (no / unknown token). */
  name?: string;
}
export interface JoinRoomResult {
  token: string;
  playerId: string;
}

export type Empty = Record<string, never>;

export interface ClientToServerEvents {
  'room:create': (p: CreateRoomPayload, ack: Ack<CreateRoomResult>) => void;
  'room:join': (p: JoinRoomPayload, ack: Ack<JoinRoomResult>) => void;
  /** Leave the room entirely (stack is frozen in the ledger; token can rejoin later). */
  'room:leave': (p: Empty, ack: Ack) => void;
  /**
   * This tab stopped showing the room (navigated home or to another room) without leaving it:
   * the seat and stack are kept, and the player counts as disconnected (auto-act grace, host
   * hand-over) until a tab re-joins with the token.
   */
  'room:detach': (p: Empty, ack: Ack) => void;

  'seat:take': (p: { seat: number }, ack: Ack<{ pending: boolean }>) => void;
  /** Stand up (become a spectator). Chips are kept and restored if you sit again. */
  'seat:leave': (p: Empty, ack: Ack) => void;
  'player:sitOut': (p: { sittingOut: boolean }, ack: Ack) => void;
  'player:rename': (p: { name: string }, ack: Ack) => void;

  'game:action': (p: PlayerAction, ack: Ack) => void;
  'game:showCards': (p: Empty, ack: Ack) => void;

  'buyback:request': (p: Empty, ack: Ack<{ voteId: string }>) => void;
  'buyback:vote': (p: { voteId: string; approve: boolean }, ack: Ack) => void;
  'buyback:cancel': (p: { voteId: string }, ack: Ack) => void;

  'chat:send': (p: { text: string }, ack: Ack) => void;

  'host:start': (p: Empty, ack: Ack) => void;
  'host:pause': (p: Empty, ack: Ack) => void;
  'host:resume': (p: Empty, ack: Ack) => void;
  'host:updateSettings': (p: Partial<GameSettings>, ack: Ack) => void;
  'host:approveSeat': (p: { playerId: string; approve: boolean }, ack: Ack) => void;
  'host:kick': (p: { playerId: string }, ack: Ack) => void;
  'host:transfer': (p: { playerId: string }, ack: Ack) => void;
  /**
   * Rematch: start a brand-new game with the same seated players. Everyone seated gets a
   * fresh single buy-in, the ledger and hand counter reset, status returns to 'lobby'.
   * Only allowed between hands.
   */
  'host:rematch': (p: Empty, ack: Ack) => void;
}

export interface NoticePayload {
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface ServerToClientEvents {
  /** Full personalised snapshot; sent after every change. */
  state: (s: RoomView) => void;
  /** Sent once right after a successful join/reconnect. */
  history: (h: { chat: ChatMessage[]; log: LogEntry[] }) => void;
  chat: (m: ChatMessage) => void;
  log: (entries: LogEntry[]) => void;
  notice: (n: NoticePayload) => void;
  /** You were removed by the host; the client should drop its token for this room. */
  kicked: (p: { reason: string }) => void;
}
