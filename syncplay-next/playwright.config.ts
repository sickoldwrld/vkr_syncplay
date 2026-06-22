import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config.
 *
 * Expects the full stack to be running before invocation:
 *   docker compose up -d   (or ./restart.sh)
 * The test suite does NOT start services itself — running real Spring + sync +
 * Postgres + MinIO from Playwright would couple the test runtime to the local
 * build chain. Use ./restart.sh from the repo root, then `npm run test:e2e`.
 *
 * The demo user (demo / demo123) is auto-seeded by DemoUserSeeder on first
 * launch when DEMO_USER_ENABLED is not "false".
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 1,
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
