# Independent Integration Review Brief — OMP WebUI

You are the final reviewer. You did NOT write this code. Your job is adversarial
verification against the 15-point completion standard in docs/omp-webui/ACCEPTANCE.md
and the mission constraints. Produce docs/omp-webui/REVIEW.md. Fix small defects you
find (run all suites after); report large ones.

## Mission constraints to audit
1. Structured omp RPC only — no PTY, no terminal scraping, no `node-pty`/`ptyprocess` deps,
   no tmux/xterm screen-scraping anywhere. grep the repo.
2. No production mock data — the stub LLM (scripts/stub-llm.ts, `teststub` provider) must
   appear ONLY in tests/scripts/docs, never imported by packages/daemon/src or packages/web/src.
3. Original product — no copied Kimi assets/branding/trade dress.
4. Loopback default; non-loopback requires token; origin validation; workspace containment
   (try to escape it: `file.read` with `..`, absolute paths, symlink tricks — write a quick
   script against a live daemon if needed).
5. No unexplained TODO/FIXME/HACK in shipped code; no disabled/skipped tests without a
   documented reason in the test file.

## Deep verification (actually run these)
```bash
export PATH="$HOME/.bun/bin:$PATH"
# stub LLM must be up: curl -sf http://127.0.0.1:8788/v1/models
bash scripts/clean-clone-test.sh          # clean-clone launch
cd packages/daemon && bun test            # 10 tests
cd packages/web && bun x vitest run       # 19 tests
cd packages/web && bun x tsc --noEmit && bun run build
cd ../.. && bun x playwright test         # 8 specs
```
Then READ the code for correctness beyond tests:
- packages/daemon/src/session-runtime.ts — every omp frame type handled sensibly?
  Any unbounded growth (pending interactions, queues)? Any swallowed errors that
  would strand the UI (e.g., approval dialog that can never resolve)?
- packages/daemon/src/worker.ts — chunk reassembly bounds, stdout pollution handling,
  process cleanup on daemon stop.
- packages/daemon/src/server.ts — auth checks on EVERY HTTP path; artifact path
  containment; broadcast fan-out on closed sockets; replay cursor correctness.
- packages/web/src/lib/reducer.ts — idempotency, replay-before-snapshot guard,
  thinking-block stripping, memory growth on long sessions.
- packages/web/src/lib/client.ts — reconnect storm risk, resume cursor tracking,
  command timeout leaks.
- docs consistency: PROTOCOL.md vs protocol.ts vs server.ts dispatch (do documented
  commands/events actually exist?); OPERATIONS.md flags vs index.ts parseArgs.

## Output: docs/omp-webui/REVIEW.md
Table: area | finding | severity (critical/major/minor) | evidence | fix (applied or recommended).
End with: overall ship/no-ship judgment and the top 3 risks.
