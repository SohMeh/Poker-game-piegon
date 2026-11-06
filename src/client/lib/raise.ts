// Pure bet-sizing helpers for the raise panel.
import type { LegalActions, PlayerAction } from '../../shared/types';
import { formatChips } from '../../shared/format';

type Sizing = Pick<LegalActions, 'minRaiseTo' | 'maxRaiseTo' | 'currentBet' | 'pot' | 'callAmount' | 'isBet'>;

/** Clamp a "raise to" amount into the legal range (integers only). */
export function clampRaise(amount: number, legal: Pick<LegalActions, 'minRaiseTo' | 'maxRaiseTo'>): number {
  const min = Math.min(legal.minRaiseTo, legal.maxRaiseTo);
  const max = legal.maxRaiseTo;
  if (!Number.isFinite(amount)) return min;
  return Math.min(max, Math.max(min, Math.round(amount)));
}

/**
 * Pot-fraction "raise to": call first, then raise by `fraction` of the resulting pot.
 * raiseTo = currentBet + fraction * (pot + callAmount), clamped to the legal range.
 */
export function potRaiseTo(legal: Sizing, fraction: number): number {
  return clampRaise(legal.currentBet + fraction * (legal.pot + legal.callAmount), legal);
}

/** Snap a slider value to multiples of `step`, keeping the exact min / max reachable. */
export function snapRaise(value: number, legal: Pick<LegalActions, 'minRaiseTo' | 'maxRaiseTo'>, step: number): number {
  const v = clampRaise(value, legal);
  if (v <= legal.minRaiseTo || v >= legal.maxRaiseTo || !(step > 1)) return v;
  const snapped = Math.round(v / step) * step;
  return clampRaise(snapped, legal);
}

/** +/- one step (big blind) from the current amount, clamped to the legal range. */
export function stepRaise(amount: number, legal: Pick<LegalActions, 'minRaiseTo' | 'maxRaiseTo'>, delta: number): number {
  return clampRaise(amount + delta, legal);
}

export interface RaisePreset {
  key: 'min' | 'half' | 'threeQuarter' | 'pot' | 'allin';
  label: string;
  amount: number;
}

export function raisePresets(legal: Sizing): RaisePreset[] {
  return [
    { key: 'min', label: 'Min', amount: clampRaise(legal.minRaiseTo, legal) },
    { key: 'half', label: '½ Pot', amount: potRaiseTo(legal, 0.5) },
    { key: 'threeQuarter', label: '¾ Pot', amount: potRaiseTo(legal, 0.75) },
    { key: 'pot', label: 'Pot', amount: potRaiseTo(legal, 1) },
    { key: 'allin', label: 'All-in', amount: legal.maxRaiseTo },
  ];
}

/** The action to send for a chosen "raise to" amount. */
export function raiseAction(amount: number, legal: Pick<LegalActions, 'minRaiseTo' | 'maxRaiseTo'>): PlayerAction {
  const v = clampRaise(amount, legal);
  if (v >= legal.maxRaiseTo) return { type: 'allin' };
  return { type: 'raise', amount: v };
}

/** Confirm button text, e.g. "Raise to 120", "Bet 60", "All-in 1,500". */
export function raiseLabel(amount: number, legal: Sizing): string {
  const v = clampRaise(amount, legal);
  if (v >= legal.maxRaiseTo) return `All-in ${formatChips(v)}`;
  return legal.isBet ? `Bet ${formatChips(v)}` : `Raise to ${formatChips(v)}`;
}

/** Only an all-in shove is possible (stack too small for a full raise). */
export function onlyAllIn(legal: Pick<LegalActions, 'minRaiseTo' | 'maxRaiseTo'>): boolean {
  return legal.minRaiseTo >= legal.maxRaiseTo;
}

/** Calling puts me all-in. */
export function callIsAllIn(legal: Pick<LegalActions, 'canCall' | 'callAmount' | 'stack'>): boolean {
  return legal.canCall && legal.callAmount >= legal.stack && legal.stack > 0;
}
