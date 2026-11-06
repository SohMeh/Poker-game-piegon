import { useMemo } from 'react';

const COLORS = ['#ff5a5f', '#ffc83d', '#2ed47a', '#3b9cff', '#8b5cf6', '#ff6fb1', '#ff9a3c'];

/** Pure-CSS confetti burst. Change `burstKey` to replay. */
export function Confetti({ burstKey, count = 46 }: { burstKey: string | number; count?: number }) {
  const pieces = useMemo(() => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    return Array.from({ length: count }, (_, i) => ({
      left: rnd() * 100,
      delay: rnd() * 600,
      dur: 1800 + rnd() * 1600,
      color: COLORS[i % COLORS.length]!,
      size: 6 + rnd() * 7,
      drift: (rnd() - 0.5) * 120,
      spin: (rnd() - 0.5) * 1080,
      round: rnd() > 0.6,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstKey, count]);
  return (
    <div className="confetti" aria-hidden key={burstKey}>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.45,
              borderRadius: p.round ? '50%' : 2,
              background: p.color,
              animationDelay: `${p.delay}ms`,
              animationDuration: `${p.dur}ms`,
              '--drift': `${p.drift}px`,
              '--spin': `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
