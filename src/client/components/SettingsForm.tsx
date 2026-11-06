// Table settings form used by "Start a game" and by the host settings editor.
import { useEffect, useState } from 'react';
import { LIMITS, TURN_TIME_OPTIONS, VOTE_TIME_OPTIONS } from '../../shared/constants';
import { formatChips } from '../../shared/format';
import type { GameSettings } from '../../shared/types';
import { BLIND_PRESETS, parseIntInput, type SettingsErrors } from '../lib/settingsForm';
import { Field, Segmented, Stepper, Toggle } from './controls';

interface Props {
  value: GameSettings;
  onChange: (s: GameSettings) => void;
  errors: SettingsErrors;
  /** Buy-in can no longer change once the first hand was dealt. */
  lockedBuyIn?: boolean;
  minSeats?: number;
  idPrefix: string;
}

function NumberInput({
  id,
  value,
  onChange,
  invalid,
  label,
  disabled,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  invalid?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState(Number.isFinite(value) ? String(value) : '');
  useEffect(() => {
    if (parseIntInput(raw) !== value) setRaw(Number.isFinite(value) ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      className={`text-input ${invalid ? 'is-invalid' : ''}`}
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      aria-label={label}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      value={raw}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d]/g, '').slice(0, 9);
        setRaw(v);
        onChange(parseIntInput(v));
      }}
    />
  );
}

export function SettingsForm({ value, onChange, errors, lockedBuyIn, minSeats = LIMITS.minSeats, idPrefix }: Props) {
  const presetIndex = BLIND_PRESETS.findIndex(([sb, bb]) => sb === value.smallBlind && bb === value.bigBlind);
  const [custom, setCustom] = useState(presetIndex < 0);
  const set = (p: Partial<GameSettings>) => onChange({ ...value, ...p });

  const setBlinds = (sb: number, bb: number) => {
    const bbMultiple = value.bigBlind > 0 ? Math.round(value.buyIn / value.bigBlind) : 100;
    const next: Partial<GameSettings> = { smallBlind: sb, bigBlind: bb };
    if (!lockedBuyIn && Number.isFinite(bb) && bb > 0) next.buyIn = bbMultiple * bb;
    set(next);
  };

  const bbs = value.bigBlind > 0 && Number.isFinite(value.buyIn) ? value.buyIn / value.bigBlind : NaN;

  return (
    <div className="settings-form">
      <Field label="Blinds" error={errors.bigBlind ?? errors.smallBlind}>
        <div className="chips" role="radiogroup" aria-label="Blinds">
          {BLIND_PRESETS.map(([sb, bb], i) => (
            <button
              key={bb}
              type="button"
              role="radio"
              className="chip"
              aria-checked={!custom && presetIndex === i}
              onClick={() => {
                setCustom(false);
                setBlinds(sb, bb);
              }}
            >
              {sb}/{bb}
            </button>
          ))}
          <button type="button" role="radio" className="chip" aria-checked={custom} onClick={() => setCustom(true)}>
            Custom
          </button>
        </div>
        {custom ? (
          <div className="blind-inputs">
            <label className="mini-field">
              <span>Small blind</span>
              <NumberInput
                id={`${idPrefix}-sb`}
                value={value.smallBlind}
                invalid={!!errors.smallBlind}
                onChange={(v) => set({ smallBlind: v })}
              />
            </label>
            <span className="blind-slash" aria-hidden>
              /
            </span>
            <label className="mini-field">
              <span>Big blind</span>
              <NumberInput
                id={`${idPrefix}-bb`}
                value={value.bigBlind}
                invalid={!!errors.bigBlind}
                onChange={(v) => setBlinds(value.smallBlind, v)}
              />
            </label>
          </div>
        ) : null}
      </Field>

      <Field
        label="Buy-in"
        htmlFor={`${idPrefix}-buyin`}
        error={errors.buyIn}
        hint={
          lockedBuyIn
            ? 'Locked — the game has started'
            : Number.isFinite(bbs)
              ? `${Number.isInteger(bbs) ? bbs : bbs.toFixed(1)} big blinds · everyone gets exactly one`
              : 'Everyone gets exactly one buy-in'
        }
      >
        <div className="buyin-row">
          <NumberInput
            id={`${idPrefix}-buyin`}
            value={value.buyIn}
            invalid={!!errors.buyIn}
            disabled={lockedBuyIn}
            onChange={(v) => set({ buyIn: v })}
          />
          {!lockedBuyIn ? (
            <div className="chips buyin-quick">
              {[50, 100, 200].map((m) => (
                <button
                  key={m}
                  type="button"
                  className="chip"
                  aria-pressed={value.buyIn === m * value.bigBlind}
                  aria-label={`${m} big blinds (${formatChips(m * value.bigBlind)})`}
                  onClick={() => set({ buyIn: m * value.bigBlind })}
                  disabled={!Number.isFinite(value.bigBlind) || value.bigBlind <= 0}
                >
                  {m}bb
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </Field>

      <div className="settings-row">
        <Field label="Seats" error={errors.maxPlayers} hint="Others can watch">
          <Stepper
            label="Seats"
            value={value.maxPlayers}
            min={Math.max(LIMITS.minSeats, minSeats)}
            max={LIMITS.maxSeats}
            onChange={(v) => set({ maxPlayers: v })}
          />
        </Field>
      </div>

      <Field label="Shot clock" error={errors.turnTimeSec}>
        <Segmented
          label="Shot clock"
          options={TURN_TIME_OPTIONS}
          value={value.turnTimeSec as (typeof TURN_TIME_OPTIONS)[number]}
          onChange={(v) => set({ turnTimeSec: v })}
          format={(v) => (v === 0 ? 'Off' : `${v}s`)}
        />
      </Field>

      <Field label="Buy-back vote timer" error={errors.buyBackVoteSec} hint="Anyone who doesn’t answer in time counts as a no">
        <Segmented
          label="Buy-back vote timer"
          options={VOTE_TIME_OPTIONS}
          value={value.buyBackVoteSec as (typeof VOTE_TIME_OPTIONS)[number]}
          onChange={(v) => set({ buyBackVoteSec: v })}
          format={(v) => `${v}s`}
        />
      </Field>

      <div className="toggles">
        <Toggle
          label="Allow buy-backs (everyone must agree)"
          hint="Busted players can ask; one “no” and they’re out"
          checked={value.allowBuyBack}
          onChange={(v) => set({ allowBuyBack: v })}
          testId={`${idPrefix}-allow-buyback`}
        />
        <Toggle
          label="Approve players before they sit"
          hint="You’ll get a request for every new seat"
          checked={value.requireApproval}
          onChange={(v) => set({ requireApproval: v })}
          testId={`${idPrefix}-require-approval`}
        />
      </div>
    </div>
  );
}
