# STATUS

Last updated: 2026-08-12

## 2026-08-12 — fix 3 pre-existing Playwright failures (extension isolation)
- Root cause: session-system's globally-installed `linear-now.ts` extension
  (`~/.omp/agent/extensions/`) registers a `before_agent_start` hook that emits
  a `customType: "linear-digest"` custom message on every session start. omp's
  `UH()` maps `custom` → `developer`, and the OpenAI-compatible adapter remaps
  `developer` → `user` for providers without native developer-role support.
  Result: the stub's `lastUser` inspection saw the Linear bookend text instead
  of the actual prompt, missed substring matches (`use a tool` / `markdown` /
  image parts), and every turn hit the default `Hello from the stub` branch.
- Confirmed by instrumenting the stub to log incoming `messages[]`: request 0
  from the panels spec showed `[1] user: please use a tool now` followed by
  `[2] user: ── Linear bookend (linear.app/spec-kit) ──` — the digest as a
  user role, positioned last.
- Fix: e2e daemon now runs with an isolated `HOME` built by
  `scripts/setup-e2e-home.ts` — copies the real `models.yml` (so the stub
  provider on :8788 stays reachable) but leaves `extensions/` and `rules/`
  empty. Playwright config exports `OMP_E2E_HOME` so the two specs that read
  models.yml / sessions/ directly point at the same tree. Daemon webServer
  flipped to `reuseExistingServer: false` to guarantee it always spawns with
  the isolated HOME.
- Suites (all green after fix): daemon+web internal tests via bun, Playwright
  24/24 (1 skipped is terminal.spec — separate config). Fixes:
  - `panels.spec.ts:6` (Plan panel + Git diff)
  - `parity.spec.ts:30` (image paste)
  - `parity.spec.ts:98` (GFM markdown)

## 2026-08-11 (night) — provider/model CRUD (gap #5)
- Schema verified against installed omp 17.2.13 before writing anything:
  `dist/types/config/models-config.d.ts` (zod-inferred provider/model shape)
  + confirmed NO models.yml file watcher in dist/cli.js (omp loads at worker
  startup; pi-web-ui hot-reloads only because it embeds omp in-process).
- New daemon module `providers.ts` (`yaml` pkg): read/upsert/remove provider
  and model entries with atomic tmp+rename writes, unknown-field preservation,
  and validation (id charset, api enum, positive int windows, last-model guard).
- WS commands: `provider.list` (apiKey masked — never sent to browser),
  `provider.add`, `provider.remove`, `model.add`, `model.remove`. Each write
  stops idle ready workers so the next spawn reloads models.yml, then
  broadcasts `providers.changed` to all clients.
- Web: Providers drawer tab (5th tab) — provider cards with metadata + masked
  key state, add-provider form (id/api/baseUrl/key/first model), inline model
  add/remove, daemon validation errors surfaced as alerts.
- Tests: daemon +19 (13 module-level round-trip/validation, 6 WS command
  round-trips incl. broadcast to a second client); web +7 (list/mask, add
  provider payload shape, optional-field omission, model add/remove, error
  surfacing, providers.changed); Playwright +1 full lifecycle: add provider →
  models.yml on disk → new session sees model in picker → serves a real turn
  through it → remove. E2E snapshots/restores the user's real models.yml.
- Suites: daemon 71/71, web 88/88, Playwright 21/21, terminal 1/1.
- 10 of 12 gaps shipped. Remaining: #10 i18n, #11 sound, #12 reference-mode
  attachments — all cosmetic.

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

## 2026-08-12 — parity gaps 10–13 closed, real /now web solution shipped

Closed all four remaining parity gaps against pi-web-ui 0.17.1:

- **10 i18n** — LanguageProvider + en/zh dictionaries + persistent SettingsDialog toggle.
- **11 sound effects** — WebAudio synth (question/done/error), per-effect volume, persisted.
- **12 reference-mode attachments** — Composer chip + Settings default + daemon path-only branch (`File attachment: <path>` frame, no inlined bytes).
- **13 /now web picker** (surfaced this session) — `session-system/extensions/linear-now.ts` falls back from `ctx.ui.custom` to `ctx.ui.select` on non-TUI hosts; web `ApprovalDialog` renders extension-supplied titles as a subtitle so `Make HOME-13 your NOW?` round-trips end-to-end. Live-verified against real Linear.

Bugs fixed mid-session while validating the above:

- `useSoundSettings` / `useAttachmentSettings` didn't sync between components in the same tab (storage events don't fire in-tab). Added a same-tab custom-event broadcast so Settings dialog writes propagate immediately.
- `AppShell.tsx` Files-panel `onAdd` bypassed `attachmentSettings.referenceMode`; now piped through.
- `linear-now.ts` had a pre-existing `.label` (should be `.name`) surface-picker bug and a missing isNow-first sort; both fixed as part of the fallback patch.

### Suites (2026-08-12)

- daemon bun test: **73 / 73 pass**
- web vitest: **99 / 99 pass**
- Playwright default: **22 pass, 3 fail** — the three failures (`panels`, `parity: attachments/images`, `parity: markdown`) reproduce on master @ 734c507 with our changes stashed. **Zero new regressions.**
- Playwright terminal: **1 / 1 pass**
- Playwright `linear-now` (real Linear key): **1 / 1 pass**

### Follow-ups

- session-system patch (`extensions/linear-now.ts`) shipped as `83c8d18` on `main` at `github.com/zimmermanc/session-system` (pushed 2026-08-12). Installed into `~/.omp/agent/extensions/linear-now.ts` via symlink to the workspace checkout — `omp` picks it up on next worker spawn.
- Real Linear key `lin_api_…` is in `/home/user/.config/linear.env` and in this thread — user should rotate at https://linear.app/settings/api.
- Latent daemon bug (worker.ts:60 uses `--session <file>`, real omp wants `--session-dir`/`--resume`) still open, no test.
