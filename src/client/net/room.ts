// Connection lifecycle: routing, joining / re-joining rooms, and server event handlers.
import { KICKED_ERROR, SESSION_EXPIRED_ERROR } from '../../shared/constants';
import type { GameSettings, RoomView } from '../../shared/types';
import { SkewTracker } from '../lib/clock';
import { parsePath, roomPath, type Route } from '../lib/route';
import { appendLog, pushChat, resetRoomState, setHistory, setUI, toast, useStore } from '../state/store';
import { fetchRoomSummary } from './api';
import { clearSession, kickedToken, loadSession, markKicked, saveName, saveSession, wasKicked } from './session';
import { emitAck, getSocket, isMockTransport, OFFLINE_ERROR, TIMEOUT_ERROR } from './socket';

const set = useStore.setState;
const get = useStore.getState;
const skew = new SkewTracker();

let wired = false;
/** Incremented on every route change so late async results for an old route are ignored. */
let routeSeq = 0;
/**
 * The room this tab's socket is attached to on the server (null = none). Leaving its route
 * without leaving the room (back to Home, another room's link) detaches it, so the server stops
 * counting this tab as present: the seat is kept, but the shot clock / host hand-over treat the
 * player as away instead of waiting for a phone that is no longer looking at the table.
 */
let attachedRoomId: string | null = null;

const KICKED_TEXT = 'The host removed you from the table.';

function detachFromRoom(): void {
  if (attachedRoomId === null) return;
  attachedRoomId = null;
  if (getSocket().connected) void emitAck('room:detach', {});
}

/**
 * A join for `roomId` succeeded (the server attached this socket). Keeps the attachment when that
 * room is still on screen; otherwise (the user navigated away meanwhile) detaches again.
 */
function attachIfOnScreen(roomId: string): boolean {
  attachedRoomId = roomId;
  const route = get().route;
  if (route.name === 'room' && route.roomId === roomId) return true;
  detachFromRoom();
  return false;
}

/** Events tied to a room (chat, log, notices, kicks) only count for the room on screen. */
function onAttachedRoom(): boolean {
  const route = get().route;
  return attachedRoomId !== null && route.name === 'room' && route.roomId === attachedRoomId;
}

function showKicked(roomId: string, reason?: string): void {
  markKicked(roomId, loadSession(roomId)?.token ?? kickedToken(roomId));
  if (attachedRoomId === roomId) attachedRoomId = null;
  set({ phase: 'kicked', kickedReason: reason || KICKED_TEXT, room: null });
}

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
  if (attachedRoomId !== null && (route.name !== 'room' || route.roomId !== attachedRoomId)) detachFromRoom();
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
  if (wasKicked(route.roomId)) {
    set({ phase: 'kicked', kickedReason: KICKED_TEXT });
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
  if (res.ok && !attachIfOnScreen(roomId)) return;
  if (seq !== routeSeq) return;
  if (res.ok) {
    saveSession(roomId, res.data);
    if (get().phase !== 'joined') set({ phase: get().room ? 'joined' : 'loading', phaseError: null });
    return;
  }
  if (res.error === KICKED_ERROR) {
    showKicked(roomId);
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
  } else if (r.kind === 'ok' && res.error === SESSION_EXPIRED_ERROR) {
    // the room exists but no longer knows our token: join again as a new player
    clearSession(roomId);
    set({ phase: 'needsName', summary: r.summary, room: null });
    toast('error', res.error);
  } else {
    // anything else (room full, rate limit, server hiccup) is temporary: keep the seat's token
    set({ phase: 'error', phaseError: res.error, room: null });
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
  // a device the host removed sends its old token along, so it cannot return as someone "new"
  const res = await emitAck('room:join', { roomId, name: name.trim(), token: kickedToken(roomId) });
  if (!res.ok) {
    if (res.error === KICKED_ERROR) {
      showKicked(roomId);
      return false;
    }
    set({ phase: 'needsName' });
    toast('error', res.error);
    return false;
  }
  if (!attachIfOnScreen(roomId)) return false;
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
  // the server attached this socket to the new room (and detached it from any other)
  attachedRoomId = res.data.roomId;
  saveSession(res.data.roomId, { token: res.data.token, playerId: res.data.playerId });
  saveName(name);
  navigate(roomPath(res.data.roomId));
  setUI({ inviteOpen: true });
  return true;
}

export async function leaveRoom(): Promise<void> {
  await emitAck('room:leave', {});
  attachedRoomId = null;
  navigate('/');
}

const PROBE_TIMEOUT_MS = 4000;
let probing = false;

/**
 * After a phone sleeps, the socket can still look connected while it is dead (until the ping
 * timeout, ~45 s). On wake we re-join (idempotent: the server answers with fresh history + state)
 * and force a reconnect when that gets no quick answer.
 */
async function probeConnection(): Promise<void> {
  const { route, phase } = get();
  if (probing || route.name !== 'room' || !route.valid || phase !== 'joined') return;
  const session = loadSession(route.roomId);
  if (!session) return;
  probing = true;
  try {
    const seq = routeSeq;
    const res = await emitAck('room:join', { roomId: route.roomId, token: session.token }, PROBE_TIMEOUT_MS);
    if (res.ok) {
      attachIfOnScreen(route.roomId);
      return;
    }
    if (seq !== routeSeq) return;
    const socket = getSocket();
    if (res.error === TIMEOUT_ERROR || res.error === OFFLINE_ERROR) {
      // the 'connect' handler re-joins once the new connection is up
      socket.disconnect();
      socket.connect();
    } else {
      await joinWithToken(route.roomId, seq);
    }
  } finally {
    probing = false;
  }
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
  socket.on('disconnect', () => {
    // the server detaches a dropped connection by itself; the 'connect' handler re-joins
    attachedRoomId = null;
    set({ conn: 'disconnected' });
  });
  socket.on('connect_error', () => set({ conn: 'disconnected' }));

  socket.on('state', handleState);
  // history is only ever sent in answer to this tab's own join, for the room on screen
  socket.on('history', (h) => {
    if (get().route.name === 'room') setHistory(h.chat ?? [], h.log ?? []);
  });
  socket.on('chat', (m) => {
    if (onAttachedRoom()) pushChat(m);
  });
  socket.on('log', (entries) => {
    if (onAttachedRoom()) appendLog(entries);
  });
  socket.on('notice', (n) => {
    if (onAttachedRoom()) toast(n.kind, n.text);
  });
  socket.on('kicked', ({ reason }) => {
    const roomId = attachedRoomId;
    if (roomId === null) return;
    const onScreen = onAttachedRoom();
    markKicked(roomId, loadSession(roomId)?.token);
    attachedRoomId = null;
    if (onScreen) set({ phase: 'kicked', kickedReason: reason || KICKED_TEXT, room: null });
  });

  const wake = () => {
    if (!socket.connected) socket.connect();
    else void probeConnection();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
  window.addEventListener('online', wake);
  window.addEventListener('pageshow', wake);
  socket.connect();
}
