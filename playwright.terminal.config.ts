import { defineConfig } from '@playwright/test';

const root = '/home/user/workspace/omp-webui';
const bunPath = '/home/user/.bun/bin';

// Separate config for the terminal spec: the daemon must run with --terminal
// and on its own port so the main suite's daemon (terminal off) is untouched.
export default defineConfig({
  testDir: './packages/e2e',
  testMatch: 'terminal.spec.ts',
  outputDir: './scratch/e2e-artifacts/terminal-results',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: './scratch/e2e-artifacts/terminal-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:7491',
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
      command: `cd ${root} && PATH=${bunPath}:$PATH bun packages/daemon/src/index.ts --port 7491 --web-dist packages/web/dist --terminal`,
      url: 'http://127.0.0.1:7491/api/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
