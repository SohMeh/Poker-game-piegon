// Tiny WebAudio synth: every sound is generated, no audio files.
import { useStore } from '../state/store';

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let noise: AudioBuffer | null = null;
let master: GainNode | null = null;

function ensureCtx(): Ctx | null {
  if (ctx) return ctx;
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

/** iOS only lets audio start inside a user gesture: unlock on the first touch / key press. */
export function installAudioUnlock(): void {
  const unlock = () => {
    const c = ensureCtx();
    if (!c) return;
    void c.resume().catch(() => undefined);
    try {
      const b = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = b;
      src.connect(c.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
    if (c.state === 'running') {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchend', unlock);
      window.removeEventListener('keydown', unlock);
    }
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchend', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}

function ready(): Ctx | null {
  if (!useStore.getState().prefs.sound) return null;
  const c = ensureCtx();
  if (!c || c.state !== 'running' || !master) return null;
  return c;
}

function getNoise(c: Ctx): AudioBuffer {
  if (noise) return noise;
  const len = Math.floor(c.sampleRate * 0.4);
  noise = c.createBuffer(1, len, c.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  slideTo?: number;
}

function tone(c: Ctx, freq: number, at: number, dur: number, o: ToneOpts = {}): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, at);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, at + dur);
  const peak = o.gain ?? 0.25;
  const attack = o.attack ?? 0.01;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(master!);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

function burst(c: Ctx, at: number, dur: number, freq: number, q: number, gain: number): void {
  const src = c.createBufferSource();
  src.buffer = getNoise(c);
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(at);
  src.stop(at + dur + 0.02);
}

export const sfx = {
  /** Two-note "ding-dong" when it becomes my turn. */
  turn(): void {
    const c = ready();
    if (!c) return;
    const t = c.currentTime + 0.01;
    tone(c, 880, t, 0.35, { type: 'sine', gain: 0.3 });
    tone(c, 1318.5, t + 0.13, 0.5, { type: 'sine', gain: 0.28 });
    tone(c, 2637, t + 0.13, 0.25, { type: 'sine', gain: 0.05 });
  },
  /** Clacky chip click. */
  chip(): void {
    const c = ready();
    if (!c) return;
    const t = c.currentTime + 0.005;
    burst(c, t, 0.05, 3800, 6, 0.5);
    tone(c, 2400, t, 0.05, { type: 'triangle', gain: 0.12 });
    burst(c, t + 0.06, 0.04, 4200, 6, 0.3);
  },
  /** Card sliding across the felt. */
  deal(): void {
    const c = ready();
    if (!c) return;
    const t = c.currentTime + 0.005;
    for (let i = 0; i < 3; i++) burst(c, t + i * 0.07, 0.08, 2200 - i * 200, 1.2, 0.25);
  },
  /** Card flip on the board. */
  flip(): void {
    const c = ready();
    if (!c) return;
    const t = c.currentTime + 0.005;
    burst(c, t, 0.06, 1800, 1.5, 0.35);
    tone(c, 600, t, 0.06, { type: 'triangle', gain: 0.08, slideTo: 300 });
  },
  /** Happy arpeggio for winning a pot. */
  win(big = false): void {
    const c = ready();
    if (!c) return;
    const t = c.currentTime + 0.01;
    const notes = big ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [659.25, 783.99, 1046.5];
    notes.forEach((f, i) => tone(c, f, t + i * 0.09, 0.4, { type: 'triangle', gain: 0.22 }));
    burst(c, t + notes.length * 0.09, 0.3, 6000, 0.8, 0.08);
  },
  /** Attention blip for a buy-back vote. */
  alert(): void {
    const c = ready();
    if (!c) return;
    const t = c.currentTime + 0.01;
    tone(c, 740, t, 0.16, { type: 'square', gain: 0.07 });
    tone(c, 988, t + 0.15, 0.22, { type: 'square', gain: 0.07 });
  },
  /** Soft pop for chat messages. */
  pop(): void {
    const c = ready();
    if (!c) return;
    const t = c.currentTime + 0.005;
    tone(c, 500, t, 0.09, { type: 'sine', gain: 0.12, slideTo: 900 });
  },
};
