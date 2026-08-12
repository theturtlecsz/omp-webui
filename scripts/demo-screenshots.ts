/**
 * Drive the running omp-webui (http://127.0.0.1:7500) through the key screens
 * and save PNGs to /tmp/omp-webui-shots/*.png.
 *
 * Preconditions: stub-llm on :8788, daemon on :7500 with LINEAR_API_KEY set.
 */
import { chromium, type Page } from 'playwright';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const OUT = '/tmp/omp-webui-shots';
const URL = 'http://127.0.0.1:7500/';
fs.mkdirSync(OUT, { recursive: true });

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-webui-demo-'));
fs.writeFileSync(path.join(workspace, 'README.md'), '# OMP WebUI Demo\n\nThis is a demo workspace shown in the screenshots.\n');
fs.writeFileSync(path.join(workspace, 'notes.txt'), 'Reference-mode attachments send this path, not the bytes.\n');
console.log('workspace:', workspace);

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`shot: ${name}`);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

console.log('==> empty state');
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await shot(page, '01-empty-state');

console.log('==> open workspace');
const wsInput = page.getByLabel('Open workspace by path');
await wsInput.fill(workspace);
await wsInput.press('Enter');
await page.waitForTimeout(800);
await shot(page, '02-workspace-open');

console.log('==> new session');
const newSession = page.getByRole('button', { name: 'New session' });
await newSession.click();
await page.getByLabel('Message OMP').waitFor({ state: 'attached' });
await page.waitForTimeout(500);
await shot(page, '03-session-ready');

console.log('==> send a message');
const composer = page.getByLabel('Message OMP');
await composer.fill('say hello');
await composer.press('Enter');
await page.waitForTimeout(2500);
await shot(page, '04-transcript-hello');

console.log('==> open settings dialog');
const settingsBtn = page.getByRole('button', { name: /^Settings$/i }).first();
if (await settingsBtn.isVisible().catch(() => false)) {
  await settingsBtn.click();
  await page.waitForTimeout(600);
  await shot(page, '05-settings-dialog');
  // Language toggle to Chinese
  const zh = page.getByText('中文').first();
  if (await zh.isVisible().catch(() => false)) {
    await zh.click();
    await page.waitForTimeout(500);
    await shot(page, '06-settings-zh');
    const en = page.getByText('English').first();
    if (await en.isVisible().catch(() => false)) await en.click();
  }
  // Modal has an in-dialog close (primary button); avoid the drawer's icon-button.
  const modalClose = page.getByRole('dialog').getByRole('button', { name: /^Close$/i }).last();
  if (await modalClose.isVisible().catch(() => false)) {
    await modalClose.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(600);
}

console.log('==> file tree panel');
const filesTab = page.getByRole('tab', { name: /files/i }).first();
if (await filesTab.isVisible().catch(() => false)) {
  await filesTab.click();
  await page.waitForTimeout(600);
  await shot(page, '07-files-panel');
}

console.log('==> /now picker (real Linear)');
await composer.click();
await composer.fill('/now');
await composer.press('Enter');
try {
  await page.getByRole('dialog', { name: /Pick your NOW/ }).waitFor({ timeout: 20_000 });
  await shot(page, '08-now-picker');
  const first = page.getByRole('dialog', { name: /Pick your NOW/ }).getByRole('option').first();
  const firstText = (await first.textContent()) ?? '';
  console.log('picked:', firstText.slice(0, 80));
  await first.click();
  await page.waitForTimeout(1200);
  await shot(page, '09-now-confirm');
  const deny = page.getByRole('dialog', { name: /Allow OMP to continue/ }).getByRole('button', { name: /Deny/ });
  if (await deny.isVisible().catch(() => false)) await deny.click();
} catch (err) {
  console.log('/now failed:', err instanceof Error ? err.message : String(err));
  await shot(page, '08-now-picker-FAILED');
}

console.log('==> done');
await browser.close();
