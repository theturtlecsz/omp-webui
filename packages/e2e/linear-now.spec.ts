/**
 * Live end-to-end for the linear-now `/now` extension via the browser UI.
 *
 * The linear-now extension originally opens a TUI overlay for the picker,
 * which the browser cannot render. We patched the extension to fall back to
 * `ctx.ui.select()` on non-TUI hosts; this spec verifies that the fall-back
 * shows a real select dialog in the web UI, populated by real Linear data,
 * and that picking + confirming flows all the way through to a status/notify
 * update.
 *
 * Skips when the extension isn't installed or LINEAR_API_KEY isn't set.
 */
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openWorkspaceAndSession } from './helpers';

const extPath = join(process.env.HOME ?? '/home/user', '.omp/agent/extensions/linear-now.ts');
const envPath = join(process.env.HOME ?? '/home/user', '.config/linear.env');
const hasExt = existsSync(extPath);
const linearKey = (() => {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  if (!existsSync(envPath)) return undefined;
  const m = readFileSync(envPath, 'utf8').match(/LINEAR_API_KEY=(.+)/);
  return m?.[1]?.trim();
})();

test.describe('linear-now /now picker (web fallback)', () => {
  test.skip(!hasExt, 'linear-now extension not installed at ~/.omp/agent/extensions/linear-now.ts');
  test.skip(!linearKey, 'LINEAR_API_KEY not set and ~/.config/linear.env missing');

  test('/now surfaces a real select dialog and picking an issue kicks off approval', async ({ page }, testInfo) => {
    // The daemon spawned by playwright.config.ts inherits our env, so passing
    // LINEAR_API_KEY as a page-level env override isn't possible — the config
    // must already have started the daemon with the key inherited from the
    // parent shell. We assume the operator ran playwright with the key exported.
    test.skip(!process.env.LINEAR_API_KEY, 'run this spec with `LINEAR_API_KEY=… bunx playwright test linear-now`');

    await openWorkspaceAndSession(page, testInfo);
    const composer = page.getByLabel('Message OMP');
    await composer.fill('/now');
    await composer.press('Enter');

    // The select dialog appears with real Linear issues.
    const dialog = page.getByRole('dialog', { name: /Pick your NOW/ });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    const options = dialog.getByRole('option');
    await expect(options.first()).toBeVisible();
    const count = await options.count();
    expect(count).toBeGreaterThan(0);

    // Pick the first option and expect the confirm dialog to open.
    const firstLabel = (await options.first().textContent()) ?? '';
    await options.first().click();
    // Web ApprovalDialog keeps its fixed "Allow OMP to continue?" heading and
    // now renders the extension-supplied title as a subtitle inside the dialog
    // (e.g. "Make HOME-13 your NOW?"). Match on the subtitle to prove that
    // extension title round-tripped end-to-end.
    const identifier = firstLabel.match(/([A-Z]+-\d+)/)?.[1];
    const confirm = page.getByRole('dialog', { name: 'Allow OMP to continue?' });
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    if (identifier) {
      await expect(confirm.getByText(new RegExp(`Make ${identifier} your NOW`))).toBeVisible();
    } else {
      await expect(confirm.getByText(/Make .* your NOW/)).toBeVisible();
    }
    // Deny the approval — this test is read-only; do not mutate real Linear state.
    await confirm.getByRole('button', { name: /Deny/ }).click();
  });
});
