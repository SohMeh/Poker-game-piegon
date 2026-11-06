import { useRef } from 'react';
import type { Card } from '../../shared/cards';
import { formatChips } from '../../shared/format';
import type { HandView } from '../../shared/types';
import { EmptyCardSlot, PlayingCard } from '../components/PlayingCard';
import { winnerLines } from '../lib/describe';
import { ChipStack } from './ChipStack';

export function Board({
  hand,
  cw,
  x,
  y,
  nameOf,
  highlight,
}: {
  hand: HandView;
  cw: number;
  x: number;
  y: number;
  nameOf: (id: string) => string;
  highlight: Set<Card>;
}) {
  // Stagger the flip of cards that arrive together (the flop).
  const seen = useRef<{ hand: number; count: number }>({ hand: -1, count: 0 });
  if (seen.current.hand !== hand.handNumber) seen.current = { hand: hand.handNumber, count: 0 };
  const firstNew = seen.current.count;
  seen.current.count = Math.max(seen.current.count, hand.board.length);

  const complete = hand.phase === 'complete';
  const collected = hand.pots.reduce((s, p) => s + p.amount, 0);
  const lines = complete && hand.winners ? winnerLines(hand.winners, nameOf) : [];
  const anyHl = complete && highlight.size > 0;

  return (
    <div className="board" style={{ left: x, top: y, '--cw': `${cw}px` } as React.CSSProperties}>
      {!complete ? (
        <div className="pots" aria-label="Pots">
          {hand.pots.length > 0 ? (
            hand.pots.map((p, i) => (
              <span key={i} className={`pot-pill ${i > 0 ? 'is-side' : ''}`}>
                <ChipStack amount={p.amount} bigBlind={hand.bigBlind} label={false} />
                <span>
                  {i === 0 ? (hand.pots.length > 1 ? 'Main' : 'Pot') : hand.pots.length > 2 ? `Side ${i}` : 'Side'}{' '}
                  <b>{formatChips(p.amount, true)}</b>
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
          {hand.pots.length > 0 && hand.totalPot > collected ? (
            <span className="pot-total">Total {formatChips(hand.totalPot, true)}</span>
          ) : null}
        </div>
      ) : null}
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
