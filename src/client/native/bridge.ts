// Web side of the bridge to the native iMessage extension (contract: ./bridgeTypes.ts).
// Everything here is a safe no-op in a normal browser and never throws.
import { hasEmbedFlag } from '../lib/route';
import { BRIDGE_HANDLER, type NativeInfo, type NativeToWeb, type WebToNative } from './bridgeTypes';

/** CustomEvent name native dispatches on window, with a NativeToWeb payload as `detail`. */
export const NATIVE_EVENT = 'flock:native';

interface MessageHandler {
  postMessage(message: unknown): void;
}

interface BridgeWindow {
  __FLOCK_NATIVE__?: unknown;
  webkit?: { messageHandlers?: Record<string, MessageHandler | undefined> };
}

function bridgeWindow(): BridgeWindow | null {
  try {
    return typeof window === 'undefined' ? null : (window as unknown as BridgeWindow);
  } catch {
    return null;
  }
}

/** What native injected at document start (validated), or null outside the iMessage app. */
export function nativeInfo(): NativeInfo | null {
  try {
    const raw = bridgeWindow()?.__FLOCK_NATIVE__;
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (o.platform !== 'imessage') return null;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    return {
      platform: 'imessage',
      version: typeof o.version === 'number' && Number.isFinite(o.version) ? o.version : 0,
      name: name || null,
      presentation: o.presentation === 'compact' ? 'compact' : 'expanded',
    };
  } catch {
    return null;
  }
}

function messageHandler(): MessageHandler | null {
  try {
    const h = bridgeWindow()?.webkit?.messageHandlers?.[BRIDGE_HANDLER];
    return h && typeof h.postMessage === 'function' ? h : null;
  } catch {
    return null;
  }
}

function urlHasEmbedFlag(): boolean {
  try {
    return hasEmbedFlag(window.location.search);
  } catch {
    return false;
  }
}

/** Once a page knows it runs inside Messages it stays in embed mode (client-side navigation, reloads keep the flag). */
let sticky = false;

/**
 * True inside the iMessage extension: native injected `__FLOCK_NATIVE__` (platform "imessage") and
 * registered the `flock` message handler, or the page was loaded with `?embed=imessage` (so the UI
 * adapts even before the injection). Posting additionally needs the handler, see postNative().
 */
export function isEmbedded(): boolean {
  if (sticky) return true;
  if ((nativeInfo() !== null && messageHandler() !== null) || urlHasEmbedFlag()) sticky = true;
  return sticky;
}

/** In embed mode and native is listening right now. */
export function canPostNative(): boolean {
  return isEmbedded() && messageHandler() !== null;
}

/**
 * Sends an event to native. Returns true when it was handed to the message handler; false (and
 * does nothing) in a normal browser, without the handler, or if posting failed. Never throws.
 */
export function postNative(event: WebToNative): boolean {
  if (!isEmbedded()) return false;
  const handler = messageHandler();
  if (!handler) return false;
  try {
    // a plain JSON object (no undefined fields, no prototypes) is what WebKit hands to Swift
    handler.postMessage(JSON.parse(JSON.stringify(event)) as WebToNative);
    return true;
  } catch {
    return false;
  }
}

const isStyle = (v: unknown): v is 'compact' | 'expanded' => v === 'compact' || v === 'expanded';

/** Validates a NativeToWeb payload (an object, or its JSON text). Unknown or malformed messages give null. */
export function parseNativeMessage(detail: unknown): NativeToWeb | null {
  let d = detail;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      return null;
    }
  }
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  if (o.type === 'presentation' && isStyle(o.style)) return { type: 'presentation', style: o.style };
  if (o.type === 'bubbleResult' && typeof o.dedupeKey === 'string' && typeof o.ok === 'boolean') {
    return {
      type: 'bubbleResult',
      dedupeKey: o.dedupeKey,
      ok: o.ok,
      sent: o.sent === true,
      error: typeof o.error === 'string' ? o.error : null,
    };
  }
  return null;
}

/** Listens for messages from native ('flock:native' CustomEvents). Returns an unsubscribe function. */
export function onNative(listener: (message: NativeToWeb) => void): () => void {
  try {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => undefined;
    const handle = (e: Event) => {
      const message = parseNativeMessage((e as CustomEvent<unknown>).detail);
      if (!message) return;
      try {
        listener(message);
      } catch {
        /* a listener bug must not break native's dispatch */
      }
    };
    window.addEventListener(NATIVE_EVENT, handle);
    return () => window.removeEventListener(NATIVE_EVENT, handle);
  } catch {
    return () => undefined;
  }
}
