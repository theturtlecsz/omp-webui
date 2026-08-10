# Security Model

## Trust boundaries
1. **Browser ↔ daemon** — WebSocket + HTTP on loopback. The browser is trusted UI but
   untrusted input: every command is validated; origins are checked; no shell interpolation.
2. **Daemon ↔ omp worker** — stdio JSONL. Workers are supervised subprocesses; stdout is
   protocol-only (logs to stderr); malformed frames are dropped, never fatal.
3. **Daemon ↔ filesystem** — all file/git operations are confined to registered workspace
   roots via canonicalized-path containment (symlink-resolving).
4. **Daemon ↔ LLM provider** — credentials live only in omp's own auth store / env /
   models.yml on the daemon host. They are never serialized into browser state or bundles.

## Network
- Default bind `127.0.0.1`. `--host` outside loopback REQUIRES `--token` (daemon refuses
  to start otherwise) and should be fronted by TLS (see OPERATIONS.md).
- WS origin allowlist: loopback origins are ALWAYS allowed; `--origin` (repeatable) adds more.
- Session/artifact filesystem access: session files must canonically live inside a
  REGISTERED workspace's omp session dir; artifact dir+target realpath-resolved, symlink
  escapes rejected (403). Foreign session paths are never read, opened, or forked.
- Protocol version enforced: mismatched protocolVersion → connection.error (protocol_version).
- Worker input bounds: chunk count/concurrency/aggregate-bytes/TTL + raw-line cap;
  malformed frames dropped, never fatal to the daemon.
- No wildcard origins. HTTP API requires the same token when configured.

## Workspace policy
- `workspace.open` registers an explicit root; canonicalized with `realpath`.
- `file.read`/`file.search`/`git.*` resolve and re-canonicalize the target and reject
  escapes (`path_escape`), including symlink escapes and `..` traversal.
- File previews are capped at 512 KiB (truncated flag), reject binary/invalid UTF-8
  content, and search results are capped at 200 entries,
  directory walk depth ≤ 12, git output capped (8/16 MiB buffers, 1 MiB diff truncation).
- `/api/artifact` rejects `..`/absolute names and caps size at 32 MiB.
- `file.upload` uses the authenticated, origin-checked WebSocket command path. Decoded
  base64 uploads are limited to 20 MiB, filenames are reduced to a safe basename, and
  each file is created mode `0600` under
  `~/.omp-webui/uploads/<workspaceId>/`. The uploads root, workspace directory, and
  final target are realpath containment-checked; an upload can only be attached from
  the workspace that created it.

## Process execution
- Workers spawn with argument arrays (no shell). Commands from the browser never reach
  a shell; only omp's own tools execute commands, under omp's approval policies.
- RPC frame reassembly bounded (64 MiB); per-line parse failures are isolated.
- Worker stderr retained in a 128 KiB ring for diagnostics; never sent to the browser raw.

### Opt-in user terminal
- `--terminal` is off by default. It enables a **user-owned shell pane only**; it is not an
  agent integration and no OMP worker/RPC command receives terminal bytes. If optional
  `node-pty` is absent or cannot load, the daemon continues normally and terminal creation
  returns `terminal_unavailable`.
- A terminal can be created only over an origin-checked, authenticated WebSocket connection.
  Its cwd is canonicalized through `WorkspaceBoundary` and must remain inside the active,
  registered workspace, including against symlink and `..` escapes.
- PTYs start `$SHELL` or `/bin/bash` with a scrubbed environment allowlist only:
  `PATH`, `HOME`, `LANG`, `TERM`, `SHELL`, `USER`, and `COLORTERM`. The daemon uses no
  command-string shell interpolation; project-command text is sent to the explicit user shell.
- Terminal ownership is pinned to the creating browser client. The daemon streams no retained
  scrollback, limits client input to 64 KiB/frame and terminal output to about 1 MiB/s
  (dropping excess with a notice), and kills PTYs on owner disconnect and daemon stop.

## Credentials
- The daemon never reads or forwards API keys. omp resolves them itself
  (auth store / env / models.yml). Missing credentials surface as omp's own
  "No models available" worker error, visible as `worker.crashed` with a redacted tail.

## Extension / untrusted content
- All tool output, diffs, filenames, and markdown are rendered as text or through the
  validated declarative WebView schema (`tool-render/webview.ts`); no `dangerouslySetInnerHTML`
  for untrusted content; markdown rendering must sanitize (no raw HTML).
- L4 sandboxed extension apps are design-only and disabled (TOOL_UI.md).

## Security test cases (automated)
- Path escape via `..` and via symlink → denied (vertical-slice.test.ts).
- Foreign WS origin → close 4403. Non-loopback without token → daemon refuses to start.
- Malformed client JSON → `connection.error`, connection stays up.
- Unknown command → error response with correlation id.
- Worker crash → `worker.crashed` event; session resumable from JSONL.
- Oversized RPC frame → chunk reassembly cap enforced (unit test in worker tests).
- Terminal disabled guard, cwd-boundary escape rejection, and owner-disconnect reaping →
  `terminal-manager.test.ts`, without requiring `node-pty`.
