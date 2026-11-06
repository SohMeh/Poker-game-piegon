import { msLeft } from '../lib/clock';
import { useFrozenElapsed } from '../lib/hooks';
import { useStore } from '../state/store';

/**
 * SVG ring that drains over the shot clock. Driven by a CSS animation whose negative delay is the
 * time already elapsed (skew-corrected), so it costs nothing per frame.
 */
export function CountdownRing({
  size,
  deadline,
  durationMs,
}: {
  size: number;
  deadline: number | null;
  durationMs: number | null;
}) {
  const skew = useStore((s) => s.skewMs);
  const stroke = Math.max(3, Math.round(size * 0.075));
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const timed = deadline != null && durationMs != null && durationMs > 0;
  const key = timed ? `t${deadline}` : 'untimed';
  // frozen per countdown: re-rendering must not shift the running animation (see useFrozenElapsed)
  const elapsed = useFrozenElapsed(key, () => (timed ? durationMs! - msLeft(deadline!, skew) : 0));
  return (
    <svg
      className={`ring ${timed ? 'is-timed' : 'is-untimed'}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
    >
      <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
      <circle
        key={key}
        className="ring-progress"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={0}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={
          timed
            ? ({
                '--c': `${c}px`,
                '--dur': `${durationMs}ms`,
                animationDuration: `${durationMs}ms`,
                animationDelay: `-${elapsed}ms`,
              } as React.CSSProperties)
            : undefined
        }
      />
    </svg>
  );
}
