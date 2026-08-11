import { test, expect } from '@playwright/test';
import { completeApprovedToolTurn, completeHelloTurn, openWorkspaceAndSession } from './helpers';

test.describe('happy path', () => {
  test('opens a workspace, streams a reply, and approves a real tool call', async ({ page }, testInfo) => {
    await openWorkspaceAndSession(page, testInfo);
    await completeHelloTurn(page);
    await completeApprovedToolTurn(page);

    // Model picker: chip shows current model + thinking level, dialog lists
    // the real omp model catalog, and picking a thinking level round-trips
    // through omp (status bar reflects the refreshed state).
    const chip = page.getByLabel('Model and thinking level');
    await expect(chip).toContainText('Stub Model 1');
    await chip.click();

    const dialog = page.getByRole('dialog', { name: 'Model & thinking' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await expect(dialog.getByRole('option', { name: /Stub Model 1/ })).toHaveAttribute('aria-selected', 'true');

    await dialog.getByRole('radio', { name: 'high', exact: true }).click();
    await expect(page.getByText('Thinking: high', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).not.toBeVisible();
  });
});
