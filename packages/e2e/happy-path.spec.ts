import { test, expect } from '@playwright/test';
import { completeApprovedToolTurn, completeHelloTurn, openWorkspaceAndSession } from './helpers';

test.describe('happy path', () => {
  test('opens a workspace, streams a reply, and approves a real tool call', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);
    await completeHelloTurn(page);
    await completeApprovedToolTurn(page);

    const models = page.getByLabel('Model');
    await expect(models.locator('option')).toHaveCount(2);
    await expect(models.locator('option').nth(1)).toContainText('stub-1');

    const thinking = page.getByLabel('Thinking level');
    await thinking.selectOption('high');
    await expect(page.getByText('Thinking: high', { exact: true })).toBeVisible();
  });
});
