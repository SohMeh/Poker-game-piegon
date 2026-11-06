// Helpers shared by the engine tests (not used at runtime).
import { expect } from 'vitest';
import type { Card, PlayerAction } from '../../shared';
import { dealOrder, stackedDeck } from './deck';
import { createHand } from './hand';
import type { HandEngine } from './types';

export const cards = (s: string): Card[] => (s.trim() ? (s.trim().split(/\s+/) as Card[]) : []);

export interface SetupOptions {
  /** seat -> starting stack. An array means seats 0..n-1. Player ids are `p<seat>`. */
  stacks: number[] | Record<number, number>;
  dealer: number;
  sb?: number;
  bb?: number;
  /** player id -> hole cards, e.g. { p0: 'As Ad' } */
  hole?: Record<string, string>;
  /** up to five board cards, e.g. 'Ah Kh Qh 2c 3d' */
  board?: string;
  deck?: Card[];
}

export function setup(opts: SetupOptions): HandEngine {
  const entries: [number, number][] = Array.isArray(opts.stacks)
    ? opts.stacks.map((s, seat) => [seat, s])
    : Object.entries(opts.stacks).map(([seat, s]) => [Number(seat), s]);
  const players = entries.map(([seat, stack]) => ({ id: `p${seat}`, seat, stack }));
  let deck = opts.deck;
  if (!deck && (opts.hole || opts.board)) {
    const order = dealOrder(
      players.map((p) => p.seat),
      opts.dealer,
    );
    deck = stackedDeck(
      order.map((seat) => cards(opts.hole?.[`p${seat}`] ?? '')),
      cards(opts.board ?? ''),
    );
  }
  return createHand({
    handNumber: 1,
    players,
    dealerSeat: opts.dealer,
    smallBlind: opts.sb ?? 10,
    bigBlind: opts.bb ?? 20,
    deck,
  });
}

/** Applies an action and asserts it was accepted. */
export function act(e: HandEngine, id: string, type: PlayerAction['type'], amount?: number): void {
  const res = e.act(id, amount === undefined ? { type } : { type, amount });
  if (!res.ok) throw new Error(`${id} ${type} ${amount ?? ''} rejected: ${res.error}`);
}

/** Applies an action and asserts it was rejected (and nothing changed). */
export function reject(e: HandEngine, id: string, action: PlayerAction, match?: RegExp): string {
  const before = snapshotState(e);
  const res = e.act(id, action);
  expect(res.ok).toBe(false);
  if (res.ok) return '';
  if (match) expect(res.error).toMatch(match);
  expect(snapshotState(e)).toEqual(before);
  return res.error;
}

export function snapshotState(e: HandEngine) {
  return {
    phase: e.phase,
    street: e.street,
    board: e.board,
    players: e.players,
    currentBet: e.currentBet,
    lastRaiseSize: e.lastRaiseSize,
    toActId: e.toActId,
    pot: e.totalPot(),
  };
}

export function stack(e: HandEngine, id: string): number {
  return e.getPlayer(id)!.stack;
}

export function chipsInPlay(e: HandEngine): number {
  return e.players.reduce((s, p) => s + p.stack, 0) + e.totalPot();
}

/** Calls advance() until the hand is complete or betting is needed. */
export function advanceUntilAction(e: HandEngine): void {
  let guard = 0;
  while (e.phase === 'roundComplete' && guard++ < 10) e.advance();
}

/** Every remaining actor checks (or calls) until the hand is complete. */
export function checkDown(e: HandEngine): void {
  let guard = 0;
  while (e.phase !== 'complete' && guard++ < 200) {
    if (e.phase === 'roundComplete') {
      e.advance();
      continue;
    }
    const id = e.toActId!;
    const legal = e.legalActions(id)!;
    act(e, id, legal.canCheck ? 'check' : 'call');
  }
}
