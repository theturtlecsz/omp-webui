import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspaceAndSession, sendPrompt } from './helpers';

test.describe('small parity gaps: questions nav, MRU, path autocomplete', () => {
  test('questions tab lists user messages and click-to-jump flashes the anchor', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);
    await sendPrompt(page, 'say hello');
    await expect(page.getByRole('main', { name: 'Conversation' }).getByText(/Hello from the stub model/)).toBeVisible();
    await sendPrompt(page, 'and a second question');
    await expect(page.getByRole('main', { name: 'Conversation' }).getByText(/Hello from the stub model/).nth(1)).toBeVisible();

    await page.getByRole('tab', { name: 'Questions' }).click();
    const panel = page.getByLabel('Questions', { exact: true });
    await expect(panel.getByText('say hello')).toBeVisible();
    await expect(panel.getByText('and a second question')).toBeVisible();

    await panel.getByText('say hello').click();
    const anchor = page.locator('[data-msg-id]', { hasText: 'say hello' }).first();
    await expect(anchor).toHaveClass(/msg-flash/);
  });

  test('workspace picker offers path completions and records recent workspaces', async ({ page }, testInfo) => {
    const { workspace } = await openWorkspaceAndSession(page, testInfo);

    // Path autocomplete: typing a prefix asks the daemon for directory completions.
    const base = join(workspace, '..');
    mkdirSync(join(workspace, 'subproj'), { recursive: true });
    const input = page.getByLabel('Open workspace by path');
    await input.fill(workspace + '/');
    await expect(page.locator('#workspace-path-suggestions option')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('#workspace-path-suggestions option').first()).toHaveAttribute('value', workspace + '/subproj/');

    // MRU: the workspace opened via the helper is recorded; reopening the
    // sidebar shows it under Recent and clicking re-opens it.
    await page.reload();
    await expect(page.getByText('online', { exact: true })).toBeVisible();
    const recent = page.locator('.sidebar__mru');
    await expect(recent.getByText(workspace)).toBeVisible({ timeout: 5000 });
    await recent.getByText(workspace).click();
    await expect(page.getByRole('button', { name: 'New session' })).toBeEnabled();
  });
});
