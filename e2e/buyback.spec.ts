// End-to-end: the one-buy-in rule and unanimous buy-back votes (approve, reject, timeout).
import { expect, test } from '@playwright/test';
import {
  closePhones,
  closeSheet,
  createGame,
  joinGame,
  openPhone,
  playUntilBust,
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

/** Heads-up table with a tiny 10 big blind buy-in, so a shove-fest busts someone fast. */
async function headsUp(browser: Parameters<typeof openPhone>[0], testInfo: Parameters<typeof openPhone>[1], voteSec = 30) {
  const host = await openPhone(browser, testInfo, 'Hana');
  const bob = await openPhone(browser, testInfo, 'Bob');
  phones = [host, bob];
  const code = await createGame(host, { blinds: '5/10', buyIn: 100, seats: 2, shotClock: 'Off', voteSec });
  await closeSheet(host);
  await joinGame(bob, code);
  await sitDown(bob);
  await host.page.getByTestId('start-game').click();
  await waitForHand(phones);
  const busted = await playUntilBust([host, bob]);
  return { host, bob, busted: phones[busted]!, other: phones[1 - busted]! };
}

test('buy-back approved: everyone agrees, the stack is restored and the ledger shows 2 buy-ins', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { busted, other } = await headsUp(browser, testInfo);
  await expect(busted.page.getByTestId('my-stack')).toHaveText('0');
  await expect(busted.page.getByTestId('buyback-request')).toContainText('1 player must agree');
  await shot(busted, 'busted');

  // the voter is browsing the menu when the request comes in: the vote must not hide behind it
  await other.page.getByTestId('menu-button').click();
  await other.page.getByTestId('tab-log').click();
  await busted.page.getByTestId('buyback-request').click();
  await expect(busted.page.getByTestId('my-buyback')).toContainText('Waiting for votes');

  const modal = other.page.getByTestId('buyback-vote');
  await expect(other.page.getByRole('dialog')).toHaveCount(0);
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(`${busted.name} wants to buy back in for 100`);
  await expect(modal).toContainText('No answer in time counts as “no”');
  await shot(other, 'vote-modal');
  await shot(busted, 'vote-waiting');
  await other.page.getByTestId('vote-approve').click();
  await expect(modal).toHaveCount(0);

  await expect(busted.page.getByText(/back in with 100/)).toBeVisible();
  // the restored stack (the next hand may already have taken a blind from it)
  await expect(busted.page.getByTestId('my-stack')).toHaveText(/^(100|95|90)$/);
  await expect(other.page.getByTestId('buyback-progress')).toContainText('is back in');
  await shot(other, 'vote-approved');

  // play resumes with the restored stack
  await waitForHand(phones);
  const ledger = await readLedger(busted);
  await shot(busted, 'ledger-after-buyback');
  const row = ledger.find((r) => r.name === busted.name)!;
  expect(row.buyIns).toBe(2);
  expect(row.totalBuyIn).toBe(200);
  expect(ledger.find((r) => r.name === other.name)!.buyIns).toBe(1);
  expect(ledger.reduce((s, r) => s + r.stack, 0)).toBe(300);
});

test('buy-back rejected: one "no" keeps the player out and starts a cooldown', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { busted, other } = await headsUp(browser, testInfo);
  await busted.page.getByTestId('buyback-request').click();
  await expect(other.page.getByTestId('buyback-vote')).toBeVisible();
  await other.page.getByTestId('vote-reject').click();

  await expect(busted.page.getByText('Your buy-back request was declined')).toBeVisible();
  await expect(busted.page.getByTestId('my-buyback')).toContainText(`Rejected by ${other.name}`);
  await expect(busted.page.getByTestId('my-stack')).toHaveText('0');
  const button = busted.page.getByTestId('buyback-request');
  await expect(button).toBeDisabled();
  await expect(button).toContainText(/You can ask again in \d+s/);
  await expect(other.page.getByTestId('buyback-progress')).toContainText('Rejected by you');
  await shot(busted, 'rejected-cooldown');

  // no new hand without a second player holding chips; the game is over for now
  await expect(table(busted)).toHaveAttribute('data-game-over', 'true');
  const ledger = await readLedger(other);
  expect(ledger.find((r) => r.name === busted.name)!.buyIns).toBe(1);
  expect(ledger.reduce((s, r) => s + r.stack, 0)).toBe(200);
});

test('buy-back timeout: silence counts as "no"', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { busted, other } = await headsUp(browser, testInfo, 15);
  await busted.page.getByTestId('buyback-request').click();
  const modal = other.page.getByTestId('buyback-vote');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.vote-secs')).toHaveText(/^1[0-5]s$/);
  // the countdown bar drains in real time (it re-renders 4x a second; it must not speed up)
  const progress = () =>
    modal.locator('.vote-bar-fill').evaluate((el) => {
      const timing = el.getAnimations()[0]?.effect?.getComputedTiming();
      return { t: performance.now(), p: Number(timing?.progress ?? NaN) };
    });
  const p1 = await progress();
  await other.page.waitForTimeout(3000);
  const p2 = await progress();
  const expected = (p2.t - p1.t) / 15_000;
  expect(Math.abs(p2.p - p1.p - expected)).toBeLessThan(0.05);
  // nobody answers...
  await expect(busted.page.getByText('Your buy-back request ran out of time')).toBeVisible({ timeout: 25_000 });
  await expect(busted.page.getByTestId('my-buyback')).toContainText('Timed out — not everyone answered');
  await expect(modal).toHaveCount(0);
  await expect(other.page.getByTestId('buyback-progress')).toContainText('Timed out');
  await expect(busted.page.getByTestId('my-stack')).toHaveText('0');
  await expect(busted.page.getByTestId('buyback-request')).toBeDisabled();
  await shot(busted, 'vote-timeout');
});
