import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { completeApprovedToolTurn, openWorkspaceAndSession } from './helpers';

test.describe('workspace panels', () => {
  test('shows a modified file and diff in Git, and renders the Plan panel safely', async ({ page }, testInfo) => {
    const { workspace } = await openWorkspaceAndSession(page, testInfo, { git: true });
    // The current deterministic stub only echoes from bash; make a real tracked
    // change in the disposable test workspace so the Git UI has a diff to render.
    writeFileSync(`${workspace}/README.md`, '# E2E workspace\nchanged by E2E fixture\n');
    await completeApprovedToolTurn(page);

    await page.getByRole('button', { name: 'Toggle workspace drawer' }).click();
    await page.getByRole('tab', { name: 'Git' }).click();
    const git = page.getByLabel('Git');
    await expect(git.getByText('README.md', { exact: true })).toBeVisible();
    await git.getByRole('button', { name: /README\.md/ }).click();
    await expect(git.locator('.diff')).toContainText('changed by E2E fixture');

    await page.getByRole('tab', { name: 'Plan' }).click();
    await expect(page.getByLabel('Plan')).toContainText('No plan yet');
  });
});
