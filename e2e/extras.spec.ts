// End-to-end: act-in-advance toggles, raise presets, showing cards, and host tools
// (kick, pause / resume) plus leaving and returning without a second buy-in.
import { expect, test } from '@playwright/test';
import {
  attr,
  closePhones,
  closeSheet,
  createGame,
  joinGame,
  openPhone,
  readLedger,
  shot,
  sitDown,
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

async function whoActs(phones: Phone[]): Promise<{ actor: Phone; other: Phone }> {
  let idx = -1;
  await expect
    .poll(async () => {
      for (let i = 0; i < phones.length; i++) if ((await attr(phones[i]!, 'data-my-turn')) === 'true') idx = i;
      return idx;
    })
    .toBeGreaterThanOrEqual(0);
  return { actor: phones[idx]!, other: phones[1 - idx]! };
}

test('pre-actions, raise presets and showing cards after an uncontested win', async ({ browser }, testInfo) => {
  const host = await openPhone(browser, testInfo, 'Hana');
  const bob = await openPhone(browser, testInfo, 'Bob');
  phones = [host, bob];
  const code = await createGame(host, { blinds: '10/20', shotClock: 'Off' });
  await closeSheet(host);
  await joinGame(bob, code);
  await sitDown(bob);
  await host.page.getByTestId('start-game').click();
  await waitForHand(phones);

  // preflop: the player waiting arms "Call any"; the actor raises the pot
  const { actor, other } = await whoActs(phones);
  await other.page.getByTestId('pre-callAny').click();
  await expect(other.page.getByTestId('pre-callAny')).toHaveAttribute('aria-pressed', 'true');
  await actor.page.getByTestId('action-raise').click();
  await actor.page.locator('.raise-presets').getByRole('button', { name: 'Pot', exact: true }).click();
  await expect(actor.page.getByTestId('raise-amount')).toHaveText('60');
  await shot(actor, 'raise-panel');
  await actor.page.getByTestId('raise-confirm').click();
  // ...and the armed toggle calls automatically: the flop comes without another tap
  await expect(table(other)).toHaveAttribute('data-street', 'flop', { timeout: 10_000 });
  await expect(other.page.locator('.toast-error')).toHaveCount(0);
  await expect(actor.page.locator('.toast-error')).toHaveCount(0);

  // flop: whoever acts first bets half the pot, the other folds
  const flop = await whoActs(phones);
  await flop.actor.page.getByTestId('action-raise').click();
  await flop.actor.page.locator('.raise-presets').getByRole('button', { name: '½ Pot' }).click();
  await expect(flop.actor.page.getByTestId('raise-amount')).toHaveText('60');
  await flop.actor.page.getByTestId('raise-confirm').click();
  await expect(table(flop.other)).toHaveAttribute('data-my-turn', 'true');
  await flop.other.page.getByTestId('action-fold').click();

  // nobody saw the winner's cards; they may show them once the hand is over
  await expect(flop.actor.page.getByTestId('hand-result')).toContainText(`${flop.actor.name} wins`);
  await expect(table(flop.other).locator('.seat .pcard:not(.pcard-back)')).toHaveCount(0);
  await flop.actor.page.getByTestId('show-cards').click();
  await expect(table(flop.other).locator('.seat .pcard:not(.pcard-back)')).toHaveCount(2);
  await shot(flop.other, 'shown-cards');
});

test('host tools: kick a spectator, pause and resume; leaving and coming back keeps the one buy-in', async ({
  browser,
}, testInfo) => {
  const host = await openPhone(browser, testInfo, 'Hana');
  const bob = await openPhone(browser, testInfo, 'Bob');
  const zed = await openPhone(browser, testInfo, 'Zed');
  phones = [host, bob, zed];
  const code = await createGame(host, { blinds: '10/20', shotClock: 'Off' });
  await closeSheet(host);
  await joinGame(bob, code);
  await sitDown(bob);
  await joinGame(zed, code);

  // kick the spectator from the Players tab
  await host.page.getByTestId('menu-button').click();
  await host.page.getByRole('button', { name: 'Kick Zed' }).click();
  await host.page.getByRole('button', { name: 'Kick?' }).click();
  await expect(zed.page.getByTestId('kicked')).toBeVisible();
  await expect(zed.page.getByTestId('kicked')).toContainText('The host removed you from the table');
  await shot(zed, 'kicked');
  // the phone stays removed: opening the link again does not offer a fresh join as a "new" player
  await zed.page.goto(`/g/${code}`);
  await expect(zed.page.getByTestId('kicked')).toBeVisible();
  await expect(zed.page.getByTestId('join-name')).toHaveCount(0);
  // ...not even with the stored session wiped (only the kicked marker is left)
  await zed.page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('flock:session:')) localStorage.removeItem(k);
  });
  await zed.page.reload();
  await expect(zed.page.getByTestId('kicked')).toBeVisible();
  await closeSheet(host);

  // pause between hands, then resume
  await host.page.getByTestId('start-game').click();
  await waitForHand(phones.slice(0, 2));
  await host.page.getByTestId('menu-button').click();
  await host.page.getByRole('button', { name: 'Pause after this hand' }).click();
  await closeSheet(host);
  // finish the hand quickly: whoever acts folds
  const { actor } = await whoActs([host, bob]);
  await actor.page.getByTestId('action-fold').click();
  await expect(table(bob)).toHaveAttribute('data-status', 'paused');
  await expect(bob.page.getByText('Game paused')).toBeVisible({ timeout: 15_000 });
  const handBefore = await attr(host, 'data-hand');
  await shot(bob, 'paused');
  await host.page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => Number(await attr(bob, 'data-hand'))).toBeGreaterThan(Number(handBefore || 0));

  // Bob leaves the room mid-hand (folding), then comes back through the same link
  const stackBefore = Number((await readLedger(bob)).find((r) => r.name === 'Bob')!.stack);
  await bob.page.getByTestId('tab-settings').click();
  await bob.page.getByTestId('leave-room').click();
  await bob.page.getByTestId('leave-confirm').click();
  await expect(bob.page.getByTestId('home-name')).toBeVisible();
  await bob.page.goto(`/g/${code}`);
  await expect(table(bob)).toBeVisible();
  await expect(bob.page.getByTestId('join-name')).toHaveCount(0);
  await expect(bob.page.getByTestId('sit-down')).toBeVisible();
  await bob.page.getByTestId('sit-down').click();
  await expect(bob.page.getByTestId('hero')).toBeVisible();
  // same chips as before (minus whatever he had in the pot when he left), still exactly one buy-in
  const ledger = await readLedger(bob);
  const row = ledger.find((r) => r.name === 'Bob')!;
  expect(row.buyIns).toBe(1);
  expect(row.totalBuyIn).toBe(2000);
  expect(row.stack).toBeLessThanOrEqual(stackBefore);
  expect(row.stack).toBeGreaterThanOrEqual(stackBefore - 20);
  expect(ledger.reduce((s, r) => s + r.stack, 0)).toBe(4000);
});
