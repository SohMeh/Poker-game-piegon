// Fixture RoomViews for visual QA (?mock=<scenario>). Never imported by the main bundle.
import type { Card } from '../../shared/cards';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import type {
  BuyBackVoteView,
  ChatMessage,
  GameSettings,
  HandView,
  LedgerRow,
  LegalActions,
  LogEntry,
  MeView,
  PublicPlayer,
  RoomSummary,
  RoomView,
} from '../../shared/types';
import type { AppState } from '../state/store';
import { INITIAL_UI } from '../state/store';

const NAMES = ['Sohum', 'Alice', 'Bob', 'Carol', 'Dan', 'Eve', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy', 'Mallory'];
export const ME = 'p0';

type PP = Partial<PublicPlayer> & { seat: number | null };

function player(i: number, p: PP): PublicPlayer {
  return {
    id: `p${i}`,
    name: NAMES[i] ?? `P${i}`,
    color: (i * 5 + 2) % 12,
    stack: 2000,
    isHost: i === 0,
    connected: true,
    sittingOut: false,
    pendingSeat: null,
    buyIns: p.seat === null ? 0 : 1,
    busted: false,
    inHand: false,
    folded: false,
    allIn: false,
    bet: 0,
    hasCards: false,
    shownCards: null,
    lastAction: null,
    timeouts: 0,
    ...p,
  };
}

/** In-hand player shorthand. */
function inHand(i: number, seat: number, p: Partial<PublicPlayer> = {}): PublicPlayer {
  return player(i, { seat, inHand: true, hasCards: true, ...p });
}

function hand(now: number, p: Partial<HandView>): HandView {
  return {
    handNumber: 7,
    street: 'preflop',
    phase: 'betting',
    board: [],
    pots: [],
    totalPot: 0,
    dealerSeat: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    smallBlind: 10,
    bigBlind: 20,
    toActPlayerId: null,
    turnDeadline: now + 19_000,
    turnDurationMs: 30_000,
    currentBet: 20,
    minRaiseTo: 40,
    winners: null,
    runout: false,
    ...p,
  };
}

function ledgerFor(players: PublicPlayer[], buyIn: number): LedgerRow[] {
  return players
    .filter((p) => p.buyIns > 0)
    .map((p) => {
      const stack = p.stack + p.bet;
      const total = p.buyIns * buyIn;
      return { playerId: p.id, name: p.name, buyIns: p.buyIns, totalBuyIn: total, stack, net: stack - total, inRoom: true };
    });
}

interface RoomOpts {
  now: number;
  players: PublicPlayer[];
  settings?: Partial<GameSettings>;
  hand?: HandView | null;
  status?: RoomView['status'];
  started?: boolean;
  me?: Partial<MeView>;
  votes?: BuyBackVoteView[];
  gameOverWinnerId?: string | null;
  ledger?: LedgerRow[];
}

function room(o: RoomOpts): RoomView {
  const settings: GameSettings = { ...DEFAULT_SETTINGS, ...o.settings };
  const seats: (string | null)[] = Array.from({ length: settings.maxPlayers }, () => null);
  for (const p of o.players) if (p.seat !== null) seats[p.seat] = p.id;
  const me = o.players.find((p) => p.id === ME)!;
  return {
    roomId: 'PIP42X',
    serverTime: o.now,
    status: o.status ?? 'running',
    settings,
    started: o.started ?? true,
    hostId: o.players.find((p) => p.isHost)?.id ?? ME,
    seats,
    players: o.players,
    hand: o.hand ?? null,
    buyBackVotes: o.votes ?? [],
    ledger: o.ledger ?? ledgerFor(o.players, settings.buyIn),
    gameOverWinnerId: o.gameOverWinnerId ?? null,
    me: {
      playerId: ME,
      name: me.name,
      isHost: me.isHost,
      seat: me.seat,
      holeCards: null,
      legal: null,
      canRequestBuyBack: false,
      buyBackCooldownUntil: null,
      votesAwaitingMe: [],
      canShowCards: false,
      ...o.me,
    },
  };
}

function legal(p: Partial<LegalActions>): LegalActions {
  return {
    canFold: true,
    canCheck: false,
    canCall: true,
    callAmount: 60,
    canRaise: true,
    isBet: false,
    minRaiseTo: 100,
    maxRaiseTo: 2000,
    currentBet: 60,
    myBet: 0,
    stack: 2000,
    pot: 90,
    ...p,
  };
}

const cards = (...c: string[]) => c as Card[];

// ---------------------------------------------------------------- chat + log
function chatFixture(now: number): ChatMessage[] {
  const m = (i: number, who: number | null, text: string, ago: number): ChatMessage => ({
    id: `c${i}`,
    playerId: who === null ? null : `p${who}`,
    name: who === null ? 'Table' : (NAMES[who] ?? '?'),
    text,
    ts: now - ago,
    system: who === null,
  });
  return [
    m(1, null, 'Sohum opened the table', 600_000),
    m(2, 1, 'pulling up a chair 🪑', 540_000),
    m(3, 2, 'who brought snacks', 500_000),
    m(4, 0, 'not me lol', 480_000),
    m(5, 3, 'nh Alice', 120_000),
    m(6, 1, 'ty ty 😎', 100_000),
    m(7, null, 'Bob bought back in (everyone agreed)', 60_000),
    m(8, 5, 'gl all 🔥', 20_000),
  ];
}

function logFixture(now: number): LogEntry[] {
  let id = 1;
  const e = (handNumber: number | null, kind: LogEntry['kind'], text: string): LogEntry => ({
    id: id++,
    handNumber,
    ts: now - (40 - id) * 9000,
    kind,
    text,
  });
  return [
    e(null, 'info', 'Sohum created the table (10/20, buy-in 2,000)'),
    e(null, 'info', 'Alice, Bob, Carol, Dan and Eve sat down'),
    e(6, 'info', 'Hand #6 · Bob is the dealer'),
    e(6, 'action', 'Carol posts small blind 10'),
    e(6, 'action', 'Dan posts big blind 20'),
    e(6, 'action', 'Eve raises to 60'),
    e(6, 'action', 'Alice calls 60'),
    e(6, 'street', 'Flop: A♥ 7♣ 2♦'),
    e(6, 'action', 'Eve bets 90'),
    e(6, 'action', 'Alice folds'),
    e(6, 'win', 'Eve wins 270'),
    e(7, 'info', 'Hand #7 · Bob is the dealer'),
    e(7, 'action', 'Carol posts small blind 10'),
    e(7, 'action', 'Dan posts big blind 20'),
    e(7, 'action', 'Eve raises to 60'),
  ];
}

// ---------------------------------------------------------------- scenarios
export type MockState = Partial<AppState>;
type Scenario = (now: number) => MockState;

const roomRoute = { name: 'room' as const, roomId: 'PIP42X', valid: true };

function tableState(r: RoomView, extra: MockState = {}): MockState {
  return { route: roomRoute, phase: 'joined', room: r, ...extra };
}

/** 6-handed preflop, Eve opened to 60, my decision with KK. */
function preflopRoom(now: number): RoomView {
  const players = [
    inHand(0, 0, { stack: 2000 }),
    inHand(1, 1, { stack: 1840 }),
    inHand(2, 2, { stack: 2310 }),
    inHand(3, 3, { stack: 1990, bet: 10, lastAction: { type: 'sb', amount: 10 } }),
    inHand(4, 4, { stack: 1480, bet: 20, lastAction: { type: 'bb', amount: 20 } }),
    inHand(5, 5, { stack: 2140, bet: 60, lastAction: { type: 'raise', amount: 60 } }),
  ];
  return room({
    now,
    players,
    settings: { maxPlayers: 6 },
    hand: hand(now, {
      handNumber: 7,
      dealerSeat: 2,
      smallBlindSeat: 3,
      bigBlindSeat: 4,
      totalPot: 90,
      currentBet: 60,
      minRaiseTo: 100,
      toActPlayerId: ME,
    }),
    me: { holeCards: cards('Kh', 'Kd'), legal: legal({}) },
  });
}

function flopWaitingRoom(now: number): RoomView {
  const players = [
    inHand(0, 0, { stack: 1760 }),
    inHand(1, 1, { stack: 1600, folded: true, hasCards: false, lastAction: { type: 'fold', amount: 0 } }),
    inHand(2, 2, { stack: 2010, bet: 80, lastAction: { type: 'bet', amount: 80 } }),
    inHand(3, 3, { stack: 1930 }),
    inHand(4, 4, { stack: 1460, folded: true, hasCards: false, lastAction: { type: 'fold', amount: 0 } }),
    player(5, { seat: 5, stack: 2140, sittingOut: true }),
  ];
  return room({
    now,
    players,
    settings: { maxPlayers: 6 },
    hand: hand(now, {
      handNumber: 8,
      street: 'flop',
      board: cards('Ah', '7c', '2d'),
      pots: [{ amount: 260, eligiblePlayerIds: ['p0', 'p2', 'p3'] }],
      totalPot: 340,
      dealerSeat: 3,
      smallBlindSeat: 4,
      bigBlindSeat: 0,
      currentBet: 80,
      minRaiseTo: 160,
      toActPlayerId: 'p3',
      turnDeadline: now + 11_000,
    }),
    me: { holeCards: cards('As', 'Qs') },
  });
}

const SCENARIOS: Record<string, Scenario> = {
  home: () => ({ route: { name: 'home' }, phase: 'idle' }),

  join: (now) => {
    const summary: RoomSummary = {
      roomId: 'PIP42X',
      hostName: 'Sohum',
      seated: 3,
      maxPlayers: 9,
      smallBlind: 10,
      bigBlind: 20,
      buyIn: 2000,
      status: 'running',
      started: true,
    };
    void now;
    return { route: roomRoute, phase: 'needsName', summary };
  },

  'not-found': () => ({ route: roomRoute, phase: 'notFound' }),
  kicked: () => ({ route: roomRoute, phase: 'kicked', kickedReason: 'The host removed you from the table.' }),
  loading: () => ({ route: roomRoute, phase: 'loading' }),

  'lobby-host': (now) =>
    tableState(
      room({
        now,
        status: 'lobby',
        started: false,
        players: [
          player(0, { seat: 0 }),
          player(1, { seat: 2 }),
          player(2, { seat: 5 }),
          player(3, { seat: 7, connected: false }),
          player(6, { seat: null }),
        ],
      }),
    ),

  'lobby-guest': (now) => {
    const players = [
      player(0, { seat: 0, isHost: false }),
      player(1, { seat: 3, isHost: true }),
      player(2, { seat: 5 }),
    ];
    return tableState(room({ now, status: 'lobby', started: false, players }));
  },

  invite: (now) => ({
    ...SCENARIOS['lobby-host']!(now),
    ui: { ...INITIAL_UI, inviteOpen: true },
  }),

  'seat-request': (now) =>
    tableState(
      room({
        now,
        status: 'lobby',
        started: false,
        settings: { requireApproval: true, maxPlayers: 6 },
        players: [
          player(0, { seat: 0 }),
          player(1, { seat: 1 }),
          player(4, { seat: null, pendingSeat: 3 }),
          player(5, { seat: null, pendingSeat: 4 }),
        ],
      }),
    ),

  'preflop-my-turn': (now) => tableState(preflopRoom(now)),

  'raise-panel-open': (now) => tableState(preflopRoom(now), { ui: { ...INITIAL_UI, raiseOpen: true } }),

  'flop-waiting': (now) => {
    const r = flopWaitingRoom(now);
    return tableState(r, {
      preAction: { kind: 'checkFold', handNumber: 8, street: 'flop', toCall: 80 },
      chatPops: [{ id: 'pop1', playerId: 'p2', name: 'Bob', text: 'feeling lucky 🍀', ts: now, system: false }],
    });
  },

  'heads-up': (now) => {
    const players = [
      inHand(0, 0, { stack: 2450, lastAction: null }),
      inHand(1, 1, { stack: 1490, lastAction: { type: 'check', amount: 0 } }),
    ];
    return tableState(
      room({
        now,
        players,
        settings: { maxPlayers: 2 },
        hand: hand(now, {
          handNumber: 23,
          street: 'turn',
          board: cards('9h', '9c', '4s', 'Jd'),
          pots: [{ amount: 120, eligiblePlayerIds: ['p0', 'p1'] }],
          totalPot: 120,
          dealerSeat: 0,
          smallBlindSeat: 0,
          bigBlindSeat: 1,
          currentBet: 0,
          minRaiseTo: 20,
          toActPlayerId: ME,
          turnDeadline: null,
          turnDurationMs: null,
        }),
        me: {
          holeCards: cards('Jh', 'Ts'),
          legal: legal({ canCheck: true, canCall: false, callAmount: 0, isBet: true, minRaiseTo: 20, maxRaiseTo: 2450, currentBet: 0, stack: 2450, pot: 120 }),
        },
      }),
    );
  },

  'showdown-split': (now) => {
    const players = [
      inHand(0, 0, { stack: 1180, shownCards: cards('Ad', 'Ac') }),
      inHand(1, 1, { stack: 2240, shownCards: cards('Jc', '4d') }),
      inHand(2, 3, { stack: 2620, shownCards: cards('Jh', '2c') }),
      inHand(3, 4, { stack: 1700, folded: true, hasCards: false }),
      player(4, { seat: 6, stack: 1900 }),
    ];
    return tableState(
      room({
        now,
        players,
        settings: { maxPlayers: 7 },
        hand: hand(now, {
          handNumber: 14,
          street: 'river',
          phase: 'complete',
          board: cards('Th', '9c', '8d', '7s', '2h'),
          pots: [{ amount: 1240, eligiblePlayerIds: ['p0', 'p1', 'p2'] }],
          totalPot: 1240,
          dealerSeat: 4,
          smallBlindSeat: 6,
          bigBlindSeat: 0,
          currentBet: 0,
          toActPlayerId: null,
          turnDeadline: null,
          winners: [
            { playerId: 'p1', amount: 620, potIndex: 0, handName: 'Straight, Jack high', bestCards: cards('Jc', 'Th', '9c', '8d', '7s') },
            { playerId: 'p2', amount: 620, potIndex: 0, handName: 'Straight, Jack high', bestCards: cards('Jh', 'Th', '9c', '8d', '7s') },
          ],
        }),
        me: { holeCards: cards('Ad', 'Ac') },
      }),
    );
  },

  'allin-runout': (now) => {
    const players = [
      inHand(0, 0, { stack: 0, allIn: true, shownCards: cards('Kc', 'Ks'), lastAction: { type: 'allin', amount: 1900 } }),
      inHand(1, 2, { stack: 0, allIn: true, shownCards: cards('Ah', 'Qd'), lastAction: { type: 'call', amount: 1900 } }),
      inHand(2, 3, { stack: 2200, folded: true, hasCards: false }),
      player(3, { seat: 5, stack: 2350 }),
    ];
    return tableState(
      room({
        now,
        players,
        settings: { maxPlayers: 6 },
        hand: hand(now, {
          handNumber: 12,
          street: 'turn',
          phase: 'dealing',
          runout: true,
          board: cards('Kd', '8s', '3c', 'Qh'),
          pots: [{ amount: 3830, eligiblePlayerIds: ['p0', 'p1'] }],
          totalPot: 3830,
          dealerSeat: 3,
          smallBlindSeat: 5,
          bigBlindSeat: 0,
          currentBet: 0,
          toActPlayerId: null,
          turnDeadline: null,
        }),
        me: { holeCards: cards('Kc', 'Ks') },
      }),
    );
  },

  'buyback-vote-voter': (now) => {
    const players = [
      inHand(0, 0, { stack: 2380 }),
      inHand(1, 1, { stack: 3110, bet: 20, lastAction: { type: 'bb', amount: 20 } }),
      player(2, { seat: 3, stack: 0, busted: true }),
      inHand(3, 4, { stack: 2490, bet: 10, lastAction: { type: 'sb', amount: 10 } }),
    ];
    const vote: BuyBackVoteView = {
      id: 'v1',
      requesterId: 'p2',
      requesterName: 'Bob',
      amount: 2000,
      createdAt: now - 9000,
      deadline: now + 21_000,
      votes: { p0: null, p1: 'yes', p3: null },
      status: 'pending',
      resolvedReason: null,
      resolvedAt: null,
    };
    return tableState(
      room({
        now,
        players,
        settings: { maxPlayers: 6 },
        votes: [vote],
        hand: hand(now, {
          handNumber: 31,
          dealerSeat: 0,
          smallBlindSeat: 4,
          bigBlindSeat: 1,
          totalPot: 30,
          toActPlayerId: 'p3',
          turnDeadline: now + 22_000,
        }),
        me: { holeCards: cards('8h', '8s'), votesAwaitingMe: ['v1'] },
      }),
    );
  },

  'buyback-requester': (now) => {
    const players = [
      player(0, { seat: 2, stack: 0, busted: true }),
      inHand(1, 0, { stack: 3110, bet: 60, lastAction: { type: 'raise', amount: 60 } }),
      inHand(2, 1, { stack: 1450, bet: 20, lastAction: { type: 'bb', amount: 20 } }),
      inHand(3, 4, { stack: 2490 }),
      inHand(4, 5, { stack: 950, folded: true, hasCards: false, lastAction: { type: 'fold', amount: 0 } }),
    ];
    const vote: BuyBackVoteView = {
      id: 'v2',
      requesterId: ME,
      requesterName: 'Sohum',
      amount: 2000,
      createdAt: now - 12_000,
      deadline: now + 18_000,
      votes: { p1: 'yes', p2: null, p3: 'yes', p4: null },
      status: 'pending',
      resolvedReason: null,
      resolvedAt: null,
    };
    return tableState(
      room({
        now,
        players,
        settings: { maxPlayers: 6 },
        votes: [vote],
        hand: hand(now, {
          handNumber: 33,
          dealerSeat: 5,
          smallBlindSeat: 0,
          bigBlindSeat: 1,
          totalPot: 90,
          currentBet: 60,
          toActPlayerId: 'p3',
        }),
      }),
    );
  },

  busted: (now) => {
    const players = [
      player(0, { seat: 2, stack: 0, busted: true }),
      inHand(1, 0, { stack: 3110 }),
      inHand(2, 1, { stack: 1450, bet: 20, lastAction: { type: 'bb', amount: 20 } }),
      inHand(3, 4, { stack: 2490, bet: 60, lastAction: { type: 'raise', amount: 60 } }),
    ];
    return tableState(
      room({
        now,
        players,
        settings: { maxPlayers: 6 },
        hand: hand(now, { handNumber: 40, dealerSeat: 4, smallBlindSeat: 0, bigBlindSeat: 1, totalPot: 90, currentBet: 60, toActPlayerId: 'p1' }),
        me: { canRequestBuyBack: true },
      }),
    );
  },

  'busted-cooldown': (now) => {
    const s = SCENARIOS.busted!(now);
    const r = s.room!;
    return {
      ...s,
      room: { ...r, me: { ...r.me, canRequestBuyBack: false, buyBackCooldownUntil: now + 17_000 } },
    };
  },

  'vote-resolved': (now) => {
    const players = [
      player(0, { seat: 0, stack: 2380 }),
      player(1, { seat: 1, stack: 3110 }),
      player(2, { seat: 3, stack: 0, busted: true }),
      player(3, { seat: 4, stack: 2490 }),
    ];
    const vote: BuyBackVoteView = {
      id: 'v3',
      requesterId: 'p2',
      requesterName: 'Bob',
      amount: 2000,
      createdAt: now - 20_000,
      deadline: now + 10_000,
      votes: { p0: 'yes', p1: 'yes', p3: 'no' },
      status: 'rejected',
      resolvedReason: 'declined',
      resolvedAt: now - 1000,
    };
    return tableState(room({ now, players, settings: { maxPlayers: 6 }, votes: [vote] }));
  },

  'ten-seats': (now) => {
    const stacks = [2000, 1820, 2460, 990, 3020, 1500, 2210, 1760, 2650, 1590];
    const players = stacks.map((stack, i) =>
      inHand(i, (i + 6) % 10, {
        stack,
        ...(i === 3 ? { folded: true, hasCards: false, lastAction: { type: 'fold' as const, amount: 0 } } : {}),
        ...(i === 4 ? { bet: 10, lastAction: { type: 'sb' as const, amount: 10 } } : {}),
        ...(i === 5 ? { bet: 20, lastAction: { type: 'bb' as const, amount: 20 } } : {}),
        ...(i === 6 ? { bet: 50, lastAction: { type: 'raise' as const, amount: 50 } } : {}),
        ...(i === 7 ? { bet: 50, lastAction: { type: 'call' as const, amount: 50 } } : {}),
        ...(i === 9 ? { connected: false } : {}),
      }),
    );
    return tableState(
      room({
        now,
        players,
        settings: { maxPlayers: 10 },
        hand: hand(now, {
          handNumber: 52,
          dealerSeat: 9,
          smallBlindSeat: 0,
          bigBlindSeat: 1,
          totalPot: 130,
          currentBet: 50,
          minRaiseTo: 80,
          toActPlayerId: 'p8',
          turnDeadline: now + 6_000,
        }),
        me: { holeCards: cards('9d', 'Tc') },
      }),
    );
  },

  'spectator-full': (now) => {
    const players = [
      player(0, { seat: null, isHost: false }),
      inHand(1, 0, { stack: 2210, isHost: true }),
      inHand(2, 1, { stack: 1880 }),
      inHand(3, 2, { stack: 2500, bet: 120, lastAction: { type: 'bet', amount: 120 } }),
      inHand(4, 3, { stack: 760, folded: true, hasCards: false }),
      inHand(5, 4, { stack: 3100 }),
      inHand(6, 5, { stack: 1550 }),
    ];
    return tableState(
      room({
        now,
        players,
        settings: { maxPlayers: 6 },
        hand: hand(now, {
          handNumber: 18,
          street: 'flop',
          board: cards('5s', '5d', 'Kh'),
          pots: [{ amount: 400, eligiblePlayerIds: [] }],
          totalPot: 520,
          dealerSeat: 1,
          smallBlindSeat: 2,
          bigBlindSeat: 3,
          currentBet: 120,
          toActPlayerId: 'p5',
        }),
      }),
    );
  },

  'spectator-open': (now) => {
    const s = SCENARIOS['spectator-full']!(now);
    const r = s.room!;
    const players = r.players.filter((p) => p.id !== 'p6');
    return { ...s, room: { ...r, players, seats: r.seats.map((id) => (id === 'p6' ? null : id)) } };
  },

  pending: (now) => {
    const s = SCENARIOS['spectator-open']!(now);
    const r = s.room!;
    return { ...s, room: { ...r, players: r.players.map((p) => (p.id === ME ? { ...p, pendingSeat: 5 } : p)) } };
  },

  'sitting-out': (now) => {
    const r = flopWaitingRoom(now);
    const players = r.players.map((p) =>
      p.id === ME ? { ...p, inHand: false, hasCards: false, sittingOut: true } : p,
    );
    return tableState({ ...r, players, me: { ...r.me, holeCards: null } });
  },

  'game-over': (now) => {
    const players = [
      player(0, { seat: 0, stack: 0, busted: true }),
      player(1, { seat: 2, stack: 8000, buyIns: 1 }),
      player(2, { seat: 3, stack: 0, busted: true, buyIns: 2 }),
      player(3, { seat: 5, stack: 0, busted: true }),
    ];
    return tableState(
      room({
        now,
        players,
        settings: { maxPlayers: 6 },
        gameOverWinnerId: 'p1',
        me: { canRequestBuyBack: true },
        ledger: [
          { playerId: 'p1', name: 'Alice', buyIns: 1, totalBuyIn: 2000, stack: 8000, net: 6000, inRoom: true },
          { playerId: 'p0', name: 'Sohum', buyIns: 1, totalBuyIn: 2000, stack: 0, net: -2000, inRoom: true },
          { playerId: 'p2', name: 'Bob', buyIns: 2, totalBuyIn: 4000, stack: 0, net: -4000, inRoom: true },
          { playerId: 'p3', name: 'Carol', buyIns: 1, totalBuyIn: 2000, stack: 0, net: -2000, inRoom: true },
        ],
      }),
    );
  },
};

function withMenu(base: string, tab: AppState['ui']['menuTab']): Scenario {
  return (now) => {
    const s = SCENARIOS[base]!(now);
    return {
      ...s,
      chat: chatFixture(now),
      log: logFixture(now),
      ui: { ...INITIAL_UI, menuOpen: true, menuTab: tab },
    };
  };
}

/** 10-seat table where Carol (p3) busted and asked to buy back in; 9 voters. */
function tenSeatVote(now: number, myVote: 'yes' | null): MockState {
  const base = SCENARIOS['ten-seats']!(now);
  const r = structuredClone(base.room!);
  const carol = r.players.find((p) => p.id === 'p3')!;
  Object.assign(carol, { stack: 0, busted: true, inHand: false, folded: false, hasCards: false, lastAction: null });
  const voters = r.players.filter((p) => p.id !== 'p3');
  const vote: BuyBackVoteView = {
    id: 'v10',
    requesterId: 'p3',
    requesterName: 'Carol',
    amount: 2000,
    createdAt: now - 12_000,
    deadline: now + 108_000,
    votes: Object.fromEntries(voters.map((p, i) => [p.id, p.id === ME ? myVote : i % 3 === 1 ? 'yes' : null])),
    status: 'pending',
    resolvedReason: null,
    resolvedAt: null,
  };
  r.settings.buyBackVoteSec = 120;
  r.buyBackVotes = [vote];
  r.me.votesAwaitingMe = myVote === null ? ['v10'] : [];
  return { ...base, room: r };
}

// a 10-seat table: 9 voters, and I still have to vote / already voted
SCENARIOS['buyback-vote-voter-10'] = (now) => tenSeatVote(now, null);
SCENARIOS['ten-seats-vote'] = (now) => tenSeatVote(now, 'yes');

// flop with two side pots (three all-in stacks) while someone decides whether to call
SCENARIOS['flop-side-pots'] = (now) => {
  const players = [
    inHand(0, 0, { stack: 1760 }),
    inHand(1, 1, { stack: 0, allIn: true, lastAction: { type: 'allin', amount: 900 } }),
    inHand(2, 2, { stack: 2010, bet: 1400, lastAction: { type: 'raise', amount: 1400 } }),
    inHand(3, 3, { stack: 0, allIn: true, lastAction: { type: 'allin', amount: 1250 } }),
    inHand(4, 4, { stack: 1460, folded: true, hasCards: false, lastAction: { type: 'fold', amount: 0 } }),
    player(5, { seat: 5, stack: 2140, sittingOut: true }),
  ];
  return tableState(
    room({
      now,
      players,
      settings: { maxPlayers: 6 },
      hand: hand(now, {
        handNumber: 9,
        street: 'flop',
        board: cards('Ah', '7c', '2d'),
        pots: [
          { amount: 3600, eligiblePlayerIds: ['p0', 'p1', 'p2', 'p3'] },
          { amount: 1250, eligiblePlayerIds: ['p0', 'p2', 'p3'] },
          { amount: 900, eligiblePlayerIds: ['p0', 'p2'] },
        ],
        totalPot: 7150,
        dealerSeat: 3,
        smallBlindSeat: 4,
        bigBlindSeat: 0,
        currentBet: 1400,
        minRaiseTo: 2800,
        toActPlayerId: 'p0',
        turnDeadline: now + 21_000,
      }),
      me: {
        holeCards: cards('As', 'Qs'),
        legal: legal({ canCheck: false, canCall: true, callAmount: 1400, isBet: false, minRaiseTo: 2800, maxRaiseTo: 1760, currentBet: 1400, stack: 1760, pot: 7150 }),
      },
    }),
  );
};

SCENARIOS['menu-players'] = withMenu('seat-request', 'players');
SCENARIOS['menu-log'] = withMenu('preflop-my-turn', 'log');
SCENARIOS['menu-chat'] = withMenu('preflop-my-turn', 'chat');
SCENARIOS['menu-ledger'] = withMenu('game-over', 'ledger');
SCENARIOS['menu-settings'] = withMenu('preflop-my-turn', 'settings');

export const SCENARIO_NAMES = Object.keys(SCENARIOS);

export function scenarioState(name: string, now: number): MockState {
  const s = SCENARIOS[name] ?? SCENARIOS['preflop-my-turn']!;
  return s(now);
}
