# Architecture Decision Records

## ADR-0001: Daemon in Bun/TypeScript instead of Rust/Axum
- **Decision**: Implement the session daemon as a Bun + TypeScript process (`packages/daemon`).
- **Alternatives**: Rust/Tokio/Axum (spec default); Node.js.
- **Reasoning**: omp's canonical protocol types (`rpc-types.ts`) and the v2 frame decoder are
  TypeScript. A TS daemon shares the runtime with the omp workers it supervises, reuses the
  observed wire shapes without re-implementation risk, and keeps the monorepo single-toolchain.
  Bun provides `bun:sqlite`, a fast HTTP/WS stack, and first-class TS execution. Rust would
  double the toolchain and force re-deriving the protocol in serde types with no product benefit.
- **Consequences**: Security/perf properties of the spec (bounded buffers, async IO, supervision)
  are implemented in TS. Heavy sync work (git diff, file search) is child-process or chunked.
- **Reversal**: The browser protocol is language-neutral; a Rust daemon could replace this one
  behind the same WS contract if operational needs change.

## ADR-0002: One omp worker per active session over stdio JSONL RPC v2
- **Decision**: `omp --mode rpc` per active session; daemon negotiates protocol v2 and
  reassembles `rpc_chunk` frames (lossless oversized frames, 64 MiB cap).
- **Reasoning**: Matches omp's native model; v1 fallback truncates >1 MiB frames.
- **Consequences**: Daemon must implement chunk validation (chunkId/index/count/byteLength).

## ADR-0003: Do not depend on collab-web; re-implement tool-render behind our own registry
- **Decision**: No runtime dependency on `@oh-my-pi/collab-web` (private, pi-wire v3).
  Tool cards are built in `packages/web/src/tool-render/` (registry + generic fallback +
  declarative WebView schema), informed by collab-web's design but clean-room for our protocol.
- **Reasoning**: collab-web speaks the encrypted relay protocol, not coding-agent JSONL RPC;
  importing it would drag the wrong transport and an unpinned package.
- **Consequences**: We own renderer maintenance; `docs/omp-webui/TOOL_UI.md` is the contract.

## ADR-0004: omp session JSONL is authoritative; SQLite indexes + journals only
- **Decision**: The daemon never writes omp session files. SQLite stores workspaces, session
  metadata, archive state, and a bounded per-session event journal for replay cursors.
  Snapshots are rebuilt from the session JSONL on resume.
- **Reasoning**: Avoids a competing transcript source of truth; survives daemon crashes.
- **Consequences**: Snapshot builder must track omp's entry union (`session-entries.ts`);
  a contract test guards drift (API_STABILITY.md).

## ADR-0005: Deterministic stub LLM as the test-only provider boundary
- **Decision**: Integration/E2E tests configure omp with a `teststub/stub-1` custom provider
  (OpenAI-compatible) served by `scripts/stub-llm.ts`. Production docs instruct users to
  configure a real provider (`/login` or env keys); no product code references the stub.
- **Reasoning**: Live end-to-end proof (real worker, real streaming, real tool execution)
  without external credentials or cost.
- **Consequences**: Tests skip with a clear message when the stub is not running; CI starts it.

## ADR-0006: bun:test for daemon/integration tests; vitest for React component tests
- **Decision**: Daemon + integration tests use `bun:test` (same runtime as the daemon, avoids
  Node-fork crashes observed under vitest with `better-sqlite3`). Frontend component tests use
  vitest + Testing Library under a DOM environment.
- **Reasoning**: Each test runner matches its runtime; native-module and WS behavior is faithful.
- **Consequences**: Two test commands; OPERATIONS.md documents both.

## ADR-0007: Session addressing for prompts
- **Decision**: Browser commands address sessions by `sessionFile` (stable across daemon
  restarts). The ephemeral alias `new:<cwd>` is accepted only immediately after
  `session.create` before the worker reports its session file via `get_state`.
- **Reasoning**: `sessionFile` is omp's durable identifier; the alias covers the bootstrap gap.
- **Consequences**: Clients should switch to the returned sessionFile as soon as known.

## ADR-0012: Session/artifact containment is workspace-session-dir scoped
Date: 2026-08-10
Status: accepted
Context: Independent review proved session.open/fork/resume and /api/artifact accepted
arbitrary paths and followed final-component symlinks, escaping approved roots.
Decision: session files are only honored when canonically contained in a REGISTERED
workspace's omp session dir (`sessionDirForCwd(ws.root)`); lazily-created files are
checked lexically until they exist, then by realpath; artifact dir and final target are
both realpath-resolved and symlink escapes rejected with 403.
Consequences: foreign sessions are unreadable/unforkable; regression tests reproduce the
review's attacks. Opening a session whose file lives outside its workspace's session dir
(e.g. imported by hand) requires moving it into the session dir first.

## ADR-0013: Hostile-worker input bounds
Date: 2026-08-10
Status: accepted
Decision: rpc_chunk reassembly bounded by count (8192), concurrent assemblies (16),
aggregate bytes (64 MiB), and TTL (60 s); raw stdout lines over 8 MiB dropped; all frame
handling wrapped in an error boundary that drops the frame instead of crashing the daemon.
