// Server clock skew tracking. offset = serverTime - localReceiveTime.
// Network latency makes every sample an under-estimate, so the best estimate is the
// largest of the recent samples.

const MAX_SAMPLES = 8;

export class SkewTracker {
  private samples: number[] = [];

  add(serverTime: number, localNow: number = Date.now()): number {
    if (!Number.isFinite(serverTime)) return this.offset;
    this.samples.push(serverTime - localNow);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    return this.offset;
  }

  get offset(): number {
    if (this.samples.length === 0) return 0;
    return Math.max(...this.samples);
  }

  reset(): void {
    this.samples = [];
  }
}

/** Milliseconds left until `deadline` (server clock), never negative. */
export function msLeft(deadline: number, skewMs: number, localNow: number = Date.now()): number {
  return Math.max(0, deadline - (localNow + skewMs));
}

/** 0..1 fraction of time remaining. */
export function fractionLeft(deadline: number, durationMs: number, skewMs: number, localNow: number = Date.now()): number {
  if (!(durationMs > 0)) return 0;
  return Math.min(1, Math.max(0, msLeft(deadline, skewMs, localNow) / durationMs));
}

/** Seconds shown in a countdown label (rounded up so it reaches 0 exactly at the deadline). */
export function secondsLeft(deadline: number, skewMs: number, localNow: number = Date.now()): number {
  return Math.ceil(msLeft(deadline, skewMs, localNow) / 1000);
}
