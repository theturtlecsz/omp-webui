import { test, expect } from '@playwright/test';
import { completeHelloTurn, openWorkspaceAndSession } from './helpers';

test.describe('network recovery', () => {
  test('shows reconnecting state and resumes the intact transcript after network loss', async ({ page, context }, testInfo) => {
    await page.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      const sockets: WebSocket[] = [];
      class TrackingWebSocket extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          sockets.push(this);
        }
      }
      Object.defineProperty(window, 'WebSocket', { configurable: true, value: TrackingWebSocket });
      (window as Window & { __ompE2ESockets?: WebSocket[] }).__ompE2ESockets = sockets;
    });
    await openWorkspaceAndSession(page, testInfo);
    await completeHelloTurn(page);

    await context.setOffline(true);
    await page.evaluate(() => (window as Window & { __ompE2ESockets: WebSocket[] }).__ompE2ESockets.forEach((socket) => socket.close()));
    await expect(page.getByText('reconnecting', { exact: true })).toBeVisible();
    await context.setOffline(false);

    await expect(page.getByText('online', { exact: true })).toBeVisible();
    await expect(page.getByRole('main', { name: 'Conversation' }).getByText('say hello', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('main', { name: 'Conversation' }).getByText(/Hello from the stub model/)).toHaveCount(1);
  });
});
