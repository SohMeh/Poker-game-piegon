// Runs the e2e suite against an already-deployed server instead of a local build:
//   E2E_BASE_URL=https://flock-poker.onrender.com npx playwright test -c playwright.live.config.ts --trace off
// (HTTPS_PROXY, when set, is passed to Chromium so it works behind a corporate/sandbox proxy.)
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'https://flock-poker.onrender.com';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL, trace: 'off', launchOptions: { proxy } },
  projects: [{ name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' } }],
});
