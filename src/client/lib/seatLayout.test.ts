import { describe, expect, it } from 'vitest';
import {
  boxesOverlap,
  computeLayout,
  inwardNormal,
  pushOutOfRect,
  fitSeatSize,
  MIN_SEAT_WIDTH,
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

  it('keeps bets out of the avoid rectangle', () => {
    const avoid = { x: 80, y: 180, width: 230, height: 90 };
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
        box.x < avoid.x + avoid.width && box.x + box.w > avoid.x && box.y < avoid.y + avoid.height && box.y + box.h > avoid.y;
      expect(overlap).toBe(false);
    }
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
