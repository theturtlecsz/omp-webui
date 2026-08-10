# STATUS

Last updated: 2026-08-10 (orchestrator)

## Current phase: 1 — live vertical slice (in progress)

## Completed
- Environment discovery: Node 20, git, sqlite3, python3, make/g++; Bun 1.3.14 installed via npm.
- Upstream clone: /home/user/workspace/oh-my-pi-upstream @ 17.2.12 (pinned).
- omp 17.2.12 installed globally via bun; `omp --mode rpc` verified live.
- Phase 0 analysis (repo-protocol-analyst): REPO_MAP, RPC_INVENTORY, SESSION_FORMAT,
  EXTENSION_API, COLLAB_WEB_INVENTORY, API_STABILITY in docs/omp-webui/analysis/.
- Real RPC fixtures captured from a live worker (105 frames: ready, state, streaming
  message deltas, tool_execution_*, agent_end) in docs/omp-webui/analysis/fixtures/.
- Deterministic stub LLM (scripts/stub-llm.ts) as TEST-ONLY provider boundary;
  models.yml `teststub/stub-1` configured for this sandbox only.
- Repo skeleton + git repo initialized.

## In progress
- packages/daemon: protocol types, worker supervisor, session/event registry, WS server.
- packages/web scaffolding (React + Vite).

## Blocked
- (none)

## Next executable tasks
- T-010 daemon protocol envelope + command/event unions
- T-011 worker lifecycle (spawn, v2 negotiate, chunk reassembly, line dispatch)
- T-012 session registry + SQLite index + session-dir scanner
- T-013 WS server + replay cursor
- T-020 web app shell + client + transcript streaming
- T-030 Phase 1 integration test (daemon↔worker↔stub LLM)

## Build/test status
- daemon deps: ws, better-sqlite3, zod installed. No build yet.

## Known defects
- Upstream docs/session.md directory description is stale vs session-paths.ts (use code).
- extension_ui_request `setWidget autoresearch` frames appear on every session start; must be tolerated (unknown-method passthrough).
