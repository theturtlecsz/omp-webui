import { expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type SessionSetup = {
  workspace: string;
};

/**
 * Test workspaces are created locally, but every workspace/session transition is
 * deliberately performed through the visible UI.
 */
export async function openWorkspaceAndSession(page: Page, testInfo: TestInfo, opts: { git?: boolean } = {}): Promise<SessionSetup> {
  const workspace = mkdtempSync(join(tmpdir(), `omp-webui-e2e-${testInfo.testId.replace(/\W/g, '').slice(-10)}-`));
  writeFileSync(join(workspace, 'README.md'), '# E2E workspace\n');
  if (opts.git) {
    execFileSync('git', ['init', '-q'], { cwd: workspace });
    execFileSync('git', ['config', 'user.email', 'e2e@example.test'], { cwd: workspace });
    execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: workspace });
    execFileSync('git', ['add', 'README.md'], { cwd: workspace });
    execFileSync('git', ['commit', '-qm', 'initial fixture'], { cwd: workspace });
  }

  await page.goto('/');
  await expect(page.getByText('online', { exact: true })).toBeVisible();
  const workspaceInput = page.getByLabel('Open workspace by path');
  await workspaceInput.fill(workspace);
  await workspaceInput.press('Enter');
  const newSession = page.getByRole('button', { name: 'New session' });
  await expect(newSession).toBeEnabled();
  await newSession.click();
  await expect(page.getByLabel('Message OMP')).toBeEnabled();
  return { workspace };
}

export async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const composer = page.getByLabel('Message OMP');
  await composer.fill(prompt);
  await composer.press('Enter');
}

export async function completeHelloTurn(page: Page): Promise<void> {
  await sendPrompt(page, 'say hello');
  await expect(page.getByLabel('Conversation').getByText('say hello', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Conversation').getByText(/Hello from the stub model/)).toBeVisible();
}

export async function completeApprovedToolTurn(page: Page): Promise<void> {
  await sendPrompt(page, 'please use a tool now');
  const card = page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'bash' }) });
  await expect(card).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Allow OMP to continue?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Allow once' }).click();
  await expect(card.getByText('Succeeded', { exact: true })).toBeVisible();
  await expect(card).toContainText('hello-from-omp-tool');
}
