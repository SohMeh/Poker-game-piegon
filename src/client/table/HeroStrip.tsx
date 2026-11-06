import { formatChips } from '../../shared/format';
import type { RoomView } from '../../shared/types';
import { Avatar } from '../components/Avatar';
import { IconCrown } from '../components/Icons';
import { PlayingCard } from '../components/PlayingCard';
import { handHint, lastActionLabel, winningCards, winningsByPlayer } from '../lib/describe';
import { myPlayer } from '../lib/gameState';
import { CountdownRing } from './CountdownRing';
import { seatTag } from './Seat';

/** My seat: avatar, stack, big hole cards and the hand-strength hint. */
export function HeroStrip({ room }: { room: RoomView }) {
  const me = myPlayer(room);
  if (!me) return null;
  const hand = room.hand;
  const hole = room.me.holeCards;
  const acting = !!hand && hand.phase === 'betting' && hand.toActPlayerId === me.id;
  const complete = !!hand && hand.phase === 'complete';
  const hint = hole && hand ? handHint(hole, hand.board) : null;
  const bubble = hand && !complete ? lastActionLabel(me.lastAction) : null;
  const won = complete ? (winningsByPlayer(hand!.winners).get(me.id) ?? 0) : 0;
  const hl = complete ? winningCards(hand!.winners) : new Set();
  const folded = me.inHand && me.folded;
  const tag = seatTag(me, hand, room.started);
  // no cards coming my way (busted / sitting out between hands): a slimmer strip leaves room for the table
  const compact = !hole?.length && !me.inHand && (me.busted || me.sittingOut || (room.started && me.stack === 0));
  return (
    <section
      className={`hero ${acting ? 'is-acting' : ''} ${won > 0 ? 'is-winner' : ''} ${compact ? 'is-compact' : ''}`}
      aria-label="Your seat"
      data-testid="hero"
    >
      <div className="hero-id">
        <div className="hero-avatar">
          <Avatar name={me.name} color={me.color} size={46} />
          {acting ? <CountdownRing size={56} deadline={hand!.turnDeadline} durationMs={hand!.turnDurationMs} /> : null}
          {me.isHost ? <IconCrown className="seat-crown" aria-label="Host" /> : null}
        </div>
        <div className="hero-meta">
          <span className="hero-name">{me.name}</span>
          <span className="hero-stack" data-testid="my-stack">
            {formatChips(me.stack)}
          </span>
        </div>
      </div>

      <div className={`hero-cards ${folded ? 'is-folded' : ''}`} key={hand ? `h${hand.handNumber}` : 'none'}>
        {hole && hole.length ? (
          hole.map((c, i) => (
            <PlayingCard
              key={c}
              card={c}
              size="lg"
              anim="deal"
              delayMs={i * 120}
              className={i === 0 ? 'hero-card-l' : 'hero-card-r'}
              highlight={complete && hl.has(c)}
              dim={folded}
            />
          ))
        ) : compact ? null : (
          <div className="hero-empty" aria-hidden>
            <span />
            <span />
          </div>
        )}
      </div>

      <div className="hero-side">
        {won > 0 ? <span className="hero-win">+{formatChips(won)}</span> : null}
        {hint ? (
          <div className="hint-pill" data-testid="hand-hint">
            <small>{folded ? 'You had' : 'You have'}</small>
            <b>{hint}</b>
          </div>
        ) : tag ? (
          <span className={`seat-tag tone-${tag.tone} is-static`}>{tag.text}</span>
        ) : null}
        {bubble ? <span className={`hero-bubble act-${me.lastAction?.type}`}>{bubble}</span> : null}
      </div>
    </section>
  );
}
