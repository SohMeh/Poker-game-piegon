// Global client state (zustand). Network handlers write here; components read with selectors.
import { create } from 'zustand';
import type { ChatMessage, LogEntry, RoomSummary, RoomView } from '../../shared/types';
import type { PreAction } from '../lib/preActions';
import type { Route } from '../lib/route';
import { readJSON, writeJSON } from '../lib/storage';

export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

/**
 * idle      – not on a room route
 * loading   – looking the room up / re-joining with a stored token
 * needsName – join screen (no session for this room)
 * joining   – join request in flight
 * joined    – RoomView received
 * notFound  – unknown room
 * kicked    – removed by the host
 * error     – could not (re)join, retry possible
 */
export type RoomPhase = 'idle' | 'loading' | 'needsName' | 'joining' | 'joined' | 'notFound' | 'kicked' | 'error';

export type ToastKind = 'info' | 'success' | 'error';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface Prefs {
  sound: boolean;
  haptics: boolean;
  fourColor: boolean;
}

export type MenuTab = 'players' | 'log' | 'chat' | 'ledger' | 'settings';

export interface UIState {
  menuOpen: boolean;
  menuTab: MenuTab;
  inviteOpen: boolean;
  raiseOpen: boolean;
}

export interface AppState {
  route: Route;
  conn: ConnStatus;
  everConnected: boolean;
  phase: RoomPhase;
  phaseError: string | null;
  summary: RoomSummary | null;
  kickedReason: string | null;
  room: RoomView | null;
  /** serverTime - localTime estimate (ms). */
  skewMs: number;
  chat: ChatMessage[];
  log: LogEntry[];
  unreadChat: number;
  /** Recent chat messages floating over the table. */
  chatPops: ChatMessage[];
  toasts: ToastItem[];
  prefs: Prefs;
  ui: UIState;
  preAction: PreAction | null;
  /** Mock scenario name when running ?mock=... */
  mock: string | null;
}

const PREFS_KEY = 'flock:prefs';
const DEFAULT_PREFS: Prefs = { sound: true, haptics: true, fourColor: false };

function loadPrefs(): Prefs {
  const p = readJSON<Partial<Prefs>>(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...(p && typeof p === 'object' ? p : {}) };
}

export const INITIAL_UI: UIState = { menuOpen: false, menuTab: 'players', inviteOpen: false, raiseOpen: false };

export const useStore = create<AppState>()(() => ({
  route: { name: 'home' },
  conn: 'idle',
  everConnected: false,
  phase: 'idle',
  phaseError: null,
  summary: null,
  kickedReason: null,
  room: null,
  skewMs: 0,
  chat: [],
  log: [],
  unreadChat: 0,
  chatPops: [],
  toasts: [],
  prefs: loadPrefs(),
  ui: INITIAL_UI,
  preAction: null,
  mock: null,
}));

const set = useStore.setState;
const get = useStore.getState;

// ---------------------------------------------------------------- toasts
let toastSeq = 1;
export function toast(kind: ToastKind, text: string, ms = 3600): void {
  if (!text) return;
  const id = toastSeq++;
  // drop exact duplicates that are still visible
  const existing = get().toasts.filter((t) => t.text !== text);
  set({ toasts: [...existing.slice(-3), { id, kind, text }] });
  setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number): void {
  set({ toasts: get().toasts.filter((t) => t.id !== id) });
}

// ---------------------------------------------------------------- prefs / ui
export function setPrefs(p: Partial<Prefs>): void {
  const prefs = { ...get().prefs, ...p };
  set({ prefs });
  writeJSON(PREFS_KEY, prefs);
}

export function setUI(p: Partial<UIState>): void {
  set({ ui: { ...get().ui, ...p } });
}

export function openMenu(tab?: MenuTab): void {
  const ui = get().ui;
  const menuTab = tab ?? ui.menuTab;
  set({ ui: { ...ui, menuOpen: true, menuTab, raiseOpen: false }, ...(menuTab === 'chat' ? { unreadChat: 0 } : {}) });
}

export function setMenuTab(tab: MenuTab): void {
  set({ ui: { ...get().ui, menuTab: tab }, ...(tab === 'chat' ? { unreadChat: 0 } : {}) });
}

export function closeMenu(): void {
  setUI({ menuOpen: false });
}

export function setPreAction(p: PreAction | null): void {
  set({ preAction: p });
}

// ---------------------------------------------------------------- chat / log
const CHAT_LIMIT = 200;
const LOG_LIMIT = 600;
const POP_MS = 4500;

/** Full history right after (re)joining: replaces whatever was shown, including unread counts. */
export function setHistory(chat: ChatMessage[], log: LogEntry[]): void {
  const s = get();
  // a re-join of the same room keeps its unread count; messages that are not part of this room's
  // history (e.g. from a room that was attached before) do not count
  const known = new Set(chat.map((m) => m.id));
  const me = s.room?.me.playerId;
  const countable = s.chat.filter((m) => known.has(m.id) && !m.system && m.playerId !== me).length;
  const stillUnread = Math.min(s.unreadChat, countable);
  set({
    chat: chat.slice(-CHAT_LIMIT),
    log: dedupeLog(log).slice(-LOG_LIMIT),
    unreadChat: stillUnread,
    chatPops: s.chatPops.filter((m) => known.has(m.id)),
  });
}

export function pushChat(m: ChatMessage): void {
  const s = get();
  if (s.chat.some((c) => c.id === m.id)) return;
  const chatVisible = s.ui.menuOpen && s.ui.menuTab === 'chat';
  const mine = s.room?.me.playerId === m.playerId;
  set({
    chat: [...s.chat, m].slice(-CHAT_LIMIT),
    unreadChat: chatVisible || mine || m.system ? s.unreadChat : s.unreadChat + 1,
  });
  // system lines (joins, buy-backs...) already show up as cards / toasts / log entries
  if (!chatVisible && !m.system) {
    set({ chatPops: [...get().chatPops, m].slice(-3) });
    setTimeout(() => set({ chatPops: get().chatPops.filter((c) => c.id !== m.id) }), POP_MS);
  }
}

function dedupeLog(entries: LogEntry[]): LogEntry[] {
  const seen = new Set<number>();
  const out: LogEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out.sort((a, b) => a.id - b.id);
}

export function appendLog(entries: LogEntry[]): void {
  set({ log: dedupeLog([...get().log, ...entries]).slice(-LOG_LIMIT) });
}

/** Clears everything tied to the current room (switching rooms / leaving). */
export function resetRoomState(): void {
  set({
    room: null,
    summary: null,
    kickedReason: null,
    phaseError: null,
    chat: [],
    log: [],
    unreadChat: 0,
    chatPops: [],
    preAction: null,
    ui: INITIAL_UI,
  });
}
