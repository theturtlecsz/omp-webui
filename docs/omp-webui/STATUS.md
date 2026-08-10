# STATUS

Last updated: 2026-08-10 (orchestrator)

## Current phase: 4 — product refinement (UX/a11y + independent review in parallel)

## 2026-08-10 (final stretch)
- Playwright E2E: 8/8 specs green in real Chromium (verified independently by orchestrator).
- Visual QA: app driven live via Playwright screenshots; found + fixed sidebar
  "Streaming" label bug (worker ready ≠ streaming; daemon now exposes isStreaming).
- Clean-clone launch: scripts/clean-clone-test.sh PASSES (caught + removed unused
  better-sqlite3 native dep that broke fresh installs).
- Daemon suite: 10/10 (slice, persistence, faults, queue-steer-abort, unknown-tool).
- Subagents active: ux-a11y final pass; independent integration review.

## Completed
- Phase 0 analysis (repo-protocol-analyst): REPO_MAP, RPC_INVENTORY, SESSION_FORMAT,
  EXTENSION_API, COLLAB_WEB_INVENTORY, API_STABILITY in docs/omp-webui/analysis/.
- Real RPC fixtures captured from a live worker (105 frames) in analysis/fixtures/.
- Deterministic stub LLM (scripts/stub-llm.ts) as TEST-ONLY provider boundary.
- Design system (ux-a11y-engineer): tokens.css, base.css, DESIGN_SYSTEM.md, A11Y_CHECKLIST.md.
- Tool-render layer (tool-extension-engineer): registry, generic fallback, WebView schema;
  9 vitest tests; TOOL_UI.md contract.
- **Phase 1 daemon**: Bun/TS daemon — WS protocol, worker supervisor (v2 negotiate, chunk
  reassembly, supervision), session runtime adapter, SQLite index + event journal,
  workspace containment, HTTP static/artifact serving.
- **Phase 1 slice test green**: create → prompt → stream → REAL approval dialog
  (select→Approve→bash runs) → abort.
- **Phase 2 persistence green**: daemon restart + resume (snapshot from authoritative
  JSONL + journal replay), worker SIGKILL crash recovery, malformed input resilience,
  token/origin security tests. 8/8 bun tests.
- **Web app** (frontend engineer, verified by orchestrator): client/store/reducer +
  AppShell, Sidebar, Transcript, ToolCard, Approval/Question dialogs, Composer,
  FileMention, GitPanel, PlanPanel, StatusBar. 19/19 vitest, tsc clean, vite build green.
- Docs: PROJECT_CHARTER, DECISIONS (7 ADRs), PROTOCOL, SECURITY, OPERATIONS, ACCEPTANCE,
  TASK_GRAPH, FRONTEND_BRIEF, E2E_BRIEF.

## Orchestrator-verified real bugs fixed
- Session index staleness: session.list now refreshes counts/titles from disk (authoritative).
- Approval response schema: upstream select answers need `{value}`; daemon translates
  confirmed→"Approve"/"Deny" per rpc-types.ts.
- `new:<cwd>` runtime alias for the bootstrap window before sessionFile is known.
- Snapshot builder now extracts toolCall blocks + toolResult messages from real JSONL.

## In progress
- Playwright E2E suite (test-release engineer): happy-path, refresh, search/fork/archive,
  network-loss, queue/steer, panels, a11y smoke, unknown-tool.

## Blocked
- (none)

## Next executable tasks
- T-040 E2E green; T-041 clean-clone script
- T-050 UX/a11y final pass; T-060 independent integration review; T-070 acceptance evidence
- README.md + root scripts

## Build/test status
- daemon: 8/8 bun tests (slice, persistence, faults)
- web: 19/19 vitest; vite build OK
- e2e: in progress

## Known defects / watch-items
- Upstream docs/session.md directory description is stale vs session-paths.ts (use code).
- `setWidget autoresearch` UI frames on session start: tolerated via session.updated.
- Subagent streaming: daemon subscribes for progress events; UI proof pending (stub LLM
  does not spawn subagents).
- Assistant text renders as plain/preformatted (safe); semantic markdown = Phase 4 option.
