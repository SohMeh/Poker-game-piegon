import { memo } from 'react';
import type { Card } from '../../shared/cards';
import { formatChips } from '../../shared/format';
import type { HandView, PublicPlayer } from '../../shared/types';
import { Avatar } from '../components/Avatar';
import { IconCrown, IconWifiOff } from '../components/Icons';
import { CardBack, PlayingCard } from '../components/PlayingCard';
import { lastActionLabel } from '../lib/describe';
import { CountdownRing } from './CountdownRing';

export interface SeatProps {
  player: PublicPlayer;
  hand: HandView | null;
  width: number;
  x: number;
  y: number;
  /** Offset from the seat to the table centre (for the deal animation). */
  toCenter: { x: number; y: number };
  bubbleBelow: boolean;
  won: number;
  highlightCards: Set<Card>;
  gameStarted: boolean;
}

export function seatTag(p: PublicPlayer, hand: HandView | null, started: boolean): { text: string; tone: string } | null {
  const live = !!hand && hand.phase !== 'complete';
  if (p.allIn && p.inHand) return { text: 'All-in', tone: 'pink' };
  if (p.busted || (started && p.stack === 0 && !p.inHand)) return { text: 'Busted', tone: 'dark' };
  if (p.sittingOut) return { text: 'Away', tone: 'grey' };
  if (!p.connected) return { text: 'Offline', tone: 'grey' };
  if (live && p.folded) return { text: 'Folded', tone: 'grey' };
  return null;
}

function SeatImpl({ player: p, hand, width, x, y, toCenter, bubbleBelow, won, highlightCards, gameStarted }: SeatProps) {
  const avatarSize = Math.round(width * 0.6);
  const acting = !!hand && hand.phase === 'betting' && hand.toActPlayerId === p.id;
  const live = !!hand && hand.phase !== 'complete';
  const folded = p.inHand && p.folded;
  const tag = seatTag(p, hand, gameStarted);
  const bubble =
    hand && hand.phase !== 'complete' && !(p.inHand && p.folded) && !p.shownCards?.length ? lastActionLabel(p.lastAction) : null;
  const isSB = !!hand && hand.smallBlindSeat === p.seat;
  const isBB = !!hand && hand.bigBlindSeat === p.seat;
  const showdown = !!hand && hand.phase === 'complete';
  const cls = [
    'seat',
    folded ? 'is-folded' : '',
    p.shownCards?.length ? 'has-shown' : '',
    acting ? 'is-acting' : '',
    won > 0 ? 'is-winner' : '',
    p.sittingOut || !p.connected ? 'is-away' : '',
    bubbleBelow ? 'bubble-below' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const status = [
    p.isHost ? 'host' : null,
    acting ? 'to act' : null,
    tag?.text ?? null,
    isSB ? 'small blind' : null,
    isBB ? 'big blind' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div
      className={cls}
      style={
        {
          left: x,
          top: y,
          width,
          '--sw': `${width}px`,
          '--avs': `${avatarSize}px`,
          '--to-x': `${toCenter.x}px`,
          '--to-y': `${toCenter.y}px`,
        } as React.CSSProperties
      }
      data-testid={`seat-${p.seat}`}
      aria-label={`${p.name}, ${formatChips(p.stack)} chips${status ? `, ${status}` : ''}`}
      role="group"
    >
      <div className="seat-avatar">
        <Avatar name={p.name} color={p.color} size={avatarSize} />
        {acting ? <CountdownRing size={avatarSize + 10} deadline={hand!.turnDeadline} durationMs={hand!.turnDurationMs} /> : null}
        {p.isHost ? <IconCrown className="seat-crown" aria-label="Host" /> : null}
        {!p.connected ? (
          <span className="seat-offline" title="Disconnected">
            <IconWifiOff />
          </span>
        ) : null}
        {isSB || isBB ? <span className={`seat-blind ${isBB ? 'is-bb' : ''}`}>{isBB ? 'BB' : 'SB'}</span> : null}
      </div>

      {p.shownCards && p.shownCards.length ? (
        <div className="seat-cards is-shown">
          {p.shownCards.map((c, i) => (
            <PlayingCard
              key={`${hand?.handNumber}-${c}`}
              card={c}
              size="sm"
              anim="flip"
              delayMs={i * 90}
              highlight={showdown && highlightCards.has(c)}
              dim={showdown && highlightCards.size > 0 && !highlightCards.has(c)}
            />
          ))}
        </div>
      ) : p.hasCards && (live || showdown) ? (
        <div className="seat-cards is-backs" key={`backs-${hand?.handNumber}`}>
          <CardBack size="xs" className="anim-deal" style={{ animationDelay: '0ms' }} />
          <CardBack size="xs" className="anim-deal" style={{ animationDelay: '120ms' }} />
        </div>
      ) : null}

      <div className="seat-plate">
        <span className="seat-name">{p.name}</span>
        <span className="seat-stack">{p.allIn && p.stack === 0 ? 'All-in' : formatChips(p.stack, true)}</span>
      </div>
      {tag && !(tag.text === 'All-in' && p.stack === 0) ? <span className={`seat-tag tone-${tag.tone}`}>{tag.text}</span> : null}
      {bubble ? (
        <div key={`${bubble}-${p.lastAction?.amount}`} className={`seat-bubble act-${p.lastAction?.type}`}>
          {bubble}
        </div>
      ) : null}
      {won > 0 ? <div className="seat-win">+{formatChips(won, true)}</div> : null}
    </div>
  );
}

export const Seat = memo(SeatImpl);

export function EmptySeat({
  seat,
  x,
  y,
  width,
  canSit,
  reserved,
  onSit,
}: {
  seat: number;
  x: number;
  y: number;
  width: number;
  canSit: boolean;
  reserved: boolean;
  onSit: (seat: number) => void;
}) {
  const size = Math.round(width * 0.6);
  return (
    <div
      className="seat seat-empty"
      style={{ left: x, top: y, width, '--sw': `${width}px`, '--avs': `${size}px` } as React.CSSProperties}
      data-testid={`seat-${seat}`}
    >
      {canSit && !reserved ? (
        <button type="button" className="sit-btn" aria-label={`Sit in seat ${seat + 1}`} onClick={() => onSit(seat)}>
          <span aria-hidden>+</span>
          <small>Sit</small>
        </button>
      ) : (
        <div className="empty-ring" aria-label={reserved ? `Seat ${seat + 1} reserved` : `Seat ${seat + 1} open`}>
          <small>{reserved ? 'Reserved' : 'Open'}</small>
        </div>
      )}
    </div>
  );
}
