# OMP WebUI — Project Charter

## Mission
A polished, local-first browser interface for the Oh My Pi (`omp`) coding agent,
comparable in interaction quality to modern coding-agent web UIs, built as an
original product over omp's structured RPC interface (`omp --mode rpc`).

## Architecture (decided; see DECISIONS.md)
```
Browser (React 18 + TS + Vite, packages/web)
      │  WebSocket (omp-webui protocol v1) + minimal REST (health/artifacts)
      ▼
Daemon (Bun + TypeScript, packages/daemon; loopback-only by default)
      │  spawns & supervises
      ▼
omp worker (`omp --mode rpc`, JSONL over stdio, protocol v2 negotiated)
      │
      ▼
LLM provider (user-configured; tests use a deterministic stub at this boundary)
```
- **Daemon language: Bun/TypeScript** (ADR-0001) instead of Rust/Axum — omp's own
  protocol types and frame decoder are TypeScript; single-runtime monorepo.
- **omp session JSONL remains authoritative** for conversation state; SQLite indexes
  sessions/workspaces/UI state plus daemon event journal for replay cursors.
- **collab-web is not reused as a dependency** (pi-wire v3 protocol, private package);
  its tool-render concepts are re-implemented behind our own registry (ADR-0003).

## Supported deployment
Local-first: daemon binds 127.0.0.1; the same process serves the built web app.
Non-loopback exposure requires explicit `--bind` + auth token + origin allowlist.

## Non-goals
Browser IDE, terminal emulator, debugger, multi-tenant SaaS, billing, org admin,
arbitrary third-party JS in the main app context, pixel-cloning any existing product.

## Completion standard
The 15-point Definition of Done in ACCEPTANCE.md, each with automated or
documented-manual evidence. A mock-driven demo does not count.
