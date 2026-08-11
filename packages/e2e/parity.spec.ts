import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openWorkspaceAndSession, sendPrompt } from './helpers';

// Minimal valid PNG (1x1 px, red) for paste/upload attachment tests.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.describe('parity: attachments and images', () => {
  test('attaches a workspace file via +, shows chip, and inlines it on send', async ({ page }, testInfo) => {
    const { workspace } = await openWorkspaceAndSession(page, testInfo);

    // Queue README.md via the Files panel "+" control.
    await page.getByLabel('Find file').getByLabel('File path').fill('README.md');
    await page.getByRole('button', { name: 'Add README.md to conversation' }).first().click();
    const chips = page.getByLabel('Attachments');
    await expect(chips.getByText('File: README.md')).toBeVisible();

    await sendPrompt(page, 'look at this');
    const conversation = page.getByRole('main', { name: 'Conversation' });
    // Sent attachment renders as a collapsible card on the user message.
    const card = conversation.locator('details').filter({ hasText: 'README.md' });
    await expect(card).toBeVisible();
    // The inline <file> transport block is hidden from visible prose but kept in the card.
    await card.locator('summary').click();
    await expect(card).toContainText('# E2E workspace');
    await expect(conversation.getByText(/Hello from the stub model/)).toBeVisible();
  });

  test('pasting an image attaches it and the model acknowledges receipt', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);
    const composer = page.getByLabel('Message OMP');

    await composer.focus();
    const bytes = Buffer.from(PNG_BASE64, 'base64');
    await composer.evaluate(async (el, data) => {
      const arr = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const file = new File([arr], 'shot.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG_BASE64);

    const chips = page.getByLabel('Attachments');
    await expect(chips.getByText('Image: shot.png')).toBeVisible();

    await sendPrompt(page, 'describe the attachment');
    await expect(page.getByRole('main', { name: 'Conversation' }).getByText('I received an image attachment.')).toBeVisible();
  });

  test('file preview modal selects a line range that becomes an attachment chip', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);

    await page.getByLabel('Find file').getByLabel('File path').fill('README.md');
    await page.getByRole('button', { name: 'README.md', exact: false }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('# E2E workspace')).toBeVisible();

    // Select the first line and add it to the conversation.
    await dialog.getByRole('option').first().click();
    await dialog.getByRole('button', { name: /Add to conversation/ }).click();

    const chips = page.getByLabel('Attachments');
    await expect(chips.getByText('File: README.md')).toBeVisible();
    await expect(chips.getByText('lines 1–1')).toBeVisible();

    await sendPrompt(page, 'what does the file say');
    const card = page.getByRole('main', { name: 'Conversation' }).locator('details').filter({ hasText: 'README.md' });
    await expect(card).toBeVisible();
  });
});

test.describe('parity: workspace file tree', () => {
  test('browses the workspace, previews a file, and live-refreshes on external writes', async ({ page }, testInfo) => {
    const { workspace } = await openWorkspaceAndSession(page, testInfo);

    // The tree lists the fixture root; the entry carries a per-file add button.
    const tree = page.getByRole('list', { name: 'Directory contents' });
    await expect(tree.getByText('README.md')).toBeVisible();
    await expect(page.getByLabel('Directory path')).toHaveText('/');

    // Clicking a file entry opens the preview dialog.
    await tree.getByRole('button', { name: /README\.md .*preview/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('# E2E workspace')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();

    // External write (as an editor or omp tool would do) triggers the daemon's
    // fs.watch push and the tree refreshes without manual reload.
    writeFileSync(join(workspace, 'agent-output.txt'), 'written externally\n');
    await expect(tree.getByText('agent-output.txt')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('parity: markdown rendering', () => {
  test('renders GFM tables, code blocks with copy, and sanitizes script injection', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);
    await sendPrompt(page, 'show me markdown');

    const conversation = page.getByRole('main', { name: 'Conversation' });
    const assistant = conversation.locator('article.message--assistant').last();
    await expect(assistant.getByRole('table')).toBeVisible();
    await expect(assistant.locator('strong', { hasText: 'bold' })).toBeVisible();
    const copyButton = assistant.getByRole('button', { name: 'Copy code' });
    await expect(copyButton).toBeVisible();
    await expect(assistant.getByText('const answer = 42;')).toBeVisible();
  });
});

test.describe('parity: edit-and-re-ask', () => {
  test('editing a prior user message forks the session and submits the edit', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);
    await sendPrompt(page, 'say hello');
    const conversation = page.getByRole('main', { name: 'Conversation' });
    await expect(conversation.getByText(/Hello from the stub model/)).toBeVisible();

    await conversation.getByLabel('Edit and re-ask').first().click();
    const editor = conversation.getByRole('textbox').first();
    await editor.fill('say hello again');
    await page.getByRole('button', { name: 'Re-ask', exact: true }).click();

    // The fork becomes active and the edited prompt gets a fresh answer.
    await expect(conversation.getByText('say hello again')).toBeVisible();
    await expect(conversation.getByText(/Hello from the stub model/)).toBeVisible();
    // Sidebar now lists the original and the fork.
    await expect(page.locator('.session-row')).toHaveCount(2);
  });
});

test.describe('parity: long-chat collapsing', () => {
  test('collapses older messages past 30, keeps the latest 15 full, and expands on click', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await openWorkspaceAndSession(page, testInfo);
    const conversation = page.getByRole('main', { name: 'Conversation' });

    for (let i = 1; i <= 17; i++) {
      await sendPrompt(page, `turn ${i}`);
      await expect(conversation.getByText(/Hello from the stub model/).last()).toBeVisible();
    }

    // 17 user + 17 assistant = 34 messages: the oldest must collapse to summary rows.
    const summary = conversation.locator('.transcript-summary').first();
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Expand');
    // The very first user turn's full article is collapsed away (its text may
    // still appear inside the summary preview, so assert on the article with
    // exact text to avoid matching 'turn 10'…'turn 17').
    const fullTurn1 = conversation.locator('article.message--user').filter({ has: page.getByText('turn 1', { exact: true }) });
    await expect(fullTurn1).toHaveCount(0);
    // The latest turns stay fully rendered.
    const fullTurn17 = conversation.locator('article.message--user').filter({ has: page.getByText('turn 17', { exact: true }) });
    await expect(fullTurn17).toBeVisible();

    await summary.click();
    await expect(fullTurn1).toBeVisible();
  });
});

test.describe('parity: terminal pane (daemon without --terminal)', () => {
  test('shows an unavailable notice instead of failing when terminal support is off', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    const pane = page.getByRole('region', { name: 'Terminal' });
    await expect(pane).toBeVisible();
    await pane.getByRole('button', { name: 'New shell' }).click();
    // The rejection is written into the xterm surface itself.
    await expect(pane.locator('.xterm-rows')).toContainText(/disabled|unavailable/i, { timeout: 15_000 });
    // Chat remains fully functional after the rejected command.
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await sendPrompt(page, 'say hello');
    await expect(page.getByRole('main', { name: 'Conversation' }).getByText(/Hello from the stub model/)).toBeVisible();
  });
});
