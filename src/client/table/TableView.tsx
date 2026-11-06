import { useEffect, useMemo, useRef, useState } from 'react';
import { formatChips } from '../../shared/format';
import type { RoomView } from '../../shared/types';
import { BirdMascot } from '../components/Logo';
import { winningCards, winningsByPlayer } from '../lib/describe';
import { eligibleCount, isGameOver, myPlayer, nameResolver, playerById, reservedSeats, seatsTaken } from '../lib/gameState';
import { useElementSize } from '../lib/hooks';
import {
  boardGeometry,
  computeLayout,
  computeTrack,
  fitSeatSize,
  heroBottomMargin,
  resultLineMaxWidth,
  SEAT_ASPECT,
  type Point,
} from '../lib/seatLayout';
import { actions } from '../net/actions';
import { Board } from './Board';
import { ChipStack } from './ChipStack';
import { EmptySeat, Seat } from './Seat';

interface Flight {
  id: string;
  from: Point;
  to: Point;
  delay: number;
}

export function TableView({ room, heroMode }: { room: RoomView; heroMode: boolean }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const me = myPlayer(room);
  const count = room.seats.length;
  const bottomSeat = me?.seat ?? 0;
  const hand = room.hand;

  const geo = useMemo(() => {
    const { width, height } = size;
    if (width < 50 || height < 50) return null;
    const fit = fitSeatSize(width, height, count, { heroBottom: heroMode });
    const seatWidth = Math.min(fit.seatWidth, 90);
    const seatHeight = Math.round(seatWidth * SEAT_ASPECT);
    const bottomMargin = heroMode ? heroBottomMargin(seatHeight) : undefined;
    const track = computeTrack({ width, height, seatWidth, seatHeight, bottomMargin });
    const { rail, cw, avoid, result } = boardGeometry(track, seatWidth);
    const layout = computeLayout({
      count,
      bottomSeat,
      width,
      height,
      seatWidth,
      seatHeight,
      bottomMargin,
      betGap: 4,
      betSize: { width: 58, height: 24 },
      avoid,
      dealerAvoid: [result],
    });
    return { layout, seatWidth, seatHeight, rail, cw, track, width, height };
  }, [size, count, bottomSeat, heroMode]);

  const nameOf = useMemo(() => nameResolver(room), [room]);
  const won = useMemo(
    () => (hand && hand.phase === 'complete' ? winningsByPlayer(hand.winners) : new Map<string, number>()),
    [hand],
  );
  const hl = useMemo(() => (hand && hand.phase === 'complete' ? winningCards(hand.winners) : new Set<never>()), [hand]);
  const reserved = reservedSeats(room);
  const canSit = !!me && me.seat === null && me.pendingSeat === null;

  // ---- chip flights: bets -> pot when a street ends, pot -> winners when the hand ends
  const [flights, setFlights] = useState<Flight[]>([]);
  const lastBets = useRef<{ hand: number | null; street: string | null; phase: string | null; bets: { id: string; at: Point }[] }>({
    hand: null,
    street: null,
    phase: null,
    bets: [],
  });
  useEffect(() => {
    const prev = lastBets.current;
    if (!hand || !geo || prev.hand !== hand.handNumber) return;
    const center = geo.layout.center;
    const next: Flight[] = [];
    const streetEnded = prev.street !== hand.street || (prev.phase !== 'complete' && hand.phase === 'complete');
    if (streetEnded) prev.bets.forEach((b, i) => next.push({ id: `p-${b.id}-${i}`, from: b.at, to: center, delay: 0 }));
    if (prev.phase !== 'complete' && hand.phase === 'complete' && hand.winners) {
      for (const [pid] of winningsByPlayer(hand.winners)) {
        const p = playerById(room, pid);
        const spot = p && p.seat !== null ? geo.layout.spots[p.seat] : undefined;
        if (spot) next.push({ id: `w-${pid}`, from: center, to: spot.pos, delay: streetEnded ? 380 : 0 });
      }
    }
    if (next.length) {
      setFlights(next);
      const t = setTimeout(() => setFlights([]), 1300);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand?.handNumber, hand?.street, hand?.phase]);
  useEffect(() => {
    if (!geo) return;
    lastBets.current = {
      hand: hand?.handNumber ?? null,
      street: hand?.street ?? null,
      phase: hand?.phase ?? null,
      bets: room.players
        .filter((p) => p.seat !== null && p.bet > 0)
        .map((p) => ({ id: p.id, at: geo.layout.spots[p.seat!]?.bet ?? geo.layout.center })),
    };
  });

  const gameOver = isGameOver(room);

  return (
    <div className="table-view" ref={ref}>
      {geo ? (
        <>
          <div
            className="rail"
            style={{
              left: geo.track.cx - geo.track.width / 2 - geo.rail / 2,
              top: geo.track.cy - geo.track.height / 2 - geo.rail / 2,
              width: geo.track.width + geo.rail,
              height: geo.track.height + geo.rail,
              '--rail': `${geo.rail}px`,
            } as React.CSSProperties}
            aria-hidden
          >
            <div className="felt">
              <div className="felt-logo">
                <BirdMascot size={Math.round(Math.min(geo.track.width, geo.track.height) * 0.3)} />
              </div>
            </div>
          </div>

          {hand ? (
            <Board
              hand={hand}
              cw={geo.cw}
              x={geo.layout.center.x}
              y={geo.layout.center.y}
              nameOf={nameOf}
              highlight={hl}
              maxWidth={resultLineMaxWidth(geo.track, geo.seatWidth)}
            />
          ) : (
            <CenterMessage room={room} x={geo.layout.center.x} y={geo.layout.center.y} gameOver={gameOver} />
          )}

          {geo.layout.spots.map((spot) => {
            const pid = room.seats[spot.seat] ?? null;
            const p = pid ? playerById(room, pid) : undefined;
            const isMine = !!me && me.seat === spot.seat;
            const dealer = hand && hand.dealerSeat === spot.seat;
            return (
              <div key={spot.seat} className="spot">
                {p && p.bet > 0 ? (
                  <div className="bet" style={{ left: spot.bet.x, top: spot.bet.y }} aria-label={`${p.name} bet ${formatChips(p.bet)}`}>
                    <ChipStack amount={p.bet} bigBlind={room.settings.bigBlind} />
                  </div>
                ) : null}
                {dealer ? (
                  <div className="dealer-btn" style={{ left: spot.dealer.x, top: spot.dealer.y }} aria-label="Dealer button">
                    D
                  </div>
                ) : null}
                {p && !(heroMode && isMine) ? (
                  <Seat
                    player={p}
                    hand={hand}
                    width={geo.seatWidth}
                    x={spot.pos.x}
                    y={spot.pos.y}
                    toCenter={{ x: geo.layout.center.x - spot.pos.x, y: geo.layout.center.y - spot.pos.y }}
                    bubbleBelow={spot.pos.y < geo.height * 0.28}
                    won={won.get(p.id) ?? 0}
                    highlightCards={hl}
                    gameStarted={room.started}
                  />
                ) : !p ? (
                  <EmptySeat
                    seat={spot.seat}
                    x={spot.pos.x}
                    y={spot.pos.y}
                    width={geo.seatWidth}
                    canSit={canSit}
                    reserved={reserved.has(spot.seat)}
                    onSit={(s) => void actions.takeSeat(s)}
                  />
                ) : null}
              </div>
            );
          })}

          {flights.map((f) => (
            <div
              key={f.id}
              className="flight"
              style={
                {
                  left: f.from.x,
                  top: f.from.y,
                  '--dx': `${f.to.x - f.from.x}px`,
                  '--dy': `${f.to.y - f.from.y}px`,
                  animationDelay: `${f.delay}ms`,
                } as React.CSSProperties
              }
              aria-hidden
            >
              <ChipStack amount={room.settings.bigBlind * 8} bigBlind={room.settings.bigBlind} label={false} />
            </div>
          ))}
          <span className="sr-only">
            {seatsTaken(room)} of {count} seats taken
          </span>
        </>
      ) : null}
    </div>
  );
}

function CenterMessage({ room, x, y, gameOver }: { room: RoomView; x: number; y: number; gameOver: boolean }) {
  const taken = seatsTaken(room);
  const host = playerById(room, room.hostId);
  let title: string;
  let sub: string;
  if (gameOver) {
    const w = playerById(room, room.gameOverWinnerId);
    title = w ? `🏆 ${w.name} wins!` : 'Game over';
    sub = room.settings.allowBuyBack ? 'Buy-backs need everyone’s OK' : 'Thanks for playing';
  } else if (room.status === 'lobby') {
    const ready = eligibleCount(room);
    title = ready >= 2 ? 'Ready when you are' : 'Waiting for players';
    sub = `${taken}/${room.settings.maxPlayers} seated · ${host ? `${host.name} deals` : 'host deals'}`;
  } else if (room.status === 'paused') {
    title = 'Paused';
    sub = 'The host paused the game';
  } else {
    title = 'Shuffling…';
    sub = 'Next hand coming up';
  }
  return (
    <div className="center-msg" style={{ left: x, top: y }}>
      <strong>{title}</strong>
      <span>{sub}</span>
    </div>
  );
}
