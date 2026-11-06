import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useStore } from '../state/store';

/** Server-clock "now", re-rendering every `intervalMs`. */
export function useServerNow(intervalMs = 250, active = true): number {
  const skew = useStore((s) => s.skewMs);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, active]);
  return now + skew;
}

export function serverNow(): number {
  return Date.now() + useStore.getState().skewMs;
}

/** Measures an element (content box), updating on resize. */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) =>
        Math.abs(s.width - r.width) < 0.5 && Math.abs(s.height - r.height) < 0.5 ? s : { width: r.width, height: r.height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/**
 * Elapsed time for a CSS countdown animation, computed ONCE per `key`.
 * The countdowns (shot-clock ring, vote bar) start their CSS animation with a negative
 * animation-delay equal to the time already elapsed. Changing animation-delay on a running
 * animation re-times it instead of restarting it, so recomputing the delay on every re-render
 * would count the elapsed time twice and make the bar drain too fast.
 */
export function useFrozenElapsed(key: string, compute: () => number): number {
  const ref = useRef<{ key: string; value: number } | null>(null);
  if (!ref.current || ref.current.key !== key) ref.current = { key, value: Math.max(0, compute()) };
  return ref.current.value;
}

/** Previous value of something across renders. */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}
