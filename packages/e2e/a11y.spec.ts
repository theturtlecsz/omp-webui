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
    await expect(page.getByRole('main', { name: 'Conversation' }).getByText(/Hello from the stub model/)).toBeVisible();

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

    // Cmd/Ctrl+K opens the slash-command palette once omp has streamed its
    // available_commands_update (which happens after the first assistant reply).
    // When no commands are loaded (fresh session, no reply yet), it falls back
    // to focusing the sessions search input — that fallback path is exercised
    // in the palette spec's second test.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    const palette = page.getByRole('dialog', { name: 'Slash command palette' });
    const search = page.getByLabel('Search sessions');
    await expect(async () => {
      const paletteVisible = await palette.isVisible().catch(() => false);
      const searchFocused = await search.evaluate((el) => el === document.activeElement).catch(() => false);
      expect(paletteVisible || searchFocused).toBe(true);
    }).toPass({ timeout: 5_000 });
  });
});
