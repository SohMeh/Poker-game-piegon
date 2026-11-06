// Pure validation for the "Start a game" form and the host settings editor.
import { LIMITS } from '../../shared/constants';
import type { GameSettings } from '../../shared/types';

export const BLIND_PRESETS: ReadonlyArray<readonly [number, number]> = [
  [5, 10],
  [10, 20],
  [25, 50],
  [50, 100],
  [100, 200],
];

export const DEFAULT_BUYIN_BB = 100;

export type SettingsErrors = Partial<Record<keyof GameSettings | 'name', string>>;

function isInt(n: number): boolean {
  return Number.isFinite(n) && Math.floor(n) === n;
}

export function defaultBuyIn(bigBlind: number): number {
  return bigBlind * DEFAULT_BUYIN_BB;
}

export function validateName(name: string): string | null {
  const t = name.trim();
  if (!t) return 'Enter your name';
  if (t.length > LIMITS.nameMaxLength) return `Max ${LIMITS.nameMaxLength} characters`;
  return null;
}

export function validateSettings(s: GameSettings): SettingsErrors {
  const e: SettingsErrors = {};
  if (!isInt(s.bigBlind) || s.bigBlind < LIMITS.minBigBlind || s.bigBlind > LIMITS.maxBigBlind) {
    e.bigBlind = `Big blind must be ${LIMITS.minBigBlind}–${LIMITS.maxBigBlind.toLocaleString('en-US')}`;
  }
  if (!isInt(s.smallBlind) || s.smallBlind < 1) e.smallBlind = 'Small blind must be at least 1';
  else if (s.smallBlind > s.bigBlind) e.smallBlind = 'Small blind can’t be bigger than the big blind';
  if (!e.bigBlind) {
    const min = s.bigBlind * LIMITS.minBuyInBB;
    const max = s.bigBlind * LIMITS.maxBuyInBB;
    if (!isInt(s.buyIn) || s.buyIn < min || s.buyIn > max) {
      e.buyIn = `Buy-in must be ${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')} (${LIMITS.minBuyInBB}–${LIMITS.maxBuyInBB} big blinds)`;
    }
  }
  if (!isInt(s.maxPlayers) || s.maxPlayers < LIMITS.minSeats || s.maxPlayers > LIMITS.maxSeats) {
    e.maxPlayers = `Seats must be ${LIMITS.minSeats}–${LIMITS.maxSeats}`;
  }
  if (
    !isInt(s.turnTimeSec) ||
    (s.turnTimeSec !== 0 && (s.turnTimeSec < LIMITS.minTurnTimeSec || s.turnTimeSec > LIMITS.maxTurnTimeSec))
  ) {
    e.turnTimeSec = 'Pick a shot clock';
  }
  if (!isInt(s.buyBackVoteSec) || s.buyBackVoteSec < LIMITS.minVoteSec || s.buyBackVoteSec > LIMITS.maxVoteSec) {
    e.buyBackVoteSec = 'Pick a vote timer';
  }
  return e;
}

export function hasErrors(e: SettingsErrors): boolean {
  return Object.values(e).some(Boolean);
}

/** Only the fields that changed (for host:updateSettings). */
export function settingsDiff(before: GameSettings, after: GameSettings): Partial<GameSettings> {
  const out: Partial<GameSettings> = {};
  for (const k of Object.keys(after) as (keyof GameSettings)[]) {
    if (before[k] !== after[k]) (out as Record<string, unknown>)[k] = after[k];
  }
  return out;
}

/** Parses a number input; empty / garbage -> NaN. */
export function parseIntInput(raw: string): number {
  const cleaned = raw.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

/** Lowest table size allowed given occupied seats (can't shrink below an occupied seat). */
export function minSeatsAllowed(seats: (string | null)[]): number {
  let highest = -1;
  seats.forEach((s, i) => {
    if (s != null) highest = i;
  });
  return Math.max(LIMITS.minSeats, highest + 1);
}
