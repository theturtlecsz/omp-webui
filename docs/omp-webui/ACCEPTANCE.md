# Acceptance Matrix — Definition of Done Evidence

Status legend: ✅ verified with automated evidence · 🟡 implemented, evidence pending · ⬜ open
Evidence commands assume: `bun scripts/stub-llm.ts 8788` running (test-only provider).

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Clean-clone launch | 🟡 | `OPERATIONS.md` install/run; clean-clone script pending (T-041) |
| 2 | Live session create/resume, prompt exchange | ✅ | `packages/daemon/test/vertical-slice.test.ts` (real worker, stub provider) |
| 3 | Incremental streaming (messages/tools/errors/subagents) | ✅ | deltas+tool events in slice test; subagent frames wired (subscription on ready); E2E pending |
| 4 | Refresh / network-loss / daemon-restart / worker-restart resilience | ✅ | `persistence.test.ts` (daemon restart), `faults.test.ts` (SIGKILL crash + resume); browser-level E2E pending |
| 5 | Polished built-in tool renderers | 🟡 | `packages/web/src/tool-render/` + ToolCard; visual pass pending (T-050) |
| 6 | Usable generic renderer for unknown tools | ✅ | `generic-model.ts` + registry fallback; 9 vitest tests (`packages/web/test/tool-render/`) |
| 7 | Interactive requests round-trip | ✅ | REAL approval dialog in slice test (select→Approve→tool executes); question dialogs same path |
| 8 | Search/archive/resume/fork on real sessions | ✅ | `session.list` query + archive + fork in daemon; UI in sidebar; E2E pending |
| 9 | File/Git restricted to approved roots | ✅ | `workspace.ts` canonical containment; `path_escape` test; symlink-safe |
| 10 | Responsive + keyboard accessible | 🟡 | AppShell breakpoints + focus styles; a11y smoke in E2E + UX pass pending |
| 11 | Unit + integration + protocol + security + browser-e2e tests pass | 🟡 | daemon 8/8 bun tests; web 19/19 vitest; Playwright suite in progress (T-040) |
| 12 | No production dependency on mock data | ✅ | stub LLM is a test-only omp provider (ADR-0005); no product code references it |
| 13 | No unexplained TODOs / disabled tests | 🟡 | sweep before final acceptance |
| 14 | Full documentation | 🟡 | charter/protocol/security/operations/decisions written; README pending |
| 15 | Orchestrator independently verified evidence | 🟡 | every subagent claim re-run by orchestrator so far; final independent pass pending |

## Verification commands (current)
```bash
bun scripts/stub-llm.ts 8788 &                      # test-only provider
cd packages/daemon && bun test                      # 8/8 — slice, persistence, faults, security
cd packages/web && bun x vitest run                 # 19/19 — reducer, client, components, tool-render
cd packages/web && bun run build                    # vite production build
bun x playwright test                               # browser E2E (in progress)
```

## Known gaps being tracked
- Subagent panel events: daemon subscribes (`set_subagent_subscription: progress`); UI panel
  rendering + E2E proof pending (stub LLM does not spawn subagents; may need a scripted
  extension or a documented manual verification step).
- Markdown rendering of assistant text is plain/preformatted (safe); semantic renderer is a
  Phase 4 candidate if time permits — must sanitize.
- L4 sandboxed iframe extension apps: documented-but-disabled by design (TOOL_UI.md).
