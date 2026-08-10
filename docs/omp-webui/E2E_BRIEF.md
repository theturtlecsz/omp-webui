# E2E Test Engineer Brief — OMP WebUI

You own `packages/e2e/**` and the root `playwright.config.ts`. Do NOT modify
`packages/daemon/**`, `packages/web/**` (except adding `data-testid` attributes if a
selector is truly impossible otherwise — prefer role/text/label selectors), or `scripts/stub-llm.ts`.

## Environment
- Bun at /home/user/.bun/bin (prefix PATH). Playwright 1.59 + chromium at ~/.cache/ms-playwright.
- `packages/web/dist` is already built (rebuild with `cd packages/web && bun run build` if needed).
- Daemon: `bun packages/daemon/src/index.ts --port <p> --web-dist packages/web/dist`
- Stub LLM: `bun scripts/stub-llm.ts 8788` (may already be running; your config must start
  it if port 8788 is not serving — check with fetch, reuse if alive).
- Playwright webServer config can spawn the daemon; use a unique port per run (e.g. 7490).

## Read first
- `packages/daemon/src/server.ts` #dispatch — command/event shapes
- `packages/web/src/components/*.tsx` — actual DOM structure, labels, roles (ground truth for selectors)
- `scripts/stub-llm.ts` — scripted prompts: "say hello", "please use a tool now", "two tools", "long", "think"
- `packages/daemon/test/persistence.test.ts` — the flow your E2E mirrors in-browser

## Suites (`packages/e2e/*.spec.ts`)
Headless chromium. Each spec: beforeAll opens a workspace in a unique tmp dir via the UI
(sidebar workspace input) OR via a pre-seeded daemon — prefer driving the UI.

1. **happy-path.spec.ts**
   - Launch app → open workspace (type tmp path) → New session → composer "say hello" →
     user message + assistant reply appear in transcript.
   - Prompt "please use a tool now" → tool card appears with bash; approval dialog appears
     (default approval mode is "write") → click Approve → tool card shows success with output.
   - Composer model selector lists models (model.list); thinking selector sets level.
2. **refresh.spec.ts** — after the happy-path conversation: page.reload() → transcript
   re-renders from snapshot (user msg, assistant, tool card with output). No duplicates.
3. **search-fork-archive.spec.ts**
   - Sidebar session list shows the session; search box filters by title/query.
   - Archive → disappears from default list → include-archived toggle shows it.
   - Fork from a message → new session opens, transcript ends at fork point.
4. **network-loss.spec.ts** — use Playwright `context.setOffline(true)` then false;
   UI shows reconnecting state, recovers, transcript intact (resume path).
5. **queue-steer.spec.ts** — during a "long" scripted response: queue a message (chip
   appears), steer another, abort stops streaming cleanly.
6. **panels.spec.ts** — Git panel lists a modified file after a tool writes one
   (prompt "please use a tool now" writes hello.txt via the stub bash command);
   diff view renders. Plan/todos panel renders without crashing.
7. **a11y.spec.ts** — Tab reaches composer; approval dialog traps focus; Esc closes it
   (cancels); Enter in composer sends; Cmd/Ctrl+K focuses session search.
   (Full a11y audit comes later; these are smoke checks.)
8. **unknown-tool.spec.ts** — any tool/renderer path: verify unknown tool names render
   the generic card (no blank entries). If no scripted prompt produces one, construct it
   at the protocol level in a daemon unit test instead and say so.

## Config (`playwright.config.ts` at repo root)
- testDir: packages/e2e; retries 1; workers 1 (shared stub LLM is stateful).
- webServer entries: stub (8788, reuseExistingServer) + daemon (7490) serving web dist.
- baseURL http://127.0.0.1:7490. Trace/screenshot on failure under scratch/e2e-artifacts.

## Definition of done
`bun x playwright test` passes all specs. Paste the real summary line in your handoff.
No skipped tests without an explanation comment. No page.waitForTimeout hacks where an
expect-based wait works.
