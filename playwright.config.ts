import { defineConfig } from '@playwright/test';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const bunDir = `${process.env.HOME}/.bun/bin`;
if (process.env.PATH && !process.env.PATH.includes(bunDir)) {
  process.env.PATH = `${bunDir}:${process.env.PATH}`;
}

// Materialize an isolated OMP HOME so globally-installed extensions
// (e.g. session-system's linear-now.ts) do not inject synthetic messages
// into e2e sessions. The stub-llm keys off substring matches in the user
// prompt; extension-injected digests would displace the real user text as
// the "last user message" and route every reply to the default branch.
const e2eHome = execSync(
  `bun ${root}/scripts/setup-e2e-home.ts`,
  { encoding: 'utf8' },
).trim();
writeFileSync(
  join(e2eHome, '.omp', 'agent', 'config.yml'),
  `disabledProviders:
  - openai
  - ollama
  - google-vertex
  - google
  - anthropic
  - zenmux
  - llama.cpp
  - lm-studio
modelRoles:
  default: teststub/stub-1
  smol: teststub/stub-1
  slow: teststub/stub-1
`,
);
writeFileSync(
  join(e2eHome, '.omp', 'agent', 'models.yml'),
  `providers:
  teststub:
    baseUrl: http://127.0.0.1:8788/v1
    api: openai-completions
    apiKey: test-key
    models:
      - id: stub-1
        name: Stub Model 1
        contextWindow: 128000
        maxTokens: 4096
        reasoning: true
`,
);
// (models.yml, sessions/) look at the same tree the daemon writes to.
process.env.OMP_E2E_HOME = e2eHome;

export default defineConfig({
  testDir: './packages/e2e',
  // terminal.spec.ts requires a daemon started with --terminal; it runs under
  // playwright.terminal.config.ts (port 7491) instead.
  testIgnore: 'terminal.spec.ts',
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
      command: `bun ${root}/scripts/stub-llm.ts 8788`,
      url: 'http://127.0.0.1:8788/v1/models',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `HOME=${e2eHome} bun ${root}/packages/daemon/src/index.ts --port 7490 --web-dist packages/web/dist`,
      url: 'http://127.0.0.1:7490/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
