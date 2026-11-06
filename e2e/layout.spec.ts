// Layout checks on small / landscape phones, using the ?mock=<scenario> fixtures (no server game).
import { expect, test, type Page } from '@playwright/test';

async function openMock(page: Page, scenario: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(`/?mock=${scenario}`);
  await expect(page.getByTestId('table-screen')).toBeVisible();
  await page.waitForTimeout(500); // entrance animations
}

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

function overlapFraction(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return (x * y) / Math.max(1, b.width * b.height);
}

const rect = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }),
  );

/** The element's centre is not covered by anything else. */
async function centreIsOwn(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && el.contains(hit);
  });
}

test('buy-back vote: Approve and Reject are fully on screen on short phones and 10-seat tables', async ({ page }) => {
  for (const scenario of ['buyback-vote-voter', 'buyback-vote-voter-10']) {
    for (const [w, h] of [
      [375, 548],
      [360, 560],
      [320, 454],
      [667, 325],
      [844, 340],
    ] as const) {
      await openMock(page, scenario, w, h);
      const modal = (await rect(page, '.vote-modal'))[0]!;
      for (const id of ['vote-approve', 'vote-reject']) {
        const b = (await rect(page, `[data-testid=${id}]`))[0]!;
        const where = `${scenario} ${w}x${h} ${id}`;
        expect(b.top, where).toBeGreaterThanOrEqual(0);
        expect(b.bottom, where).toBeLessThanOrEqual(h);
        expect(b.top, where).toBeGreaterThanOrEqual(modal.top - 0.5);
        expect(b.bottom, where).toBeLessThanOrEqual(modal.bottom + 0.5);
        expect(await centreIsOwn(page, `[data-testid=${id}]`), where).toBe(true);
      }
    }
  }
});

test('side pots: the pot row stays between the side seats and readable', async ({ page }) => {
  for (const [w, h] of [
    [375, 548],
    [390, 844],
    [667, 325],
  ] as const) {
    await openMock(page, 'flop-side-pots', w, h);
    const pills = await rect(page, '.pots > *');
    expect(pills.length).toBeGreaterThan(0);
    for (const p of pills) {
      expect(p.left, `${w}x${h}`).toBeGreaterThanOrEqual(0);
      expect(p.right, `${w}x${h}`).toBeLessThanOrEqual(w);
    }
    for (let i = 0; i < pills.length; i++) expect(await centreIsOwn(page, `.pots > :nth-child(${i + 1})`), `${w}x${h} pill ${i}`).toBe(true);
    // nothing in the row is covered by a seat plate
    const plates = await rect(page, '.seat .seat-plate');
    for (const p of pills) for (const s of plates) expect(overlapFraction(s, p), `${w}x${h}`).toBe(0);
  }
  // at phone width the row is one "Pot 7,150 +2" chip; a tap shows the breakdown
  await openMock(page, 'flop-side-pots', 375, 548);
  const compact = page.getByTestId('pots-compact');
  await expect(compact).toContainText('7,150');
  await expect(compact).toContainText('+2');
  await compact.click();
  await expect(page.locator('.pots')).toContainText('Main 3,600');
  await expect(page.locator('.pots')).toContainText('Side 2');
});

test('a pending buy-back vote does not cover the seats; its voter list opens on tap', async ({ page }) => {
  for (const [w, h] of [
    [390, 844],
    [375, 548],
    [844, 390],
  ] as const) {
    await openMock(page, 'ten-seats-vote', w, h);
    const card = (await rect(page, '[data-testid=buyback-progress]'))[0]!;
    for (const plate of await rect(page, '.seat .seat-plate')) {
      expect(overlapFraction(card, plate), `${w}x${h}`).toBeLessThanOrEqual(0.15);
    }
    await expect(page.getByTestId('buyback-progress').locator('.voter')).toHaveCount(0);
    await page.getByTestId('buyback-progress-toggle').click();
    await expect(page.getByTestId('buyback-progress').locator('.voter')).toHaveCount(9);
  }
});

test('landscape: the raise panel stays in the right-hand column, off the seats', async ({ page }) => {
  for (const [w, h] of [
    [667, 325],
    [844, 340],
    [740, 360],
  ] as const) {
    await openMock(page, 'raise-panel-open', w, h);
    const panel = (await rect(page, '.raise-panel'))[0]!;
    const hero = (await rect(page, '.hero'))[0]!;
    expect(panel.left, `${w}x${h}`).toBeGreaterThanOrEqual(hero.left - 0.5);
    for (const seat of await rect(page, '.seat')) expect(overlapFraction(panel, seat), `${w}x${h}`).toBe(0);
    await expect(page.getByTestId('raise-confirm')).toBeVisible();
    expect(await centreIsOwn(page, '[data-testid=raise-confirm]')).toBe(true);
  }
});

test('without color-mix() support (iOS < 16.2) buttons and avatars keep a solid fill', async ({ page }) => {
  await openMock(page, 'preflop-my-turn', 390, 844);
  // re-load every stylesheet with color-mix() renamed to an unknown function
  await page.evaluate(async () => {
    for (const link of [...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')]) {
      const css = await (await fetch(link.href)).text();
      const style = document.createElement('style');
      style.textContent = css.replaceAll('color-mix(', 'color-mixx(');
      document.head.appendChild(style);
      link.remove();
    }
  });
  await page.waitForTimeout(100);
  const fill = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  for (const sel of ['[data-testid=action-fold]', '[data-testid=action-raise]', '.seat .avatar']) {
    expect(await fill(sel), sel).not.toBe('rgba(0, 0, 0, 0)');
  }
  expect(await fill('[data-testid=action-fold]')).not.toBe(await fill('[data-testid=action-raise]'));
});
