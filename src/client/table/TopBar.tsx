import { formatChips } from '../../shared/format';
import type { RoomView } from '../../shared/types';
import { IconChat, IconMenu, IconShare } from '../components/Icons';
import { statusLabel } from '../lib/describe';
import { isGameOver, pendingRequests } from '../lib/gameState';
import { openMenu, setUI, useStore } from '../state/store';

export function TopBar({ room }: { room: RoomView }) {
  const unread = useStore((s) => s.unreadChat);
  const requests = room.me.isHost ? pendingRequests(room).length : 0;
  const gameOver = isGameOver(room);
  const status = statusLabel(room.status, gameOver);
  const handNo = room.hand?.handNumber;
  return (
    <header className="topbar">
      <button
        type="button"
        className="room-chip"
        data-testid="room-code"
        aria-label={`Room ${room.roomId}. Invite friends`}
        onClick={() => setUI({ inviteOpen: true })}
      >
        <span className="room-code">{room.roomId}</span>
        <span className="room-invite">
          <IconShare /> Invite
        </span>
      </button>
      <div className="topbar-mid">
        <span className={`pill status-pill is-${gameOver ? 'over' : room.status}`}>
          <span className="status-dot" aria-hidden />
          {status}
        </span>
        <span className="topbar-meta">
          {handNo ? <b>#{handNo}</b> : null}
          <span>
            {formatChips(room.settings.smallBlind, true)}/{formatChips(room.settings.bigBlind, true)}
          </span>
        </span>
      </div>
      <div className="topbar-right">
        <button type="button" className="icon-btn" aria-label={unread ? `Chat, ${unread} unread` : 'Chat'} onClick={() => openMenu('chat')}>
          <IconChat />
          {unread ? <span className="badge">{unread > 9 ? '9+' : unread}</span> : null}
        </button>
        <button
          type="button"
          className="icon-btn"
          data-testid="menu-button"
          aria-label={requests ? `Menu, ${requests} seat request${requests > 1 ? 's' : ''}` : 'Menu'}
          onClick={() => openMenu(requests ? 'players' : undefined)}
        >
          <IconMenu />
          {requests ? <span className="badge">{requests}</span> : null}
        </button>
      </div>
    </header>
  );
}
