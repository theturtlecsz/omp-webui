import { test, expect } from '@playwright/test';
import { openWorkspaceAndSession } from './helpers';

// Runs against a daemon started WITH --terminal (playwright.terminal.config.ts,
// port 7491). Verifies the real PTY path end to end: pty-host shim under Node,
// shell round trip, project commands, and surface switching.

test.describe('terminal pane (daemon with --terminal)', () => {
  test('opens a real shell, runs a project command, and survives surface switches', async ({ page }, testInfo) => {
    const { workspace } = await openWorkspaceAndSession(page, testInfo);

    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    const pane = page.getByRole('region', { name: 'Terminal' });
    await expect(pane).toBeVisible();

    // Open a real shell through the pty-host and read output back.
    const openShell = pane.getByRole('button', { name: 'New shell' });
    const emptyOpen = pane.getByRole('button', { name: 'Open shell' });
    if (await emptyOpen.isVisible().catch(() => false)) await emptyOpen.click();
    else await openShell.click();

    const xtermRows = pane.locator('.xterm-rows').first();
    await expect(xtermRows).toBeVisible({ timeout: 15_000 });
    await expect(pane.locator('.terminal-notice')).toHaveCount(0);
    await xtermRows.click();
    await page.keyboard.type('echo E2E_TERMINAL_OK');
    await page.keyboard.press('Enter');
    await expect(xtermRows).toContainText('E2E_TERMINAL_OK', { timeout: 15_000 });

    // The shell starts inside the workspace (boundary-pinned cwd).
    await page.keyboard.type('pwd');
    await page.keyboard.press('Enter');
    await expect(xtermRows).toContainText(workspace, { timeout: 15_000 });

    // Project command: create, then run it in a fresh shell.
    await pane.getByRole('button', { name: 'Add project command' }).click();
    await pane.getByLabel('Command name').fill('marker');
    await pane.getByLabel('Command text').fill('echo PROJECT_CMD_OK');
    await pane.getByRole('button', { name: 'Save' }).click();
    const runButton = pane.locator('.terminal-command__run', { hasText: 'marker' });
    await expect(runButton).toBeVisible();
    await runButton.click();
    await expect(pane.locator('.xterm-rows').last()).toContainText('PROJECT_CMD_OK', { timeout: 15_000 });

    // Switching to Chat and back keeps the terminal mounted (xterm stays live).
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.getByLabel('Conversation')).toBeVisible();
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await expect(pane.locator('.xterm-rows').first()).toContainText('E2E_TERMINAL_OK');
  });
});
