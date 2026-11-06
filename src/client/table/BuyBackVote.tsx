// Buy-back voting UI: the voter modal, compact progress cards and the requester's status.
import { useState } from 'react';
import { formatChips } from '../../shared/format';
import type { BuyBackVoteView, RoomView, VoteChoice } from '../../shared/types';
import { Avatar } from '../components/Avatar';
import { msLeft, secondsLeft } from '../lib/clock';
import { tallyVote, voteOutcomeText } from '../lib/describe';
import { nameResolver, playerById } from '../lib/gameState';
import { useFrozenElapsed, useServerNow } from '../lib/hooks';
import { actions } from '../net/actions';
import { useStore } from '../state/store';

function VoteTimer({ vote, compact }: { vote: BuyBackVoteView; compact?: boolean }) {
  const now = useServerNow(250, vote.status === 'pending');
  const skew = useStore((s) => s.skewMs);
  const total = Math.max(1, vote.deadline - vote.createdAt);
  // frozen per vote: re-rendering every 250 ms must not shift the running animation
  const elapsed = useFrozenElapsed(vote.id, () => total - msLeft(vote.deadline, skew));
  const secs = secondsLeft(vote.deadline, 0, now);
  return (
    <div className={`vote-timer ${compact ? 'is-compact' : ''} ${secs <= 5 ? 'is-low' : ''}`}>
      <div className="vote-bar" aria-hidden>
        <div
          key={vote.id}
          className="vote-bar-fill"
          style={
            {
              '--dur': `${total}ms`,
              animationDuration: `${total}ms`,
              animationDelay: `-${elapsed}ms`,
            } as React.CSSProperties
          }
        />
      </div>
      <span className="vote-secs" aria-label={`${secs} seconds left`}>
        {secs}s
      </span>
    </div>
  );
}

function choiceText(c: VoteChoice | null): { icon: string; text: string; tone: string } {
  if (c === 'yes') return { icon: '✓', text: 'Yes', tone: 'yes' };
  if (c === 'no') return { icon: '✗', text: 'No', tone: 'no' };
  return { icon: '…', text: 'Waiting', tone: 'wait' };
}

export function VoterList({ vote, room, compact }: { vote: BuyBackVoteView; room: RoomView; compact?: boolean }) {
  const nameOf = nameResolver(room);
  return (
    <ul className={`voters ${compact ? 'is-compact' : ''}`} aria-label="Votes">
      {Object.entries(vote.votes).map(([id, c]) => {
        const p = playerById(room, id);
        const t = choiceText(c);
        const mine = id === room.me.playerId;
        return (
          <li key={id} className={`voter tone-${t.tone}`}>
            {!compact && p ? <Avatar name={p.name} color={p.color} size={26} /> : null}
            <span className="voter-name">{mine ? 'You' : nameOf(id)}</span>
            <span className="voter-choice" aria-label={t.text}>
              {t.icon}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Big modal for voters. */
export function VoteModal({ room }: { room: RoomView }) {
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const vote = room.buyBackVotes.find(
    (v) => v.status === 'pending' && room.me.votesAwaitingMe.includes(v.id) && !sent[v.id],
  );
  if (!vote) return null;
  const requester = playerById(room, vote.requesterId);
  const t = tallyVote(vote);
  const cast = (approve: boolean) => {
    setSent((s) => ({ ...s, [vote.id]: true }));
    void actions.voteBuyBack(vote.id, approve).then((r) => {
      if (!r.ok) setSent((s) => ({ ...s, [vote.id]: false }));
    });
  };
  return (
    <div className="vote-layer">
      <div
        className="vote-modal"
        role="alertdialog"
        aria-modal="false"
        aria-labelledby={`vote-${vote.id}-title`}
        aria-describedby={`vote-${vote.id}-desc`}
        data-testid="buyback-vote"
      >
        <div className="vote-head">
          {requester ? <Avatar name={requester.name} color={requester.color} size={52} /> : null}
          <div>
            <p className="vote-kicker">Buy-back vote</p>
            <h2 className="vote-title" id={`vote-${vote.id}-title`}>
              {vote.requesterName} wants to buy back in for {formatChips(vote.amount)}.
            </h2>
          </div>
        </div>
        <p className="vote-desc" id={`vote-${vote.id}-desc`}>
          Everyone must agree. No answer in time counts as “no”.
        </p>
        <VoteTimer vote={vote} />
        <VoterList vote={vote} room={room} />
        <p className="vote-tally">
          {t.yes} of {t.total} agreed so far
        </p>
        <div className="vote-actions">
          <button type="button" className="btn btn-red btn-lg" data-testid="vote-reject" onClick={() => cast(false)}>
            ✗ Reject
          </button>
          <button type="button" className="btn btn-green btn-lg" data-testid="vote-approve" onClick={() => cast(true)}>
            ✓ Approve
          </button>
        </div>
      </div>
    </div>
  );
}

/** Names for vote outcome lines, with the viewer called "you" ("Rejected by you"). */
function voteNameOf(room: RoomView): (id: string) => string {
  const base = nameResolver(room);
  return (id) => (id === room.me.playerId ? 'you' : base(id));
}

/** Small card on the table for everyone who isn't being asked right now. */
export function VoteProgressCard({ vote, room }: { vote: BuyBackVoteView; room: RoomView }) {
  const nameOf = voteNameOf(room);
  const t = tallyVote(vote);
  const pending = vote.status === 'pending';
  const tone = pending ? 'pending' : vote.status === 'approved' ? 'approved' : 'rejected';
  return (
    <div className={`float-card vote-card tone-${tone}`} role="status" data-testid="buyback-progress">
      <div className="float-card-row">
        <span className="vote-card-icon" aria-hidden>
          {pending ? '🗳️' : vote.status === 'approved' ? '🎉' : '🚫'}
        </span>
        <div className="float-card-text">
          <b>
            {vote.requesterName} {pending ? 'wants back in' : vote.status === 'approved' ? 'is back in!' : 'stays out'}
          </b>
          <span>{pending ? `${t.yes}/${t.total} agreed · ${formatChips(vote.amount)} chips` : voteOutcomeText(vote, nameOf)}</span>
        </div>
        {pending ? <VoteTimer vote={vote} compact /> : null}
      </div>
      {pending ? <VoterList vote={vote} room={room} compact /> : null}
    </div>
  );
}

/** The requester's own view of their request (inside the busted panel). */
export function MyBuyBackStatus({ room }: { room: RoomView }) {
  const vote = [...room.buyBackVotes].reverse().find((v) => v.requesterId === room.me.playerId);
  if (!vote) return null;
  const nameOf = voteNameOf(room);
  const pending = vote.status === 'pending';
  const t = tallyVote(vote);
  return (
    <div className={`my-vote tone-${pending ? 'pending' : vote.status}`} data-testid="my-buyback" role="status">
      <div className="my-vote-head">
        <span>
          {pending ? (
            <>
              <b>Waiting for votes</b> · {t.yes}/{t.total} agreed
            </>
          ) : (
            <b>{vote.status === 'approved' ? 'Approved by everyone — you’re back in!' : voteOutcomeText(vote, nameOf)}</b>
          )}
        </span>
        {pending ? (
          <button type="button" className="btn btn-white btn-xs" data-testid="buyback-cancel" onClick={() => void actions.cancelBuyBack(vote.id)}>
            Cancel
          </button>
        ) : null}
      </div>
      {pending ? (
        <>
          <VoteTimer vote={vote} compact />
          <VoterList vote={vote} room={room} compact />
        </>
      ) : null}
    </div>
  );
}

/** Pending / recently resolved votes that are not mine and are not waiting for my vote. */
export function otherVotes(room: RoomView): BuyBackVoteView[] {
  return room.buyBackVotes.filter(
    (v) =>
      v.requesterId !== room.me.playerId &&
      !(v.status === 'pending' && room.me.votesAwaitingMe.includes(v.id)),
  );
}
