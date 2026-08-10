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
`session.fork {sessionFile, entryId?}` · `prompt.submit {message, streamingBehavior?}` ·
`prompt.queue {message}` (followUp) · `prompt.steer {message}` · `prompt.abort` ·
`approval.respond {interactionId, confirmed}` · `question.respond {interactionId, value|cancelled}` ·
`file.search {workspaceId, query}` · `file.read {workspaceId, path}` ·
`git.status {workspaceId}` · `git.diff {workspaceId, path?, staged?}` ·
`model.list` · `model.set {provider, modelId}` · `thinking.set {level}` · `settings.update`

## Server events
`connection.ready/error` · `session.snapshot` (full transcript rebuilt from omp JSONL) ·
`session.created/updated/archived/forked` · `worker.starting/ready/stopped/crashed` ·
`message.started/delta/completed/failed` · `status.updated` (streaming, compaction, retry, notices) ·
`context.updated` (model, thinkingLevel, contextUsage, todos) ·
`tool.started/updated/completed/failed` · `approval.requested` (confirm) ·
`question.requested` (select/input/editor) · `subagent.started/updated/completed` ·
`todos.updated` · `queue.updated` · `replay.completed {replayed, lastSequence}` ·
`response` (command correlation)

## Replay & dedupe
1. Client tracks `lastSequence` per session from envelopes.
2. On reconnect: `connection.resume {sessionId, afterSequence: lastSequence}`.
3. Server sends `session.snapshot` (authoritative omp JSONL rebuild), then journaled
   events with `sequence > afterSequence`, then `replay.completed`.
4. Client dedupes by `eventId`; reducer upserts are idempotent by item id/toolCallId.
5. If the journal was truncated (retention bound), the snapshot already covers history;
   replay gaps are therefore safe by construction.

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
