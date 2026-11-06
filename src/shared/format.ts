/** 1234 -> "1,234"; 1250000 -> "1.25M" when compact. */
export function formatChips(n: number, compact = false): string {
  if (!Number.isFinite(n)) return '0';
  if (compact) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
    if (abs >= 10_000) return `${trim(n / 1_000)}K`;
  }
  return Math.round(n).toLocaleString('en-US');
}

function trim(x: number): string {
  return x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1');
}

export function formatSigned(n: number): string {
  if (n > 0) return `+${formatChips(n)}`;
  if (n < 0) return `-${formatChips(-n)}`;
  return '0';
}
