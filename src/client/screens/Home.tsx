import { useState, type FormEvent } from 'react';
import { DEFAULT_SETTINGS, LIMITS } from '../../shared/constants';
import type { GameSettings } from '../../shared/types';
import { BirdMascot, Wordmark } from '../components/Logo';
import { Field } from '../components/controls';
import { SettingsForm } from '../components/SettingsForm';
import { extractRoomCode, isValidRoomCode, roomPath } from '../lib/route';
import { defaultBuyIn, hasErrors, validateName, validateSettings } from '../lib/settingsForm';
import { createRoom, navigate } from '../net/room';
import { loadName } from '../net/session';

export function Home() {
  const [name, setName] = useState(() => loadName());
  const [settings, setSettings] = useState<GameSettings>(() => ({
    ...DEFAULT_SETTINGS,
    buyIn: defaultBuyIn(DEFAULT_SETTINGS.bigBlind),
  }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const nameError = validateName(name);
  const errors = validateSettings(settings);
  const invalid = !!nameError || hasErrors(errors);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    const ok = await createRoom(name, settings);
    if (!ok) setBusy(false);
  };

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    const c = extractRoomCode(code);
    if (!isValidRoomCode(c)) {
      setCodeError(`Codes are ${LIMITS.roomIdLength} letters/numbers`);
      return;
    }
    navigate(roomPath(c));
  };

  return (
    <div className="home">
      <header className="home-hero">
        <BirdMascot size={112} className="home-mascot" />
        <Wordmark />
        <p className="tagline">No-Limit Hold’em for the group chat</p>
        <ul className="house-rules" aria-label="House rules">
          <li>
            <span aria-hidden>🪙</span> One buy-in each
          </li>
          <li>
            <span aria-hidden>🤝</span> Buy back only if everyone agrees
          </li>
          <li>
            <span aria-hidden>📱</span> Made for phones
          </li>
        </ul>
      </header>

      <form className="card-panel home-card" onSubmit={onCreate} noValidate>
        <h2 className="home-card-title">Start a game</h2>
        <Field label="Your name" htmlFor="home-name" error={touched ? nameError : null}>
          <input
            id="home-name"
            data-testid="home-name"
            className={`text-input ${touched && nameError ? 'is-invalid' : ''}`}
            value={name}
            maxLength={LIMITS.nameMaxLength}
            placeholder="e.g. Sam"
            autoComplete="nickname"
            enterKeyHint="go"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <SettingsForm idPrefix="create" value={settings} onChange={setSettings} errors={touched ? errors : {}} />
        <button
          type="submit"
          className="btn btn-green btn-lg btn-block"
          data-testid="create-room"
          disabled={busy || (touched && invalid)}
        >
          {busy ? 'Setting the table…' : 'Create table'}
        </button>
      </form>

      <form className="card-panel join-card" onSubmit={onJoin} noValidate>
        <h2 className="home-card-title">Have a code?</h2>
        <div className="join-row">
          <input
            className={`text-input code-input ${codeError ? 'is-invalid' : ''}`}
            aria-label="Room code"
            data-testid="join-code"
            placeholder="ABC123"
            value={code}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().slice(0, 64));
              setCodeError(null);
            }}
          />
          <button type="submit" className="btn btn-purple" data-testid="join-code-submit">
            Join
          </button>
        </div>
        {codeError ? (
          <span className="field-error" role="alert">
            {codeError}
          </span>
        ) : null}
      </form>
      <p className="home-foot">Play money only · no sign-up · share the link to invite</p>
    </div>
  );
}
