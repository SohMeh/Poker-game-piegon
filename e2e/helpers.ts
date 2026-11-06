// Shared helpers for the end-to-end tests. Every "phone" is its own browser context
// (separate localStorage = a different friend's device) with an iPhone-13 sized viewport.
import { devices, expect, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PHONE = devices['iPhone 13'];
const SCREENSHOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');

export interface Phone {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Raw socket.io frames received by this phone (for hole-card leak checks). */
  frames: string[];
  /** Uncaught page errors; closePhones() fails the test if there were any. */
  errors: string[];
}

export async function openPhone(browser: Browser, testInfo: TestInfo, name: string): Promise<Phone> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...opts } = PHONE;
  const context = await browser.newContext({ ...opts, baseURL: testInfo.project.use.baseURL });
  const page = await context.newPage();
  const frames: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      if (typeof f.payload === 'string') frames.push(f.payload);
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`[${name}] ${err.message}`));
  return { name, context, page, frames, errors };
}

/** Closes every phone, then fails if any of them hit an uncaught error along the way. */
export async function closePhones(phones: Phone[]): Promise<void> {
  await Promise.all(phones.map((p) => p.context.close().catch(() => undefined)));
  expect(phones.flatMap((p) => p.errors)).toEqual([]);
}

export async function shot(phone: Phone, name: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  // let entrance animations settle so the screenshot shows the resting layout
  await phone.page.waitForTimeout(450);
  await phone.page.screenshot({ path: path.join(SCREENSHOT_DIR, `e2e-${name}.png`) });
}

export interface CreateOptions {
  /** Blind preset label, e.g. "5/10". */
  blinds?: string;
  buyIn?: number;
  seats?: number;
  /** Shot clock radio label, e.g. "Off" or "30s". */
  shotClock?: string;
  voteSec?: number;
  requireApproval?: boolean;
  allowBuyBack?: boolean;
}

/** Host flow: home screen -> fill name + settings -> Create table. Returns the room code. */
export async function createGame(host: Phone, opts: CreateOptions = {}): Promise<string> {
  const { page } = host;
  await page.goto('/');
  await page.getByTestId('home-name').fill(host.name);
  await fillCreateSettings(page, opts);
  await page.getByTestId('create-room').click();
  const code = (await page.getByTestId('invite-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await expect(page).toHaveURL(new RegExp(`/g/${code}$`));
  return code;
}

/** Sets the table settings on the home screen's "Start a game" form (name and submit are up to the caller). */
export async function fillCreateSettings(page: Page, opts: CreateOptions = {}): Promise<void> {
  if (opts.blinds) await page.getByRole('radiogroup', { name: 'Blinds' }).getByRole('radio', { name: opts.blinds, exact: true }).click();
  if (opts.buyIn !== undefined) await page.locator('#create-buyin').fill(String(opts.buyIn));
  if (opts.seats !== undefined) {
    const value = page.getByRole('group', { name: 'Seats' }).locator('output');
    for (let i = 0; i < 12; i++) {
      const current = Number(await value.textContent());
      if (current === opts.seats) break;
      await page.getByRole('button', { name: current > opts.seats ? 'Fewer seats' : 'More seats' }).click();
    }
    await expect(value).toHaveText(String(opts.seats));
  }
  if (opts.shotClock) {
    await page.getByRole('radiogroup', { name: 'Shot clock' }).getByRole('radio', { name: opts.shotClock, exact: true }).click();
  }
  if (opts.voteSec !== undefined) {
    await page
      .getByRole('radiogroup', { name: 'Buy-back vote timer' })
      .getByRole('radio', { name: `${opts.voteSec}s`, exact: true })
      .click();
  }
  await setSwitch(page.getByTestId('create-require-approval'), opts.requireApproval);
  await setSwitch(page.getByTestId('create-allow-buyback'), opts.allowBuyBack);
}

async function setSwitch(sw: Locator, want: boolean | undefined): Promise<void> {
  if (want === undefined) return;
  const on = (await sw.getAttribute('aria-checked')) === 'true';
  if (on !== want) await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', String(want));
}

export async function closeSheet(phone: Phone): Promise<void> {
  await phone.page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(phone.page.getByRole('dialog')).toHaveCount(0);
}

/** Friend flow: open the invite link, enter a name, land on the table as a spectator. */
export async function joinGame(phone: Phone, code: string): Promise<void> {
  const { page } = phone;
  await page.goto(`/g/${code}`);
  await expect(page.getByTestId('room-summary')).toBeVisible();
  await page.getByTestId('join-name').fill(phone.name);
  await page.getByTestId('join-room').click();
  await expect(page.getByTestId('table-screen')).toBeVisible();
}

export async function sitDown(phone: Phone): Promise<void> {
  await phone.page.getByTestId('sit-down').click();
  await expect(phone.page.getByTestId('hero')).toBeVisible();
}

export function table(phone: Phone): Locator {
  return phone.page.getByTestId('table-screen');
}

export async function attr(phone: Phone, name: string): Promise<string> {
  return (await table(phone).getAttribute(name)) ?? '';
}

export async function waitForHand(phones: Phone[], handNumber?: number): Promise<number> {
  let n = 0;
  for (const p of phones) {
    await expect
      .poll(async () => {
        const h = Number((await attr(p, 'data-hand')) || 0);
        const phase = await attr(p, 'data-phase');
        return handNumber === undefined ? h > 0 && phase !== 'complete' : h === handNumber;
      }, { timeout: 20_000 })
      .toBe(true);
    n = Number(await attr(p, 'data-hand'));
  }
  return n;
}

export type Strategy = 'checkCall' | 'shove';

/** Whose turn is it (index into phones), or -1 if nobody can act right now. */
async function actorIndex(phones: Phone[]): Promise<number> {
  for (let i = 0; i < phones.length; i++) if ((await attr(phones[i]!, 'data-my-turn')) === 'true') return i;
  return -1;
}

async function takeTurn(phone: Phone, strategy: Strategy): Promise<void> {
  const { page } = phone;
  const visible = async (id: string) => page.getByTestId(id).isVisible();
  if (strategy === 'checkCall') {
    if (await visible('action-check')) return page.getByTestId('action-check').click();
    if (await visible('action-call')) return page.getByTestId('action-call').click();
    return page.getByTestId('action-allin').click();
  }
  if (await visible('action-allin')) return page.getByTestId('action-allin').click();
  if (await visible('action-raise')) {
    await page.getByTestId('action-raise').click();
    await page.locator('.raise-presets').getByRole('button', { name: 'All-in' }).click();
    return page.getByTestId('raise-confirm').click();
  }
  if (await visible('action-call')) return page.getByTestId('action-call').click();
  return page.getByTestId('action-check').click();
}

/**
 * Plays the current hand to the end with the given strategy, acting on whichever phone
 * has the turn. Resolves once every phone shows the hand as complete.
 */
export async function playHand(phones: Phone[], strategy: Strategy, onTurn?: (phone: Phone) => Promise<void>): Promise<number> {
  const handNumber = Number(await attr(phones[0]!, 'data-hand'));
  for (let step = 0; step < 60; step++) {
    let idx = -1;
    let done = false;
    await expect
      .poll(
        async () => {
          if (Number(await attr(phones[0]!, 'data-hand')) !== handNumber || (await attr(phones[0]!, 'data-phase')) === 'complete') {
            done = true;
            return true;
          }
          idx = await actorIndex(phones);
          return idx >= 0;
        },
        { timeout: 20_000, intervals: [100] },
      )
      .toBe(true);
    if (done) break;
    const phone = phones[idx]!;
    const key = await attr(phone, 'data-turn-key');
    if (onTurn) await onTurn(phone);
    await takeTurn(phone, strategy);
    // the turn moved on (next player, next street, or the hand ended)
    await expect.poll(async () => attr(phone, 'data-turn-key'), { timeout: 10_000, intervals: [50] }).not.toBe(key);
  }
  for (const p of phones) {
    await expect
      .poll(async () => (Number(await attr(p, 'data-hand')) !== handNumber ? 'next' : await attr(p, 'data-phase')), {
        timeout: 20_000,
      })
      .toMatch(/complete|next/);
  }
  return handNumber;
}

/** Hole cards shown in my hero strip, as accessible labels ("Ace of spades"). */
export async function heroCards(phone: Phone): Promise<string[]> {
  return phone.page.getByTestId('hero').locator('.hero-cards .pcard:not(.pcard-back)').evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label') ?? ''),
  );
}

export interface LedgerRowData {
  name: string;
  buyIns: number;
  totalBuyIn: number;
  stack: number;
  net: number;
}

export async function readLedger(phone: Phone): Promise<LedgerRowData[]> {
  const { page } = phone;
  await page.getByTestId('menu-button').click();
  await page.getByTestId('tab-ledger').click();
  const rows = page.getByTestId('ledger-row');
  await expect(rows.first()).toBeVisible();
  const data = await rows.evaluateAll((els) =>
    els.map((e) => ({
      name: e.getAttribute('data-name') ?? '',
      buyIns: Number(e.getAttribute('data-buyins')),
      totalBuyIn: Number(e.getAttribute('data-total-buyin')),
      stack: Number(e.getAttribute('data-stack')),
      net: Number(e.getAttribute('data-net')),
    })),
  );
  return data;
}

/** Card codes ("As", "Td") a RoomView frame mentions anywhere, for leak checks. */
export function stateFrames(phone: Phone): { raw: string; view: Record<string, unknown> }[] {
  const out: { raw: string; view: Record<string, unknown> }[] = [];
  for (const raw of phone.frames) {
    if (!raw.startsWith('42')) continue;
    try {
      const [event, view] = JSON.parse(raw.slice(2)) as [string, Record<string, unknown>];
      if (event === 'state') out.push({ raw, view });
    } catch {
      /* not a JSON event frame */
    }
  }
  return out;
}

const RANK_CODE: Record<string, string> = {
  Ace: 'A',
  King: 'K',
  Queen: 'Q',
  Jack: 'J',
  '10': 'T',
};
const SUIT_CODE: Record<string, string> = { spades: 's', hearts: 'h', diamonds: 'd', clubs: 'c' };

/** "Ace of spades" -> "As". */
export function cardCode(label: string): string {
  const [rank, , suit] = label.split(' ');
  return `${RANK_CODE[rank!] ?? rank}${SUIT_CODE[suit!]}`;
}

/**
 * Busts one of two heads-up players by shoving every hand. Returns the index of the busted phone.
 * Split pots simply lead to another hand.
 */
export async function playUntilBust(phones: [Phone, Phone], maxHands = 12): Promise<number> {
  for (let i = 0; i < maxHands; i++) {
    await waitForHand(phones);
    await playHand(phones, 'shove');
    for (let k = 0; k < phones.length; k++) {
      // the busted player is offered a buy-back once the hand is over
      if (await phones[k]!.page.getByTestId('buyback-request').isVisible()) return k;
    }
    const stacks = await Promise.all(phones.map(async (p) => (await p.page.getByTestId('my-stack').textContent())?.trim()));
    const zero = stacks.findIndex((s) => s === '0');
    if (zero >= 0) {
      await expect(phones[zero]!.page.getByTestId('buyback-request')).toBeVisible();
      return zero;
    }
  }
  throw new Error('Nobody busted');
}
