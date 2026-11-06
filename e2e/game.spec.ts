// End-to-end: a host and friends on separate phones play a real game against the prod server.
import { expect, test } from '@playwright/test';
import {
  cardCode,
  closePhones,
  closeSheet,
  createGame,
  heroCards,
  joinGame,
  openPhone,
  playHand,
  readLedger,
  shot,
  sitDown,
  stateFrames,
  table,
  waitForHand,
  type Phone,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let phones: Phone[] = [];
test.afterEach(async () => {
  await closePhones(phones);
  phones = [];
});

test('happy path: create, invite, sit, play a full hand to showdown', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const host = await openPhone(browser, testInfo, 'Hana');
  const bob = await openPhone(browser, testInfo, 'Bob');
  const cleo = await openPhone(browser, testInfo, 'Cleo');
  phones = [host, bob, cleo];

  // ---- host starts a game from the home screen
  await host.page.goto('/');
  await shot(host, 'home');
  const code = await createGame(host, { blinds: '10/20', buyIn: 2000, seats: 6, shotClock: 'Off' });
  await expect(host.page.getByRole('dialog', { name: 'Invite friends' })).toBeVisible();
  const link = await host.page.getByRole('textbox', { name: 'Invite link' }).inputValue();
  expect(link).toMatch(new RegExp(`/g/${code}$`));
  await shot(host, 'invite-sheet');
  await closeSheet(host);

  // ---- two friends open the link, enter names and take seats
  await bob.page.goto(`/g/${code}`);
  await expect(bob.page.getByTestId('room-summary')).toContainText('Hana’s table');
  await expect(bob.page.getByTestId('room-summary')).toContainText('1/6 seated');
  await shot(bob, 'join-screen');
  await joinGame(bob, code);
  await sitDown(bob);
  await joinGame(cleo, code);
  await sitDown(cleo);
  await expect(host.page.getByText('3 players ready')).toBeVisible();
  await shot(host, 'lobby-host');

  // ---- host deals
  await host.page.getByTestId('start-game').click();
  const handNumber = await waitForHand(phones);
  expect(handNumber).toBe(1);

  // every phone sees exactly its own two hole cards, and only card backs for the others
  const hole: Record<string, string[]> = {};
  for (const p of phones) {
    await expect(p.page.getByTestId('hero').locator('.hero-cards .pcard:not(.pcard-back)')).toHaveCount(2);
    hole[p.name] = await heroCards(p);
    await expect(p.page.getByTestId('hand-hint')).toBeVisible();
    const others = table(p).locator('.seat:not(.seat-empty)');
    await expect(others).toHaveCount(2);
    for (const seat of await others.all()) {
      await expect(seat.locator('.pcard-back')).toHaveCount(2);
      await expect(seat.locator('.pcard:not(.pcard-back)')).toHaveCount(0);
    }
  }
  const allHole = Object.values(hole).flat();
  expect(new Set(allHole).size).toBe(6);
  await shot(host, 'preflop-host');
  await shot(bob, 'preflop-bob');

  // ---- check / call it down through flop, turn and river
  const seenStreets = new Set<string>();
  await playHand(phones, 'checkCall', async (p) => {
    seenStreets.add((await table(p).getAttribute('data-street')) ?? '');
    if (seenStreets.size === 2 && !seenStreets.has('shot-flop')) {
      seenStreets.add('shot-flop');
      await shot(p, 'flop-my-turn');
    }
  });
  expect([...seenStreets]).toEqual(expect.arrayContaining(['preflop', 'flop', 'turn', 'river']));

  // showdown: the result line is visible everywhere and the board is complete
  for (const p of phones) {
    await expect(p.page.getByTestId('hand-result')).toBeVisible();
    await expect(p.page.getByTestId('hand-result')).toContainText(/wins|split/);
    await expect(table(p).locator('.board-cards .pcard:not(.pcard-slot)')).toHaveCount(5);
    await expect(table(p)).toHaveAttribute('data-street', 'showdown');
  }
  await shot(host, 'showdown');

  // nobody ever received another player's face-down cards before the showdown
  for (const p of phones) {
    const mine = new Set(hole[p.name]!.map(cardCode));
    const theirs = allHole.map(cardCode).filter((c) => !mine.has(c));
    const before = stateFrames(p).filter(({ view }) => {
      const h = view.hand as { handNumber: number; phase: string; runout: boolean } | null;
      return !!h && h.handNumber === handNumber && h.phase !== 'complete' && !h.runout;
    });
    expect(before.length).toBeGreaterThan(3);
    for (const { raw } of before) for (const c of theirs) expect(raw).not.toContain(`"${c}"`);
  }

  // ---- the ledger always adds up to the buy-ins
  const ledger = await readLedger(bob);
  await shot(bob, 'ledger');
  expect(ledger).toHaveLength(3);
  expect(ledger.every((r) => r.buyIns === 1 && r.totalBuyIn === 2000)).toBe(true);
  expect(ledger.reduce((s, r) => s + r.stack, 0)).toBe(6000);
  expect(ledger.reduce((s, r) => s + r.net, 0)).toBe(0);
  await closeSheet(bob);

  // the next hand is dealt automatically
  await waitForHand(phones, handNumber + 1);

  // table talk: a chat message reaches the others (as a pop over the table and in the chat tab)
  await cleo.page.getByRole('button', { name: /^Chat/ }).click();
  await cleo.page.getByTestId('chat-input').fill('nice hand Hana');
  await cleo.page.getByTestId('chat-input').press('Enter');
  await expect(cleo.page.getByTestId('chat-input')).toHaveValue('');
  await expect(bob.page.locator('.chat-pop')).toContainText('nice hand Hana');
  await expect(bob.page.getByRole('button', { name: 'Chat, 1 unread' })).toBeVisible();
  await bob.page.getByRole('button', { name: 'Chat, 1 unread' }).click();
  await expect(bob.page.locator('.chat-bubble', { hasText: 'nice hand Hana' })).toBeVisible();
  await shot(bob, 'chat');
});

test('reconnect: reloading keeps the seat, stack and hole cards', async ({ browser }, testInfo) => {
  const host = await openPhone(browser, testInfo, 'Hana');
  const bob = await openPhone(browser, testInfo, 'Bob');
  phones = [host, bob];
  const code = await createGame(host, { blinds: '10/20', shotClock: 'Off' });
  await closeSheet(host);
  await joinGame(bob, code);
  await sitDown(bob);
  await host.page.getByTestId('start-game').click();
  await waitForHand(phones);

  const seat = await table(bob).getAttribute('data-seat');
  const cards = await heroCards(bob);
  const stack = await bob.page.getByTestId('my-stack').textContent();
  expect(cards).toHaveLength(2);

  await bob.page.reload();
  await expect(table(bob)).toBeVisible();
  await expect(bob.page.getByTestId('join-name')).toHaveCount(0);
  await expect(table(bob)).toHaveAttribute('data-seat', seat ?? '');
  await expect.poll(() => heroCards(bob)).toEqual(cards);
  await expect(bob.page.getByTestId('my-stack')).toHaveText(stack ?? '');
  await shot(bob, 'after-reload');

  // and the game carries on: the hand can still be played out from the reloaded phone
  await playHand(phones, 'checkCall');
  await expect(bob.page.getByTestId('hand-result')).toBeVisible();
});

test('waking up: a phone that missed updates while asleep catches up right away', async ({ browser }, testInfo) => {
  const host = await openPhone(browser, testInfo, 'Hana');
  const bob = await openPhone(browser, testInfo, 'Bob');
  phones = [host, bob];
  // Bob's websocket can be turned into a black hole: it stays "connected" but nothing gets through,
  // like a phone whose browser was frozen in the background
  let asleep = false;
  await bob.page.routeWebSocket(/\/socket\.io\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (!asleep) server.send(m);
    });
    server.onMessage((m) => {
      if (!asleep) ws.send(m);
    });
  });
  const code = await createGame(host, { blinds: '10/20', shotClock: 'Off' });
  await closeSheet(host);
  await joinGame(bob, code);
  await sitDown(bob);
  await host.page.getByTestId('start-game').click();
  await waitForHand(phones);

  asleep = true;
  await host.page.getByTestId('menu-button').click();
  await host.page.getByRole('button', { name: 'Pause after this hand' }).click();
  await expect(table(host)).toHaveAttribute('data-status', 'paused');
  await bob.page.waitForTimeout(1500);
  await expect(table(bob)).toHaveAttribute('data-status', 'running'); // Bob missed it

  // the phone wakes up: the page becomes visible again and re-syncs without a reload
  asleep = false;
  await bob.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(table(bob)).toHaveAttribute('data-status', 'paused', { timeout: 5_000 });
});

test('host approval: a seat request waits until the host approves it', async ({ browser }, testInfo) => {
  const host = await openPhone(browser, testInfo, 'Hana');
  const dee = await openPhone(browser, testInfo, 'Dee');
  phones = [host, dee];
  const code = await createGame(host, { requireApproval: true });
  await closeSheet(host);
  await joinGame(dee, code);
  await expect(dee.page.getByText('The host approves new players')).toBeVisible();
  await dee.page.getByTestId('sit-down').click();
  await expect(dee.page.getByTestId('pending-approval')).toBeVisible();
  await expect(dee.page.getByTestId('hero')).toHaveCount(0);
  await shot(dee, 'pending-approval');

  // the host sees the request (and cannot start yet: only one player is seated)
  const request = host.page.getByTestId('seat-request');
  await expect(request).toContainText('Dee wants to sit');
  await expect(host.page.getByTestId('start-game')).toBeDisabled();
  await shot(host, 'host-seat-request');
  await request.getByTestId('approve-seat').click();

  await expect(dee.page.getByTestId('hero')).toBeVisible();
  await expect(dee.page.getByTestId('pending-approval')).toHaveCount(0);
  await expect(dee.page.getByText('Host approved your seat')).toBeVisible();
  await expect(host.page.getByTestId('seat-request')).toHaveCount(0);
  await expect(host.page.getByTestId('start-game')).toBeEnabled();
});

test('capacity: with 2 seats a third phone can only spectate', async ({ browser }, testInfo) => {
  const host = await openPhone(browser, testInfo, 'Hana');
  const bob = await openPhone(browser, testInfo, 'Bob');
  const eve = await openPhone(browser, testInfo, 'Eve');
  phones = [host, bob, eve];
  const code = await createGame(host, { seats: 2 });
  await closeSheet(host);
  await joinGame(bob, code);
  await sitDown(bob);

  await eve.page.goto(`/g/${code}`);
  await expect(eve.page.getByTestId('room-summary')).toContainText('2/2 seated');
  await expect(eve.page.getByText('Full — you can watch')).toBeVisible();
  await eve.page.getByTestId('join-name').fill('Eve');
  await eve.page.getByTestId('join-room').click();
  await expect(eve.page.getByTestId('table-full')).toBeVisible();
  await expect(eve.page.getByTestId('sit-down')).toHaveCount(0);
  await expect(eve.page.getByTestId('hero')).toHaveCount(0);
  await expect(table(eve).locator('.sit-btn')).toHaveCount(0);
  await shot(eve, 'table-full-spectator');

  // the game still runs for the two seated players, and the spectator sees only card backs
  await host.page.getByTestId('start-game').click();
  await waitForHand([host, bob, eve]);
  await expect(table(eve).locator('.seat .pcard-back')).toHaveCount(4);
  await expect(table(eve).locator('.seat .pcard:not(.pcard-back)')).toHaveCount(0);

  // when a seat opens up (Bob stands up mid-hand, which folds his cards), the spectator can take it
  await bob.page.getByTestId('menu-button').click();
  await bob.page.getByTestId('tab-settings').click();
  await bob.page.getByRole('button', { name: /Stand up/ }).click();
  await expect(eve.page.getByTestId('table-full')).toHaveCount(0);
  await eve.page.getByTestId('sit-down').click();
  await expect(eve.page.getByTestId('hero')).toBeVisible();
  // Bob is now the one watching, and the table is full again
  await closeSheet(bob);
  await expect(bob.page.getByTestId('table-full')).toBeVisible();
});
