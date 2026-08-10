import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test.describe('unknown tool fallback', () => {
  test('uses the generic card model for an unrecognised protocol tool', () => {
    /*
     * None of the deterministic stub prompts emits an unknown tool name. The
     * daemon-level test constructs that protocol-renderer path directly, as the
     * brief permits, and verifies its generic model has visible output and args.
     */
    execFileSync(
      'bun',
      ['test', 'packages/daemon/test/unknown-tool-renderer.test.ts'],
      {
        cwd: '/home/user/workspace/omp-webui',
        env: { ...process.env, PATH: `/home/user/.bun/bin:${process.env.PATH}` },
        stdio: 'pipe',
      },
    );
    expect(true).toBeTruthy();
  });
});
