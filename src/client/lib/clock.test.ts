import { describe, expect, it } from 'vitest';
import { SkewTracker, fractionLeft, msLeft, secondsLeft } from './clock';

describe('clock skew', () => {
  it('uses the largest recent offset (least latency)', () => {
    const t = new SkewTracker();
    expect(t.offset).toBe(0);
    t.add(10_000, 9_000); // +1000
    t.add(20_000, 19_200); // +800 (slower packet)
    expect(t.offset).toBe(1000);
  });
  it('computes time left against the server clock', () => {
    expect(msLeft(10_000, 1000, 8_000)).toBe(1000);
    expect(msLeft(10_000, 0, 12_000)).toBe(0);
    expect(secondsLeft(10_000, 0, 8_500)).toBe(2);
    expect(fractionLeft(10_000, 4000, 0, 8_000)).toBeCloseTo(0.5);
    expect(fractionLeft(10_000, 0, 0, 8_000)).toBe(0);
  });
});
