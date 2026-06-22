import { test, expect } from '@playwright/test';
import { loginDemo } from './helpers';

test.describe('Auth', () => {
  test('demo user can log in and reach the home page', async ({ page }) => {
    await loginDemo(page);
    await expect(page).toHaveURL(/\/$|\/rooms/);
  });

  test('wrong credentials surface a 401 error to the user', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder(/логин|username/i).fill('demo');
    await page.getByPlaceholder(/пароль|password/i).fill('wrong-password');
    await page.getByRole('button', { name: /войти|log in/i }).click();
    await expect(page.getByText(/неверный|invalid/i)).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated room access redirects to /login', async ({ context, page }) => {
    await context.clearCookies();
    await page.goto('/rooms/00000000-0000-0000-0000-000000000000');
    await page.waitForURL(/\/login/);
  });
});
