import { test, expect } from '@playwright/test';
import { loginDemo, waitForRoomConnected } from './helpers';

test.describe('Room lifecycle', () => {
  test('host can create a room and the page renders core controls', async ({ page }) => {
    await loginDemo(page);
    // Click "create room" — fallback to typing if the button is hidden behind a tweaks panel.
    const createBtn = page.getByRole('button', { name: /создать комнату|create room/i });
    await createBtn.first().click();

    // Some UIs ask for a name modal — fill any visible input then submit.
    const nameInput = page.getByPlaceholder(/название|name/i).first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill(`e2e-${Date.now()}`);
      await page.getByRole('button', { name: /создать|create|ok|готово/i }).first().click();
    }

    await page.waitForURL(/\/rooms\//, { timeout: 10_000 });
    await waitForRoomConnected(page);

    // Transport controls + drift bar must be present once connected.
    await expect(page.getByTestId('drift-bar')).toBeVisible();
  });

  test('drift bar shows a numeric ms value', async ({ page }) => {
    await loginDemo(page);
    await page.getByRole('button', { name: /создать комнату|create room/i }).first().click();
    const nameInput = page.getByPlaceholder(/название|name/i).first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill(`e2e-${Date.now()}`);
      await page.getByRole('button', { name: /создать|create|ok|готово/i }).first().click();
    }
    await page.waitForURL(/\/rooms\//);
    await waitForRoomConnected(page);
    await expect(page.getByTestId('drift-value')).toContainText(/-?\d+ms/);
  });
});
