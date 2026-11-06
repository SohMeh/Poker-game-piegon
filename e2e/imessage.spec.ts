// End-to-end: the table running inside the iMessage extension. A fake native bridge (what the Swift
// WKWebView host injects) records every event the page posts; each one must have the shape of the
// shared contract fixture, and normal browser pages must never post anything.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BubbleKind, HapticStyle, WebToNative } from '../src/client/native/bridgeTypes';
import {
  attr,
  closePhones,
  closeSheet,
  createGame,
  fillCreateSettings,
  joinGame,
  openPhone,
  playHand,
  playUntilBust,
  sitDown,
  table,
  waitForHand,
  type Phone,
} from './helpers';

test.describe.configure({ mode: 'serial' });

type Bubble = Extract<WebToNative, { type: 'bubble' }>;

const FIXTURE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../ios/FlockKit/Tests/FlockKitTests/Fixtures/bridge-events.json');
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { webToNative: WebToNative[] };
const HAPTIC_STYLES: HapticStyle[] = ['light', 'medium', 'heavy', 'success', 'warning', 'error', 'selection'];

let phones: Phone[] = [];
test.afterEach(async () => {
  await closePhones(phones);
  phones = [];
});

/**
 * Stands in for the native extension: `native` adds window.__FLOCK_NATIVE__ (what the app injects at
 * document start); the flock message handler is always there and records into window.__bridgeEvents.
 */
async function installFakeBridge(page: Page, opts: { native: boolean; name?: string | null }): Promise<void> {
  await page.addInitScript(({ native, name }) => {
    const w = window as unknown as Record<string, unknown>;
    const events: unknown[] = [];
    w.__bridgeEvents = events;
    if (native) w.__FLOCK_NATIVE__ = { platform: 'imessage', version: 1, name, presentation: 'expanded' };
    w.webkit = {
      messageHandlers: {
        flock: {
          postMessage: (m: unknown) => {
            events.push(JSON.parse(JSON.stringify(m)));
          },
        },
      },
    };
  }, { native: opts.native, name: opts.name ?? null });
}

async function events(page: Page): Promise<WebToNative[]> {
  return page.evaluate(() => ((window as unknown as { __bridgeEvents?: unknown[] }).__bridgeEvents ?? []) as never);
}

async function bubbles(phone: Phone, kind: BubbleKind): Promise<Bubble[]> {
  return (await events(phone.page)).filter((e): e is Bubble => e.type === 'bubble' && e.kind === kind);
}

async function waitForBubble(phone: Phone, kind: BubbleKind, timeout = 20_000): Promise<Bubble> {
  await expect.poll(async () => (await bubbles(phone, kind)).length, { timeout, message: `${phone.name}: ${kind} bubble` }).toBeGreaterThan(0);
  return (await bubbles(phone, kind))[0]!;
}

async function playerId(page: Page, code: string): Promise<string> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), `flock:session:${code}`);
  return (JSON.parse(raw ?? '{}') as { playerId?: string }).playerId ?? '';
}

/** Keys and value types, recursively. */
function shapeOf(v: unknown): unknown {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.map(shapeOf);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, shapeOf(o[k])]));
  }
  return typeof v;
}

/** Every posted event has exactly the keys / value types of the fixture event of the same type (and kind). */
function expectFixtureShapes(posted: WebToNative[], origin: string, code: string): void {
  expect(posted.length).toBeGreaterThan(0);
  for (const e of posted) {
    const where = JSON.stringify(e);
    const ref = FIXTURE.webToNative.find((f) => f.type === e.type && (e.type !== 'bubble' || (f as Bubble).kind === e.kind));
    expect(ref, where).toBeTruthy();
    expect(shapeOf(e), where).toEqual(shapeOf(ref));
    if (e.type === 'ready') {
      expect(e.version, where).toBe(1);
      expect(['home', 'table'], where).toContain(e.route);
    } else if (e.type === 'haptic') {
      expect(HAPTIC_STYLES, where).toContain(e.style);
    } else if (e.type === 'presentation') {
      expect(['compact', 'expanded'], where).toContain(e.style);
    } else if (e.type === 'bubble') {
      expect([e.mode, e.plainLink], where).toEqual(e.kind === 'invite' ? ['insert', true] : ['send', false]);
      expect(e.bubble.roomId, where).toBe(code);
      expect(e.bubble.url, where).toBe(`${origin}/g/${code}`);
      expect(e.dedupeKey.startsWith(`${e.kind}:${code}:`), where).toBe(true);
    }
  }
}

async function checkOrCall(phone: Phone): Promise<void> {
  const { page } = phone;
  const key = await attr(phone, 'data-turn-key');
  if (await page.getByTestId('action-check').isVisible()) await page.getByTestId('action-check').click();
  else await page.getByTestId('action-call').click();
  await expect.poll(() => attr(phone, 'data-turn-key'), { timeout: 10_000 }).not.toBe(key);
}

test('inside Messages: invite, start, your-turn nudge, buy-back vote, game over and rematch bubbles', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const origin = new URL(String(testInfo.project.use.baseURL)).origin;
  const host = await openPhone(browser, testInfo, 'Hana');
  const bob = await openPhone(browser, testInfo, 'Bob');
  phones = [host, bob];
  await installFakeBridge(host.page, { native: true, name: 'Hana' });
  // Bob first opens the plain web link (a friend without the app). His page gets a stray message
  // handler but no native injection: it must never be used.
  await installFakeBridge(bob.page, { native: false });

  // ---- app drawer -> Flock Poker -> New game: the create form first, with the remembered name
  await host.page.goto('/?embed=imessage&create=1');
  await expect(host.page.getByTestId('home-name')).toHaveValue('Hana');
  await expect(host.page.locator('.home-hero')).toHaveCount(0);
  const form = host.page.locator('.home-card');
  await expect(form).toBeVisible();
  expect((await form.boundingBox())!.y).toBeLessThan(60);
  await expect.poll(() => events(host.page)).toEqual([{ type: 'ready', version: 1, route: 'home' }]);

  await fillCreateSettings(host.page, { blinds: '5/10', buyIn: 100, seats: 2, shotClock: 'Off', voteSec: 15 });
  await host.page.getByTestId('create-room').click();
  // the embed flag stays on the URL, so a reload inside the extension stays embedded
  await expect(host.page).toHaveURL(/\/g\/[A-Z0-9]{6}\?embed=imessage$/);
  const code = new URL(host.page.url()).pathname.split('/')[2]!;
  await expect(table(host)).toBeVisible();

  // ---- the invite bubble goes to the compose field (instead of the invite sheet)
  const invite = await waitForBubble(host, 'invite');
  expect(invite).toMatchObject({ type: 'bubble', kind: 'invite', mode: 'insert', plainLink: true, dedupeKey: `invite:${code}:1` });
  expect(invite.bubble).toEqual({
    roomId: code,
    url: `${origin}/g/${code}`,
    title: "Hana's poker game",
    subtitle: '5/10 · buy-in 100 · 1/2 seated — tap to join',
    summary: 'Hana started a poker game',
    trailing: 'Lobby',
    status: 'lobby',
    hostName: 'Hana',
    seated: 1,
    maxPlayers: 2,
    smallBlind: 5,
    bigBlind: 10,
    buyIn: 100,
    handNumber: 0,
  });
  await expect(host.page.getByRole('dialog')).toHaveCount(0);
  const early = await events(host.page);
  expect(early.filter((e) => e.type === 'rememberName')).toEqual([{ type: 'rememberName', name: 'Hana' }]);
  expect(early.filter((e) => e.type === 'ready')).toEqual([
    { type: 'ready', version: 1, route: 'home' },
    { type: 'ready', version: 1, route: 'table' },
  ]);

  // ---- a friend joins from the plain web link
  await joinGame(bob, code);
  await sitDown(bob);

  // ---- invite sheet inside Messages: "Send to chat" replaces the share sheet / SMS link
  await host.page.getByTestId('room-code').click();
  const sheet = host.page.getByRole('dialog');
  await expect(sheet.getByTestId('send-to-chat')).toBeVisible();
  await expect(sheet.getByTestId('send-invite')).toHaveCount(0);
  await expect(sheet.getByText('Open Messages')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await sheet.getByTestId('send-to-chat').click();
  await expect(host.page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await bubbles(host, 'invite')).length).toBe(2);
  const resent = (await bubbles(host, 'invite'))[1]!;
  expect(resent).toMatchObject({ mode: 'insert', plainLink: true, dedupeKey: `invite:${code}:1` });
  expect(resent.bubble).toMatchObject({ seated: 2, subtitle: '5/10 · buy-in 100 · 2/2 seated — tap to watch' });

  // ---- host taps Start
  await host.page.getByTestId('start-game').click();
  const started = await waitForBubble(host, 'gameStarted');
  expect(started).toMatchObject({ mode: 'send', plainLink: false, dedupeKey: `gameStarted:${code}:1` });
  expect(started.bubble).toMatchObject({
    title: 'Cards are in the air!',
    subtitle: '2 players · 5/10 — tap to play',
    summary: 'Game started',
    trailing: 'Hand #1',
    status: 'running',
    handNumber: 1,
    seated: 2,
  });
  await waitForHand(phones, 1);

  // ---- your-turn nudge: Bob closes his browser while Hana is to act; when the action reaches him,
  // Hana's phone nudges him in the chat
  const hostId = await playerId(host.page, code);
  const bobId = await playerId(bob.page, code);
  expect(hostId).not.toBe('');
  expect(bobId).not.toBe('');
  for (let i = 0; i < 10 && (await attr(host, 'data-my-turn')) !== 'true'; i++) {
    if ((await attr(bob, 'data-my-turn')) === 'true') await checkOrCall(bob);
    else await host.page.waitForTimeout(200);
  }
  await expect(table(host)).toHaveAttribute('data-my-turn', 'true');
  // the plain web page never talked to the stray handler
  expect(await events(bob.page)).toEqual([]);
  await bob.page.close();
  await expect(host.page.locator('.seat-offline')).toHaveCount(1);

  let nudge: Bubble | undefined;
  for (let i = 0; i < 4 && !nudge; i++) {
    await expect(table(host)).toHaveAttribute('data-my-turn', 'true', { timeout: 15_000 });
    await checkOrCall(host);
    await expect
      .poll(
        async () => {
          nudge = (await bubbles(host, 'yourTurn'))[0];
          return !!nudge || (await attr(host, 'data-my-turn')) === 'true';
        },
        { timeout: 8000 },
      )
      .toBe(true);
  }
  expect(nudge, 'a yourTurn bubble for Bob').toBeTruthy();
  const nudgeHand = Number(await attr(host, 'data-hand'));
  expect(nudge).toMatchObject({ mode: 'send', plainLink: false, dedupeKey: `yourTurn:${code}:${nudgeHand}:${bobId}` });
  expect(nudge!.bubble).toMatchObject({ title: "Bob, it's your turn", summary: 'Waiting on Bob', trailing: `Hand #${nudgeHand}`, handNumber: nudgeHand });
  expect(nudge!.bubble.subtitle).toMatch(/^Pot \d+ · (preflop|flop|turn|river) — tap to act$/);

  // ---- Bob taps the bubble: now he is inside Messages too, back in his seat (same device storage)
  const bobPage = await bob.context.newPage();
  bobPage.on('pageerror', (err) => bob.errors.push(`[Bob] ${err.message}`));
  await installFakeBridge(bobPage, { native: true, name: 'Bob' });
  await bobPage.goto(`/g/${code}?embed=imessage`);
  bob.page = bobPage;
  await expect(table(bob)).toBeVisible();
  await expect(host.page.locator('.seat-offline')).toHaveCount(0);
  expect(await bubbles(host, 'yourTurn')).toHaveLength(1);

  // ---- shove until someone busts
  const bustedIndex = await playUntilBust([host, bob]);
  const busted = phones[bustedIndex]!;
  const winner = phones[1 - bustedIndex]!;
  const winnerId = winner === host ? hostId : bobId;

  // ---- game over: the host's device tells the chat
  const over = await waitForBubble(host, 'gameOver');
  expect(over).toMatchObject({ mode: 'send', plainLink: false, dedupeKey: `gameOver:${code}:1:${winnerId}` });
  expect(over.bubble).toMatchObject({
    title: `${winner.name} won the game!`,
    subtitle: 'Holding all 200 chips — tap for the ledger',
    summary: `${winner.name} won the game`,
    trailing: 'Final',
    status: 'running',
  });
  expect(over.bubble.handNumber).toBeGreaterThan(0);
  expect(await bubbles(bob, 'gameOver')).toEqual([]);

  // ---- the busted player asks to buy back in: THEIR phone posts the "tap to vote" bubble
  await expect(busted.page.getByTestId('buyback-request')).toBeEnabled();
  await busted.page.getByTestId('buyback-request').click();
  const ask = await waitForBubble(busted, 'buyBackRequested');
  expect(ask).toMatchObject({ mode: 'send', plainLink: false });
  expect(ask.dedupeKey).toMatch(new RegExp(`^buyBackRequested:${code}:\\S+$`));
  expect(ask.bubble).toMatchObject({
    title: `${busted.name} wants to buy back in`,
    subtitle: 'Everyone must approve within 15s — tap to vote',
    summary: `${busted.name} asked to buy back in`,
    trailing: 'Vote',
  });
  expect(await bubbles(winner, 'buyBackRequested')).toEqual([]);
  // the vote itself happens at the table, with a native haptic for the voter
  await expect(winner.page.getByTestId('buyback-vote')).toBeVisible();
  await expect.poll(async () => (await events(winner.page)).some((e) => e.type === 'haptic' && e.style === 'warning')).toBe(true);
  await winner.page.getByTestId('vote-reject').click();
  await expect(winner.page.getByTestId('buyback-vote')).toHaveCount(0);
  await expect(table(host)).toHaveAttribute('data-game-over', 'true');

  // ---- rematch
  await host.page.getByTestId('rematch').click();
  const again = await waitForBubble(host, 'rematch');
  expect(again).toMatchObject({ mode: 'send', plainLink: false, dedupeKey: `rematch:${code}:2` });
  expect(again.bubble).toMatchObject({
    title: 'Rematch!',
    subtitle: 'Fresh buy-ins of 100 — tap to sit down',
    summary: 'New game started',
    trailing: 'Lobby',
    status: 'lobby',
    handNumber: 0,
    seated: 2,
  });

  // ---- every event either phone posted matches the shared contract fixture
  const hostEvents = await events(host.page);
  const bobEvents = await events(bob.page);
  expectFixtureShapes(hostEvents, origin, code);
  expectFixtureShapes(bobEvents, origin, code);
  expect(bobEvents.filter((e) => e.type === 'ready')).toEqual([{ type: 'ready', version: 1, route: 'table' }]);
  // Bob rejoined with his seat token: no name was entered, so none is remembered
  expect(bobEvents.filter((e) => e.type === 'rememberName')).toEqual([]);
  // native haptics instead of navigator.vibrate (Hana had at least one turn)
  expect(hostEvents.some((e) => e.type === 'haptic' && e.style === 'medium')).toBe(true);
  // one bubble per moment
  const kinds = hostEvents.filter((e): e is Bubble => e.type === 'bubble').map((e) => e.kind);
  expect(kinds.filter((k) => k === 'gameStarted' || k === 'gameOver' || k === 'rematch')).toEqual(['gameStarted', 'gameOver', 'rematch']);
});

test('outside Messages nothing is posted, even with a message handler on the page', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const host = await openPhone(browser, testInfo, 'Hana');
  const bob = await openPhone(browser, testInfo, 'Bob');
  phones = [host, bob];
  await installFakeBridge(host.page, { native: false });
  await installFakeBridge(bob.page, { native: false });

  await host.page.goto('/');
  await expect(host.page.locator('.home-hero')).toBeVisible();
  const code = await createGame(host, { blinds: '5/10', buyIn: 100, seats: 2, shotClock: 'Off' });
  // the normal invite sheet: share sheet + SMS link, no "Send to chat"
  const sheet = host.page.getByRole('dialog');
  await expect(sheet.getByTestId('send-invite')).toBeVisible();
  await expect(sheet.getByText('Open Messages')).toBeVisible();
  await expect(sheet.getByTestId('send-to-chat')).toHaveCount(0);
  await closeSheet(host);
  await joinGame(bob, code);
  await sitDown(bob);
  await host.page.getByTestId('start-game').click();
  await waitForHand(phones);
  await playHand(phones, 'checkCall');
  await expect(host.page).toHaveURL(new RegExp(`/g/${code}$`));
  expect(await events(host.page)).toEqual([]);
  expect(await events(bob.page)).toEqual([]);
  expect(await host.page.evaluate(() => document.documentElement.dataset.embed ?? null)).toBeNull();
});

test('?embed=imessage before the native injection: the UI adapts, nothing is posted, the invite sheet is the fallback', async ({ browser }, testInfo) => {
  const host = await openPhone(browser, testInfo, 'Hana');
  phones = [host];
  await host.page.goto('/?embed=imessage');
  await expect(host.page.locator('.home-hero')).toHaveCount(0);
  await expect(host.page.locator('html')).toHaveAttribute('data-embed', 'imessage');
  await host.page.getByTestId('home-name').fill('Hana');
  await host.page.getByTestId('create-room').click();
  await expect(host.page).toHaveURL(/\/g\/[A-Z0-9]{6}\?embed=imessage$/);
  // no native to take the bubble: the invite sheet opens like in a browser, with "Send to chat"
  await expect(host.page.getByRole('dialog').getByTestId('send-to-chat')).toBeVisible();
  expect(await host.page.evaluate(() => (window as unknown as { __bridgeEvents?: unknown }).__bridgeEvents ?? null)).toBeNull();
  // a reload keeps embed mode
  await host.page.reload();
  await expect(table(host)).toBeVisible();
  await expect(host.page.locator('html')).toHaveAttribute('data-embed', 'imessage');
  // leaving to the home screen keeps the flag too
  await host.page.getByTestId('menu-button').click();
  await host.page.getByTestId('tab-settings').click();
  await host.page.getByTestId('leave-room').click();
  await host.page.getByTestId('leave-confirm').click();
  await expect(host.page).toHaveURL(/\/\?embed=imessage$/);
  await expect(host.page.locator('.home-card')).toBeVisible();
  await expect(host.page.locator('.home-hero')).toHaveCount(0);
});

test('embedded table layout: extra top inset under the Messages header, still no scrolling', async ({ page }) => {
  const topOf = async (selector: string) => (await page.locator(selector).boundingBox())!.y;
  for (const [w, h] of [
    [390, 664],
    [375, 548],
    [320, 454],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const scenario of ['preflop-my-turn', 'buyback-vote-voter', 'lobby-host', 'game-over']) {
      await page.goto(`/?mock=${scenario}`);
      await expect(page.getByTestId('table-screen')).toBeVisible();
      await page.waitForTimeout(400);
      const plainTop = await topOf('.topbar');
      await page.goto(`/?mock=${scenario}&embed=imessage`);
      await expect(page.getByTestId('table-screen')).toBeVisible();
      await page.waitForTimeout(400);
      const where = `${scenario} ${w}x${h}`;
      expect(await topOf('.topbar'), where).toBeCloseTo(plainTop + 8, 0);
      const fits = await page.evaluate(() => {
        const el = document.scrollingElement!;
        return el.scrollHeight <= window.innerHeight && el.scrollWidth <= window.innerWidth;
      });
      expect(fits, where).toBe(true);
      // every control at the bottom is fully on screen
      for (const box of await page.locator('.bottom-area button, .vote-modal button').evaluateAll((els) =>
        els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })),
      )) {
        expect(box.top, where).toBeGreaterThanOrEqual(0);
        expect(box.bottom, where).toBeLessThanOrEqual(h + 0.5);
        expect(box.left, where).toBeGreaterThanOrEqual(0);
        expect(box.right, where).toBeLessThanOrEqual(w + 0.5);
      }
    }
  }
});
