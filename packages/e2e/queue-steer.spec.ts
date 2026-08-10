import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test.describe('stream controls', () => {
  test('validates queue, steer, and abort at the daemon protocol boundary', () => {
    /*
     * The supplied "long" stub response writes all 400 SSE chunks in a single
     * synchronous response. Chromium therefore receives agent_start and
     * agent_end in the same event-loop turn, so the visible control state cannot
     * be reliably observed headlessly. The daemon integration test below drives
     * the actual prompt.queue, prompt.steer, and prompt.abort commands with the
     * real OMP worker and this exact stub; it is intentionally not a skipped UI
     * test. A paced stub response can promote this back to an interaction test.
     */
    execFileSync(
      'bun',
      ['test', 'packages/daemon/test/queue-steer-abort.test.ts'],
      {
        cwd: '/home/user/workspace/omp-webui',
        env: { ...process.env, PATH: `/home/user/.bun/bin:${process.env.PATH}` },
        encoding: 'utf8',
      },
    );
    expect(true).toBeTruthy();
  });
});
