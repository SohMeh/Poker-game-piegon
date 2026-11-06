// Pure geometry for placing 2..10 seats around a stadium-shaped ("pill") poker table.
//
// Seats sit ON the rail of the table and are spaced by equal arc length, starting at the
// bottom-centre and going clockwise on screen (bottom -> left -> top -> right), which matches
// the clockwise order of play: the seat after mine appears on my left.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A stadium: a rounded rectangle whose corner radius is half its shorter side. */
export interface Track {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export interface LayoutInput {
  /** Number of seats (settings.maxPlayers). */
  count: number;
  /** Seat index drawn at the bottom-centre (my seat, or 0 for spectators). */
  bottomSeat: number;
  /** Container size in px. */
  width: number;
  height: number;
  /** Seat box size in px (avatar + name plate). */
  seatWidth: number;
  seatHeight: number;
  /** Extra space between seat boxes and the container edge. */
  margin?: number;
  /** Distance from a seat towards the middle of the table at which its bet is drawn. */
  betInset?: number;
  /** Bet chip box size (used to keep bets out of `avoid`). */
  betSize?: { width: number; height: number };
  /** Area in the middle (board + pots) that bets must not cover. */
  avoid?: Rect | null;
}

export interface SeatSpot {
  seat: number;
  /** 0 = bottom-centre, then clockwise. */
  relative: number;
  /** Seat centre. */
  pos: Point;
  /** Where the seat's bet chips go. */
  bet: Point;
  /** Where the dealer button goes when this seat has it. */
  dealer: Point;
  /** Unit vector pointing from the seat into the table. */
  inward: Point;
}

export interface TableLayout {
  track: Track;
  spots: SeatSpot[];
  center: Point;
}

export function stadiumPerimeter(t: Track): number {
  const r = Math.min(t.width, t.height) / 2;
  const straight = Math.abs(t.width - t.height);
  return 2 * straight + 2 * Math.PI * r;
}

function arc(center: Point, r: number, theta: number): Point {
  return { x: center.x + r * Math.cos(theta), y: center.y + r * Math.sin(theta) };
}

/**
 * Point on the stadium outline at arc length `s` measured from the bottom-centre, moving
 * towards the left first (clockwise on screen, where y grows downwards).
 */
export function stadiumPoint(t: Track, s: number): Point {
  const r = Math.min(t.width, t.height) / 2;
  const L = Math.abs(t.width - t.height);
  const P = 2 * L + 2 * Math.PI * r;
  let d = ((s % P) + P) % P;
  const quarter = (Math.PI * r) / 2;
  const half = Math.PI * r;

  if (t.height >= t.width) {
    // Portrait: vertical straights on the left/right, semicircles top and bottom.
    const bottomC = { x: t.cx, y: t.cy + L / 2 };
    const topC = { x: t.cx, y: t.cy - L / 2 };
    if (d <= quarter) return arc(bottomC, r, Math.PI / 2 + d / r);
    d -= quarter;
    if (d <= L) return { x: t.cx - r, y: t.cy + L / 2 - d };
    d -= L;
    if (d <= half) return arc(topC, r, Math.PI + d / r);
    d -= half;
    if (d <= L) return { x: t.cx + r, y: t.cy - L / 2 + d };
    d -= L;
    return arc(bottomC, r, d / r);
  }

  // Landscape: horizontal straights top/bottom, semicircles left and right.
  const leftC = { x: t.cx - L / 2, y: t.cy };
  const rightC = { x: t.cx + L / 2, y: t.cy };
  if (d <= L / 2) return { x: t.cx - d, y: t.cy + r };
  d -= L / 2;
  if (d <= half) return arc(leftC, r, Math.PI / 2 + d / r);
  d -= half;
  if (d <= L) return { x: t.cx - L / 2 + d, y: t.cy - r };
  d -= L;
  if (d <= half) return arc(rightC, r, -Math.PI / 2 + d / r);
  d -= half;
  return { x: t.cx + L / 2 - d, y: t.cy + r };
}

/** Unit vector from `p` towards the closest point of the stadium's spine (its inward normal). */
export function inwardNormal(t: Track, p: Point): Point {
  const L = Math.abs(t.width - t.height);
  let target: Point;
  if (t.height >= t.width) {
    const y = Math.min(t.cy + L / 2, Math.max(t.cy - L / 2, p.y));
    target = { x: t.cx, y };
  } else {
    const x = Math.min(t.cx + L / 2, Math.max(t.cx - L / 2, p.x));
    target = { x, y: t.cy };
  }
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: -1 };
  return { x: dx / len, y: dy / len };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Moves a box centred at `p` vertically out of `avoid` (towards the side `p` is already on). */
export function pushOutOfRect(p: Point, size: { width: number; height: number }, avoid: Rect): Point {
  const box: Rect = { x: p.x - size.width / 2, y: p.y - size.height / 2, width: size.width, height: size.height };
  if (!intersects(box, avoid)) return p;
  const midY = avoid.y + avoid.height / 2;
  const gap = 2;
  if (p.y < midY) return { x: p.x, y: avoid.y - size.height / 2 - gap };
  return { x: p.x, y: avoid.y + avoid.height + size.height / 2 + gap };
}

/** The rail track for a container: seats centred on it must stay inside the container. */
export function computeTrack(input: Pick<LayoutInput, 'width' | 'height' | 'seatWidth' | 'seatHeight' | 'margin'>): Track {
  const margin = input.margin ?? 4;
  const width = Math.max(40, input.width - input.seatWidth - 2 * margin);
  const height = Math.max(40, input.height - input.seatHeight - 2 * margin);
  return { cx: input.width / 2, cy: input.height / 2, width, height };
}

export function computeLayout(input: LayoutInput): TableLayout {
  const count = Math.max(1, Math.floor(input.count));
  const track = computeTrack(input);
  const P = stadiumPerimeter(track);
  const betInset = input.betInset ?? Math.min(track.width, track.height) * 0.2;
  const betSize = input.betSize ?? { width: 56, height: 22 };
  const center = { x: track.cx, y: track.cy };
  const bottom = ((input.bottomSeat % count) + count) % count;

  const spots: SeatSpot[] = [];
  for (let seat = 0; seat < count; seat++) {
    const relative = (seat - bottom + count) % count;
    const pos = stadiumPoint(track, (relative * P) / count);
    const inward = inwardNormal(track, pos);
    let bet = { x: pos.x + inward.x * betInset, y: pos.y + inward.y * betInset };
    if (input.avoid) bet = pushOutOfRect(bet, betSize, input.avoid);
    // dealer button: a little inwards, nudged sideways (clockwise tangent)
    const tangent = { x: -inward.y, y: inward.x };
    const dInset = betInset * 0.62;
    const dealer = {
      x: pos.x + inward.x * dInset + tangent.x * 26,
      y: pos.y + inward.y * dInset + tangent.y * 26,
    };
    spots.push({ seat, relative, pos, bet, dealer, inward });
  }
  return { track, spots, center };
}

export const MIN_SEAT_WIDTH = 56;
export const MAX_SEAT_WIDTH = 96;
export const SEAT_ASPECT = 1.06;

/**
 * Largest seat box (width x width*SEAT_ASPECT, between MIN and MAX) for which no two seats of a
 * `count`-seat table overlap in a container of the given size (with `gap` px breathing room).
 */
export function fitSeatSize(
  width: number,
  height: number,
  count: number,
  gap = 4,
): { seatWidth: number; seatHeight: number } {
  const maxByContainer = Math.min(MAX_SEAT_WIDTH, Math.floor(Math.min(width, height) * 0.3));
  for (let w = Math.max(MIN_SEAT_WIDTH, maxByContainer); w >= MIN_SEAT_WIDTH; w -= 2) {
    const h = Math.round(w * SEAT_ASPECT);
    const layout = computeLayout({ count, bottomSeat: 0, width, height, seatWidth: w, seatHeight: h });
    if (!anyOverlap(layout.spots.map((s) => s.pos), w + gap, h + gap)) return { seatWidth: w, seatHeight: h };
  }
  return { seatWidth: MIN_SEAT_WIDTH, seatHeight: Math.round(MIN_SEAT_WIDTH * SEAT_ASPECT) };
}

export function anyOverlap(points: Point[], w: number, h: number): boolean {
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (boxesOverlap(points[i]!, points[j]!, w, h)) return true;
    }
  }
  return false;
}

/** True when two seat boxes of the given size centred at a and b overlap. */
export function boxesOverlap(a: Point, b: Point, w: number, h: number): boolean {
  return Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h;
}
