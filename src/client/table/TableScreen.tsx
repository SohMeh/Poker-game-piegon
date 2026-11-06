import { lazy, Suspense } from 'react';
import type { RoomView } from '../../shared/types';
import { isGameOver, myPlayer } from '../lib/gameState';
import { useStore } from '../state/store';
import { BottomPanel } from './BottomPanel';
import { VoteModal } from './BuyBackVote';
import { Confetti } from './Confetti';
import { FloatingCards } from './FloatingCards';
import { HeroStrip } from './HeroStrip';
import { TableView } from './TableView';
import { TopBar } from './TopBar';
import { useGameEffects } from './useGameEffects';

const InviteSheet = lazy(() => import('../sheets/InviteSheet'));
const MenuSheet = lazy(() => import('../sheets/MenuSheet'));

export function TableScreen({ room }: { room: RoomView }) {
  useGameEffects(room);
  const ui = useStore((s) => s.ui);
  const me = myPlayer(room);
  const heroMode = !!me && me.seat !== null;
  const gameOver = isGameOver(room);

  return (
    <div className={`table-screen ${heroMode ? 'has-hero' : 'no-hero'} ${ui.raiseOpen ? 'is-raising' : ''}`} data-testid="table-screen">
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
      <Suspense fallback={null}>
        {ui.inviteOpen ? <InviteSheet room={room} /> : null}
        {ui.menuOpen ? <MenuSheet room={room} /> : null}
      </Suspense>
    </div>
  );
}
