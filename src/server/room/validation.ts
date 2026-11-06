// zod schemas for every client -> server payload, plus settings / name rules.
import { z } from 'zod';
import { formatChips, LIMITS, type GameSettings } from '../../shared';

// ------------------------------------------------------------------ helpers

/** Invisible / zero-width code points (soft hyphen, Hangul fillers, ZW joiners, bidi controls, tags…). */
const IGNORABLE_RE = /\p{Default_Ignorable_Code_Point}/gu;
/** Ignorables that are part of normal emoji spelling (text / emoji presentation selectors). */
const KEEP_IGNORABLE = new Set(['\ufe0e', '\ufe0f']);
/** Characters that are not "ignorable" but still render as blank space. */
const BLANK_RE = /[\u2800\u3164\uffa0\u115f\u1160]/g;
/** At most this many combining marks per base character (no "Zalgo" names). */
const MAX_MARKS = 3;
const MARK_RUN_RE = new RegExp(`(\\p{M}{${MAX_MARKS}})\\p{M}+`, 'gu');
/** A name must contain something you can see. */
const VISIBLE_RE = /[\p{L}\p{N}\p{S}\p{P}]/u;

/**
 * NFKC-normalize, drop control / invisible characters, cap combining marks, collapse runs of
 * whitespace and trim. The result renders the way it reads (no blank or look-alike names).
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(IGNORABLE_RE, (c) => (KEEP_IGNORABLE.has(c) ? c : ''))
    .replace(BLANK_RE, ' ')
    .replace(MARK_RUN_RE, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A normalized name is usable: 1–16 characters with at least one visible character. */
export function isValidName(normalized: string): boolean {
  return normalized.length >= 1 && normalized.length <= LIMITS.nameMaxLength && VISIBLE_RE.test(normalized);
}

/** Comparison key for "is this name taken": ignores case, invisible characters and look-alike forms. */
export function nameSkeleton(name: string): string {
  return name.normalize('NFKC').replace(IGNORABLE_RE, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Trim and drop control characters (newlines are collapsed to spaces). */
export function normalizeChat(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const NAME_ERROR = `Enter a name (1–${LIMITS.nameMaxLength} characters)`;

const nameSchema = z
  .string({ error: NAME_ERROR })
  .max(500, { error: NAME_ERROR })
  .transform(normalizeName)
  .pipe(z.string().refine(isValidName, { error: NAME_ERROR }));

const idSchema = (what: string) => z.string({ error: `Missing ${what}` }).min(1, { error: `Missing ${what}` }).max(64, { error: `Invalid ${what}` });

const intField = (label: string) =>
  z.number({ error: `${label} must be a number` }).int({ error: `${label} must be a whole number` });

const boolField = (label: string) => z.boolean({ error: `${label} must be true or false` });

const obj = <S extends z.ZodRawShape>(shape: S) => z.object(shape, { error: 'Invalid request' });

// ------------------------------------------------------------------ schemas

export const settingsPatchSchema = obj({
  smallBlind: intField('Small blind').optional(),
  bigBlind: intField('Big blind').optional(),
  buyIn: intField('Buy-in').optional(),
  maxPlayers: intField('Seats').optional(),
  turnTimeSec: intField('Shot clock').optional(),
  buyBackVoteSec: intField('Vote timer').optional(),
  requireApproval: boolField('Require approval').optional(),
  allowBuyBack: boolField('Allow buy-backs').optional(),
});

export const schemas = {
  empty: z.union([z.object({}), z.null(), z.undefined()], { error: 'Invalid request' }),
  createRoom: obj({
    name: nameSchema,
    settings: settingsPatchSchema.optional(),
  }),
  joinRoom: obj({
    roomId: z.string({ error: 'Missing room code' }).max(64, { error: 'Room not found' }),
    token: z.string({ error: 'Invalid session' }).max(200, { error: 'Invalid session' }).optional(),
    name: nameSchema.optional(),
  }),
  seatTake: obj({
    seat: z.number({ error: 'Pick a seat' }).int({ error: 'That seat does not exist' }),
  }),
  sitOut: obj({ sittingOut: boolField('sittingOut') }),
  rename: obj({ name: nameSchema }),
  action: obj({
    type: z.enum(['fold', 'check', 'call', 'raise', 'allin'], { error: 'Unknown action' }),
    amount: z.number({ error: 'Bet amount must be a whole number of chips' }).optional(),
  }),
  vote: obj({ voteId: idSchema('vote'), approve: boolField('approve') }),
  voteRef: obj({ voteId: idSchema('vote') }),
  chat: obj({
    text: z
      .string({ error: 'Message is empty' })
      .max(LIMITS.chatMaxLength * 4, { error: `Messages can be at most ${LIMITS.chatMaxLength} characters` })
      .transform(normalizeChat)
      .pipe(
        z
          .string()
          .min(1, { error: 'Message is empty' })
          .max(LIMITS.chatMaxLength, { error: `Messages can be at most ${LIMITS.chatMaxLength} characters` }),
      ),
  }),
  settings: settingsPatchSchema,
  approveSeat: obj({ playerId: idSchema('player'), approve: boolField('approve') }),
  playerRef: obj({ playerId: idSchema('player') }),
} as const;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): ParseResult<T> {
  const r = schema.safeParse(payload);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error.issues[0]?.message ?? 'Invalid request' };
}

export function parseName(raw: unknown): ParseResult<string> {
  return parsePayload(nameSchema, raw);
}

// ------------------------------------------------------------------ settings rules

export interface SettingsContext {
  /** True once the first hand was dealt (buy-in is locked). */
  started: boolean;
  /** The buy-in currently in force (to detect a change while locked). */
  currentBuyIn: number;
  /** Highest seat index that is occupied or reserved by a pending request (-1 if none). */
  highestUsedSeat: number;
}

/** Full cross-field validation of a merged settings object. Returns a human message or null. */
export function checkSettings(s: GameSettings, ctx: SettingsContext): string | null {
  const ints: (keyof GameSettings)[] = ['smallBlind', 'bigBlind', 'buyIn', 'maxPlayers', 'turnTimeSec', 'buyBackVoteSec'];
  for (const k of ints) {
    const v = s[k];
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) return `${k} must be a whole number`;
  }
  if (typeof s.requireApproval !== 'boolean' || typeof s.allowBuyBack !== 'boolean') return 'Invalid settings';
  if (s.bigBlind < LIMITS.minBigBlind || s.bigBlind > LIMITS.maxBigBlind) {
    return `Big blind must be ${formatChips(LIMITS.minBigBlind)}–${formatChips(LIMITS.maxBigBlind)}`;
  }
  if (s.smallBlind < 1) return 'Small blind must be at least 1';
  if (s.smallBlind > s.bigBlind) return 'Small blind can’t be bigger than the big blind';
  if (ctx.started && s.buyIn !== ctx.currentBuyIn) {
    return 'The buy-in is locked once the first hand is dealt (start a rematch to change it)';
  }
  const minBuyIn = s.bigBlind * LIMITS.minBuyInBB;
  const maxBuyIn = s.bigBlind * LIMITS.maxBuyInBB;
  if (s.buyIn < minBuyIn || s.buyIn > maxBuyIn) {
    if (ctx.started) {
      const maxBB = Math.floor(s.buyIn / LIMITS.minBuyInBB);
      const minBB = Math.ceil(s.buyIn / LIMITS.maxBuyInBB);
      return `With a ${formatChips(s.buyIn)} buy-in the big blind must be ${formatChips(Math.max(LIMITS.minBigBlind, minBB))}–${formatChips(maxBB)}`;
    }
    return `Buy-in must be ${formatChips(minBuyIn)}–${formatChips(maxBuyIn)} (${LIMITS.minBuyInBB}–${LIMITS.maxBuyInBB} big blinds)`;
  }
  if (s.maxPlayers < LIMITS.minSeats || s.maxPlayers > LIMITS.maxSeats) {
    return `Seats must be ${LIMITS.minSeats}–${LIMITS.maxSeats}`;
  }
  if (s.maxPlayers < ctx.highestUsedSeat + 1) {
    return `Seat ${ctx.highestUsedSeat + 1} is taken — the table needs at least ${ctx.highestUsedSeat + 1} seats`;
  }
  if (s.turnTimeSec !== 0 && (s.turnTimeSec < LIMITS.minTurnTimeSec || s.turnTimeSec > LIMITS.maxTurnTimeSec)) {
    return `Shot clock must be off or ${LIMITS.minTurnTimeSec}–${LIMITS.maxTurnTimeSec} seconds`;
  }
  if (s.buyBackVoteSec < LIMITS.minVoteSec || s.buyBackVoteSec > LIMITS.maxVoteSec) {
    return `Vote timer must be ${LIMITS.minVoteSec}–${LIMITS.maxVoteSec} seconds`;
  }
  return null;
}
