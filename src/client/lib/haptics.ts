import { useStore } from '../state/store';

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
