import { isEmbedded, postNative } from '../native/bridge';
import type { HapticStyle } from '../native/bridgeTypes';
import { useStore } from '../state/store';

/** The moments the table buzzes for. */
export type HapticCue = 'turn' | 'win' | 'vote';

/** Vibration pattern for browsers, and the native style used inside the iMessage extension (iOS has no navigator.vibrate). */
export const HAPTIC_CUES: Record<HapticCue, { pattern: number[]; style: HapticStyle }> = {
  turn: { pattern: [40, 60, 40], style: 'medium' },
  win: { pattern: [30, 40, 90], style: 'success' },
  vote: { pattern: [60, 40, 60], style: 'warning' },
};

export function haptic(cue: HapticCue): void {
  if (!useStore.getState().prefs.haptics) return;
  const { pattern, style } = HAPTIC_CUES[cue];
  if (isEmbedded() && postNative({ type: 'haptic', style })) return;
  vibrate(pattern);
}

export function vibrate(pattern: number | number[]): void {
  if (!useStore.getState().prefs.haptics) return;
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    // browsers block vibration before the first user gesture (and log a warning)
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua && !ua.hasBeenActive) return;
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
