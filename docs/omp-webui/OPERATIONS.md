# Operations

## Prerequisites
- Bun ≥ 1.3.14 (`npm install -g bun`)
- Oh My Pi ≥ 17.2.12 (`bun install -g @oh-my-pi/pi-coding-agent`)
- A configured model provider for omp: `omp` then `/login`, or set
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / etc. (omp resolves credentials itself;
  the daemon never touches them).

## Install (clean clone)
```bash
git clone <repo> omp-webui && cd omp-webui
bun install                       # root + workspace deps
cd packages/web && bun run build  # static web app → packages/web/dist
```

## Run (production mode)
```bash
bun packages/daemon/src/index.ts --port 7483 --web-dist packages/web/dist
# open http://127.0.0.1:7483/
```

## Run (development)
```bash
bun packages/daemon/src/index.ts --port 7483 &        # daemon
cd packages/web && bun run dev                        # vite dev server (proxies /ws, /api)
```

## Tests
```bash
# stub LLM for integration/e2e (test-only provider boundary)
bun scripts/stub-llm.ts 8788 &

cd packages/daemon && bun test            # unit + live integration (bun:test)
cd packages/web && bun x vitest run       # component + reducer tests (vitest)
bun x playwright test                     # browser E2E (packages/e2e)
```
Integration tests skip with a clear message when the stub is not on 127.0.0.1:8788.

## Configuration
| Flag | Default | Meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Bind address. Non-loopback REQUIRES `--token`. |
| `--port` | `7483` | HTTP/WS port (0 = ephemeral). |
| `--token` | unset | Capability token for non-loopback deployments. |
| `--origin` | loopback only | Additional allowed WS origin (repeatable). |
| `--web-dist` | unset | Directory of the built web app to serve. |

Worker idle shutdown: 10 minutes without streaming (keeps sessions warm, frees memory).

## Data locations
- Daemon DB (workspaces, session index, event journal): `~/.omp/webui/daemon.db`
- omp sessions (authoritative transcripts): `~/.omp/agent/sessions/<encoded-cwd>/*.jsonl`
- omp credentials: `~/.omp/agent/` (owned by omp; never read by the daemon)

## Logs
- Daemon logs to stdout/stderr of its process.
- Worker stderr is mirrored to daemon stderr with a per-worker prefix and retained
  in a bounded ring (4 KiB tail surfaced on `worker.crashed`).

## Recovery
- **Daemon restart**: sessions are re-indexed from omp JSONL; clients resume via
  `connection.resume` (snapshot + journal replay).
- **Worker crash**: `worker.crashed` event; `session.open` starts a fresh worker with
  `--session <file>`; conversation state is intact.
- **Interrupted stream**: the omp session file holds whatever completed; a new prompt
  continues the session.
- **DB loss**: delete `~/.omp/webui/daemon.db`; sessions are re-discovered from omp
  JSONL on next `session.list` (titles/metadata rebuilt; archive flags reset).

## Upgrade
- Bump the pinned omp version in one place (daemon `ompBin` + contract test), run the
  RPC contract tests against real fixtures, then release. See API_STABILITY.md analysis.

## Troubleshooting
- **"No models available"** — omp has no credentials: run `omp` and `/login`, or set a
  provider env var. The WebUI surfaces this as a worker startup failure.
- **WS closes immediately (4403)** — connecting from a non-loopback origin; add `--origin`
  or use SSH port-forwarding: `ssh -L 7483:127.0.0.1:7483 host`.
- **401 on HTTP** — token required; pass `?token=` or `Authorization: Bearer`.
- **Worker start timed out** — check `omp --mode rpc` runs standalone in the workspace;
  inspect daemon stderr for the worker log tail.
