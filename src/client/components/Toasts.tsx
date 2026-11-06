import { dismissToast, useStore } from '../state/store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
          <span className="toast-dot" aria-hidden>
            {t.kind === 'error' ? '!' : t.kind === 'success' ? '✓' : 'i'}
          </span>
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}

export function ReconnectBanner() {
  const conn = useStore((s) => s.conn);
  const ever = useStore((s) => s.everConnected);
  const mock = useStore((s) => s.mock);
  if (mock || !ever || conn === 'connected') return null;
  return (
    <div className="reconnect-banner" role="status" aria-live="assertive">
      <span className="spinner" aria-hidden /> Reconnecting…
    </div>
  );
}
