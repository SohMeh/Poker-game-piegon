// Pre-action toggles ("Check/Fold", "Call 40", "Call any") armed while waiting for my turn.
import type { LegalActions, PlayerAction } from '../../shared/types';

export type PreActionKind = 'checkFold' | 'call' | 'callAny';

export interface PreAction {
  kind: PreActionKind;
  /** Hand + street the toggle was armed on; it is dropped when either changes. */
  handNumber: number;
  street: string;
  /** For 'call': the amount to call when armed (0 = "Check"). Dropped if that changes. */
  toCall: number;
}

/** What to send when my turn arrives, or null when the armed toggle no longer applies. */
export function resolvePreAction(pre: PreAction, legal: LegalActions): PlayerAction | null {
  switch (pre.kind) {
    case 'checkFold':
      if (legal.canCheck) return { type: 'check' };
      return legal.canFold ? { type: 'fold' } : null;
    case 'call':
      if (pre.toCall === 0) return legal.canCheck ? { type: 'check' } : null;
      if (legal.canCall && legal.callAmount === pre.toCall) return { type: 'call' };
      return null;
    case 'callAny':
      if (legal.canCheck) return { type: 'check' };
      return legal.canCall ? { type: 'call' } : null;
  }
}

/** Should an armed toggle be dropped given the current hand state? */
export function preActionStale(pre: PreAction, handNumber: number | null, street: string | null, toCall: number): boolean {
  if (handNumber === null || street === null) return true;
  if (pre.handNumber !== handNumber || pre.street !== street) return true;
  if (pre.kind === 'call' && pre.toCall !== toCall) return true;
  return false;
}
