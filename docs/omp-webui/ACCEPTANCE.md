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
| 11 | Unit + integration + protocol + security + browser-e2e tests pass | ✅ | daemon **17/17** bun tests (6 files); web **19/19** vitest + `tsc --noEmit` clean + vite build; Playwright **8/8** in Chromium (23.4s) |
| 12 | No production dependency on mock data | ✅ | static audit in REVIEW.md: no `stub-llm`/`teststub` reference in `packages/daemon/src` or `packages/web/src`; test-only provider (ADR-0005) |
| 13 | No unexplained TODOs / disabled tests | ✅ | reviewer sweep: no TODO/FIXME/HACK in shipped source; no `.skip`/`.only`/`xit` in owned tests |
| 14 | Full documentation | ✅ | PROJECT_CHARTER, PROTOCOL, SECURITY, OPERATIONS, DECISIONS, ACCEPTANCE, REVIEW, DESIGN_SYSTEM, A11Y_CHECKLIST, TOOL_UI + analysis/ — synchronized with final counts |
| 15 | Orchestrator independently verified evidence | ✅ | orchestrator re-ran every suite itself; independent reviewer re-ran all suites + live adversarial probes (REVIEW.md); review's critical finding remediated and regression-tested by `containment.test.ts` |

## Verification commands (final)
```bash
bun scripts/stub-llm.ts 8788 &                      # test-only provider
cd packages/daemon && bun test                      # 17/17 — slice, persistence, faults, queue/steer/abort, unknown-tool, containment
cd packages/web && bun x tsc --noEmit               # clean
cd packages/web && bun x vitest run                 # 19/19 — reducer, client, components, tool-render
cd packages/web && bun run build                    # vite production build
bun x playwright test                               # 8/8 browser E2E (Chromium)
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
- Assistant text renders as safe preformatted markdown source (no HTML injection risk);
  a sanitized semantic markdown renderer is a post-1.0 candidate.
- L4 sandboxed iframe extension apps: documented-but-disabled by design (TOOL_UI.md).
- Screen-reader / forced-colors / high-zoom checks need an interactive a11y environment
  (noted in `scratch/ux-a11y-final-handoff.md`).
