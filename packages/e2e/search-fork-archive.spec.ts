import { test, expect } from '@playwright/test';
import { completeHelloTurn, openWorkspaceAndSession } from './helpers';

test.describe('session management', () => {
  test('searches, archives, reveals, and forks a session through the UI', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);
    await completeHelloTurn(page);

    const search = page.getByLabel('Search sessions');
    await search.fill('untitled');
    await expect(page.locator('.session-row')).toHaveCount(1);
    await search.fill('');

    const archive = page.getByRole('button', { name: /^Archive / });
    await archive.click();
    await expect(page.locator('.session-row')).toHaveCount(0);
    await page.getByLabel('Show archived').check();
    await expect(page.locator('.session-row')).toHaveCount(1);

    await page.getByLabel('Fork from message').first().click();
    const conversation = page.getByLabel('Conversation');
    await expect(conversation.getByText('say hello', { exact: true })).toBeVisible();
    await expect(conversation.getByText(/Hello from the stub model/)).toHaveCount(0);
  });
});
