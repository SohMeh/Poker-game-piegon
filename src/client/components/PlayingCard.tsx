import { rankOf, RANK_LABEL, suitOf, SUIT_NAME, SUIT_SYMBOL, type Card } from '../../shared/cards';
import { useStore } from '../state/store';

const RANK_NAME: Partial<Record<string, string>> = { J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' };

export type CardSize = 'xs' | 'sm' | 'md' | 'lg' | 'board';

interface Props {
  card: Card;
  size?: CardSize;
  dim?: boolean;
  highlight?: boolean;
  /** 'deal' slides in, 'flip' turns over. */
  anim?: 'deal' | 'flip' | null;
  delayMs?: number;
  className?: string;
}

export function PlayingCard({ card, size = 'md', dim, highlight, anim, delayMs, className }: Props) {
  const fourColor = useStore((s) => s.prefs.fourColor);
  const suit = suitOf(card);
  const rank = rankOf(card);
  const label = `${RANK_NAME[rank] ?? RANK_LABEL[rank]} of ${SUIT_NAME[suit]}`;
  const cls = [
    'pcard',
    `pcard-${size}`,
    `suit-${suit}`,
    fourColor ? 'four-color' : '',
    dim ? 'is-dim' : '',
    highlight ? 'is-hl' : '',
    anim ? `anim-${anim}` : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} role="img" aria-label={label} style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}>
      <span className="pcard-rank">{RANK_LABEL[rank]}</span>
      <span className="pcard-suit-sm">{SUIT_SYMBOL[suit]}</span>
      <span className="pcard-suit">{SUIT_SYMBOL[suit]}</span>
    </div>
  );
}

export function CardBack({
  size = 'sm',
  className,
  style,
}: {
  size?: CardSize;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`pcard pcard-back pcard-${size} ${className ?? ''}`} style={style} aria-hidden>
      <span className="pcard-back-inner" />
    </div>
  );
}

export function EmptyCardSlot({ size = 'board' }: { size?: CardSize }) {
  return <div className={`pcard pcard-${size} pcard-slot`} aria-hidden />;
}
