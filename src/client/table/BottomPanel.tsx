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
  myPlayer,
  playerById,
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

function BuyBackButton({ room }: { room: RoomView }) {
  const now = useServerNow(500);
  const [busy, run] = useBusy();
  const avail = buyBackAvailability(room, now);
  const voters = buyBackVoterCount(room);
  const amount = room.settings.buyIn;
  let sub: string;
  if (avail.allowed) sub = voters === 0 ? 'No one else to ask' : `${voters} player${voters === 1 ? '' : 's'} must agree`;
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
      Ask to buy back in · {formatChips(amount)}
      <span className="btn-sub">{sub}</span>
    </button>
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
        <Panel title="You’re watching" sub={room.settings.requireApproval && !isHost ? 'The host approves new players' : 'Grab a seat to play'}>
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
        <Panel title="Table is full — watching" sub="You can sit when a seat opens up">
          <InviteButton />
        </Panel>
      );
    }
    case 'pending':
      return (
        <Panel title="Waiting for host approval…" sub={`${host?.name ?? 'The host'} will let you in`} tone="soft">
          <button type="button" className="btn btn-white btn-sm" disabled={busy} onClick={() => run(actions.standUp())}>
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
            <p className="panel-title">{iWon ? 'You won the game! 🏆' : winner ? `${winner.name} won the game` : 'Game over'}</p>
            <p className="panel-sub">{isHost ? 'Start a rematch — everyone gets a fresh buy-in' : `Waiting for ${host?.name ?? 'the host'}…`}</p>
          </div>
          <div className="panel-actions">
            {me?.busted || (me && me.stack === 0) ? <BuyBackButton room={room} /> : null}
            {isHost ? (
              <button type="button" className="btn btn-purple" data-testid="rematch" disabled={busy} onClick={() => run(actions.rematch())}>
                Rematch
              </button>
            ) : null}
          </div>
          <MyBuyBackStatus room={room} />
        </div>
      );
    }
    case 'busted':
      return (
        <div className="panel panel-busted">
          <div className="panel-text">
            <p className="panel-title">You’re out of chips</p>
            <p className="panel-sub">
              {room.settings.allowBuyBack
                ? 'One buy-in per player — buying back needs everyone’s OK'
                : 'Buy-backs are off for this game'}
            </p>
          </div>
          <MyBuyBackStatus room={room} />
          <div className="panel-actions">
            <BuyBackButton room={room} />
            <button type="button" className="btn btn-white btn-sm" data-testid="stand-up" disabled={busy} onClick={() => run(actions.standUp())}>
              Stand up
            </button>
          </div>
        </div>
      );
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
