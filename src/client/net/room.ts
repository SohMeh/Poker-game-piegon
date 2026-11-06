// Connection lifecycle: routing, joining / re-joining rooms, and server event handlers.
import type { GameSettings, RoomView } from '../../shared/types';
import { SkewTracker } from '../lib/clock';
import { parsePath, roomPath, type Route } from '../lib/route';
import { appendLog, pushChat, resetRoomState, setHistory, setUI, toast, useStore } from '../state/store';
import { fetchRoomSummary } from './api';
import { clearSession, loadSession, saveName, saveSession } from './session';
import { emitAck, getSocket, isMockTransport, OFFLINE_ERROR, TIMEOUT_ERROR } from './socket';

const set = useStore.setState;
const get = useStore.getState;
const skew = new SkewTracker();

let wired = false;
/** Incremented on every route change so late async results for an old route are ignored. */
let routeSeq = 0;

// ---------------------------------------------------------------- routing
export function currentRoute(): Route {
  return parsePath(window.location.pathname);
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  try {
    if (opts.replace) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
  } catch {
    /* ignore (sandboxed iframes) */
  }
  applyLocation();
}

function applyLocation(): void {
  const route = currentRoute();
  if (route.name === 'room' && route.valid) {
    const canonical = roomPath(route.roomId);
    if (window.location.pathname !== canonical) {
      try {
        window.history.replaceState(null, '', canonical + window.location.search);
      } catch {
        /* ignore */
      }
    }
  }
  const prev = get().route;
  const same = prev.name === route.name && (prev.name !== 'room' || (route.name === 'room' && prev.roomId === route.roomId));
  set({ route });
  if (!same || get().phase === 'idle') void enterRoute(route);
}

export function initRouter(): void {
  window.addEventListener('popstate', applyLocation);
  applyLocation();
}

async function enterRoute(route: Route): Promise<void> {
  const seq = ++routeSeq;
  resetRoomState();
  skew.reset();
  if (isMockTransport()) return;
  if (route.name === 'home') {
    set({ phase: 'idle' });
    document.title = 'Flock Poker';
    return;
  }
  document.title = `Flock Poker · ${route.roomId}`;
  if (!route.valid) {
    set({ phase: 'notFound' });
    return;
  }
  const session = loadSession(route.roomId);
  set({ phase: 'loading' });
  if (session) {
    if (getSocket().connected) await joinWithToken(route.roomId, seq);
    return; // otherwise the 'connect' handler joins
  }
  const r = await fetchRoomSummary(route.roomId);
  if (seq !== routeSeq) return;
  if (r.kind === 'notFound') set({ phase: 'notFound' });
  else if (r.kind === 'ok') set({ phase: 'needsName', summary: r.summary });
  else set({ phase: 'needsName', summary: null, phaseError: r.error });
}

async function joinWithToken(roomId: string, seq: number): Promise<void> {
  const session = loadSession(roomId);
  if (!session) return;
  const res = await emitAck('room:join', { roomId, token: session.token });
  if (seq !== routeSeq) return;
  if (res.ok) {
    saveSession(roomId, res.data);
    if (get().phase !== 'joined') set({ phase: get().room ? 'joined' : 'loading', phaseError: null });
    return;
  }
  if (res.error === TIMEOUT_ERROR || res.error === OFFLINE_ERROR || !getSocket().connected) {
    // keep the session; we retry on the next (re)connect or via the Retry button
    if (get().phase !== 'joined') set({ phase: 'error', phaseError: res.error });
    return;
  }
  const r = await fetchRoomSummary(roomId);
  if (seq !== routeSeq) return;
  if (r.kind === 'notFound') {
    clearSession(roomId);
    set({ phase: 'notFound', room: null });
  } else if (r.kind === 'ok') {
    // the room exists but our token is no longer valid: join again as a new player
    clearSession(roomId);
    set({ phase: 'needsName', summary: r.summary, room: null });
    toast('error', res.error);
  } else {
    set({ phase: 'error', phaseError: res.error });
  }
}

/** Retry button on the "couldn't connect" screen. */
export function retryJoin(): void {
  const route = get().route;
  if (route.name !== 'room') return;
  const s = getSocket();
  if (!s.connected) s.connect();
  void enterRoute(route);
}

export async function joinWithName(roomId: string, name: string): Promise<boolean> {
  set({ phase: 'joining' });
  const res = await emitAck('room:join', { roomId, name: name.trim() });
  if (!res.ok) {
    set({ phase: 'needsName' });
    toast('error', res.error);
    return false;
  }
  saveSession(roomId, res.data);
  saveName(name);
  set({ phase: get().room ? 'joined' : 'loading' });
  return true;
}

export async function createRoom(name: string, settings: Partial<GameSettings>): Promise<boolean> {
  const res = await emitAck('room:create', { name: name.trim(), settings });
  if (!res.ok) {
    toast('error', res.error);
    return false;
  }
  saveSession(res.data.roomId, { token: res.data.token, playerId: res.data.playerId });
  saveName(name);
  navigate(roomPath(res.data.roomId));
  setUI({ inviteOpen: true });
  return true;
}

export async function leaveRoom(): Promise<void> {
  await emitAck('room:leave', {});
  navigate('/');
}

// ---------------------------------------------------------------- server events
function handleState(view: RoomView): void {
  const s = get();
  if (s.route.name !== 'room' || view.roomId !== s.route.roomId) return;
  if (s.phase === 'kicked') return;
  skew.add(view.serverTime);
  set({ room: view, skewMs: skew.offset, phase: 'joined', phaseError: null });
}

export function initNetwork(): void {
  if (wired || isMockTransport()) return;
  wired = true;
  const socket = getSocket();
  set({ conn: 'connecting' });

  socket.on('connect', () => {
    set({ conn: 'connected', everConnected: true });
    const { route, phase } = get();
    if (route.name !== 'room' || !route.valid) return;
    if (phase === 'kicked' || phase === 'notFound' || phase === 'needsName' || phase === 'joining') return;
    if (loadSession(route.roomId)) void joinWithToken(route.roomId, routeSeq);
  });
  socket.on('disconnect', () => set({ conn: 'disconnected' }));
  socket.on('connect_error', () => set({ conn: 'disconnected' }));

  socket.on('state', handleState);
  socket.on('history', (h) => setHistory(h.chat ?? [], h.log ?? []));
  socket.on('chat', (m) => pushChat(m));
  socket.on('log', (entries) => appendLog(entries));
  socket.on('notice', (n) => toast(n.kind, n.text));
  socket.on('kicked', ({ reason }) => {
    const route = get().route;
    if (route.name === 'room') clearSession(route.roomId);
    set({ phase: 'kicked', kickedReason: reason || 'The host removed you from the table.', room: null });
  });

  const wake = () => {
    if (!socket.connected) socket.connect();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
  window.addEventListener('online', wake);
  window.addEventListener('pageshow', wake);
  socket.connect();
}
