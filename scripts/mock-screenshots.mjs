// Visual QA: screenshots of ?mock=<scenario> fixtures at phone / landscape / desktop sizes.
// Usage: node scripts/mock-screenshots.mjs [baseUrl] [scenario,...|all] [viewport,...|all] [outDir]
// Needs a running client (e.g. `npx vite --port 5191 --strictPort`). Uses the pre-installed Chromium.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const ALL_SCENARIOS = [
  'home', 'join', 'not-found', 'lobby-host', 'lobby-guest', 'invite', 'seat-request', 'preflop-my-turn',
  'raise-panel-open', 'flop-waiting', 'heads-up', 'showdown-split', 'allin-runout', 'buyback-vote-voter',
  'buyback-requester', 'busted', 'busted-cooldown', 'vote-resolved', 'ten-seats', 'spectator-full',
  'spectator-open', 'pending', 'sitting-out', 'game-over', 'menu-players', 'menu-log', 'menu-chat',
  'menu-ledger', 'menu-settings',
];
const VIEWPORTS = {
  '390x844': { width: 390, height: 844, isMobile: true, hasTouch: true },
  '375x667': { width: 375, height: 667, isMobile: true, hasTouch: true },
  '320x568': { width: 320, height: 568, isMobile: true, hasTouch: true },
  '844x390': { width: 844, height: 390, isMobile: true, hasTouch: true },
  '1280x800': { width: 1280, height: 800, isMobile: false, hasTouch: false },
};

const [base = 'http://localhost:5191', sc = 'all', vp = '390x844,375x667,844x390,1280x800', out = 'e2e/screenshots'] =
  process.argv.slice(2);
const scenarios = sc === 'all' ? ALL_SCENARIOS : sc.split(',');
const viewports = vp === 'all' ? Object.keys(VIEWPORTS) : vp.split(',');
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
let failures = 0;
for (const v of viewports) {
  const cfg = VIEWPORTS[v];
  if (!cfg) throw new Error(`unknown viewport ${v}`);
  const ctx = await browser.newContext({
    viewport: { width: cfg.width, height: cfg.height },
    deviceScaleFactor: 2,
    isMobile: cfg.isMobile,
    hasTouch: cfg.hasTouch,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  for (const s of scenarios) {
    errors.length = 0;
    await page.goto(`${base}/?mock=${s}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1100);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const file = `${out}/mock-${s}-${v}.png`;
    await page.screenshot({ path: file });
    const flags = [overflow ? 'H-SCROLL' : '', errors.length ? `ERRORS: ${errors.join(' | ')}` : ''].filter(Boolean).join(' ');
    if (flags) failures++;
    console.log(`${file}${flags ? '  <-- ' + flags : ''}`);
  }
  await ctx.close();
}
await browser.close();
if (failures) process.exitCode = 1;
