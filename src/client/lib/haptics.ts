import { useStore } from '../state/store';

export function vibrate(pattern: number | number[]): void {
  if (!useStore.getState().prefs.haptics) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
