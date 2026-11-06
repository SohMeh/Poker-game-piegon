import type { RoomView } from '../../shared/types';
import { isGameOver, myPlayer } from '../lib/gameState';
import { useStore } from '../state/store';
import { BottomPanel } from './BottomPanel';
import { VoteModal } from './BuyBackVote';
import { Confetti } from './Confetti';
import { FloatingCards } from './FloatingCards';
import { HeroStrip } from './HeroStrip';
import { InviteSheet } from '../sheets/InviteSheet';
import { MenuSheet } from '../sheets/MenuSheet';
import { TableView } from './TableView';
import { TopBar } from './TopBar';
import { useGameEffects } from './useGameEffects';


export function TableScreen({ room }: { room: RoomView }) {
  useGameEffects(room);
  const ui = useStore((s) => s.ui);
  const me = myPlayer(room);
  const heroMode = !!me && me.seat !== null;
  const gameOver = isGameOver(room);
  const hand = room.hand;

  return (
    <div
      className={`table-screen ${heroMode ? 'has-hero' : 'no-hero'} ${ui.raiseOpen ? 'is-raising' : ''}`}
      data-testid="table-screen"
      // Machine-readable state for end-to-end tests (and debugging); purely informational.
      data-status={room.status}
      data-hand={hand?.handNumber ?? ''}
      data-street={hand?.street ?? ''}
      data-phase={hand?.phase ?? ''}
      data-my-turn={room.me.legal ? 'true' : 'false'}
      data-turn-key={hand ? `${hand.handNumber}:${hand.street}:${hand.phase}:${hand.toActPlayerId ?? '-'}` : ''}
      data-seat={me?.seat ?? ''}
      data-game-over={gameOver ? 'true' : 'false'}
    >
      <TopBar room={room} />
      <main className="table-area">
        <TableView room={room} heroMode={heroMode} />
        <FloatingCards room={room} />
        <VoteModal room={room} />
        {gameOver ? <Confetti burstKey={`go-${room.gameOverWinnerId ?? 'none'}`} /> : null}
      </main>
      {heroMode ? <HeroStrip room={room} /> : null}
      <div className="bottom-area">
        <BottomPanel room={room} />
      </div>
      {ui.inviteOpen ? <InviteSheet room={room} /> : null}
      {ui.menuOpen ? <MenuSheet room={room} /> : null}
    </div>
  );
}
