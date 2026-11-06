// Cards floating at the top of the table: host seat requests, buy-back progress, chat pops.
import type { RoomView } from '../../shared/types';
import { Avatar } from '../components/Avatar';
import { pendingRequests } from '../lib/gameState';
import { actions } from '../net/actions';
import { openMenu, useStore } from '../state/store';
import { otherVotes, VoteProgressCard } from './BuyBackVote';

export function FloatingCards({ room }: { room: RoomView }) {
  const requests = room.me.isHost ? pendingRequests(room) : [];
  const votes = otherVotes(room);
  const pops = useStore((s) => s.chatPops);
  return (
    <div className="floaters">
      {requests.slice(0, 2).map((p) => (
        <div key={p.id} className="float-card request-card" role="status" data-testid="seat-request">
          <div className="float-card-row">
            <Avatar name={p.name} color={p.color} size={34} />
            <div className="float-card-text">
              <b>{p.name} wants to sit</b>
              <span>Seat {(p.pendingSeat ?? 0) + 1}</span>
            </div>
            <button type="button" className="btn btn-white btn-xs" onClick={() => void actions.approveSeat(p.id, false)}>
              Deny
            </button>
            <button type="button" className="btn btn-green btn-xs" data-testid="approve-seat" onClick={() => void actions.approveSeat(p.id, true)}>
              Approve
            </button>
          </div>
        </div>
      ))}
      {requests.length > 2 ? (
        <button type="button" className="float-more" onClick={() => openMenu('players')}>
          +{requests.length - 2} more requests
        </button>
      ) : null}
      {votes.map((v) => (
        <VoteProgressCard key={v.id} vote={v} room={room} />
      ))}
      {pops.map((m) => (
        <button key={m.id} type="button" className={`chat-pop ${m.system ? 'is-system' : ''}`} onClick={() => openMenu('chat')}>
          {m.system ? null : <b>{m.name}</b>}
          <span>{m.text}</span>
        </button>
      ))}
    </div>
  );
}
