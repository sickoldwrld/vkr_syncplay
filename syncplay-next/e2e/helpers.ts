import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const DEMO = { username: 'demo', password: 'demo123' };

/**
 * Log in as the seeded demo user via the same form the user sees.
 * Tolerant to redirects: returns once `/` is visible.
 */
export async function loginDemo(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder(/логин|username/i).fill(DEMO.username);
  await page.getByPlaceholder(/пароль|password/i).fill(DEMO.password);
  await page.getByRole('button', { name: /войти|log in/i }).click();
  await page.waitForURL(/\/$|\/rooms\//, { timeout: 15_000 });
}

/**
 * Register a fresh user — used when a test needs an isolated identity (e.g. a
 * second client in a vote-skip scenario). Returns the created username.
 */
export async function registerFresh(page: Page, prefix = 'e2e') {
  const username = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  await page.goto('/login');
  await page.getByRole('button', { name: /зарегистрироваться|sign up|register/i }).click().catch(() => {});
  await page.getByPlaceholder(/логин|username/i).fill(username);
  await page.getByPlaceholder(/email/i).fill(`${username}@e2e.local`);
  await page.getByPlaceholder(/пароль|password/i).fill('e2epass');
  await page.getByRole('button', { name: /зарегистрироваться|register|sign up/i }).click();
  await page.waitForURL(/\/$|\/rooms\//, { timeout: 15_000 });
  return username;
}

/** Wait for the room WebSocket to mark the page as connected. */
export async function waitForRoomConnected(page: Page) {
  await expect(page.getByText(/подключено/i)).toBeVisible({ timeout: 15_000 });
}
