// iMessage embed mode: when the table runs inside the Flock Poker Messages extension, this module
// tells native what happened (chat bubbles, haptics, page ready, remembered name). Every function
// returns straight away in a normal browser.
import { LIMITS } from '../../shared/constants';
import type { RoomView } from '../../shared/types';
import type { Route } from '../lib/route';
import { loadName } from '../net/session';
import { setUI, toast, useStore } from '../state/store';
import { isEmbedded, nativeInfo, onNative, postNative } from './bridge';
import { BRIDGE_VERSION, type NativeInfo } from './bridgeTypes';
import {
  awayNextActor,
  bubbleContext,
  buyBackRequestedBubble,
  currentGame,
  gameOverBubble,
  gameStartedBubble,
  inviteBubble,
  rematchBubble,
  yourTurnBubble,
  type BubbleContext,
  type BubbleEvent,
} from './bubbles';

const get = useStore.getState;

/** How long to wait for the table state that follows an action's ack (broadcasts come right after it). */
const STATE_WAIT_MS = 4000;

function context(): BubbleContext {
  return bubbleContext(get().log, window.location.origin);
}

function postBubble(event: BubbleEvent | null): boolean {
  return event ? postNative(event) : false;
}

function latestRoom(roomId: string): RoomView | null {
  const room = get().room;
  return room && room.roomId === roomId ? room : null;
}

/**
 * Resolves with the first non-undefined `decide(room)` over the table snapshots of `roomId` that
 * arrive after `before` (the current one counts if it is already newer). Undefined on timeout or
 * when another table shows up.
 */
function watchRoom<T>(roomId: string, before: RoomView | null, decide: (room: RoomView) => T | undefined, timeoutMs = STATE_WAIT_MS): Promise<T | undefined> {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (value: T | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const check = (room: RoomView | null) => {
      if (done || !room || room === before) return;
      if (room.roomId !== roomId) return finish(undefined);
      const value = decide(room);
      if (value !== undefined) finish(value);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    unsubscribe = useStore.subscribe((s, prev) => {
      if (s.room !== prev.room) check(s.room);
    });
    check(get().room);
  });
}

// ---------------------------------------------------------------- names
/** Name to prefill on the create / join forms: the one native remembered, then this browser's. */
export function preferredName(): string {
  const native = isEmbedded() ? nativeInfo()?.name : null;
  return (native || loadName()).slice(0, LIMITS.nameMaxLength);
}

/** The player created / joined / renamed with this name: native prefills it next time. */
export function rememberName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed || !isEmbedded()) return;
  postNative({ type: 'rememberName', name: trimmed });
}

// ---------------------------------------------------------------- bubbles
function openInviteIfOnTable(roomId: string): void {
  const route = get().route;
  if (route.name === 'room' && route.roomId === roomId) setUI({ inviteOpen: true });
}

/**
 * The host just created `roomId` (and is being taken to the table): insert the invite bubble into
 * the compose field, where the host taps Send. Without native (or its table state) the invite
 * sheet opens instead, like in a browser.
 */
export async function afterCreate(roomId: string): Promise<void> {
  if (!isEmbedded()) return;
  const room = await watchRoom(roomId, null, (r) => r);
  if (!room || !postBubble(inviteBubble(room, context()))) openInviteIfOnTable(roomId);
}

/** "Send to chat" in the invite sheet. False when native is not there to take it. */
export function sendInvite(room: RoomView): boolean {
  return postBubble(inviteBubble(room, context()));
}

/** Captured right before a host / player action is sent; null outside embed mode. */
export interface Snapshot {
  room: RoomView;
  game: number;
}

export function snapshot(): Snapshot | null {
  if (!isEmbedded()) return null;
  const room = get().room;
  return room ? { room, game: currentGame(get().log) } : null;
}

/** host:start was accepted: post "Cards are in the air!" once the first hand shows up. */
export async function afterStart(before: Snapshot | null): Promise<void> {
  if (!before) return;
  const { roomId } = before.room;
  const room = (await watchRoom(roomId, before.room, (r) => (r.status !== 'lobby' ? r : undefined))) ?? latestRoom(roomId);
  if (room) postBubble(gameStartedBubble(room, context()));
}

/** My buy-back request was accepted: everyone else has to tap the bubble and vote. */
export async function afterBuyBackRequest(before: Snapshot | null, voteId: string): Promise<void> {
  if (!before) return;
  const { roomId } = before.room;
  const room =
    (await watchRoom(roomId, before.room, (r) => (r.buyBackVotes.some((v) => v.id === voteId) ? r : undefined))) ??
    latestRoom(roomId);
  if (!room) return;
  const vote = room.buyBackVotes.find((v) => v.id === voteId);
  // nobody else had to vote (approved on the spot): nothing to ask the chat
  if (vote && vote.status !== 'pending') return;
  postBubble(buyBackRequestedBubble(room, context(), voteId));
}

/** yourTurn nudges already posted by this page (game:dedupeKey; hand numbers restart after a rematch). */
const nudged = new Set<string>();

/** My game:action was accepted: if the next player to act is away from the table, nudge them in the chat. */
export async function afterAction(before: Snapshot | null): Promise<void> {
  const hand = before?.room.hand;
  if (!before || !hand) return;
  const myId = before.room.me.playerId;
  const handNumber = hand.handNumber;
  const found = await watchRoom(before.room.roomId, before.room, (r) => {
    const target = awayNextActor(r, myId, handNumber);
    return target === undefined ? undefined : { room: r, target };
  });
  if (!found?.target) return;
  const ctx = context();
  const event = yourTurnBubble(found.room, ctx, found.target);
  if (!event) return;
  const key = `${ctx.game}:${event.dedupeKey}`;
  if (nudged.has(key)) return;
  nudged.add(key);
  postBubble(event);
}

/** host:rematch was accepted: announce the new game once its lobby shows up. */
export async function afterRematch(before: Snapshot | null): Promise<void> {
  if (!before) return;
  const { roomId } = before.room;
  const room =
    (await watchRoom(roomId, before.room, (r) => (!r.started && r.status === 'lobby' ? r : undefined))) ?? latestRoom(roomId);
  if (!room) return;
  const ctx = context();
  // LogEntry.game already counts the new game; older servers do not send it
  postBubble(rematchBubble(room, { ...ctx, game: Math.max(ctx.game, before.game + 1), lastHand: 0 }));
}

// ---------------------------------------------------------------- boot
let started = false;

function routeKey(route: Route): string {
  return route.name === 'room' ? `table:${route.roomId}` : 'home';
}

function setPresentation(style: NativeInfo['presentation']): void {
  try {
    document.documentElement.dataset.presentation = style;
  } catch {
    /* ignore */
  }
}

/** Call once at boot (after the router set the first route) when isEmbedded(). */
export function initEmbed(): void {
  if (started || !isEmbedded()) return;
  started = true;
  let presentation: NativeInfo['presentation'] = nativeInfo()?.presentation ?? 'expanded';
  try {
    document.documentElement.dataset.embed = 'imessage';
  } catch {
    /* ignore */
  }
  setPresentation(presentation);

  let lastReady = '';
  const ready = (route: Route) => {
    const key = routeKey(route);
    if (key === lastReady) return;
    lastReady = key;
    postNative({ type: 'ready', version: BRIDGE_VERSION, route: route.name === 'room' ? 'table' : 'home' });
  };
  ready(get().route);

  useStore.subscribe((s, prev) => {
    if (s.route !== prev.route) ready(s.route);
    // game over: the host's device tells the chat (once, when it happens)
    const room = s.room;
    const old = prev.room;
    if (room && old && room !== old && room.roomId === old.roomId && room.me.isHost && !old.gameOverWinnerId && room.gameOverWinnerId) {
      postBubble(gameOverBubble(room, context()));
    }
  });

  onNative((message) => {
    if (message.type === 'presentation') {
      presentation = message.style;
      setPresentation(presentation);
      return;
    }
    // automatic bubbles fail quietly; an invite the player asked for says so and offers the link
    if (!message.ok && message.dedupeKey.startsWith('invite:')) {
      toast('error', 'Couldn’t add the invite to the chat — copy the link instead');
      const roomId = message.dedupeKey.split(':')[1];
      if (roomId) openInviteIfOnTable(roomId);
    }
  });

  // Messages has no keyboard in the compact (app drawer) size: typing needs the expanded view
  document.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement | null;
    if (presentation === 'compact' && el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      postNative({ type: 'presentation', style: 'expanded' });
    }
  });
}
