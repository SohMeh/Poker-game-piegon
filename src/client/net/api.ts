import type { RoomSummary } from '../../shared/types';

export type SummaryResult = { kind: 'ok'; summary: RoomSummary } | { kind: 'notFound' } | { kind: 'error'; error: string };

export async function fetchRoomSummary(roomId: string, signal?: AbortSignal): Promise<SummaryResult> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
      headers: { accept: 'application/json' },
      signal,
    });
    if (res.status === 404) return { kind: 'notFound' };
    if (!res.ok) return { kind: 'error', error: `Server error (${res.status})` };
    const summary = (await res.json()) as RoomSummary;
    if (!summary || typeof summary.roomId !== 'string') return { kind: 'error', error: 'Bad response' };
    return { kind: 'ok', summary };
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') return { kind: 'error', error: 'aborted' };
    return { kind: 'error', error: 'Could not reach the server' };
  }
}
