# Independent Integration Review — OMP WebUI

**Review date:** 2026-08-10  
**Scope:** adversarial integration review against `REVIEW_BRIEF.md`, the 15-point acceptance matrix, and mission constraints. The daemon/protocol/security paths were read independently and all requested verification commands were executed.

## Verdict

**NO-SHIP.** The required workspace-containment boundary is bypassable through unregistered session paths and artifact symlinks. This permits reads outside an approved workspace/session boundary and must be fixed and regression-tested before release.

## Findings

| Area | Finding | Severity | Evidence | Fix applied or recommended |
|---|---|---:|---|---|
| Session and artifact authorization | Session-oriented endpoints do not enforce that a supplied session file belongs to the requested workspace or to the daemon session index. `session.open` passes caller-provided `sessionFile` to the worker; `session.fork` reads/writes beside it; `connection.resume` indexes any supplied `.jsonl`; `/api/artifact` derives an artifact directory from any supplied session-file path. `#serveArtifact` performs lexical `resolve`/`relative` checks but follows a final-component symlink when `readFileSync` runs. | **critical** | `packages/daemon/src/server.ts`: `session.open`, `session.fork`, `#resumeSession`, `#indexSessionFile`, and `#serveArtifact`. Live repro used a valid temporary workspace, a foreign JSONL outside it, and an artifact named `leak` symlinked to that JSONL. `GET /api/artifact?...&name=leak` returned HTTP 200 and the foreign file; `connection.resume { sessionId: <foreign-jsonl> }` returned a `session.snapshot` containing `INTEGRATION_REVIEW_SECRET`; `session.fork { sessionFile: <foreign-jsonl> }` wrote a new JSONL beside that foreign file. | **Recommended before ship:** resolve session identity from a server-owned indexed record and verify its workspace ownership for open/fork/resume/artifact. Reject raw arbitrary paths. Canonicalize the artifact directory and target with `realpath`; reject symlinks/targets outside the canonical directory (prefer no-follow file opening where available). Add live regression tests for foreign session paths, artifact directory traversal, final-component/intermediate symlinks, and foreign fork destinations. |
| Worker input bounds | Chunk reassembly is only bounded by declared `byteLength`. It has no bound on `count`, number of concurrent chunk IDs, aggregate buffered bytes, or expiry for incomplete messages. `new Array(count)` can throw for hostile counts; `#onLine` does not contain errors from `#onChunk`. Normal stdout lines also have no maximum length. A malformed/noisy worker can consume unbounded memory or terminate the daemon. | **major** | `packages/daemon/src/worker.ts`, `CHUNK_REASSEMBLY_LIMIT`, `#onLine`, and `#onChunk`. The code accepts any numeric `count`, creates `new Array(count)`, and stores incomplete accumulators in `#chunks` indefinitely. | Bound count based on a fixed maximum and declared byte length; cap concurrent assemblies and aggregate retained bytes; expire incomplete chunk IDs; reject oversized raw lines before JSON parsing; surround reassembly with an error boundary that drops the frame rather than crashing the daemon. Add fault tests for huge count, many incomplete IDs, oversized line, and malformed base64. |
| Idle-worker lifecycle | The documented ten-minute idle shutdown is nonfunctional. `#reapIdleWorkers` reads a `lastActivity` property that is never written; when absent it substitutes `now`, so `now - last` is always zero. Idle workers/runtimes can remain resident indefinitely. | **major** | `packages/daemon/src/server.ts` `#reapIdleWorkers`; repository search found no writer for `lastActivity`. `OPERATIONS.md` promises “Worker idle shutdown: 10 minutes”. | Add a real timestamp to `SessionRuntime` or a runtime registry record; update it on browser commands and every worker frame; only terminate non-streaming workers after measured idleness. Add a fake-timer test proving reaping and that active/streaming workers are preserved. |
| Protocol-version contract | The daemon accepts `protocolVersion: 0`, although `PROTOCOL.md` says it rejects unsupported lower majors with `connection.error`. | **minor** | Live isolated-daemon probe sent `{ protocolVersion: 0, type: "workspace.list" }` and received a normal `response` with `workspaces`. `packages/daemon/src/server.ts` validates only `type` and `id`. | Validate exact supported major before dispatch; emit/return a structured `connection.error` or correlated error. Add protocol tests for absent, lower, and higher versions. |
| Origin CLI/documented behavior | `--origin` is documented as repeatable and “additional,” but `parseArgs` stores one string (last occurrence) and `#originAllowed` replaces the loopback allowance whenever an explicit list exists. With `allowedOrigins: ['https://allowed.example']`, a loopback-origin WS was closed 4403 while the configured origin connected. | **minor** | `packages/daemon/src/index.ts` `parseArgs`; `packages/daemon/src/server.ts` `#originAllowed`; `OPERATIONS.md` configuration table. Live isolated-daemon probe confirmed loopback close 4403 and configured-origin success. | Parse repeated `--origin` values into an array and accept loopback **or** explicitly allowed origins, matching the documented “additional” semantics. Add CLI/origin regression coverage. |
| Long-lived browser memory | The reducer retains every `eventId` forever in `seenEvents`; unlike the server journal, it has no retention bound. Long sessions will grow this map monotonically even after transcript snapshots or active-session changes. | **minor** | `packages/web/src/lib/reducer.ts`: `applyServerEvent` always spreads `seenEvents` with a new key and `setActiveSession` does not clear/prune it. | Keep a bounded per-session recent-event LRU/ring sized to the replay retention window, or clear safely after an authoritative snapshot/replay barrier. Add a high-volume reducer test. |
| Documentation/acceptance accuracy | Acceptance evidence is stale: the table says clean-clone evidence is pending and daemon tests are 8/8, while this review observed clean-clone PASS and daemon 10/10. Its verification section also omits the mandated `tsc --noEmit`. | **minor** | `docs/omp-webui/ACCEPTANCE.md` versus executed commands below. | Update acceptance statuses/counts and list the typecheck command. Keep status documentation synchronized with suite changes. |
| Browser accessible naming | The Plan tab panel and nested Plan region shared the same accessible name. Playwright `getByLabel('Plan')` was ambiguous, failing the required browser suite. | **minor — fixed** | Initial Playwright run: 7 passed, `packages/e2e/panels.spec.ts` failed strict locator resolution for two elements named “Plan”. | **Applied:** removed redundant `aria-label="Plan"` from `packages/web/src/components/PlanPanel.tsx`; the tabpanel remains the single named Plan landmark. Re-ran web unit/type/build and full browser suites successfully. |

## Mission-constraint audit

| Constraint | Result | Evidence |
|---|---|---|
| Structured OMP RPC only; no PTY/screen parsing | Pass | Repository-wide policy grep found no `node-pty`, `ptyprocess`, tmux, xterm, terminal-scraping, or prohibited lockfile dependency outside review prose/test fixture content. Worker uses spawned `omp --mode rpc` with JSONL stdio. |
| No production mock-data dependency | Pass | No `stub-llm` or `teststub` reference was found in `packages/daemon/src` or `packages/web/src`; test provider references are confined to scripts/tests/docs/fixtures. |
| Original product / no copied Kimi trade dress | Pass (static) | No Kimi/Moonshot reference in shipped product source; the only results were the review brief and upstream RPC fixture provider inventory. |
| Loopback/token/origin/workspace containment | **Fail** | Bind/token and foreign-origin checks pass, but the critical session/artifact path escape above violates containment. |
| No unexplained TODO/FIXME/HACK or skipped tests | Pass | No markers in shipped daemon/web source and no `.skip`/`.only`/`xit`/`xdescribe` in owned daemon, web, or E2E tests. |

## 15-point acceptance audit

| # | Requirement | Review result |
|---:|---|---|
| 1 | Clean-clone launch | Pass — clean-clone script passed. |
| 2 | Live create/resume/prompt exchange | Pass — daemon integration suite passed. |
| 3 | Incremental messages/tools/errors/subagents | Pass by existing integration/E2E coverage; subagent production behavior remains dependent on OMP emitting frames. |
| 4 | Refresh/network/daemon/worker recovery | Pass by daemon and E2E coverage; idle-worker shutdown defect remains a lifecycle risk. |
| 5 | Built-in tool renderers | Pass by web and E2E coverage. |
| 6 | Unknown-tool renderer | Pass by dedicated daemon/web/E2E coverage. |
| 7 | Interactive round-trip | Pass by real approval interaction test/E2E coverage. |
| 8 | Search/archive/resume/fork | Pass by daemon/browser coverage, subject to critical raw-session-path authorization defect. |
| 9 | File/Git restricted to approved roots | **Fail** — file/git paths are contained, but session/artifact filesystem paths are not. |
| 10 | Responsive and keyboard accessible | Pass after applied Plan accessible-name fix; browser a11y smoke passed. |
| 11 | Unit/integration/protocol/security/browser suites | Pass after rerun; security coverage is incomplete for the critical bypass. |
| 12 | No production mock data | Pass static audit. |
| 13 | No unexplained TODOs/disabled tests | Pass static audit. |
| 14 | Full documentation | Partial — coverage is broad, but acceptance/test-count evidence and origin semantics are inaccurate. |
| 15 | Independent verification | Complete — this review independently executed the required suites and live adversarial probes. |

## Verification executed

All commands were run with `PATH="$HOME/.bun/bin:$PATH"`.

| Command | Exact result |
|---|---|
| `curl -sf http://127.0.0.1:8788/v1/models` | Pass — stub provider returned `stub-1`. |
| `bash scripts/clean-clone-test.sh` | Pass — install, build, daemon health, index, and bundle all verified; `CLEAN-CLONE LAUNCH: PASS`. |
| `cd packages/daemon && bun test` | Pass — **10 pass, 0 fail**, 38 expectations, 5 files. |
| `cd packages/web && bun x vitest run` | Pass — **5 files / 19 tests passed**. Rerun after fix also passed 5/19. |
| `cd packages/web && bun x tsc --noEmit && bun run build` | Pass — typecheck succeeded and Vite production build succeeded. Rerun after fix also succeeded. |
| `bun x playwright test` | Initial result: **7 passed, 1 failed** (duplicate Plan accessible name). After fix: **8 passed**. |
| Live containment probe | **Fail as designed** — foreign JSONL snapshot and artifact symlink content were returned outside the approved workspace. |
| Live protocol probe | **Fail as designed** — `protocolVersion: 0` received normal `workspace.list` response. |
| Live configured-origin probe | **Fail as designed** — explicit origin list rejected loopback origin, contrary to documented additional-origin semantics. |

## Fixes applied

1. `packages/web/src/components/PlanPanel.tsx`: removed the redundant `aria-label="Plan"` from the nested Plan region. This eliminates the ambiguous accessible name while preserving the named tabpanel.
2. No daemon/security rewrite was applied. The containment defect is cross-cutting and security-sensitive; precise repros are documented above for the orchestrator to address safely.

## Top 3 risks

1. **Critical filesystem-boundary bypass:** arbitrary session paths and artifact symlinks expose daemon-readable files outside approved roots.
2. **Worker-driven availability risk:** unbounded/incomplete chunk reassembly and unbounded stdout lines can exhaust memory or throw through protocol handling.
3. **Lifecycle/resource leak:** idle workers never meet the reaper’s idle condition and can accumulate for the daemon lifetime.

## Ship decision

**NO-SHIP** until the critical session/artifact containment defect is remediated with regression tests. After that fix, rerun at minimum the full daemon suite, clean-clone test, browser suite, and the three live containment probes documented here.

---

## Remediation addendum (orchestrator, 2026-08-10, commit e94230b)

All critical/major findings above were remediated by the orchestrator and independently
re-verified. New regression suite `packages/daemon/test/containment.test.ts` (7 tests)
reproduces the live attacks from this review — foreign `connection.resume`, foreign
`session.fork`, out-of-workspace `session.open`, artifact final-component symlink escape,
`protocolVersion: 0`, hostile chunk floods, oversized stdout lines, and idle-reaper
behavior — all now rejected/bounded, daemon stable.

Post-remediation suites (orchestrator-run):
- `cd packages/daemon && bun test` — **17 pass, 0 fail**
- `cd packages/web && bun x tsc --noEmit && bun x vitest run && bun run build` — clean, 19/19, build OK
- `bun x playwright test` — **8 passed (23.4s)**
- `bash scripts/clean-clone-test.sh` — **CLEAN-CLONE LAUNCH: PASS**

Deferred with rationale: reducer `seenEvents` retention (minor; see ACCEPTANCE.md).
Revised verdict: **SHIP** for local-first use per the security model in SECURITY.md.
