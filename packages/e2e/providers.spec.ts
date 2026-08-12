import { test, expect } from '@playwright/test';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openWorkspaceAndSession, sendPrompt } from './helpers';

// Prefer the isolated e2e HOME set by playwright.config.ts. Falls back to
// the real home so this spec still runs standalone if invoked directly.
const OMP_HOME = process.env.OMP_E2E_HOME ?? homedir();
const MODELS_YML = join(OMP_HOME, '.omp', 'agent', 'models.yml');
const BACKUP = MODELS_YML + '.e2e-backup';

// The Playwright daemon runs against the real agent dir, so snapshot the
// user's models.yml and restore it after the suite. A leftover backup means a
// previous run died mid-suite — restore it before taking a new snapshot so
// retries never stack e2e-provider rows.
function restoreIfNeeded() {
  if (existsSync(BACKUP)) {
    copyFileSync(BACKUP, MODELS_YML);
    rmSync(BACKUP, { force: true });
  }
}

test.describe('provider/model CRUD (gap #5)', () => {
  test.beforeAll(() => {
    restoreIfNeeded();
    if (existsSync(MODELS_YML)) copyFileSync(MODELS_YML, BACKUP);
  });
  test.afterAll(() => {
    restoreIfNeeded();
  });

  test('add provider+model, use it in a new session, then remove', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);

    // --- add a second provider pointing at the same stub LLM ---
    await page.getByRole('tab', { name: 'Providers' }).click();
    const panel = page.getByLabel('Providers', { exact: true });
    await expect(panel.getByRole('strong').filter({ hasText: 'teststub' })).toBeVisible();
    await panel.getByRole('button', { name: /add provider/i }).click();
    await panel.getByLabel('Provider id').fill('e2e-provider');
    await panel.getByLabel('Base URL').fill('http://127.0.0.1:8788/v1');
    await panel.getByLabel('API key').fill('test-key');
    await panel.getByLabel('First model id').fill('e2e-model');
    await panel.getByLabel('Model name (optional)').fill('E2E Model');
    await panel.getByRole('button', { name: 'Save provider' }).click();
    await expect(panel.getByRole('strong').filter({ hasText: 'e2e-provider' })).toBeVisible();
    await expect(panel.getByText('E2E Model')).toBeVisible();

    // models.yml on disk now contains the new provider (omp's schema).
    const yml = readFileSync(MODELS_YML, 'utf8');
    expect(yml).toContain('e2e-provider');
    expect(yml).toContain('e2e-model');

    // --- add a second model to it via the inline model row ---
    await panel.getByLabel('New model id for e2e-provider').fill('e2e-model-2');
    await panel.getByLabel('Add model to e2e-provider').click();
    await expect(panel.getByRole('code').filter({ hasText: 'e2e-model-2' })).toBeVisible();

    // --- the new model is selectable after a session restart ---
    // The current session's worker was idle-restarted by the CRUD write; a
    // fresh session spawns a worker that loads the updated models.yml.
    await page.getByRole('button', { name: 'New session' }).click();
    const chip = page.getByLabel('Model and thinking level');
    await expect(chip).toBeVisible();
    await chip.click();
    const dialog = page.getByRole('dialog', { name: 'Model & thinking' });
    await expect(dialog.getByRole('option', { name: /E2E Model/ })).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('option', { name: /E2E Model/ }).click();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(chip).toContainText('E2E Model');

    // --- the new model actually serves a turn (stub LLM is model-agnostic) ---
    await sendPrompt(page, 'hello from the e2e provider');
    await expect(page.getByRole('main', { name: 'Conversation' }).getByText(/Hello from the stub model/)).toBeVisible();

    // --- remove the provider; it disappears from the panel and the file ---
    await page.getByRole('tab', { name: 'Providers' }).click();
    await panel.getByLabel('Remove provider e2e-provider').click();
    await expect(panel.getByRole('strong').filter({ hasText: 'e2e-provider' })).not.toBeVisible();
    expect(readFileSync(MODELS_YML, 'utf8')).not.toContain('e2e-provider');
  });
});
