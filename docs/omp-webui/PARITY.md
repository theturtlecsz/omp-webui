# PARITY.md — Phase 6: Feature Parity with pi-web-ui

Status: **complete (2026-08-10)** — all 11 items verified, security review remediated (SHIP); Phase 7 terminal polish (T-210 tab rename + keyboard shortcuts, T-220 commands.json export/import) also shipped. See ACCEPTANCE.md · Owner: OMP WebUI Delivery Orchestrator · Baseline: v1 acceptance (commit 401b230, pushed to theturtlecsz/omp-webui)

## Target
Feature parity with pi-web-ui v0.15.0 (published 2026-08-10) while preserving our
differentiators: hardened containment, journaled incremental protocol, crash isolation,
no-PTY integration architecture, and full test pyramid. Their package states NO public
roadmap (verified 2026-08-10); parity target is therefore their shipped feature set.

## Verified upstream facts (do not re-litigate)
- omp RPC `prompt`/`steer`/`follow_up` accept `images?: ImageContent[]` where
  `ImageContent = { type:"image", data: base64, mimeType }` (rpc-types.ts:33-37,
  packages/ai/src/types.ts:717). No custom-message/aside RPC exists → file attachments
  are inlined into the prompt text as `<file path="..." lines="a-b">` blocks (same
  convention pi-web-ui uses for line ranges).
- pi-web-ui has no auth model documented; we keep ours strictly stronger.

## Work items

### T-100 Sanitized GFM markdown renderer (web)
Assistant + user messages render GitHub-Flavored Markdown: tables, fenced code with
syntax highlighting, copy buttons on code blocks. MUST be XSS-safe: react-markdown +
remark-gfm + rehype-sanitize (default schema + code class whitelist); no raw HTML.
Thinking blocks stay separate (never rendered as message text). Streaming messages render
as plain text until turn end (avoid re-parse churn), then markdown.

### T-110 Long-chat collapsing + bounded seenEvents (web)
>30 messages: older collapse to summary rows (role, first-line preview, block counts),
click to expand; latest 15 always full. Also bound reducer `seenEvents` (LRU, 10k) —
closes the one deferred review finding.

### T-120 Edit-and-re-ask (daemon + web)
Edit button on every user message → inline editor → submit: daemon forks session at that
entry (existing session.fork), opens the fork, re-submits edited prompt. Original session
untouched and listed; fork titled "Fork of <title>". Fork must be journaled + resumable.

### T-130 Attachments & images (daemon + web)
- `prompt.submit` accepts `images: [{data,mimeType}]` → forwarded to omp `images` field;
  and `attachments: [{path} | {name, data(base64)}]`.
- Workspace file chips: "+" on Files panel entries queues attachment; ≤12 KB
  (OMP_WEB_INLINE_FILE_MAX) inlined as `<file path>` block, larger → path reference only.
- Paste (Ctrl+V), drag-drop onto composer, paperclip button for local files; images
  downscaled ≤1568 px client-side; uploads persisted daemon-side under
  `~/.omp-webui/uploads/<workspaceId>/` with 20 MB cap, name-sanitized, containment-checked.
- Vision warning when attaching images to a model known non-vision (model metadata
  `capabilities`/`input` if present; otherwise no warning).
- Attachment chips render above composer; sent attachments render as collapsible cards.

### T-140 File preview + line selection (web, minor daemon)
Click file in Files panel → modal preview (line numbers, 512 KB cap, binary refused —
daemon `file.read` already caps; add `?start&end` range support if cheap). Click/drag/
shift-click line selection → "Add to conversation" → attachment chip with lines range;
on send inlined as `<file path="..." lines="a-b">` containing only that range.

### T-150 Terminal pane (OPT-IN, isolated)
xterm.js + node-pty user shell, VSCode-style tabs, project commands from
`<workspace>/.omp/commands.json` (`${pwd}` supported), chat/terminal top-bar toggle.
HARD CONSTRAINTS: disabled by default, requires `--terminal` daemon flag; node-pty is a
lazy `import()` so clean-clone install/build NEVER requires it (add to
optionalDependencies, guard load failure with a clear notice); shell cwd must be inside
the active workspace boundary; terminals killed when last client disconnects; raw line
and scrollback bounded. This is a USER shell, not the agent integration — document that
distinction in SECURITY.md.

### T-160 Workspace memory + version display (web polish)
Last-workspace-per-browser restore (verify existing behavior, fix gaps), Recent projects
one-click switch (exists — polish), daemon version in header from /api/health. NO
self-update panel (not npm-published) — noted as intentional divergence.

### T-170 Service installer (scripts)
`scripts/install-service.sh`: `--print` (default) emits a systemd --user unit;
`install` writes + enables it. Linux only; macOS/Windows documented as manual. No sudo.

### T-180 E2E parity specs (packages/e2e)
New specs: markdown rendering (table + code copy), paste-image attachment round-trip
(stub LLM extended TEST-ONLY to acknowledge image receipt), edit-and-re-ask fork flow,
long-chat collapse at >30 messages, file preview + line selection, terminal pane
(with --terminal enabled in that spec's daemon). All existing suites must stay green.

### T-190 Independent security review of Phase 6
Focused: upload containment, attachment size caps, markdown XSS (probe with known XSS
vectors through the renderer), terminal escape (cwd boundary, orphan reaping), new WS
commands auth. Same adversarial standard as Phase 4 review.

### T-200 Docs + acceptance + push
PROTOCOL.md (new commands/payloads), SECURITY.md (terminal + uploads sections),
OPERATIONS.md (--terminal, service installer, env vars), ACCEPTANCE.md parity rows,
DECISIONS.md ADRs for: attachment inlining convention, optional-PTY isolation,
markdown sanitization schema. Commit + push to origin/master.

## Explicit non-goals (divergences, recorded)
- In-process SDK architecture — we keep subprocess RPC (crash isolation, ADR-0002).
- Self-update panel — not npm-published.
- launchd/Windows service templates — Linux systemd only.
- Per-browser-client isolated sessions — we keep shared workspace sessions (multi-client
  broadcast is a feature).
