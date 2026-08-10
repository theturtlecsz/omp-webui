import { test, expect } from '@playwright/test';
import { openWorkspaceAndSession, sendPrompt } from './helpers';

test.describe('accessibility smoke checks', () => {
  test('supports keyboard compose, search, and approval dialog focus management', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);

    await page.getByRole('link', { name: 'Skip to conversation' }).focus();
    for (let i = 0; i < 14; i++) {
      if (await page.getByLabel('Message OMP').evaluate((node) => document.activeElement === node)) break;
      await page.keyboard.press('Tab');
    }
    await expect(page.getByLabel('Message OMP')).toBeFocused();

    await page.getByLabel('Message OMP').fill('say hello');
    await page.getByLabel('Message OMP').press('Enter');
    await expect(page.getByLabel('Conversation').getByText(/Hello from the stub model/)).toBeVisible();

    await sendPrompt(page, 'please use a tool now');
    const dialog = page.getByRole('dialog', { name: 'Allow OMP to continue?' });
    const deny = dialog.getByRole('button', { name: 'Deny' });
    const allow = dialog.getByRole('button', { name: 'Allow once' });
    await expect(deny).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(allow).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(deny).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    await expect(page.getByLabel('Search sessions')).toBeFocused();
  });
});
