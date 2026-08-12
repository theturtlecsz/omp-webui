/**
 * Parity gaps #10 / #11 / #12 — visible-browser proof:
 *   - i18n toggle switches Settings dialog text and persists to localStorage
 *   - Sound-effect settings persist to localStorage under the pi-web-ui-shaped keys
 *   - Reference-mode attachment sends path-only to the daemon (no inlined bytes)
 *
 * Radio and checkbox inputs are wrapped by <label><input/><span/></label>, so
 * clicking the visible <span> toggles the input (and avoids `.check()` racing
 * with pointer-event interception).
 */
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openWorkspaceAndSession, sendPrompt } from './helpers';

test.describe('parity gaps 10-12: i18n, sound, reference-mode', () => {
  test('language toggle updates the Settings dialog and persists selection', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Sounds' })).toBeVisible();

    // Click the visible label text (radio input is covered by its span).
    await dialog.getByText('中文', { exact: true }).click();

    // After the switch the dialog is still mounted; look up the whole page since
    // its accessible name (aria-labelledby -> h2) is now '设置'.
    await expect(page.getByRole('dialog').getByRole('heading', { name: '声音' })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('heading', { name: '附件' })).toBeVisible();

    const stored = await page.evaluate(() => localStorage.getItem('omp-webui.lang'));
    expect(stored).toBe('zh');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh');

    // Reload — Settings button label is now '设置'.
    await page.reload();
    await expect(page.getByText('online', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: '声音' })).toBeVisible();
  });

  test('sound settings persist under the documented storage keys', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Settings' });
    await dialog.getByText('Enable sound effects', { exact: true }).click();
    await dialog.getByRole('slider', { name: 'Volume' }).fill('60');
    // Uncheck "Turn complete" by clicking its label span.
    await dialog.getByText('Turn complete', { exact: true }).click();
    // Two buttons match "Close" (the header X icon + the footer primary); the
    // footer button is the last one and both trigger onClose.
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();

    const stored = await page.evaluate(() => localStorage.getItem('omp-webui.sound'));
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.enabled).toBe(true);
    expect(parsed.volume).toBe(60);
    expect(parsed.perEvent.done).toBe(false);
    expect(parsed.perEvent.question).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('omp-webui.enableSound'))).toBe('true');
  });

  test('reference-mode attachment sends path-only to the daemon (no inlined bytes)', async ({ page }, testInfo) => {
    const { workspace } = await openWorkspaceAndSession(page, testInfo);
    const sentinel = 'REF_MODE_SENTINEL_MARKER_ABC123';
    writeFileSync(join(workspace, 'refnote.txt'), `${sentinel}\n`);

    // Enable reference-mode default via Settings (click the label text).
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog').filter({ hasText: 'Settings' });
    await settings.getByText('Send files as references (path only)', { exact: true }).click();
    await settings.getByRole('button', { name: 'Close', exact: true }).last().click();

    // Attach the file via the Files panel.
    await page.getByRole('tab', { name: 'Files' }).click();
    const filesPanel = page.getByRole('region', { name: 'Find file' });
    await filesPanel.getByLabel('File path').fill('refnote.txt');
    // There are two "Add refnote.txt" buttons (input row + matching-files row); pick the first.
    await filesPanel.getByRole('button', { name: /Add refnote\.txt to conversation/ }).first().click();

    // Chip shows the reference badge because the setting defaults new attachments.
    const attachments = page.getByLabel('Attachments', { exact: true });
    await expect(attachments.getByText('File: refnote.txt')).toBeVisible();
    // The toggle button offers the OTHER mode; when currently in reference mode
    // it offers to switch to Inline.
    await expect(attachments.getByRole('button', { name: /refnote\.txt: Inline \(send contents\)/ })).toBeVisible();

    await sendPrompt(page, 'reference this file');
    await expect(page.getByRole('main', { name: 'Conversation' }).getByText(/Hello from the stub model/)).toBeVisible();

    // omp writes each session's transcript to ~/.omp/agent/sessions/<slug>/
    // where <slug> is the workspace path with slashes turned into hyphens.
    // Search that directory for our unique prompt to find this run's
    // transcript, then verify the daemon emitted path-only text.
    // Prefer the isolated e2e HOME set by playwright.config.ts so this test
    // reads the sessions the daemon actually wrote to.
    const ompHome = process.env.OMP_E2E_HOME ?? process.env.HOME ?? '/home/user';
    const sessionsRoot = join(ompHome, '.omp/agent/sessions');
    const { execFileSync } = await import('node:child_process');
    await page.waitForTimeout(500); // let the transcript flush finish
    const found = execFileSync('grep', ['-rlF', 'reference this file', sessionsRoot], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const slug = workspace.replace(/\//g, '-');
    const mine = found.filter(f => f.includes(slug));
    expect(mine.length, `expected a transcript under ${sessionsRoot} mentioning slug ${slug}`).toBeGreaterThan(0);
    const combined = mine.map(f => readFileSync(f, 'utf8')).join('\n===\n');
    expect(combined).toContain('File attachment: refnote.txt');
    expect(combined).not.toContain(sentinel);
  });
});
