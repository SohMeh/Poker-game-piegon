// Contract between the web table and the native iMessage extension that hosts it in a WKWebView.
// The Swift side (ios/FlockKit/Sources/FlockKit/BridgeEvent.swift) decodes exactly these shapes;
// both sides' tests check the shared fixture ios/FlockKit/Tests/FlockKitTests/Fixtures/bridge-events.json.
//
// Web -> native: window.webkit.messageHandlers.flock.postMessage(event)  (a plain JSON object)
// Native -> web: before any page script runs, native defines window.__FLOCK_NATIVE__ (NativeInfo),
//                and later dispatches   window.dispatchEvent(new CustomEvent('flock:native', { detail }))
//                with a NativeToWeb payload.
//
// The web page is loaded by the extension as:
//   <server>/?embed=imessage[&create=1]          app-drawer "New game" (create form first)
//   <server>/g/<ROOMID>?embed=imessage           a game bubble was tapped
// The `embed=imessage` flag is sticky for the page session (keep it when navigating client-side).

export const BRIDGE_VERSION = 1;

/** Message handler name registered by native (window.webkit.messageHandlers[BRIDGE_HANDLER]). */
export const BRIDGE_HANDLER = 'flock';

/** Injected by native at document start. */
export interface NativeInfo {
  platform: 'imessage';
  version: number;
  /** Poker name remembered on this device (from an earlier rememberName), if any. */
  name: string | null;
  /** 'compact' (app drawer height) or 'expanded' (full screen) at load time. */
  presentation: 'compact' | 'expanded';
}

/** What a chat bubble shows. Native turns this into an MSMessage (template layout + rendered image). */
export interface BubbleInfo {
  roomId: string;
  /** Absolute table URL, e.g. https://flock-poker.onrender.com/g/ABC123 (stored as MSMessage.url). */
  url: string;
  /** Bubble caption (bold line), e.g. "Sohum's poker game". */
  title: string;
  /** Bubble sub-caption, e.g. "10/20 · buy-in 2,000 · 3/9 seated — tap to join". */
  subtitle: string;
  /** Collapsed text shown for older bubbles of the same game session, e.g. "Hand #12 — Bob won 340". */
  summary: string;
  /** Small trailing caption, e.g. "Hand #12" or "Lobby". */
  trailing: string;
  status: 'lobby' | 'running' | 'paused';
  hostName: string;
  seated: number;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  buyIn: number;
  handNumber: number;
}

/**
 * Why a bubble is posted. The web side decides WHEN (see src/client/native/bubbles.ts); native only
 * renders and posts it, de-duplicating by `dedupeKey`.
 *   invite           – host created the game, or anyone tapped "Send to chat" in the invite sheet
 *   gameStarted      – host tapped Start
 *   buyBackRequested – I asked to buy back in; everyone must tap the bubble and vote before the timer ends
 *   yourTurn         – I acted and the next player to act is away from the app (nudge them)
 *   gameOver         – one player holds every chip (host device posts it)
 *   rematch          – host started a new game with fresh buy-ins
 */
export type BubbleKind = 'invite' | 'gameStarted' | 'buyBackRequested' | 'yourTurn' | 'gameOver' | 'rematch';

/**
 * insert – put the bubble in the compose field; the user taps Send (used for invites).
 * send   – post it straight into the conversation (MSConversation.send), falling back to insert.
 */
export type BubbleMode = 'insert' | 'send';

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection';

export type WebToNative =
  /** Page booted and the bridge is live. */
  | { type: 'ready'; version: number; route: 'home' | 'table' }
  /** Remember the player's poker name on this device (prefills next time). */
  | { type: 'rememberName'; name: string }
  /** Post / insert a chat bubble for this game. `plainLink` adds a text line with the URL for friends without the app. */
  | { type: 'bubble'; kind: BubbleKind; mode: BubbleMode; dedupeKey: string; plainLink: boolean; bubble: BubbleInfo }
  /** Native haptic feedback (iOS has no navigator.vibrate). */
  | { type: 'haptic'; style: HapticStyle }
  /** Ask Messages to resize the extension. */
  | { type: 'presentation'; style: 'compact' | 'expanded' };

export type NativeToWeb =
  /** Messages resized the extension. */
  | { type: 'presentation'; style: 'compact' | 'expanded' }
  /** A bubble was posted / inserted (or failed). */
  | { type: 'bubbleResult'; dedupeKey: string; ok: boolean; sent: boolean; error: string | null };
