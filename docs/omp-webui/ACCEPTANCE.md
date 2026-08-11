# Acceptance Matrix — Definition of Done Evidence

Status legend: ✅ verified with automated evidence · 🟡 implemented, evidence pending · ⬜ open
Evidence commands assume: `bun scripts/stub-llm.ts 8788` running (test-only provider).
All rows verified by the orchestrator on 2026-08-10 AFTER the independent review's
remediation (commit `e94230b`); the reviewer separately executed suites and live
adversarial probes (docs/omp-webui/REVIEW.md).

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Clean-clone launch | ✅ | `scripts/clean-clone-test.sh` → `CLEAN-CLONE LAUNCH: PASS` (fresh copy, bun install, build, daemon health, web bundle) |
| 2 | Live session create/resume, prompt exchange | ✅ | `vertical-slice.test.ts` (real `omp --mode rpc` worker, stub provider); live UI screenshot proof `scratch/shots/04-conversation.png` |
| 3 | Incremental streaming (messages/tools/errors/subagents) | ✅ | deltas + tool events in slice test; subagent frames wired via `set_subagent_subscription: progress`; browser streaming asserted in `happy-path.spec.ts` |
| 4 | Refresh / network-loss / daemon-restart / worker-restart resilience | ✅ | `persistence.test.ts` (daemon restart + snapshot replay), `faults.test.ts` (SIGKILL crash + resume), `refresh-snapshot.spec.ts`, `network-loss.spec.ts` (both green in Chromium) |
| 5 | Polished built-in tool renderers | ✅ | `packages/web/src/tool-render/` + ToolCard; UX visual pass complete (`scratch/ux-a11y-final-handoff.md`, `scratch/shots/05-polished-*.png`); running/success/failure states verified visually |
| 6 | Usable generic renderer for unknown tools | ✅ | `generic-model.ts` + registry fallback; daemon `unknown-tool-renderer.test.ts`; E2E `unknown-tool.spec.ts` — never an empty card |
| 7 | Interactive requests round-trip | ✅ | REAL approval dialog in slice test (select→Approve→tool executes) and in `happy-path.spec.ts` (Allow click in browser); question dialogs same path |
| 8 | Search/archive/resume/fork on real sessions | ✅ | daemon commands + `search-fork-archive.spec.ts` (green in Chromium); fork hardened to indexed/contained session files only |
| 9 | File/Git restricted to approved roots | ✅ | `workspace.ts` canonical containment; `path_escape` test; `containment.test.ts`: foreign session files, artifact symlink escapes, foreign fork destinations all rejected |
| 10 | Responsive + keyboard accessible | ✅ | `a11y.spec.ts` (keyboard compose/search/dialog focus) green; UX pass verified focus trap, tab semantics, contrast ≥ 4.5:1 sampled (min 5.56:1), 800px collapsed-sidebar layout |
| 11 | Unit + integration + protocol + security + browser-e2e tests pass | ✅ | daemon **31/31** bun tests (10 files) + `tsc --noEmit` clean; web **25/25** vitest + `tsc --noEmit` clean + vite build; Playwright **15/15** in Chromium + terminal config **1/1** (live PTY) |
| 12 | No production dependency on mock data | ✅ | static audit in REVIEW.md: no `stub-llm`/`teststub` reference in `packages/daemon/src` or `packages/web/src`; test-only provider (ADR-0005) |
| 13 | No unexplained TODOs / disabled tests | ✅ | reviewer sweep: no TODO/FIXME/HACK in shipped source; no `.skip`/`.only`/`xit` in owned tests |
| 14 | Full documentation | ✅ | PROJECT_CHARTER, PROTOCOL, SECURITY, OPERATIONS, DECISIONS, ACCEPTANCE, REVIEW, DESIGN_SYSTEM, A11Y_CHECKLIST, TOOL_UI + analysis/ — synchronized with final counts |
| 15 | Orchestrator independently verified evidence | ✅ | orchestrator re-ran every suite itself; independent reviewer re-ran all suites + live adversarial probes (REVIEW.md); review's critical finding remediated and regression-tested by `containment.test.ts` |

## Verification commands (final)
```bash
bun scripts/stub-llm.ts 8788 &                      # test-only provider
cd packages/daemon && bun test                      # 31/31 — slice, persistence, faults, queue/steer/abort, unknown-tool, containment, attachments, reask, markdown caps, terminal, phase6-review
cd packages/web && bun x tsc --noEmit               # clean
cd packages/web && bun x vitest run                 # 25/25 — reducer, client, components, tool-render, collapse, markdown XSS probes
cd packages/web && bun run build                    # vite production build
bun x playwright test                               # 15/15 browser E2E (Chromium)
bun x playwright test --config=playwright.terminal.config.ts  # 1/1 live-PTY E2E
bash scripts/clean-clone-test.sh                    # CLEAN-CLONE LAUNCH: PASS
```

## Independent-review disposition (2026-08-10)
- **Critical (fixed):** session/artifact path containment — foreign session reads, artifact
  symlink escapes, foreign forks now rejected; regression tests in `containment.test.ts`
  reproduce all three review attacks and pass.
- **Major (fixed):** worker chunk reassembly bounds (count/concurrency/aggregate bytes/TTL,
  raw-line cap, error boundary) — hostile-output test passes.
- **Major (fixed):** idle-worker reaping functional (`lastActivity` tracking + reaper test).
- **Minor (fixed):** protocol version enforcement; `--origin` repeatability + loopback-always.
- **Minor (accepted risk):** browser reducer `seenEvents` map is unbounded across very long
  sessions; bounded-LRU recommendation recorded in REVIEW.md — memory impact is small
  (~64 B/event) and sessions are user-lifetime scoped; deferred.
- **Minor (fixed):** duplicate Plan accessible name (reviewer-applied); stale counts here.

## Known limitations (documented, non-blocking)
- Subagent panel: daemon subscribes and forwards `subagent.*` frames; live visual proof with
  the stub provider isn't possible (it never spawns subagents). Manual verification step in
  OPERATIONS.md against a real provider.
- L4 sandboxed iframe extension apps: documented-but-disabled by design (TOOL_UI.md).
- Screen-reader / forced-colors / high-zoom checks need an interactive a11y environment
  (noted in `scratch/ux-a11y-final-handoff.md`).

## Phase 6 (feature parity) — final evidence (2026-08-10)

All PARITY.md items verified with automated evidence; independent Phase 6 security
review (REVIEW_PHASE6.md) adjudicated FIX-FIRST → all findings remediated → SHIP.

| Task | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| T-100 | Markdown rendering (GFM, sanitized, highlighted, copy) | ✅ | `MarkdownMessage` (react-markdown + sanitize + highlight); `markdown.test.tsx` (25/25 web incl. XSS probes); E2E table/copy assertion in `parity.spec.ts` |
| T-110 | Long-chat collapsing (>30 messages) | ✅ | `lib/transcript-collapse.ts` unit tests; E2E collapse/expand in `parity.spec.ts` |
| T-120 | Edit and re-ask (fork-at-entry) | ✅ | daemon `session.reask` + `reask.test.ts`; `ReaskEditor`; E2E fork flow in `parity.spec.ts` |
| T-130 | File attachments (chip, paste, drag-drop, line ranges) | ✅ | Composer `+` menu, chips, 1568px image resize; daemon `file.upload` (20 MiB, pre-decode cap) + attachment inlining; E2E chip + inline send in `parity.spec.ts` |
| T-140 | Image attachments with vision detection | ✅ | image resize + omp `images` forwarding (`PromptImage`); non-vision models get an explicit UI warning; stub round trip in `parity.spec.ts` (vision-guard placeholder accepted) |
| T-150 | Opt-in integrated terminal | ✅ | `terminal-manager.ts` + Node `pty-host.mjs` shim (ADR-0016); `terminal.test.ts` + `terminal-auth.test.ts`; live-PTY E2E (`terminal.spec.ts`, playwright.terminal.config.ts) 1/1 |
| T-160 | Workspace memory (per-project notes) | ✅ | workspace.open returns `memory`; settings dialog textarea; `workspace.memory` command; unit tested |
| T-170 | Service installer + version display | ✅ | `scripts/install-service.sh` (systemd --user, loopback default); daemon version surfaced via `connection.ready` → TopBar chip |
| T-180 | E2E parity test coverage | ✅ | `parity.spec.ts` 7/7 green + terminal 1/1; full Playwright 15/15 |
| T-190 | Phase 6 security review | ✅ | REVIEW_PHASE6.md — 1 High + 2 Medium + 1 Low, all remediated; final verdict SHIP |
| T-200 | Documentation sync | ✅ | this row + PROTOCOL bounds section + ADR-0016/0017 |

Phase 6 suite totals: daemon **31/31**, web **25/25**, Playwright **15/15 + 1/1**, clean-clone PASS.

## Phase 7 (terminal polish) — final evidence (2026-08-10)

| Task | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| T-210 | Rename tabs + keyboard shortcuts (Mod+T new, Mod+W close, Mod+1..9 switch, Mod+Shift+[/] prev/next) | ✅ | `TerminalPane.tsx` `TerminalTab` inline rename (dblclick → input, Enter commit, Esc cancel, 40-char cap) + window keydown listener that ignores input/textarea focus. E2E: `terminal.spec.ts` renames Shell 1 → "builder", dispatches Ctrl+T (2 tabs), Ctrl+1 (activates first). |
| T-220 | Export/import `commands.json` (portable, mergeable) | ✅ | Download button emits `commands.json` blob; upload button opens file picker, validates JSON, re-keys ids, merges by name (same-named commands replaced). E2E: exports, deletes `marker`, re-imports the downloaded file, `marker` reappears. |

Phase 7 verification: web 25/25 vitest, `tsc` clean, build OK; Playwright terminal config 1/1 (extended); default Playwright 15/15; daemon 31/31 (clean run, no concurrent-suite interference); clean-clone PASS.
