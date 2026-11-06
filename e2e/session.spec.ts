// End-to-end: what a phone's tab tells the server about where it is (navigating away from a
// table, blocked storage, reconnects), plus the lobby buy-in rule.
import { expect, test, type WebSocketRoute } from '@playwright/test';
import { closePhones, closeSheet, createGame, joinGame, openPhone, readLedger, sitDown, table, waitForHand, type Phone } from './helpers';

test.describe.configure({ mode: 'serial' });

let phones: Phone[] = [];
test.afterEach(async () => {
  await closePhones(phones);
  phones = [];
});

test('going back home detaches from the table: the others see you away, and old-room chat stays out', async ({ browser }, testInfo) => {
  const host = await openPhone(browser, testInfo, 'Hana');
  const bob = await openPhone(browser, testInfo, 'Bob');
  phones = [host, bob];
  const code = await createGame(host, { blinds: '10/20', shotClock: 'Off' });
  await closeSheet(host);
  await joinGame(bob, code);
  await sitDown(bob);
  await host.page.getByTestId('start-game').click();
  await waitForHand(phones);
  const hostSeat = table(bob).locator('[data-testid=seat-0]');
  await expect(hostSeat.locator('.seat-offline')).toHaveCount(0);

  // the back gesture: the host's page shows Home while its websocket stays open
  await host.page.goBack();
  await expect(host.page.getByTestId('home-name')).toBeVisible();
  await expect(hostSeat.locator('.seat-offline')).toHaveCount(1, { timeout: 5_000 });

  // the table's chat does not pop up on the home screen
  await bob.page.getByRole('button', { name: /^Chat/ }).click();
  await bob.page.getByTestId('chat-input').fill('where did you go');
  await bob.page.getByTestId('chat-input').press('Enter');
  await expect(bob.page.getByTestId('chat-input')).toHaveValue('');
  await host.page.waitForTimeout(500);
  await expect(host.page.locator('.chat-pop')).toHaveCount(0);
  await expect(host.page.locator('.toast')).toHaveCount(0);

  // coming back re-attaches the same seat
  await host.page.goForward();
  await expect(table(host)).toBeVisible();
  await expect(table(host)).toHaveAttribute('data-seat', '0');
  await expect(hostSeat.locator('.seat-offline')).toHaveCount(0);
  // the message arrived while away: it is in the history, not a fresh pop-up
  await expect(host.page.locator('.chat-pop')).toHaveCount(0);
});

test('blocked storage: the creator lands on the table and a guest survives a dropped connection', async ({ browser }, testInfo) => {
  const host = await openPhone(browser, testInfo, 'Hana');
  const bob = await openPhone(browser, testInfo, 'Bob');
  phones = [host, bob];
  const blockStorage = () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  };
  await host.context.addInitScript(blockStorage);
  await bob.context.addInitScript(blockStorage);
  // Bob's websocket can be cut, like a phone whose screen locked
  let bobWs: WebSocketRoute | null = null;
  let bobConnections = 0;
  await bob.page.routeWebSocket(/\/socket\.io\//, (ws) => {
    bobWs = ws;
    bobConnections++;
    ws.connectToServer();
  });

  const code = await createGame(host, { blinds: '10/20', shotClock: 'Off' });
  await closeSheet(host);
  await expect(table(host)).toBeVisible();
  await host.page.waitForTimeout(1000);
  await expect(host.page.getByTestId('room-summary')).toHaveCount(0);
  await expect(table(host)).toHaveAttribute('data-seat', '0');

  await joinGame(bob, code);
  await sitDown(bob);
  const bobSeat = table(host).locator('[data-testid=seat-1]');
  await expect(bobSeat).toBeVisible();
  await expect(bobSeat.locator('.seat-offline')).toHaveCount(0);

  await bobWs!.close();
  await expect.poll(() => bobConnections, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  // Bob is re-attached to his seat (not stuck as an offline ghost)
  await expect(bobSeat.locator('.seat-offline')).toHaveCount(0, { timeout: 10_000 });
  await host.page.getByTestId('start-game').click();
  await waitForHand(phones);
  await expect(bob.page.getByTestId('hero')).toBeVisible();
});

test('changing the buy-in before the first hand gives everyone already seated the new amount', async ({ browser }, testInfo) => {
  const host = await openPhone(browser, testInfo, 'Hana');
  const bob = await openPhone(browser, testInfo, 'Bob');
  phones = [host, bob];
  const code = await createGame(host, { blinds: '10/20', buyIn: 2000 });
  await closeSheet(host);
  await joinGame(bob, code);
  await sitDown(bob);
  await host.page.getByTestId('menu-button').click();
  await host.page.getByTestId('tab-settings').click();
  await host.page.locator('#edit-buyin').fill('5000');
  await host.page.getByTestId('save-settings').click();
  await expect(host.page.getByText('Settings saved')).toBeVisible();
  await closeSheet(host);
  const ledger = await readLedger(bob);
  expect(ledger.map((r) => [r.name, r.buyIns, r.totalBuyIn, r.stack])).toEqual([
    ['Hana', 1, 5000, 5000],
    ['Bob', 1, 5000, 5000],
  ]);
});
