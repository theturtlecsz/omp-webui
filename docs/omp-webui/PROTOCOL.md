# OMP WebUI Browser Protocol (v1)

The browser never sees raw omp RPC frames. The daemon adapts omp's wire format
(`omp --mode rpc`, JSONL/stdio, protocol v2) into this WebSocket protocol.
Canonical type source: `packages/daemon/src/protocol.ts`.

## Envelope

```json
{
  "protocolVersion": 1,
  "type": "message.delta",
  "sessionId": "019feba4-…",
  "eventId": "ev_…",
  "sequence": 123,
  "correlationId": "req_…",
  "payload": {},
  "error": { "message": "…", "code": "path_escape" }
}
```

- `sequence`: monotonic per session, assigned when the event is journaled.
  Streaming `message.delta` frames are broadcast but not journaled (snapshots
  rebuild text); all lifecycle/tool/interaction events are journaled.
- `correlationId`: echoes the client command `id` on direct responses.
- `error.code`: machine-readable (`path_escape`, `session_not_found`, …).

## Transport
- `ws://<host>/ws` — all commands and events.
- `GET /api/health` — liveness. `GET /api/artifact?sessionFile&name` — bounded artifact download.
- Loopback default; non-loopback requires `?token=` (WS) or `Authorization: Bearer` (HTTP).
- Origin header validated: loopback origins only unless `--origin` allowlist is set.

## Client commands
`connection.resume {sessionId, afterSequence}` · `workspace.list` · `workspace.open {root}` ·
`session.list {workspaceId?, query?, includeArchived?}` · `session.create {workspaceId}` ·
`session.open {workspaceId, sessionFile}` · `session.archive {sessionId, archived}` ·
`session.fork {sessionFile, entryId?}` ·
`session.reask {sessionId?|sessionFile, entryId, message}` ·
`prompt.submit {message, streamingBehavior?, workspaceId?, images?, attachments?}` ·
`prompt.queue {message, workspaceId?, images?, attachments?}` (followUp) · `prompt.steer {message, workspaceId?, images?, attachments?}` · `prompt.abort` ·
`approval.respond {interactionId, confirmed}` · `question.respond {interactionId, value|cancelled}` ·
`file.search {workspaceId, query}` · `file.read {workspaceId, path, start?, end?}` · `file.upload {workspaceId, name, data}` ·
`git.status {workspaceId}` · `git.diff {workspaceId, path?, staged?}` ·
`model.list` · `model.set {provider, modelId}` · `thinking.set {level}` · `settings.update` ·
`terminal.create {workspaceId, cwd?, cols, rows}` · `terminal.input {workspaceId, terminalId, data}` ·
`terminal.resize {workspaceId, terminalId, cols, rows}` · `terminal.kill {workspaceId, terminalId}` ·
`terminal.commands {workspaceId, commands?}`

## Server events
`connection.ready/error` · `session.snapshot` (full transcript rebuilt from omp JSONL) ·
`session.created/updated/archived/forked` · `worker.starting/ready/stopped/crashed` ·
`message.started/delta/completed/failed` · `status.updated` (streaming, compaction, retry, notices) ·
`context.updated` (model, thinkingLevel, contextUsage, todos) ·
`tool.started/updated/completed/failed` · `approval.requested` (confirm) ·
`question.requested` (select/input/editor) · `subagent.started/updated/completed` ·
`todos.updated` · `queue.updated` · `replay.completed {replayed, lastSequence}` ·
`terminal.output {terminalId, data}` · `terminal.exit {terminalId, code}` · `response` (command correlation)

### Terminal commands (opt-in)

Terminal support is disabled unless the daemon was started with `--terminal`. When disabled,
every `terminal.*` command returns `terminal_disabled`; when optional `node-pty` cannot load,
terminal creation returns `terminal_unavailable`. Terminal frames are not journaled or replayed.

- `terminal.create` starts `$SHELL` (or `/bin/bash`) at the workspace root, or at `cwd` after
  canonical workspace-boundary validation, and returns `{terminalId}`. `cols` and `rows` are
  integers in `[2, 1000]`; at most eight terminals may run for a workspace.
- `terminal.input` accepts at most 64 KiB of UTF-8 data. `terminal.output` is streamed only
  to the owning authenticated WebSocket; output above approximately 1 MiB/s is dropped with
  an in-band notice rather than queued. The daemon retains no terminal scrollback.
- `terminal.resize` changes the PTY dimensions and `terminal.kill` terminates that owned PTY.
  Processes are also reaped when their WebSocket disconnects or the daemon stops.
- `terminal.commands {workspaceId}` reads `<workspace>/.omp/commands.json` and returns
  `{commands}`. Passing a validated `commands` array writes the same bounded config back.
  Each command is `{id, name, command, cwd?}`; the UI expands literal `${pwd}` to the
  workspace root before sending command text to an already-open user shell.

### `session.reask`

`session.reask` creates a new session file by copying the source session through the
specified JSONL message `entryId`, changes that fork's title to `Fork of <source title>`,
attaches a worker to the fork, and submits `message` to that worker. The source session
file is never modified. The direct `response` includes `{accepted, sessionId, sessionFile,
title}` and the daemon journals then broadcasts `session.forked` with `activate: true`, so
every attached browser switches to the fork and resumes its snapshot. Transcript user
items rebuilt from a session file include `entryId` for this command.

## Replay & dedupe
1. Client tracks `lastSequence` per session from envelopes.
2. On reconnect: `connection.resume {sessionId, afterSequence: lastSequence}`.
3. Server sends `session.snapshot` (authoritative omp JSONL rebuild), then journaled
   events with `sequence > afterSequence`, then `replay.completed`.
4. Client dedupes by `eventId`; reducer upserts are idempotent by item id/toolCallId.
5. If the journal was truncated (retention bound), the snapshot already covers history;
   replay gaps are therefore safe by construction.

## Attachments and file previews

- `file.upload` is a WebSocket command, so it has the same origin and token checks as
  every other browser command. `data` is base64, decoded data is limited to 20 MiB, and
  the daemon stores it under `~/.omp-webui/uploads/<workspaceId>/` with a sanitized,
  generated filename. The response is `{path, name, size}`. Returned paths are accepted
  only from that same workspace's upload directory.
- Prompt commands accept `images: [{data, mimeType}]`; valid PNG, JPEG, WebP, and GIF
  values are forwarded to omp as `{type:"image", data, mimeType}`. They also accept
  `attachments: [{path, start?, end?} | {name, data, start?, end?}]`. Attachment paths
  are contained in the active workspace or its private upload directory; `{name,data}`
  uses the same bounded upload storage.
- Text attachments up to `OMP_WEB_INLINE_FILE_MAX` bytes (default 12 KiB) are appended
  to the outgoing prompt as `<file path="…">…</file>`. Inclusive `start`/`end` produces
  `<file path="…" lines="start-end">` with only those lines. Larger or binary files
  become a path-reference line. `file.read` is a preview-safe 512 KiB text read, returns
  `binary: true` for binary/invalid UTF-8 data, and supports the same line range.

## Adapter boundary (daemon internal)
omp frames → normalized events in `packages/daemon/src/session-runtime.ts` ONLY:
- `message_start/update/end` → `message.started/delta/completed|failed`
  (`stopReason: error|aborted` → `message.failed`).
- `tool_execution_start/update/end` → `tool.started/updated/completed|failed`.
- `extension_ui_request`: `confirm`→approval; `select|input|editor`→question;
  `notify|setStatus`→status; `setWidget|setTitle|set_editor_text|open_url`→session.updated
  (terminal-only surfaces, no browser dialog); `cancel`→dismiss pending.
- `subagent_lifecycle/progress/event` → `subagent.*` (subscription: daemon sets
  `set_subagent_subscription: "progress"` on worker start).
- Unknown frame types → bounded `status.updated` debug notice (never silently dropped).

## Versioning
- `protocolVersion` is a single integer; additive event/command fields are minor-compatible.
- Breaking changes bump the integer; the daemon rejects lower-than-supported majors with
  `connection.error`. omp-side compatibility is pinned to `@oh-my-pi/pi-coding-agent@17.2.12`
  and guarded by contract tests (see ACCEPTANCE.md).

## Resource bounds (Phase 6 review)

- Fully-assembled prompts (message + inlined attachments) are capped at 512 KiB of
  UTF-8. Larger submissions are rejected with error code `message_too_large` on
  `prompt.submit`, `prompt.queue`, `prompt.steer`, and `session.reask`. Large files
  should be attached as path references — the model reads them on demand.
- Preview and attachment reads are bounded fd reads (at most 512 KiB + 1 byte);
  the daemon never allocates a workspace file's full size.
- The WebSocket server enforces `maxPayload` of 32 MiB per frame (a 20 MiB binary
  upload is ~27 MiB base64). Oversized frames close the socket with code 1009
  before any decoding occurs.
- The markdown renderer parses at most 100,000 characters per message; overflow is
  available on demand as plain text.
