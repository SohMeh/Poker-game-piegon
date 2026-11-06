import { formatChips } from '../../shared/format';

const CHIP_COLORS = ['#ff5a5f', '#3b9cff', '#2ed47a', '#8b5cf6', '#ffc83d'];

export function chipCount(amount: number, bigBlind: number): number {
  if (amount <= 0) return 0;
  const bbs = amount / Math.max(1, bigBlind);
  if (bbs < 2) return 1;
  if (bbs < 6) return 2;
  if (bbs < 20) return 3;
  return 4;
}

export function ChipStack({ amount, bigBlind, label = true }: { amount: number; bigBlind: number; label?: boolean }) {
  const n = chipCount(amount, bigBlind);
  return (
    <span className="chipstack">
      <span className="chipstack-chips" aria-hidden>
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className="chip-disc" style={{ '--chip': CHIP_COLORS[(i + Math.floor(amount / Math.max(1, bigBlind))) % CHIP_COLORS.length], '--i': i } as React.CSSProperties} />
        ))}
      </span>
      {label ? <span className="chipstack-amt">{formatChips(amount, true)}</span> : null}
    </span>
  );
}
