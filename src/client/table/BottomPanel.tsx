import { useState } from 'react';
import { formatChips } from '../../shared/format';
import type { RoomView } from '../../shared/types';
import { secondsLeft } from '../lib/clock';
import {
  bottomMode,
  buyBackAvailability,
  buyBackVoterCount,
  eligibleCount,
  firstFreeSeat,
  isGameOver,
  isStalled,
  myPendingRequest,
  myPlayer,
  playerById,
  seatNeedsApproval,
  type BottomMode,
} from '../lib/gameState';
import { useServerNow } from '../lib/hooks';
import { actions } from '../net/actions';
import { setUI } from '../state/store';
import { ActionBar, PreActions } from './ActionBar';
import { MyBuyBackStatus } from './BuyBackVote';

function Panel({ title, sub, children, tone }: { title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; tone?: string }) {
  return (
    <div className={`panel ${tone ? `panel-${tone}` : ''}`}>
      <div className="panel-text">
        <p className="panel-title">{title}</p>
        {sub ? <p className="panel-sub">{sub}</p> : null}
      </div>
      {children ? <div className="panel-actions">{children}</div> : null}
    </div>
  );
}

function InviteButton() {
  return (
    <button type="button" className="btn btn-white btn-sm" onClick={() => setUI({ inviteOpen: true })}>
      Invite
    </button>
  );
}

function useBusy(): [boolean, (p: Promise<unknown>) => void] {
  const [busy, setBusy] = useState(false);
  return [
    busy,
    (p) => {
      setBusy(true);
      void p.finally(() => setBusy(false));
    },
  ];
}

function BuyBackButton({ room, compact }: { room: RoomView; compact?: boolean }) {
  const now = useServerNow(500);
  const [busy, run] = useBusy();
  const avail = buyBackAvailability(room, now);
  const voters = buyBackVoterCount(room);
  const amount = room.settings.buyIn;
  let sub: string;
  if (avail.allowed) {
    sub =
      voters === 0
        ? `${formatChips(amount)} chips`
        : compact
          ? `${voters} must agree`
          : `${voters} player${voters === 1 ? '' : 's'} must agree · ${formatChips(amount)}`;
  }
  else if (avail.cooldownUntil) sub = `You can ask again in ${secondsLeft(avail.cooldownUntil, 0, now)}s`;
  else sub = avail.reason;
  return (
    <button
      type="button"
      className="btn btn-green btn-stack buyback-btn"
      data-testid="buyback-request"
      disabled={!avail.allowed || busy}
      onClick={() => run(actions.requestBuyBack())}
    >
      {compact ? 'Buy back in' : 'Ask to buy back in'}
      <span className="btn-sub">{sub}</span>
    </button>
  );
}

/** Host only, when no hand can be dealt: start over (two taps, it resets every stack). */
function StartOverButton() {
  const [confirm, setConfirm] = useState(false);
  const [busy, run] = useBusy();
  if (!confirm) {
    return (
      <button type="button" className="btn btn-white btn-sm" data-testid="start-over" onClick={() => setConfirm(true)}>
        New game
      </button>
    );
  }
  return (
    <>
      <button type="button" className="btn btn-white btn-sm" onClick={() => setConfirm(false)}>
        Keep playing
      </button>
      <button type="button" className="btn btn-purple btn-sm" data-testid="rematch" disabled={busy} onClick={() => run(actions.rematch())}>
        Reset all stacks
      </button>
    </>
  );
}

export function BottomPanel({ room }: { room: RoomView }) {
  const mode: BottomMode = bottomMode(room);
  const me = myPlayer(room);
  const [busy, run] = useBusy();
  const host = playerById(room, room.hostId);
  const isHost = room.me.isHost;

  switch (mode) {
    case 'act':
      return <ActionBar room={room} />;
    case 'inHand':
      return <PreActions room={room} />;
    case 'spectator': {
      const free = firstFreeSeat(room);
      return free !== null ? (
        <Panel title="You’re watching" sub={seatNeedsApproval(room) ? 'The host approves new players' : 'Grab a seat to play'}>
          <button
            type="button"
            className="btn btn-green"
            data-testid="sit-down"
            disabled={busy}
            onClick={() => run(actions.takeSeat(free))}
          >
            Sit down
          </button>
        </Panel>
      ) : (
        <Panel title={<span data-testid="table-full">Table is full — watching</span>} sub="You can sit when a seat opens up">
          <InviteButton />
        </Panel>
      );
    }
    case 'pending':
      return (
        <Panel title={<span data-testid="pending-approval">Waiting for host approval…</span>} sub={`${host?.name ?? 'The host'} will let you in`} tone="soft">
          <button type="button" className="btn btn-white btn-sm" data-testid="cancel-seat-request" disabled={busy} onClick={() => run(actions.standUp())}>
            Cancel
          </button>
        </Panel>
      );
    case 'gameOver': {
      const winner = playerById(room, room.gameOverWinnerId);
      const iWon = winner?.id === room.me.playerId;
      return (
        <div className="panel panel-gameover">
          <div className="panel-text">
            <p className="panel-title">{iWon ? 'You won the game! 🏆' : winner ? `${winner.name} won the game 🏆` : 'Game over'}</p>
            <p className="panel-sub">{isHost ? 'Rematch gives everyone a fresh buy-in' : `Waiting for ${host?.name ?? 'the host'} to start a rematch`}</p>
          </div>
          <MyBuyBackStatus room={room} />
          <div className="panel-actions">
            {(me?.busted || (me && me.stack === 0)) && !myPendingRequest(room) ? <BuyBackButton room={room} compact={isHost} /> : null}
            {isHost ? (
              <button type="button" className="btn btn-purple" data-testid="rematch" disabled={busy} onClick={() => run(actions.rematch())}>
                Rematch
              </button>
            ) : null}
          </div>
        </div>
      );
    }
    case 'busted': {
      const pending = myPendingRequest(room);
      return (
        <div className="panel panel-busted">
          <div className="panel-row">
            <div className="panel-text">
              <p className="panel-title">You’re out of chips</p>
              {!pending ? (
                <p className="panel-sub">
                  {room.settings.allowBuyBack ? 'One buy-in each — buying back needs everyone’s OK' : 'Buy-backs are off for this game'}
                </p>
              ) : null}
            </div>
            <button type="button" className="btn btn-white btn-xs" data-testid="stand-up" disabled={busy} onClick={() => run(actions.standUp())}>
              Stand up
            </button>
          </div>
          <MyBuyBackStatus room={room} />
          {!pending ? <BuyBackButton room={room} /> : null}
        </div>
      );
    }
    case 'lobby': {
      const ready = eligibleCount(room);
      return isHost ? (
        <Panel
          title={ready >= 2 ? `${ready} players ready` : 'Need at least 2 players'}
          sub={ready >= 2 ? 'Deal when everyone’s in' : 'Send the link to your group chat'}
        >
          <InviteButton />
          <button
            type="button"
            className="btn btn-green"
            data-testid="start-game"
            disabled={ready < 2 || busy}
            onClick={() => run(actions.start())}
          >
            Start game
          </button>
        </Panel>
      ) : (
        <Panel title={`Waiting for ${host?.name ?? 'the host'} to start`} sub="Grab a snack, invite a friend">
          <InviteButton />
        </Panel>
      );
    }
    case 'sittingOut':
      return (
        <Panel title="You’re sitting out" sub="You won’t be dealt in until you’re back">
          <button type="button" className="btn btn-green" data-testid="im-back" disabled={busy} onClick={() => run(actions.sitOut(false))}>
            I’m back
          </button>
        </Panel>
      );
    case 'paused':
      return (
        <Panel title="Game paused" sub={isHost ? 'Resume when everyone’s ready' : `${host?.name ?? 'The host'} paused the game`}>
          {isHost ? (
            <button type="button" className="btn btn-green" disabled={busy} onClick={() => run(actions.resume())}>
              Resume
            </button>
          ) : null}
        </Panel>
      );
    case 'folded':
    case 'allIn':
    case 'waiting': {
      if (mode === 'waiting' && isStalled(room)) {
        return (
          <Panel title={<span data-testid="waiting-for-players">Waiting for players</span>} sub="A hand starts once 2 players with chips are in">
            {isHost ? <StartOverButton /> : <InviteButton />}
          </Panel>
        );
      }
      const title =
        mode === 'folded'
          ? 'You folded'
          : mode === 'allIn'
            ? 'You’re all-in! 🤞'
            : room.hand && room.hand.phase !== 'complete'
              ? 'You’re in next hand'
              : 'Next hand coming up';
      const sub = mode === 'allIn' ? 'Good luck…' : isGameOver(room) ? '' : 'Sit tight';
      return (
        <Panel title={title} sub={sub}>
          {room.me.canShowCards ? (
            <button type="button" className="btn btn-purple btn-sm" data-testid="show-cards" disabled={busy} onClick={() => run(actions.showCards())}>
              Show cards
            </button>
          ) : null}
        </Panel>
      );
    }
  }
}
