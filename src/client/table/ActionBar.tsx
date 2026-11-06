import { useEffect, useState } from 'react';
import { formatChips } from '../../shared/format';
import type { LegalActions, PlayerAction, RoomView } from '../../shared/types';
import { IconMinus, IconPlus } from '../components/Icons';
import { amountToCall, myPlayer, playerById } from '../lib/gameState';
import type { PreActionKind } from '../lib/preActions';
import {
  callIsAllIn,
  clampRaise,
  onlyAllIn,
  raiseAction,
  raiseLabel,
  raisePresets,
  snapRaise,
  stepRaise,
} from '../lib/raise';
import { actions } from '../net/actions';
import { setPreAction, setUI, useStore } from '../state/store';

export function ActionBar({ room }: { room: RoomView }) {
  const legal = room.me.legal!;
  const raiseOpen = useStore((s) => s.ui.raiseOpen);
  const bb = room.hand?.bigBlind ?? room.settings.bigBlind;
  const [amount, setAmount] = useState(() => clampRaise(legal.minRaiseTo, legal));
  const [busy, setBusy] = useState(false);

  // a fresh decision resets the amount
  useEffect(() => {
    setAmount(clampRaise(legal.minRaiseTo, legal));
  }, [legal.minRaiseTo, legal.maxRaiseTo, legal.currentBet]);

  const send = async (a: PlayerAction) => {
    if (busy) return;
    setBusy(true);
    const res = await actions.act(a);
    setBusy(false);
    if (res.ok) setUI({ raiseOpen: false });
  };

  const allInCall = callIsAllIn(legal);
  const shoveOnly = legal.canRaise && onlyAllIn(legal);

  if (raiseOpen && legal.canRaise && !shoveOnly) {
    return (
      <div className="action-bar is-raising">
        <RaisePanel legal={legal} amount={amount} setAmount={setAmount} bigBlind={bb} />
        <div className="action-row">
          <button type="button" className="btn btn-white act-btn" onClick={() => setUI({ raiseOpen: false })}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-yellow act-btn act-confirm"
            data-testid="raise-confirm"
            disabled={busy}
            onClick={() => void send(raiseAction(amount, legal))}
          >
            {raiseLabel(amount, legal)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="action-bar" role="group" aria-label="Your turn">
      <div className="action-row">
        {legal.canFold ? (
          <button
            type="button"
            className="btn btn-red act-btn"
            data-testid="action-fold"
            disabled={busy}
            onClick={() => void send({ type: 'fold' })}
          >
            Fold
          </button>
        ) : null}
        {legal.canCheck ? (
          <button
            type="button"
            className="btn btn-green act-btn"
            data-testid="action-check"
            disabled={busy}
            onClick={() => void send({ type: 'check' })}
          >
            Check
          </button>
        ) : legal.canCall ? (
          <button
            type="button"
            className={`btn ${allInCall ? 'btn-pink' : 'btn-blue'} act-btn btn-stack`}
            data-testid="action-call"
            disabled={busy}
            onClick={() => void send(allInCall ? { type: 'allin' } : { type: 'call' })}
          >
            {allInCall ? 'All-in' : 'Call'}
            <span className="btn-sub">{formatChips(legal.callAmount)}</span>
          </button>
        ) : null}
        {legal.canRaise ? (
          shoveOnly ? (
            <button
              type="button"
              className="btn btn-pink act-btn btn-stack"
              data-testid="action-allin"
              disabled={busy}
              onClick={() => void send({ type: 'allin' })}
            >
              All-in
              <span className="btn-sub">{formatChips(legal.maxRaiseTo)}</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-yellow act-btn btn-stack"
              data-testid="action-raise"
              disabled={busy}
              onClick={() => setUI({ raiseOpen: true })}
            >
              {legal.isBet ? 'Bet' : 'Raise'}
              <span className="btn-sub">min {formatChips(legal.minRaiseTo, true)}</span>
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

function RaisePanel({
  legal,
  amount,
  setAmount,
  bigBlind,
}: {
  legal: LegalActions;
  amount: number;
  setAmount: (n: number) => void;
  bigBlind: number;
}) {
  const presets = raisePresets(legal);
  const bbs = amount / Math.max(1, bigBlind);
  const pct = legal.maxRaiseTo > legal.minRaiseTo ? ((amount - legal.minRaiseTo) / (legal.maxRaiseTo - legal.minRaiseTo)) * 100 : 100;
  return (
    <div className="raise-panel" role="group" aria-label="Choose your bet size">
      <div className="raise-readout">
        <small>{amount >= legal.maxRaiseTo ? 'All-in' : legal.isBet ? 'Bet' : 'Raise to'}</small>
        <output className="raise-amount" aria-live="polite" data-testid="raise-amount">
          {formatChips(amount)}
        </output>
        <small>{bbs >= 100 ? Math.round(bbs) : Math.round(bbs * 10) / 10} BB</small>
      </div>
      <div className="raise-slider-row">
        <button
          type="button"
          className="stepper-btn"
          aria-label="Less (one big blind)"
          onClick={() => setAmount(stepRaise(amount, legal, -bigBlind))}
          disabled={amount <= legal.minRaiseTo}
        >
          <IconMinus width={20} height={20} />
        </button>
        <input
          type="range"
          className="raise-slider"
          aria-label="Bet size"
          min={legal.minRaiseTo}
          max={legal.maxRaiseTo}
          step={1}
          value={amount}
          style={{ '--pct': `${pct}%` } as React.CSSProperties}
          onChange={(e) => setAmount(snapRaise(Number(e.target.value), legal, bigBlind))}
        />
        <button
          type="button"
          className="stepper-btn"
          aria-label="More (one big blind)"
          onClick={() => setAmount(stepRaise(amount, legal, bigBlind))}
          disabled={amount >= legal.maxRaiseTo}
        >
          <IconPlus width={20} height={20} />
        </button>
      </div>
      <div className="raise-presets">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`chip ${p.key === 'allin' ? 'chip-allin' : ''}`}
            aria-pressed={amount === p.amount}
            onClick={() => setAmount(p.amount)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PreActions({ room }: { room: RoomView }) {
  const me = myPlayer(room)!;
  const hand = room.hand!;
  const pre = useStore((s) => s.preAction);
  const toCall = amountToCall(room, me);
  const actor = playerById(room, hand.toActPlayerId);
  const arm = (kind: PreActionKind) => {
    if (pre?.kind === kind) setPreAction(null);
    else setPreAction({ kind, handNumber: hand.handNumber, street: hand.street, toCall });
  };
  const options: { kind: PreActionKind; label: string }[] = [
    { kind: 'checkFold', label: 'Check/Fold' },
    { kind: 'call', label: toCall > 0 ? `Call ${formatChips(toCall, true)}` : 'Check' },
    { kind: 'callAny', label: 'Call any' },
  ];
  return (
    <div className="panel preactions">
      <p className="panel-status">
        {hand.phase === 'betting' && actor ? (
          <>
            Waiting for <b>{actor.name}</b>…
          </>
        ) : (
          'Dealing…'
        )}
      </p>
      <div className="pre-row" role="group" aria-label="Act in advance">
        {options.map((o) => (
          <button
            key={o.kind}
            type="button"
            className="pre-btn"
            aria-pressed={pre?.kind === o.kind}
            data-testid={`pre-${o.kind}`}
            onClick={() => arm(o.kind)}
          >
            <span className="pre-box" aria-hidden>
              {pre?.kind === o.kind ? '✓' : ''}
            </span>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
