// Chat bubbles the web table asks the iMessage extension to post. Pure: RoomView in, bridge event
// out. WHEN each one is posted is decided in ./embed.ts; native only renders, de-duplicates by
// `dedupeKey` and posts (contract: ./bridgeTypes.ts, examples: the shared bridge-events.json fixture).
import { formatChips } from '../../shared/format';
import type { LogEntry, RoomView } from '../../shared/types';
import { playerById, seatsTaken } from '../lib/gameState';
import { roomPath } from '../lib/route';
import type { BubbleInfo, BubbleKind, BubbleMode, WebToNative } from './bridgeTypes';

export type BubbleEvent = Extract<WebToNative, { type: 'bubble' }>;

/** Invites go to the compose field (the user taps Send) with a plain link for friends without the app; the rest are posted. */
export const BUBBLE_DELIVERY: Record<BubbleKind, { mode: BubbleMode; plainLink: boolean }> = {
  invite: { mode: 'insert', plainLink: true },
  gameStarted: { mode: 'send', plainLink: false },
  buyBackRequested: { mode: 'send', plainLink: false },
  yourTurn: { mode: 'send', plainLink: false },
  gameOver: { mode: 'send', plainLink: false },
  rematch: { mode: 'send', plainLink: false },
};

export interface BubbleContext {
  /** Page origin, e.g. "https://flock-poker.onrender.com" (window.location.origin). */
  origin: string;
  /** Which game of the room this is: 1, +1 per rematch. */
  game: number;
  /** Last hand dealt in this game, for views without a hand (game over). */
  lastHand: number;
}

/** The room's current game number from the hand log (LogEntry.game; 1 when the server does not send it). */
export function currentGame(log: readonly LogEntry[]): number {
  let game = 0;
  for (const e of log) if (typeof e.game === 'number' && Number.isInteger(e.game) && e.game > game) game = e.game;
  return game > 0 ? game : 1;
}

/** Highest hand number logged for `game` (entries without a game number count for every game). */
export function lastHandNumber(log: readonly LogEntry[], game: number): number {
  let n = 0;
  for (const e of log) {
    if (typeof e.handNumber !== 'number') continue;
    if (typeof e.game === 'number' && e.game !== game) continue;
    if (e.handNumber > n) n = e.handNumber;
  }
  return n;
}

export function bubbleContext(log: readonly LogEntry[], origin: string): BubbleContext {
  const game = currentGame(log);
  return { origin, game, lastHand: lastHandNumber(log, game) };
}

/** Absolute table link stored in the bubble (no embed flag: it is also what friends without the app open). */
export function tableUrl(origin: string, roomId: string): string {
  return `${origin.replace(/\/+$/, '')}${roomPath(roomId)}`;
}

function nameOf(room: RoomView, playerId: string | null | undefined, fallback: string): string {
  if (!playerId) return fallback;
  return playerById(room, playerId)?.name ?? room.ledger.find((r) => r.playerId === playerId)?.name ?? fallback;
}

function handNumberOf(room: RoomView, ctx: BubbleContext): number {
  if (room.hand) return room.hand.handNumber;
  return room.started ? ctx.lastHand : 0;
}

function blinds(room: RoomView): string {
  return `${formatChips(room.settings.smallBlind)}/${formatChips(room.settings.bigBlind)}`;
}

/** "Lobby", "Hand #12" or "Paused". */
function statusTrailing(room: RoomView, ctx: BubbleContext): string {
  if (room.status === 'lobby') return 'Lobby';
  if (room.status === 'paused') return 'Paused';
  const n = handNumberOf(room, ctx);
  return n > 0 ? `Hand #${n}` : 'Playing';
}

interface Copy {
  title: string;
  subtitle: string;
  summary: string;
  trailing: string;
}

export function bubbleInfo(room: RoomView, ctx: BubbleContext, copy: Copy): BubbleInfo {
  const s = room.settings;
  return {
    roomId: room.roomId,
    url: tableUrl(ctx.origin, room.roomId),
    title: copy.title,
    subtitle: copy.subtitle,
    summary: copy.summary,
    trailing: copy.trailing,
    status: room.status,
    hostName: nameOf(room, room.hostId, 'The host'),
    seated: seatsTaken(room),
    maxPlayers: s.maxPlayers,
    smallBlind: s.smallBlind,
    bigBlind: s.bigBlind,
    buyIn: s.buyIn,
    handNumber: handNumberOf(room, ctx),
  };
}

function bubbleEvent(kind: BubbleKind, dedupeKey: string, bubble: BubbleInfo): BubbleEvent {
  const { mode, plainLink } = BUBBLE_DELIVERY[kind];
  return { type: 'bubble', kind, mode, dedupeKey, plainLink, bubble };
}

/** Host created the table, or someone tapped "Send to chat" in the invite sheet. */
export function inviteBubble(room: RoomView, ctx: BubbleContext): BubbleEvent {
  const host = nameOf(room, room.hostId, 'The host');
  const seated = seatsTaken(room);
  const max = room.settings.maxPlayers;
  return bubbleEvent(
    'invite',
    `invite:${room.roomId}:${ctx.game}`,
    bubbleInfo(room, ctx, {
      title: `${host}'s poker game`,
      subtitle: `${blinds(room)} · buy-in ${formatChips(room.settings.buyIn)} · ${seated}/${max} seated — ${seated >= max ? 'tap to watch' : 'tap to join'}`,
      summary: room.status === 'lobby' ? `${host} started a poker game` : `Join ${host}'s poker game`,
      trailing: statusTrailing(room, ctx),
    }),
  );
}

/** Host tapped Start. */
export function gameStartedBubble(room: RoomView, ctx: BubbleContext): BubbleEvent {
  const seated = seatsTaken(room);
  return bubbleEvent(
    'gameStarted',
    `gameStarted:${room.roomId}:${ctx.game}`,
    bubbleInfo(room, ctx, {
      title: 'Cards are in the air!',
      subtitle: `${seated} player${seated === 1 ? '' : 's'} · ${blinds(room)} — tap to play`,
      summary: 'Game started',
      trailing: statusTrailing(room, ctx),
    }),
  );
}

/** I asked to buy back in: everyone else must tap the bubble and vote before the timer runs out. */
export function buyBackRequestedBubble(room: RoomView, ctx: BubbleContext, voteId: string): BubbleEvent {
  const vote = room.buyBackVotes.find((v) => v.id === voteId);
  const name = vote?.requesterName || nameOf(room, vote?.requesterId ?? room.me.playerId, room.me.name);
  return bubbleEvent(
    'buyBackRequested',
    `buyBackRequested:${room.roomId}:${voteId}`,
    bubbleInfo(room, ctx, {
      title: `${name} wants to buy back in`,
      subtitle: `Everyone must approve within ${room.settings.buyBackVoteSec}s — tap to vote`,
      summary: `${name} asked to buy back in`,
      trailing: 'Vote',
    }),
  );
}

/** Nudge `playerId`, whose turn it is while their phone is away from the table. Null without a hand. */
export function yourTurnBubble(room: RoomView, ctx: BubbleContext, playerId: string): BubbleEvent | null {
  const hand = room.hand;
  if (!hand) return null;
  const name = nameOf(room, playerId, 'Someone');
  return bubbleEvent(
    'yourTurn',
    `yourTurn:${room.roomId}:${hand.handNumber}:${playerId}`,
    bubbleInfo(room, ctx, {
      title: `${name}, it's your turn`,
      subtitle: `Pot ${formatChips(hand.totalPot)} · ${hand.street} — tap to act`,
      summary: `Waiting on ${name}`,
      trailing: `Hand #${hand.handNumber}`,
    }),
  );
}

/** One player holds every chip. Null while the game is not over. */
export function gameOverBubble(room: RoomView, ctx: BubbleContext): BubbleEvent | null {
  const winnerId = room.gameOverWinnerId;
  if (!winnerId) return null;
  const name = nameOf(room, winnerId, 'Someone');
  const chips = playerById(room, winnerId)?.stack ?? room.ledger.find((r) => r.playerId === winnerId)?.stack ?? 0;
  return bubbleEvent(
    'gameOver',
    `gameOver:${room.roomId}:${ctx.game}:${winnerId}`,
    bubbleInfo(room, ctx, {
      title: `${name} won the game!`,
      subtitle: `Holding all ${formatChips(chips)} chips — tap for the ledger`,
      summary: `${name} won the game`,
      trailing: 'Final',
    }),
  );
}

/** Host started a new game with fresh buy-ins (`ctx.game` is the new game's number). */
export function rematchBubble(room: RoomView, ctx: BubbleContext): BubbleEvent {
  return bubbleEvent(
    'rematch',
    `rematch:${room.roomId}:${ctx.game}`,
    bubbleInfo(room, ctx, {
      title: 'Rematch!',
      subtitle: `Fresh buy-ins of ${formatChips(room.settings.buyIn)} — tap to sit down`,
      summary: 'New game started',
      trailing: statusTrailing(room, ctx),
    }),
  );
}

/**
 * After I acted in hand `handNumber`: the next player to act if their phone is away (not
 * connected), null when nobody needs a nudge (my turn again, they are here, the hand is over),
 * or undefined while the next actor is not known yet (the next street is being dealt).
 */
export function awayNextActor(room: RoomView, myId: string, handNumber: number): string | null | undefined {
  const hand = room.hand;
  if (!hand || hand.handNumber !== handNumber || hand.phase === 'complete') return null;
  if (hand.phase !== 'betting' || !hand.toActPlayerId) return undefined;
  if (hand.toActPlayerId === myId) return null;
  const next = playerById(room, hand.toActPlayerId);
  return next && !next.connected ? next.id : null;
}
