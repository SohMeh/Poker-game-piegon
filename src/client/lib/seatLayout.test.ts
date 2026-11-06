import { describe, expect, it } from 'vitest';
import {
  boardGeometry,
  boxesOverlap,
  computeTrack,
  computeLayout,
  inwardNormal,
  pushOutOfRect,
  fitSeatSize,
  heroBottomMargin,
  MIN_SEAT_WIDTH,
  POT_COMPACT_W,
  potPillCount,
  potRowCompact,
  potRowSize,
  resultLineMaxWidth,
  stadiumPerimeter,
  stadiumPoint,
  type Track,
} from './seatLayout';

const portrait: Track = { cx: 150, cy: 200, width: 200, height: 300 };
const landscape: Track = { cx: 300, cy: 150, width: 500, height: 200 };

describe('stadiumPoint', () => {
  it('starts at the bottom centre and passes the left, top and right extremes in order', () => {
    const P = stadiumPerimeter(portrait);
    const b = stadiumPoint(portrait, 0);
    expect(b.x).toBeCloseTo(150);
    expect(b.y).toBeCloseTo(350);
    const top = stadiumPoint(portrait, P / 2);
    expect(top.x).toBeCloseTo(150);
    expect(top.y).toBeCloseTo(50);
    const left = stadiumPoint(portrait, P / 4);
    expect(left.x).toBeCloseTo(50);
    expect(left.y).toBeCloseTo(200);
    const right = stadiumPoint(portrait, (3 * P) / 4);
    expect(right.x).toBeCloseTo(250);
    expect(right.y).toBeCloseTo(200);
  });

  it('works for landscape tracks and wraps around', () => {
    const P = stadiumPerimeter(landscape);
    expect(stadiumPoint(landscape, 0)).toEqual({ x: 300, y: 250 });
    const top = stadiumPoint(landscape, P / 2);
    expect(top.x).toBeCloseTo(300);
    expect(top.y).toBeCloseTo(50);
    const left = stadiumPoint(landscape, P / 4);
    expect(left.x).toBeCloseTo(50);
    expect(left.y).toBeCloseTo(150);
    const wrapped = stadiumPoint(landscape, P + 10);
    const direct = stadiumPoint(landscape, 10);
    expect(wrapped.x).toBeCloseTo(direct.x);
    expect(wrapped.y).toBeCloseTo(direct.y);
  });

  it('every point lies on the outline', () => {
    for (const t of [portrait, landscape]) {
      const P = stadiumPerimeter(t);
      const r = Math.min(t.width, t.height) / 2;
      for (let i = 0; i < 100; i++) {
        const p = stadiumPoint(t, (i * P) / 100);
        // distance from the spine equals r
        const n = inwardNormal(t, p);
        const L = Math.abs(t.width - t.height);
        const spine =
          t.height >= t.width
            ? { x: t.cx, y: Math.min(t.cy + L / 2, Math.max(t.cy - L / 2, p.y)) }
            : { x: Math.min(t.cx + L / 2, Math.max(t.cx - L / 2, p.x)), y: t.cy };
        expect(Math.hypot(p.x - spine.x, p.y - spine.y)).toBeCloseTo(r, 5);
        expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 5);
      }
    }
  });
});

describe('computeLayout', () => {
  it('puts the bottom seat at the bottom centre and goes clockwise (next seat on the left)', () => {
    const l = computeLayout({ count: 6, bottomSeat: 2, width: 375, height: 450, seatWidth: 70, seatHeight: 76 });
    const mine = l.spots[2]!;
    expect(mine.relative).toBe(0);
    expect(mine.pos.x).toBeCloseTo(187.5);
    expect(mine.pos.y).toBeGreaterThan(l.center.y);
    const next = l.spots[3]!;
    expect(next.relative).toBe(1);
    expect(next.pos.x).toBeLessThan(mine.pos.x); // on my left
    const prev = l.spots[1]!;
    expect(prev.relative).toBe(5);
    expect(prev.pos.x).toBeGreaterThan(mine.pos.x);
  });

  it('bets are drawn inside the table, closer to the centre than the seat', () => {
    const l = computeLayout({ count: 9, bottomSeat: 0, width: 390, height: 560, seatWidth: 76, seatHeight: 82 });
    for (const s of l.spots) {
      const dSeat = Math.hypot(s.pos.x - l.center.x, s.pos.y - l.center.y);
      const dBet = Math.hypot(s.bet.x - l.center.x, s.bet.y - l.center.y);
      expect(dBet).toBeLessThan(dSeat);
    }
  });

  const viewports = [
    { name: '375x667 portrait', width: 375, height: 420 },
    { name: '390x844 portrait', width: 390, height: 560 },
    { name: '320x568 portrait', width: 320, height: 360 },
    { name: '844x390 landscape', width: 560, height: 330 },
    { name: '1280x800 desktop', width: 900, height: 520 },
  ];
  for (const vp of viewports) {
    for (let count = 2; count <= 10; count++) {
      it(`no overlapping seats and nothing outside the container: ${count} seats at ${vp.name}`, () => {
        const size = fitSeatSize(vp.width, vp.height, count);
        expect(size.seatWidth).toBeGreaterThanOrEqual(MIN_SEAT_WIDTH);
        const l = computeLayout({ count, bottomSeat: 0, width: vp.width, height: vp.height, ...size });
        for (const s of l.spots) {
          expect(s.pos.x - size.seatWidth / 2).toBeGreaterThanOrEqual(0);
          expect(s.pos.x + size.seatWidth / 2).toBeLessThanOrEqual(vp.width);
          expect(s.pos.y - size.seatHeight / 2).toBeGreaterThanOrEqual(0);
          expect(s.pos.y + size.seatHeight / 2).toBeLessThanOrEqual(vp.height);
        }
        for (let i = 0; i < l.spots.length; i++) {
          for (let j = i + 1; j < l.spots.length; j++) {
            expect(boxesOverlap(l.spots[i]!.pos, l.spots[j]!.pos, size.seatWidth, size.seatHeight)).toBe(false);
          }
        }
      });
    }
  }

  for (const vp of viewports) {
    for (let count = 2; count <= 10; count++) {
      it(`hero mode (my seat below the table): ${count} seats at ${vp.name}`, () => {
        const size = fitSeatSize(vp.width, vp.height, count, { heroBottom: true });
        const l = computeLayout({
          count,
          bottomSeat: 3 % count,
          width: vp.width,
          height: vp.height,
          ...size,
          bottomMargin: heroBottomMargin(size.seatHeight),
        });
        const visible = l.spots.filter((s) => s.relative !== 0);
        for (const s of visible) {
          expect(s.pos.y + size.seatHeight / 2).toBeLessThanOrEqual(vp.height + 1e-6);
          expect(s.pos.x - size.seatWidth / 2).toBeGreaterThanOrEqual(-1e-6);
        }
        for (let i = 0; i < visible.length; i++) {
          for (let j = i + 1; j < visible.length; j++) {
            expect(boxesOverlap(visible[i]!.pos, visible[j]!.pos, size.seatWidth, size.seatHeight)).toBe(false);
          }
        }
      });
    }
  }

  // Bets on 320px-wide phones with 8+ seats (and 10 seats in landscape) may touch: too little felt.
  const cramped = (name: string, count: number) => (name.startsWith('320') && count >= 8) || (name.startsWith('844') && count >= 10);
  for (const vp of viewports) {
    for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10].filter((c) => !cramped(vp.name, c))) {
      it(`bets do not collide with each other or with seats: ${count} seats at ${vp.name}`, () => {
        const size = fitSeatSize(vp.width, vp.height, count, { heroBottom: true });
        const betSize = { width: 58, height: 24 };
        const bottomMargin = heroBottomMargin(size.seatHeight);
        const track = computeTrack({ width: vp.width, height: vp.height, ...size, bottomMargin });
        const { avoid } = boardGeometry(track);
        const l = computeLayout({
          count,
          bottomSeat: 0,
          width: vp.width,
          height: vp.height,
          ...size,
          bottomMargin,
          betSize,
          avoid,
        });
        const hit = (a: { x: number; y: number }, b: { x: number; y: number }, w: number, h: number) =>
          Math.abs(a.x - b.x) < w - 0.5 && Math.abs(a.y - b.y) < h - 0.5;
        for (let i = 0; i < l.spots.length; i++) {
          for (let j = i + 1; j < l.spots.length; j++) {
            expect(hit(l.spots[i]!.bet, l.spots[j]!.bet, betSize.width, betSize.height)).toBe(false);
          }
          const b = l.spots[i]!.bet;
          for (const z of avoid.slice(0, 1)) {
            const inAvoid =
              Math.abs(b.x - (z.x + z.width / 2)) < (z.width + betSize.width) / 2 - 0.5 &&
              Math.abs(b.y - (z.y + z.height / 2)) < (z.height + betSize.height) / 2 - 0.5;
            expect(inAvoid).toBe(false);
          }
          for (const s of l.spots) {
            if (s.relative === 0) continue;
            expect(hit(l.spots[i]!.bet, s.pos, (betSize.width + size.seatWidth) / 2, (betSize.height + size.seatHeight) / 2)).toBe(false);
          }
        }
      });
    }
  }

  it('bets and dealer buttons sit outside their own seat box', () => {
    const w = 80;
    const h = 85;
    const l = computeLayout({ count: 9, bottomSeat: 0, width: 390, height: 560, seatWidth: w, seatHeight: h, betSize: { width: 60, height: 26 } });
    for (const s of l.spots) {
      const betBox = { x: s.bet.x - 30, y: s.bet.y - 13, w: 60, h: 26 };
      const seatBox = { x: s.pos.x - w / 2, y: s.pos.y - h / 2, w, h };
      const overlap =
        betBox.x < seatBox.x + seatBox.w && betBox.x + betBox.w > seatBox.x && betBox.y < seatBox.y + seatBox.h && betBox.y + betBox.h > seatBox.y;
      expect(overlap).toBe(false);
      const dd = Math.max(Math.abs(s.dealer.x - s.pos.x) - w / 2, Math.abs(s.dealer.y - s.pos.y) - h / 2);
      expect(dd).toBeGreaterThan(0);
    }
  });

  it('keeps the dealer button off the board and the hand-result line', () => {
    for (const [width, height] of [
      [390, 470],
      [375, 380],
      [390, 560],
    ] as const) {
      for (const count of [2, 3, 6, 9]) {
        const fit = fitSeatSize(width, height, count, { heroBottom: true });
        const seatWidth = Math.min(fit.seatWidth, 90);
        const seatHeight = Math.round(seatWidth * 1.06);
        const bottomMargin = heroBottomMargin(seatHeight);
        const track = computeTrack({ width, height, seatWidth, seatHeight, bottomMargin });
        const { avoid, result } = boardGeometry(track, seatWidth);
        const l = computeLayout({ count, bottomSeat: 0, width, height, seatWidth, seatHeight, bottomMargin, avoid, dealerAvoid: [result] });
        for (const s of l.spots) {
          for (const z of [avoid[0]!, result]) {
            const hit = Math.abs(s.dealer.x - (z.x + z.width / 2)) < (z.width + 26) / 2 && Math.abs(s.dealer.y - (z.y + z.height / 2)) < (z.height + 26) / 2;
            expect(hit, `${width}x${height} ${count} seats, seat ${s.seat}`).toBe(false);
          }
        }
      }
    }
  });

  it('keeps bets out of the avoid rectangle', () => {
    const zone = { x: 80, y: 180, width: 230, height: 90 };
    const avoid = [zone];
    const betSize = { width: 56, height: 22 };
    const l = computeLayout({
      count: 9,
      bottomSeat: 0,
      width: 390,
      height: 450,
      seatWidth: 76,
      seatHeight: 82,
      avoid,
      betSize,
    });
    for (const s of l.spots) {
      const box = { x: s.bet.x - 28, y: s.bet.y - 11, w: 56, h: 22 };
      const overlap =
        box.x < zone.x + zone.width && box.x + box.w > zone.x && box.y < zone.y + zone.height && box.y + box.h > zone.y;
      expect(overlap).toBe(false);
    }
  });
});

describe('pot row with side pots', () => {
  const width = 375;
  const height = 330;
  const fit = fitSeatSize(width, height, 6, { heroBottom: true });
  const seatWidth = Math.min(fit.seatWidth, 90);
  const seatHeight = Math.round(seatWidth * 1.06);
  const track = computeTrack({ width, height, seatWidth, seatHeight, bottomMargin: heroBottomMargin(seatHeight) });

  it('counts a chip per pot plus "Total" while bets are still out', () => {
    expect(potPillCount(null)).toBe(0);
    expect(potPillCount({ pots: [], totalPot: 30, phase: 'betting' })).toBe(1);
    expect(potPillCount({ pots: [{ amount: 260 }], totalPot: 260, phase: 'betting' })).toBe(1);
    expect(potPillCount({ pots: [{ amount: 260 }], totalPot: 340, phase: 'betting' })).toBe(2);
    expect(potPillCount({ pots: [{ amount: 3600 }, { amount: 1250 }, { amount: 900 }], totalPot: 6200, phase: 'betting' })).toBe(4);
    expect(potPillCount({ pots: [{ amount: 3600 }], totalPot: 3600, phase: 'complete' })).toBe(0);
  });

  it('the no-bet zone above the board grows with the pot count but never gets wider than the gap between the side seats', () => {
    const max = resultLineMaxWidth(track, seatWidth);
    const zones = [1, 2, 3, 4].map((n) => boardGeometry(track, seatWidth, n).avoid[1]!);
    const area = (z: { width: number; height: number }) => z.width * z.height;
    for (let i = 1; i < zones.length; i++) expect(area(zones[i]!)).toBeGreaterThanOrEqual(area(zones[i - 1]!));
    expect(area(zones[3]!)).toBeGreaterThan(area(zones[0]!));
    // too many chips for one line: one compact chip, one row tall
    for (const n of [2, 3, 4]) {
      const z = boardGeometry(track, seatWidth, n).avoid[1]!;
      if (potRowCompact(n, max)) {
        expect(z.width).toBeLessThanOrEqual(POT_COMPACT_W);
        expect(z.height).toBeLessThanOrEqual(33);
      }
    }
    expect(potRowCompact(4, max)).toBe(true);
    // wide tables keep the full row (and reserve all of it)
    const wide = boardGeometry({ cx: 500, cy: 300, width: 900, height: 400 }, 90, 4).avoid[1]!;
    expect(wide.width).toBeGreaterThan(300);
    for (const z of zones) {
      expect(z.width).toBeLessThanOrEqual(max);
      expect(Math.abs(z.x + z.width / 2 - track.cx)).toBeLessThan(1); // centred over the board
      expect(z.y + z.height).toBeLessThanOrEqual(track.cy); // above the board's centre line
    }
    // 1 pot is unchanged from before (one pill)
    expect(zones[0]!.width).toBeLessThanOrEqual(116);
  });

  it('wraps into rows when the pills do not fit', () => {
    expect(potRowSize(4, 1000).rows).toBe(1);
    const narrow = potRowSize(4, 220);
    expect(narrow.rows).toBeGreaterThan(1);
    expect(narrow.width).toBeLessThanOrEqual(220);
    expect(narrow.height).toBeGreaterThan(potRowSize(4, 1000).height);
  });
});

describe('pushOutOfRect', () => {
  it('leaves points outside untouched and pushes inside points vertically out', () => {
    const r = { x: 0, y: 0, width: 100, height: 50 };
    expect(pushOutOfRect({ x: 50, y: 100 }, { width: 10, height: 10 }, r)).toEqual({ x: 50, y: 100 });
    const up = pushOutOfRect({ x: 50, y: 10 }, { width: 10, height: 10 }, r);
    expect(up.y).toBeLessThan(0);
    const down = pushOutOfRect({ x: 50, y: 40 }, { width: 10, height: 10 }, r);
    expect(down.y).toBeGreaterThan(50);
  });
});
