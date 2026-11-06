// Pure selectors over a RoomView.
import type { BuyBackVoteView, PublicPlayer, RoomView } from '../../shared/types';

export function playerById(room: RoomView, id: string | null | undefined): PublicPlayer | undefined {
  if (!id) return undefined;
  return room.players.find((p) => p.id === id);
}

export function myPlayer(room: RoomView): PublicPlayer | undefined {
  return playerById(room, room.me.playerId);
}

export function nameResolver(room: RoomView): (id: string) => string {
  const map = new Map(room.players.map((p) => [p.id, p.name] as const));
  for (const row of room.ledger) if (!map.has(row.playerId)) map.set(row.playerId, row.name);
  return (id: string) => map.get(id) ?? 'Someone';
}

export function seatedPlayers(room: RoomView): PublicPlayer[] {
  return room.players.filter((p) => p.seat !== null).sort((a, b) => a.seat! - b.seat!);
}

export function spectators(room: RoomView): PublicPlayer[] {
  return room.players.filter((p) => p.seat === null);
}

export function pendingRequests(room: RoomView): PublicPlayer[] {
  return room.players.filter((p) => p.pendingSeat !== null && p.seat === null);
}

/** Seats somebody is waiting on host approval for. */
export function reservedSeats(room: RoomView): Set<number> {
  const set = new Set<number>();
  for (const p of room.players) if (p.pendingSeat !== null && p.seat === null) set.add(p.pendingSeat);
  return set;
}

/** First seat that is empty and not reserved, or null when the table is full. */
export function firstFreeSeat(room: RoomView): number | null {
  const reserved = reservedSeats(room);
  for (let i = 0; i < room.seats.length; i++) {
    if (room.seats[i] == null && !reserved.has(i)) return i;
  }
  return null;
}

export function seatsTaken(room: RoomView): number {
  return room.seats.filter((s) => s != null).length;
}

/** Players who would be dealt in if the host pressed Start. */
export function eligibleCount(room: RoomView): number {
  return seatedPlayers(room).filter((p) => !p.sittingOut && p.stack > 0).length;
}

export function isGameOver(room: RoomView): boolean {
  if (room.gameOverWinnerId) return true;
  // Fallback for "nobody here holds chips" (gameOverWinnerId is null then): only between hands.
  // Someone standing with chips can still sit back down, so they keep the game going.
  if (!room.started || room.status === 'lobby' || room.hand) return false;
  return seatedPlayers(room).length >= 1 && !room.ledger.some((r) => r.inRoom && r.stack > 0);
}

/**
 * The game is running but no hand can be dealt: fewer than two seated players with chips are in
 * (someone stood up, left, sits out or is offline). Not game over: they can come back.
 */
export function isStalled(room: RoomView): boolean {
  return room.started && room.status === 'running' && !room.hand && !isGameOver(room) && eligibleCount(room) < 2;
}

/** A spectator's first seat needs the host's OK (approval setting, or joining a game under way). */
export function seatNeedsApproval(room: RoomView): boolean {
  if (room.me.isHost) return false;
  const me = myPlayer(room);
  return room.settings.requireApproval || (room.started && (me?.buyIns ?? 0) === 0);
}

/** Chips I need to put in to call right now (0 = I could check), capped at my stack. */
export function amountToCall(room: RoomView, p: PublicPlayer | undefined): number {
  if (!room.hand || !p) return 0;
  return Math.max(0, Math.min(p.stack, room.hand.currentBet - p.bet));
}

export function pendingVotes(room: RoomView): BuyBackVoteView[] {
  return room.buyBackVotes.filter((v) => v.status === 'pending');
}

export function myPendingRequest(room: RoomView): BuyBackVoteView | undefined {
  return room.buyBackVotes.find((v) => v.status === 'pending' && v.requesterId === room.me.playerId);
}

/** Number of OTHER seated players who would have to approve my buy-back. */
export function buyBackVoterCount(room: RoomView): number {
  return seatedPlayers(room).filter((p) => p.id !== room.me.playerId).length;
}

export type BuyBackBlock =
  | { allowed: true }
  | { allowed: false; reason: string; cooldownUntil?: number };

export function buyBackAvailability(room: RoomView, serverNow: number): BuyBackBlock {
  if (!room.settings.allowBuyBack) return { allowed: false, reason: 'The host turned buy-backs off' };
  if (myPendingRequest(room)) return { allowed: false, reason: 'Your request is being voted on' };
  const until = room.me.buyBackCooldownUntil;
  if (until && until > serverNow) {
    return { allowed: false, reason: 'You can ask again soon', cooldownUntil: until };
  }
  if (!room.me.canRequestBuyBack) return { allowed: false, reason: 'Not available right now' };
  return { allowed: true };
}

export type BottomMode =
  | 'act'
  | 'spectator'
  | 'pending'
  | 'gameOver'
  | 'busted'
  | 'lobby'
  | 'sittingOut'
  | 'paused'
  | 'inHand'
  | 'folded'
  | 'allIn'
  | 'waiting';

/** Which contextual panel to show at the bottom of the table. */
export function bottomMode(room: RoomView): BottomMode {
  const me = myPlayer(room);
  if (room.me.legal) return 'act';
  if (!me || me.seat === null) return me && me.pendingSeat !== null ? 'pending' : 'spectator';
  if (isGameOver(room)) return 'gameOver';
  const hand = room.hand;
  const inLiveHand = !!hand && hand.phase !== 'complete' && me.inHand;
  if (inLiveHand) {
    if (me.folded) return 'folded';
    if (me.allIn) return 'allIn';
    return 'inHand';
  }
  if (me.busted || (me.stack === 0 && !me.inHand && room.started)) return 'busted';
  if (room.status === 'lobby') return 'lobby';
  if (me.sittingOut) return 'sittingOut';
  if (room.status === 'paused') return 'paused';
  if (hand && hand.phase === 'complete' && me.inHand && me.folded) return 'folded';
  return 'waiting';
}
