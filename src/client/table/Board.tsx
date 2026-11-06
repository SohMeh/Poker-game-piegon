import { useEffect, useRef, useState } from 'react';
import type { Card } from '../../shared/cards';
import { formatChips } from '../../shared/format';
import type { HandView } from '../../shared/types';
import { EmptyCardSlot, PlayingCard } from '../components/PlayingCard';
import { winnerLines } from '../lib/describe';
import { potPillCount, potRowCompact, potsCollected } from '../lib/seatLayout';
import { ChipStack } from './ChipStack';

export function Board({
  hand,
  cw,
  x,
  y,
  nameOf,
  highlight,
  maxWidth,
}: {
  hand: HandView;
  cw: number;
  x: number;
  y: number;
  nameOf: (id: string) => string;
  highlight: Set<Card>;
  /** Room for the result line between the side seats. */
  maxWidth: number;
}) {
  // Stagger the flip of cards that arrive together (the flop).
  const seen = useRef<{ hand: number; count: number }>({ hand: -1, count: 0 });
  if (seen.current.hand !== hand.handNumber) seen.current = { hand: hand.handNumber, count: 0 };
  const firstNew = seen.current.count;
  seen.current.count = Math.max(seen.current.count, hand.board.length);

  const complete = hand.phase === 'complete';
  const collected = potsCollected(hand);
  const lines = complete && hand.winners ? winnerLines(hand.winners, nameOf) : [];
  const anyHl = complete && highlight.size > 0;

  return (
    <div className="board" style={{ left: x, top: y, '--cw': `${cw}px`, '--rw': `${Math.round(maxWidth)}px` } as React.CSSProperties}>
      {!complete ? <Pots hand={hand} collected={collected} maxWidth={maxWidth} /> : null}
      <div className="board-cards" aria-label="Board">
        {Array.from({ length: 5 }, (_, i) => {
          const c = hand.board[i];
          if (!c) return <EmptyCardSlot key={`slot-${i}`} size="board" />;
          const delay = i >= firstNew ? (i - firstNew) * 130 : 0;
          return (
            <PlayingCard
              key={`${hand.handNumber}-${c}`}
              card={c}
              size="board"
              anim={i >= firstNew ? 'flip' : null}
              delayMs={delay}
              highlight={anyHl && highlight.has(c)}
              dim={anyHl && !highlight.has(c)}
            />
          );
        })}
      </div>
      {lines.length ? (
        <div className="board-result" role="status" data-testid="hand-result">
          {lines.slice(0, 3).map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      ) : hand.runout ? (
        <div className="board-result is-runout">All-in — running it out</div>
      ) : null}
    </div>
  );
}

function potLabel(hand: HandView, i: number): string {
  if (i === 0) return hand.pots.length > 1 ? 'Main' : 'Pot';
  return hand.pots.length > 2 ? `Side ${i}` : 'Side';
}

/**
 * Pot chips above the board. With side pots (or a pot plus "Total") the full row can be wider than
 * the room between the side seats: it then collapses into one "Pot <total> +N side pots" chip;
 * tapping it shows the breakdown for a few seconds.
 */
function Pots({ hand, collected, maxWidth }: { hand: HandView; collected: number; maxWidth: number }) {
  const [open, setOpen] = useState(false);
  const compact = potRowCompact(potPillCount(hand), maxWidth);
  const showTotal = hand.pots.length > 0 && hand.totalPot > collected;
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setOpen(false), 4000);
    return () => clearTimeout(t);
  }, [open]);
  const breakdown = [
    ...hand.pots.map((p, i) => `${potLabel(hand, i)} ${formatChips(p.amount)}`),
    ...(showTotal ? [`Total ${formatChips(hand.totalPot)}`] : []),
  ].join(' · ');

  if (compact && !open) {
    return (
      <div className="pots" aria-label="Pots">
        <button type="button" className="pot-pill is-compact" aria-label={breakdown} data-testid="pots-compact" onClick={() => setOpen(true)}>
          <ChipStack amount={hand.totalPot} bigBlind={hand.bigBlind} label={false} />
          <span>
            Pot <b>{formatChips(hand.totalPot, true)}</b>
          </span>
          {hand.pots.length > 1 ? <span className="pot-more">+{hand.pots.length - 1}</span> : null}
        </button>
      </div>
    );
  }
  return (
    <div className={`pots ${open ? 'is-open' : ''}`} aria-label="Pots" onClick={open ? () => setOpen(false) : undefined}>
      {hand.pots.length > 0 ? (
        hand.pots.map((p, i) => (
          <span key={i} className={`pot-pill ${i > 0 ? 'is-side' : ''}`}>
            {/* side pots skip the chip icon: the row has to fit between the side seats */}
            {i === 0 ? <ChipStack amount={p.amount} bigBlind={hand.bigBlind} label={false} /> : null}
            <span>
              {potLabel(hand, i)} <b>{formatChips(p.amount, true)}</b>
            </span>
          </span>
        ))
      ) : hand.totalPot > 0 ? (
        <span className="pot-pill">
          <ChipStack amount={hand.totalPot} bigBlind={hand.bigBlind} label={false} />
          <span>
            Pot <b>{formatChips(hand.totalPot, true)}</b>
          </span>
        </span>
      ) : null}
      {showTotal ? <span className="pot-total">Total {formatChips(hand.totalPot, true)}</span> : null}
    </div>
  );
}
