# STATUS

Last updated: 2026-08-11

## 2026-08-11 (night) — questions nav, recent workspaces, path autocomplete
- Gaps #7/#8/#9 closed in one pass:
  - **Questions tab** (drawer, 4th tab): lists user messages with click-to-jump
    via new `data-msg-id` anchors on transcript items + `msg-flash` highlight.
    Hidden `<file>` transport blocks are stripped from previews.
  - **Recent workspaces MRU**: localStorage (8 entries, deduped, MRU-first),
    recorded centrally in AppShell.changeWorkspace so every open path counts;
    Sidebar renders a Recent section with click-to-reopen.
  - **Path autocomplete**: daemon `path.complete` command (host-dir listing,
    `~` expansion, hidden/node_modules filtered, 50 cap) feeding a datalist
    on the Sidebar open-path input with 150 ms debounce.
- a11y spec: Tab-loop cap raised 14 → 40 (MRU entries + 4th drawer tab add
  tab stops; exact count is brittle by design).
- Suites: daemon 52/52 (+4), web 81/81 (+9), Playwright 20/20 (+2),
  terminal 1/1.

## 2026-08-11 (evening) — workspace file tree + live refresh
- Gap #6 closed: FileTreePanel in the drawer Files tab — navigable
  dirs-first tree with per-entry preview + add-to-conversation, backed by
  daemon `file.list` (boundary-contained single-level listing, dirs first,
  500-entry cap, node_modules/.git skipped).
- Live refresh: listing a directory attaches a debounced (400 ms)
  non-recursive fs.watch on the daemon; external writes push `file.changed`
  to the listing client and the tree re-lists without a reload. Watch is
  per-client and torn down on socket close / daemon stop.
- Old path-input panel kept below as "Find file" (search remains useful).
- Tests: daemon file-list.test.ts (3: listing shape/order, boundary-escape
  rejection, watch push), web file-tree.test.tsx (7: nav, live-refresh
  filtering, preview, add, errors), new parity.spec.ts E2E verifies an
  external write appears in the tree against the real daemon. E2E selector
  hardening: `getByLabel('Conversation')` → `getByRole('main', …)` after the
  new per-file add buttons introduced an a11y name collision.
- Suites: daemon 48/48 (+3), web 72/72 (+7), Playwright 18/18 (+1),
  terminal 1/1.

## 2026-08-11 (later) — model picker + thinking-level UI
- Gap #3 closed: ModelPickerDialog replaces the bare composer selects —
  provider-grouped model listbox with context-window/reasoning/cost metadata,
  full 7-level thinking range (off/minimal/low/medium/high/xhigh/max), and
  cycle buttons backed by new `model.cycle`/`thinking.cycle` daemon commands
  (omp `cycle_model`/`cycle_thinking_level` RPC passthroughs).
- Verified live against omp 17.2.13 + stub-llm: daemon model-commands.test.ts
  (2 tests, real WS round-trip), 9 web unit tests, happy-path E2E rewritten
  to drive the dialog. Suites: daemon 45/45, web 65/65, Playwright 17/17,
  terminal 1/1.

## 2026-08-11 — upstream re-baseline + extension-UI dialogs
- omp upgraded 17.2.12 → **17.2.13**; RPC type surface byte-identical, all
  suites re-run green against it (daemon 43/43, web vitest 56/56, Playwright
  default 17/17, terminal 1/1).
- pi-web-ui re-baselined 0.15.0 → **0.17.1**: upstream added a native
  slash-command palette (parity held — ours is omp-catalog-driven), a
  `file_changed` fs.watch push on their file browser (gap slightly larger),
  and a Questions nav bar (new minor gap). Full detail in
  REAL_PARITY_COMPARISON.md §"2026-08-11 re-baseline".
- All 11 omp `extension_ui_request` methods now have method-correct UI
  (SelectDialog/InputDialog/EditorDialog/NotifyToast/OpenUrlDialog/
  ExtensionStatusPills/title reflector). +12 daemon tests, +17 web tests.

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

## 2026-08-10 (acceptance complete)
- Independent review: NO-SHIP on critical session/artifact containment bypass.
- Orchestrator remediated ALL critical/major + 3 minor findings; new containment.test.ts
  (7 tests) reproduces the review's live attacks — all rejected.
- Final suites (orchestrator-verified): daemon 17/17, web tsc+19/19+build, Playwright 8/8
  (23.4s), clean-clone PASS. REVIEW.md addendum revises verdict to SHIP.
- Definition of Done: all 15 acceptance rows ✅ (see ACCEPTANCE.md).
