# OMP WebUI

A polished, local-first browser interface for [Oh My Pi](https://github.com/can1357/oh-my-pi)
(`omp`), the extensible coding agent. One daemon supervises one `omp --mode rpc` worker per
session and serves a React app with streaming transcripts, tool cards, approval dialogs,
session search/fork/archive, and file/Git panels.

## Quickstart

```bash
# prerequisites: bun >= 1.3.14, omp >= 17.2.12, and an omp model provider
# (run `omp` and use /login, or set ANTHROPIC_API_KEY / OPENAI_API_KEY / ...)

git clone <this repo> && cd omp-webui
bun install && (cd packages/daemon && bun install) && (cd packages/web && bun install)
cd packages/web && bun run build && cd ../..
bun packages/daemon/src/index.ts --port 7483 --web-dist packages/web/dist
# open http://127.0.0.1:7483/
```

## Development

```bash
bun packages/daemon/src/index.ts --port 7483 &   # daemon
cd packages/web && bun run dev                   # vite dev server with /ws + /api proxy
```

## Tests

```bash
bun scripts/stub-llm.ts 8788 &        # deterministic test-only LLM provider
cd packages/daemon && bun test        # integration + security + fault tests
cd packages/web && bun x vitest run   # reducer/client/component tests
bun x playwright test                 # browser end-to-end
```

## Architecture

```
browser (React)  ──WS/HTTP──>  daemon (Bun/TS)  ──stdio JSONL RPC──>  omp worker (per session)
                                    │
                                    ├─ SQLite index + event journal (~/.omp/webui/daemon.db)
                                    └─ omp session JSONL is the authoritative transcript
```

- `packages/daemon` — protocol adapter, worker supervisor, workspace security, replay
- `packages/web` — React 19 + Vite app, tool-render registry, design tokens
- `packages/e2e` — Playwright browser tests
- `docs/omp-webui` — charter, protocol, security, decisions, acceptance evidence

See `docs/omp-webui/OPERATIONS.md` for configuration, recovery, and troubleshooting.
