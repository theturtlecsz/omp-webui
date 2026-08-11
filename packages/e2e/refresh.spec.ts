import { test, expect } from '@playwright/test';
import { completeApprovedToolTurn, completeHelloTurn, openWorkspaceAndSession } from './helpers';

test.describe('snapshot restore', () => {
  test('restores the completed transcript without duplicate cards after a browser refresh', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);
    await completeHelloTurn(page);
    await completeApprovedToolTurn(page);

    await page.reload();
    const conversation = page.getByRole('main', { name: 'Conversation' });
    await expect(conversation.getByText('say hello', { exact: true })).toHaveCount(1);
    await expect(conversation.getByText(/Hello from the stub model/)).toHaveCount(1);
    await expect(conversation.locator('.tool-card')).toHaveCount(1);
    await expect(conversation.locator('.tool-card')).toContainText('hello-from-omp-tool');
  });
});
