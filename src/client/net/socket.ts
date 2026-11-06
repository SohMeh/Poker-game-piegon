// Typed Socket.IO client + promise-based emit with an ack timeout.
import { io, type Socket } from 'socket.io-client';
import type { AckResponse, ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type EventName = keyof ClientToServerEvents;
export type PayloadOf<E extends EventName> = Parameters<ClientToServerEvents[E]>[0];
export type AckDataOf<E extends EventName> =
  Parameters<ClientToServerEvents[E]>[1] extends (res: AckResponse<infer T>) => void ? T : never;

export const ACK_TIMEOUT_MS = 8000;
export const TIMEOUT_ERROR = 'The server did not answer. Try again.';
export const OFFLINE_ERROR = 'You are offline. Reconnecting…';

let socket: ClientSocket | null = null;

export function getSocket(): ClientSocket {
  if (!socket) {
    socket = io({
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      timeout: 10_000,
    }) as ClientSocket;
  }
  return socket;
}

/** Alternative transport (mock mode). Receives every emit and answers like a server would. */
export type MockTransport = (event: EventName, payload: unknown) => Promise<AckResponse<unknown>>;
let mockTransport: MockTransport | null = null;

export function setMockTransport(t: MockTransport | null): void {
  mockTransport = t;
}

export function isMockTransport(): boolean {
  return mockTransport !== null;
}

/** Emit an event and resolve with the server's AckResponse (or an error after `timeoutMs`). */
export function emitAck<E extends EventName>(
  event: E,
  payload: PayloadOf<E>,
  timeoutMs: number = ACK_TIMEOUT_MS,
): Promise<AckResponse<AckDataOf<E>>> {
  if (mockTransport) return mockTransport(event, payload) as Promise<AckResponse<AckDataOf<E>>>;
  const s = getSocket();
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: s.connected ? TIMEOUT_ERROR : OFFLINE_ERROR });
    }, timeoutMs);
    const emit = s.emit as unknown as (ev: string, p: unknown, cb: (res: AckResponse<unknown>) => void) => void;
    emit.call(s, event, payload, (res: AckResponse<unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!res || typeof res !== 'object' || typeof (res as { ok?: unknown }).ok !== 'boolean') {
        resolve({ ok: false, error: 'Unexpected server response' });
        return;
      }
      resolve(res as AckResponse<AckDataOf<E>>);
    });
  });
}
