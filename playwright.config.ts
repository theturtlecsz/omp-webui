import { defineConfig } from '@playwright/test';

const root = '/home/user/workspace/omp-webui';
const bunPath = '/home/user/.bun/bin';

export default defineConfig({
  testDir: './packages/e2e',
  outputDir: './scratch/e2e-artifacts/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: './scratch/e2e-artifacts/html-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:7490',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `cd ${root} && PATH=${bunPath}:$PATH bun scripts/stub-llm.ts 8788`,
      url: 'http://127.0.0.1:8788/v1/models',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `cd ${root} && PATH=${bunPath}:$PATH bun packages/daemon/src/index.ts --port 7490 --web-dist packages/web/dist`,
      url: 'http://127.0.0.1:7490/api/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
