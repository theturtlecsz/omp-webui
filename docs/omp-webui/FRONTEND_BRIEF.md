# Frontend Engineer Brief — OMP WebUI

You own `packages/web/src/**` EXCEPT `src/styles/**` (UX engineer) and `src/tool-render/**`
(tool engineer). Read before coding:

- `packages/daemon/src/protocol.ts` — the WebSocket protocol (envelope, commands, events)
- `packages/daemon/src/server.ts` `#dispatch` — exact command payloads and response shapes
- `packages/web/src/styles/tokens.css` + `docs/omp-webui/DESIGN_SYSTEM.md` + `docs/omp-webui/UX_VISUAL_HANDOFF.md`
- `packages/web/src/tool-render/registry.ts`, `generic-model.ts`, `webview.ts` — renderer contracts
- `docs/omp-webui/analysis/fixtures/rpc-probe-frames.jsonl` — real event shapes

## Stack
Vite + React 18 + TypeScript, strict. zustand for state. No UI kit; hand-rolled CSS using the
design tokens (import `styles/tokens.css` + `styles/base.css` in main.tsx). lucide-react for icons.

## Connection layer (`src/lib/`)
- `client.ts`: WS to `ws://<host>/ws` (same origin; dev override via `?daemon=ws://127.0.0.1:7483/ws`
  URL param or localStorage `omp-webui.daemon`). JSON envelope send/receive. Command/response
  correlation by `id` (promise map, 30s timeout). Auto-reconnect with exponential backoff
  (250ms→8s, jitter); on reconnect send `connection.resume {sessionId, afterSequence}` for the
  active session. Track `lastSequence` per session from event envelopes. Expose connection state
  (connecting/online/reconnecting/offline) to the UI.
- `store.ts` (zustand): workspaces, sessions, activeSession {sessionId, sessionFile}, transcript
  items, toolCards (by toolCallId), pendingInteractions (approvals/questions), sessionState
  (model, thinkingLevel, isStreaming, contextUsage, todos), queuedPrompts, drafts.
- `reducer.ts`: pure function applying each server event to transcript state.
  - `session.snapshot` → replace items.
  - `message.started/delta` → upsert in-flight assistant item (use payload.message accumulating
    object; extract text from content[] text blocks; NEVER render thinking blocks as content —
    show a collapsed "Thinking" affordance only).
  - `message.completed/failed` → finalize.
  - `tool.started/updated/completed/failed` → upsert tool card by toolCallId (state, args,
    partialResult/result text via buildGenericToolModel).
  - `approval.requested/question.requested` → push pending interaction (id, method, payload).
  - `status.updated/context.updated/todos.updated` → session state.
  - `replay.completed` → mark replay done; dedupe by eventId/sequence (never double-append).
  Reducer must be idempotent: applying the same event twice yields the same state.

## Components (`src/components/`)
- `AppShell`: sidebar | transcript | right drawer (tabs: Files, Git, Plan). Responsive:
  sidebar collapses <900px; drawer becomes overlay. Keyboard: Ctrl/Cmd+K session search,
  Ctrl/Cmd+N new session, Ctrl/Cmd+B toggle sidebar, Esc closes dialogs/drawer.
- `Sidebar`: workspace switcher (open-by-path input), session list (title, relative time,
  streaming spinner, archived filter), search box (session.list with query), archive/unarchive,
  "New session" button.
- `Transcript`: virtualized-friendly list (render cap: keep DOM nodes bounded — collapse tool
  output >4KB behind "expand"), auto-scroll pinned to bottom unless user scrolled up (show
  "Jump to latest" pill), message copy button, fork-from-message button (session.fork),
  empty/loading/offline/reconnecting states.
- `ToolCard`: uses `resolveToolRenderer(toolName)`; generic fallback via `buildGenericToolModel`
  for unknown tools. States: running (spinner+elapsed), success, failure, cancelled. Expandable
  raw JSON. Copy output. File paths in args link to file preview.
- `ApprovalDialog` / `QuestionDialog`: modal, focus-trapped, aria-modal. confirm →
  approval.respond {interactionId, confirmed}. select → options list; input/editor → text field;
  question.respond {interactionId, value} or {cancelled:true}. Show timeout countdown when
  payload.timeout present.
- `Composer`: multiline textarea (Enter send, Shift+Enter newline), disabled with explanation
  when no session; while streaming: Steer + Queue + Abort buttons (prompt.steer / prompt.queue /
  prompt.abort); model selector (model.list → model.set), thinking-level selector
  (off/minimal/low/medium/high), context-usage meter (percent), queued-message chips.
  Draft preserved per sessionFile in localStorage on every keystroke; restored on switch/reload.
- `FileMention`: `@` in composer opens file search (file.search) popup; selection inserts
  `@path`. Attachment button reads file via file.read and appends a fenced block.
- `GitPanel`: git.status list (path, status badge, staged), click → git.diff view (syntax
  colored +/- lines), refresh button.
- `PlanPanel`: todos.updated phases/tasks (pending/in_progress/completed icons), collapsible.
- `StatusBar`: connection state, worker state, model id, thinking level, context %, tokens/s
  when available.

## Quality bar
- No mock data anywhere: all state comes from the daemon protocol.
- All interactive elements keyboard-reachable with visible focus (tokens.css focus ring).
- aria-live="polite" throttled announcer for streaming status (not per-token).
- `bun run build` (vite build) must succeed; `bun x tsc --noEmit` clean.

## Tests (`packages/web/test/`, vitest + jsdom + @testing-library/react)
- reducer: snapshot replace, delta upsert idempotency, tool lifecycle, approval push/resolve,
  replay dedupe (same event twice → single item), large-output collapse flag.
- client: correlation, reconnect resume call (mock WebSocket).
- components: ToolCard generic fallback renders unknown tool; Composer draft preservation;
  ApprovalDialog keyboard (Tab trap, Enter confirm, Esc cancel).
Run: `cd packages/web && bun x vitest run` — must pass.

## Install
`cd packages/web && bun add react react-dom zustand lucide-react && bun add -d vite @vitejs/plugin-react typescript @types/react @types/react-dom vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom`
