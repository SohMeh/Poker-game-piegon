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
  /**
   * Distance between the track and the container's bottom edge. Defaults to the same clearance as
   * the top; pass a small value when the bottom seat is drawn outside the table (my "hero" strip).
   */
  bottomMargin?: number;
  /** Gap between a seat box and its bet chips. */
  betGap?: number;
  /** Bet chip box size (used to keep bets out of `avoid`). */
  betSize?: { width: number; height: number };
  /** Areas in the middle (board cards, pot pills) that bets must not cover. */
  avoid?: Rect[] | null;
  /** Extra areas only the dealer button must stay out of (e.g. the hand-result line under the board). */
  dealerAvoid?: Rect[] | null;
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

type TrackInput = Pick<LayoutInput, 'width' | 'height' | 'seatWidth' | 'seatHeight' | 'margin' | 'bottomMargin'>;

/** The rail track for a container: seats centred on it must stay inside the container. */
export function computeTrack(input: TrackInput): Track {
  const margin = input.margin ?? 4;
  const top = input.seatHeight / 2 + margin;
  const bottom = input.bottomMargin ?? top;
  const width = Math.max(40, input.width - input.seatWidth - 2 * margin);
  const height = Math.max(40, input.height - top - bottom);
  return { cx: input.width / 2, cy: top + height / 2, width, height };
}

export function computeLayout(input: LayoutInput): TableLayout {
  const count = Math.max(1, Math.floor(input.count));
  const track = computeTrack(input);
  const P = stadiumPerimeter(track);
  const betSize = input.betSize ?? { width: 56, height: 22 };
  const betGap = input.betGap ?? 6;
  const center = { x: track.cx, y: track.cy };
  const bottom = ((input.bottomSeat % count) + count) % count;
  const halfW = input.seatWidth / 2;
  const halfH = input.seatHeight / 2;
  const heroMode = input.bottomMargin !== undefined;

  const spots: SeatSpot[] = [];
  for (let seat = 0; seat < count; seat++) {
    const relative = (seat - bottom + count) % count;
    const onTrack = stadiumPoint(track, (relative * P) / count);
    // keep every seat box inside the container (matters when the track runs to the bottom edge)
    const pos = {
      x: Math.min(input.width - halfW, Math.max(halfW, onTrack.x)),
      y: Math.min(input.height - halfH, Math.max(halfH, onTrack.y)),
    };
    const inward = inwardNormal(track, onTrack);
    const ax = Math.abs(inward.x);
    const ay = Math.abs(inward.y);
    const edge = Math.min(ax > 1e-6 ? halfW / ax : Infinity, ay > 1e-6 ? halfH / ay : Infinity);
    // dealer button: just off the seat box, beside the bet (clockwise side)
    const tangent = { x: -inward.y, y: inward.x };
    const dDist = edge + 14;
    const side = Math.min(betSize.width / 2 + 16, 44);
    const dealer = {
      x: pos.x + inward.x * dDist + tangent.x * side,
      y: pos.y + inward.y * dDist + tangent.y * side,
    };
    spots.push({ seat, relative, pos, bet: pos, dealer, inward });
  }

  // Bets: walk inwards from each seat until the chip box clears every seat, the bets placed so
  // far and the board area. Small angular deviations are allowed when the straight path is blocked.
  const seatRects: Rect[] = spots
    .filter((s) => !(heroMode && s.relative === 0))
    .map((s) => ({ x: s.pos.x - halfW, y: s.pos.y - halfH, width: input.seatWidth, height: input.seatHeight }));
  const placed: Rect[] = [];
  const ordered = [...spots].sort((a, b) => a.relative - b.relative);
  for (const spot of ordered) {
    spot.bet = placeBet(spot, betSize, betGap, halfW, halfH, seatRects, placed, input.avoid ?? [], input);
    placed.push(rectAt(spot.bet, betSize));
  }
  // Dealer button (only one is ever shown): beside the seat, clear of every bet and seat.
  const dSize = { width: 26, height: 26 };
  const boardAvoid = input.avoid ?? [];
  const dealerAvoid = [...boardAvoid, ...(input.dealerAvoid ?? [])];
  // strictest first; when a cramped table leaves no such spot, bets (often empty) and then the
  // result-line zone may be covered, but never a seat or the board cards
  const passes: Rect[][] = [
    [...seatRects, ...placed, ...dealerAvoid],
    [...seatRects, ...dealerAvoid],
    [...seatRects, ...boardAvoid],
  ];
  for (const spot of spots) {
    const n = spot.inward;
    const t = { x: -n.y, y: n.x };
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const edge = Math.min(ax > 1e-6 ? halfW / ax : Infinity, ay > 1e-6 ? halfH / ay : Infinity);
    // half the seat box measured along the tangent: lets the button sit right beside the seat
    const tEdge = Math.min(Math.abs(t.x) > 1e-6 ? halfW / Math.abs(t.x) : Infinity, Math.abs(t.y) > 1e-6 ? halfH / Math.abs(t.y) : Infinity);
    const sides = [32, -32, 48, -48, 0, 64, -64, tEdge + 15, -(tEdge + 15)];
    let chosen: Point | null = null;
    for (const blockers of passes) {
      for (const dist of [edge + 14, edge + 30, edge + 46, edge + 62, edge * 0.5, 0]) {
        for (const side of sides) {
          const p = { x: spot.pos.x + n.x * dist + t.x * side, y: spot.pos.y + n.y * dist + t.y * side };
          const r = rectAt(p, dSize);
          if (r.x < 0 || r.y < 0 || r.x + r.width > input.width || r.y + r.height > input.height) continue;
          if (intersectsAny(r, blockers)) continue;
          chosen = p;
          break;
        }
        if (chosen) break;
      }
      if (chosen) break;
    }
    if (chosen) spot.dealer = chosen;
  }
  return { track, spots, center };
}

function rectAt(p: Point, size: { width: number; height: number }): Rect {
  return { x: p.x - size.width / 2, y: p.y - size.height / 2, width: size.width, height: size.height };
}

function intersectsAny(r: Rect, list: Rect[]): boolean {
  for (const o of list) if (intersects(r, o)) return true;
  return false;
}

const BET_ANGLES = [0, 0.22, -0.22, 0.45, -0.45, 0.7, -0.7, 1.0, -1.0];

function placeBet(
  spot: SeatSpot,
  betSize: { width: number; height: number },
  gap: number,
  halfW: number,
  halfH: number,
  seats: Rect[],
  placed: Rect[],
  avoid: Rect[],
  bounds: { width: number; height: number },
): Point {
  const clearAlong = (d: Point) => {
    const ax = Math.abs(d.x);
    const ay = Math.abs(d.y);
    return Math.min(
      ax > 1e-6 ? (halfW + betSize.width / 2) / ax : Infinity,
      ay > 1e-6 ? (halfH + betSize.height / 2) / ay : Infinity,
    );
  };
  const inBounds = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.width <= bounds.width && r.y + r.height <= bounds.height;
  const n = spot.inward;
  const firstDir = n;
  const first = clearAlong(firstDir) + gap;
  // a bet must stay closer to its own seat than to any other seat, so it reads as theirs
  const ownedBy = (p: Point) => {
    const own = Math.hypot(p.x - spot.pos.x, p.y - spot.pos.y);
    for (const r of seats) {
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      if (Math.abs(cx - spot.pos.x) < 0.5 && Math.abs(cy - spot.pos.y) < 0.5) continue;
      if (Math.hypot(p.x - cx, p.y - cy) < own) return false;
    }
    return true;
  };
  let best: { p: Point; score: number } | null = null;
  for (let extra = 0; extra <= 160; extra += 3) {
    for (const a of BET_ANGLES) {
      const base = extra + Math.abs(a) * 45;
      if (best && base >= best.score) continue;
      const d = { x: n.x * Math.cos(a) - n.y * Math.sin(a), y: n.x * Math.sin(a) + n.y * Math.cos(a) };
      const t = clearAlong(d) + gap + extra;
      const p = { x: spot.pos.x + d.x * t, y: spot.pos.y + d.y * t };
      const r = rectAt(p, betSize);
      // hard limits: stay on screen, off every seat, off other bets and off the board cards
      const cards = avoid[0];
      if (!inBounds(r) || intersectsAny(r, seats) || intersectsAny(r, placed) || (cards && intersects(r, cards))) continue;
      // soft limits: prefer spots that clearly belong to this seat and that leave the pot pills free
      const score = base + (ownedBy(p) ? 0 : 70) + (intersectsAny(r, avoid.slice(1)) ? 110 : 0);
      if (best && score >= best.score) continue;
      best = { p, score };
    }
  }
  if (best) return best.p;
  // nothing fits (very cramped): fall back to the straight-in position
  const p = { x: spot.pos.x + firstDir.x * first, y: spot.pos.y + firstDir.y * first };
  return avoid[0] ? pushOutOfRect(p, betSize, avoid[0]) : p;
}

export interface BoardGeometry {
  /** Rail thickness (px). */
  rail: number;
  /** Board card width (px). */
  cw: number;
  /** Zones bets must stay out of: the card row and the pot strip above it. */
  avoid: Rect[];
  /** Where the hand-result line (or "running it out" banner) appears under the board. */
  result: Rect;
}

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Chips already collected into the pot(s) (excludes bets still in front of players). */
export function potsCollected(hand: { pots: { amount: number }[] }): number {
  return hand.pots.reduce((s, p) => s + p.amount, 0);
}

/** How many chips the pot row above the board shows: one pill per pot, plus "Total" when bets are out. */
export function potPillCount(hand: { pots: { amount: number }[]; totalPot: number; phase: string } | null): number {
  if (!hand || hand.phase === 'complete') return 0;
  const pills = hand.pots.length > 0 ? hand.pots.length : hand.totalPot > 0 ? 1 : 0;
  return pills + (hand.pots.length > 0 && hand.totalPot > potsCollected(hand) ? 1 : 0);
}

/** Approximate rendered widths of the pot row's chips (see Board / .pot-pill). */
const POT_MAIN_W = 116;
const POT_SIDE_W = 92;
const POT_TOTAL_W = 84;
/** The single "Pot 7,150 +2" chip used when the full row would not fit on one line. */
export const POT_COMPACT_W = 150;
const POT_ROW_H = 28;
const POT_ROW_GAP = 4;

/**
 * True when the pot row (`pills` chips) does not fit on one line between the side seats: Board then
 * shows one compact chip (total + number of side pots) that expands on tap.
 */
export function potRowCompact(pills: number, maxWidth: number): boolean {
  return pills > 1 && potRowSize(pills, maxWidth).rows > 1;
}

/** Size of the (wrapping) pot row for `pills` chips when at most `maxWidth` wide. */
export function potRowSize(pills: number, maxWidth: number, hasTotal = pills > 1): { width: number; height: number; rows: number } {
  if (pills <= 0) return { width: 0, height: POT_ROW_H, rows: 1 };
  const widths = Array.from({ length: pills }, (_, i) => (i === 0 ? POT_MAIN_W : hasTotal && i === pills - 1 ? POT_TOTAL_W : POT_SIDE_W));
  let rows = 1;
  let row = 0;
  let widest = 0;
  for (const w of widths) {
    const next = row === 0 ? w : row + 6 + w;
    if (next > maxWidth && row > 0) {
      widest = Math.max(widest, row);
      rows++;
      row = w;
    } else row = next;
  }
  widest = Math.min(maxWidth, Math.max(widest, row));
  return { width: widest, height: rows * POT_ROW_H + (rows - 1) * POT_ROW_GAP, rows };
}

/**
 * Rail thickness, board card size and the board's no-bet zone for a track. `potPills` is the
 * number of chips in the pot row (side pots make it wider and, once it wraps, taller).
 */
export function boardGeometry(track: Track, seatWidth?: number, potPills = 1): BoardGeometry {
  const rail = clampN(Math.min(track.width, track.height) * 0.055, 10, 20);
  const cw = Math.round(clampN(Math.min((track.width - 2 * rail - 30) / 5.6, ((track.height - 2 * rail) * 0.28) / 1.4), 28, 64));
  const ch = cw * 1.4;
  const gap = Math.max(4, cw * 0.1);
  const boardW = 5 * cw + 4 * gap;
  // the result line and the pot row are at most as wide as the gap between the side seats (Board's maxWidth)
  const resultMax = seatWidth ? resultLineMaxWidth(track, seatWidth) : track.width - 2 * rail;
  const compact = potRowCompact(potPills, resultMax);
  const pot = potRowSize(Math.max(1, potPills), resultMax);
  const potH = compact ? POT_ROW_H : pot.height;
  const potW = potPills <= 1 ? Math.min(boardW, POT_MAIN_W) : compact ? Math.min(POT_COMPACT_W, resultMax) : pot.width;
  const resultW = Math.min(boardW + 24, resultMax);
  return {
    rail,
    cw,
    result: { x: track.cx - resultW / 2, y: track.cy + ch / 2 + 4, width: resultW, height: 50 },
    avoid: [
      { x: track.cx - boardW / 2 - 3, y: track.cy - ch / 2 - 3, width: boardW + 6, height: ch + 6 },
      { x: track.cx - potW / 2, y: track.cy - ch / 2 - potH - 8, width: potW, height: potH + 5 },
    ],
  };
}

/** Widest the hand-result line under the board may get (room between the side seats). */
export function resultLineMaxWidth(track: Track, seatWidth: number): number {
  return Math.max(160, track.width - seatWidth - 8);
}

/** Track clearance at the bottom when my own seat is drawn below the table. */
export function heroBottomMargin(seatHeight: number): number {
  return Math.round(seatHeight * 0.22);
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
  opts: { gap?: number; heroBottom?: boolean } = {},
): { seatWidth: number; seatHeight: number } {
  const gap = opts.gap ?? 4;
  const maxByContainer = Math.min(MAX_SEAT_WIDTH, Math.floor(Math.min(width * 0.25, height * 0.3)));
  for (let w = Math.max(MIN_SEAT_WIDTH, maxByContainer); w >= MIN_SEAT_WIDTH; w -= 2) {
    const h = Math.round(w * SEAT_ASPECT);
    const layout = computeLayout({
      count,
      bottomSeat: 0,
      width,
      height,
      seatWidth: w,
      seatHeight: h,
      bottomMargin: opts.heroBottom ? heroBottomMargin(h) : undefined,
    });
    // in hero mode the bottom spot is not drawn on the table
    const pts = layout.spots.filter((s) => !(opts.heroBottom && s.relative === 0)).map((s) => s.pos);
    if (!anyOverlap(pts, w + gap, h + gap)) return { seatWidth: w, seatHeight: h };
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
