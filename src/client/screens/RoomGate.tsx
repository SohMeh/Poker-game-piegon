// Screens shown on /g/:roomId before the table: join, not found, kicked, error, loading.
import { useState, type FormEvent } from 'react';
import { LIMITS } from '../../shared/constants';
import { formatChips } from '../../shared/format';
import type { RoomSummary } from '../../shared/types';
import { BirdMascot } from '../components/Logo';
import { Field } from '../components/controls';
import { validateName } from '../lib/settingsForm';
import { joinWithName, navigate, retryJoin } from '../net/room';
import { loadName } from '../net/session';
import { useStore } from '../state/store';

function goHome(e?: { preventDefault: () => void }) {
  e?.preventDefault();
  navigate('/');
}

export function summaryLine(s: RoomSummary): string {
  return `${s.hostName}’s table · ${formatChips(s.smallBlind)}/${formatChips(s.bigBlind)} · ${s.seated}/${s.maxPlayers} seated · buy-in ${formatChips(s.buyIn)}`;
}

export function JoinScreen({ roomId }: { roomId: string }) {
  const summary = useStore((s) => s.summary);
  const phase = useStore((s) => s.phase);
  const phaseError = useStore((s) => s.phaseError);
  const [name, setName] = useState(() => loadName());
  const [touched, setTouched] = useState(false);
  const nameError = validateName(name);
  const busy = phase === 'joining';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameError || busy) return;
    await joinWithName(roomId, name);
  };

  const full = summary ? summary.seated >= summary.maxPlayers : false;
  return (
    <div className="gate">
      <form className="card-panel gate-card" onSubmit={onSubmit} noValidate>
        <BirdMascot size={92} className="gate-mascot" />
        <h1 className="gate-title">You’re invited!</h1>
        {summary ? (
          <>
            <p className="gate-summary" data-testid="room-summary">
              {summaryLine(summary)}
            </p>
            <div className="gate-pills">
              <span className={`pill ${summary.status === 'lobby' ? 'pill-yellow' : 'pill-green'}`}>
                {summary.status === 'lobby' ? 'Not started yet' : summary.status === 'paused' ? 'Paused' : 'Playing now'}
              </span>
              <span className="pill pill-soft">Room {summary.roomId}</span>
              {full ? <span className="pill pill-soft">Full — you can watch</span> : null}
            </div>
          </>
        ) : (
          <p className="gate-summary">
            Room <strong>{roomId}</strong>
            {phaseError ? ` · ${phaseError}` : ''}
          </p>
        )}
        <Field label="Your name" htmlFor="join-name" error={touched ? nameError : null}>
          <input
            id="join-name"
            data-testid="join-name"
            className={`text-input ${touched && nameError ? 'is-invalid' : ''}`}
            value={name}
            maxLength={LIMITS.nameMaxLength}
            placeholder="e.g. Sam"
            autoComplete="nickname"
            enterKeyHint="go"
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn-green btn-lg btn-block" data-testid="join-room" disabled={busy}>
          {busy ? 'Joining…' : 'Join table'}
        </button>
        <p className="gate-note">You’ll start as a spectator — tap an open seat to play.</p>
        <a className="gate-link" href="/" onClick={goHome}>
          Start your own game instead
        </a>
      </form>
    </div>
  );
}

export function NotFoundScreen() {
  return (
    <div className="gate">
      <div className="card-panel gate-card" data-testid="not-found">
        <BirdMascot size={92} className="gate-mascot is-sad" />
        <h1 className="gate-title">Game not found</h1>
        <p className="gate-summary">That table has closed, or the code is wrong. Double-check the link from your group chat.</p>
        <a className="btn btn-purple btn-lg btn-block" href="/" onClick={goHome}>
          Back home
        </a>
      </div>
    </div>
  );
}

export function KickedScreen() {
  const reason = useStore((s) => s.kickedReason);
  return (
    <div className="gate">
      <div className="card-panel gate-card" data-testid="kicked">
        <BirdMascot size={92} className="gate-mascot is-sad" />
        <h1 className="gate-title">You left the table</h1>
        <p className="gate-summary">{reason ?? 'The host removed you from this game.'}</p>
        <a className="btn btn-purple btn-lg btn-block" href="/" onClick={goHome}>
          Back home
        </a>
      </div>
    </div>
  );
}

export function ErrorScreen() {
  const err = useStore((s) => s.phaseError);
  return (
    <div className="gate">
      <div className="card-panel gate-card">
        <BirdMascot size={92} className="gate-mascot is-sad" />
        <h1 className="gate-title">Can’t reach the table</h1>
        <p className="gate-summary">{err ?? 'Something went wrong.'}</p>
        <button type="button" className="btn btn-green btn-lg btn-block" onClick={retryJoin}>
          Try again
        </button>
        <a className="gate-link" href="/" onClick={goHome}>
          Back home
        </a>
      </div>
    </div>
  );
}

export function LoadingScreen({ text = 'Pulling up a chair…' }: { text?: string }) {
  return (
    <div className="gate">
      <div className="gate-loading" role="status">
        <BirdMascot size={96} className="gate-mascot is-bouncing" />
        <p>{text}</p>
      </div>
    </div>
  );
}
