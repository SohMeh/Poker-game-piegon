import { useId, type ReactNode } from 'react';
import { IconMinus, IconPlus } from './Icons';

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="toggle-row" onClick={() => !disabled && onChange(!checked)}>
      <span className="toggle-text" id={id}>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        data-testid={testId}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
      />
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  format,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => string;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="stepper-btn"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <IconMinus width={20} height={20} />
      </button>
      <output className="stepper-value" aria-live="polite">
        {format ? format(value) : value}
      </output>
      <button
        type="button"
        className="stepper-btn"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <IconPlus width={20} height={20} />
      </button>
    </div>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  format,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  format?: (v: T) => string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          role="radio"
          className="chip"
          aria-checked={o === value}
          onClick={() => onChange(o)}
        >
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      {htmlFor ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}
