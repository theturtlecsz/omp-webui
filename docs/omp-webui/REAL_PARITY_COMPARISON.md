# REAL_PARITY_COMPARISON — pi-web-ui v0.15.0 vs omp-webui (2026-08-10)

> **Re-validated 2026-08-11** against pi-web-ui **0.17.1** and omp **17.2.13**
> (see "2026-08-11 re-baseline" section at the bottom). Full suites re-run
> green against omp 17.2.13: daemon bun 43/43, web vitest 56/56, Playwright
> default 17/17, Playwright terminal 1/1.

## The framing problem I need to lead with

pi-web-ui is a browser frontend for **`@earendil-works/pi-coding-agent`** (the
pi SDK by Mario Zechner). omp-webui is a browser frontend for **omp**
(`@oh-my-pi/pi-coding-agent`, Can Bölük's fork). They target different backends
with different capabilities, session formats, and CLIs. So "feature parity" is
not a like-for-like comparison of two clients over the same server — it's UX
parity of two clients that must each faithfully surface their respective
backends. Some pi-web-ui features are pi-SDK features we cannot mirror without
reimplementing them against omp; some omp features have no pi-web-ui analogue.

pi-web-ui's package.json declares the pi SDK as a **direct dependency** — it
imports SDK classes and drives the agent in-process. omp-webui takes the
opposite architecture: it launches `omp --mode rpc` as a subprocess and talks
JSON frames over stdio, so we never link the agent library into our daemon.
That is a real architectural difference, not a gap.

## Method

- Downloaded `pi-web-ui@0.15.0` via `npm pack`, extracted the tarball,
  inspected `package.json`, `dist/server/*.js`, `web/dist/assets/*.js`,
  `README.md`, and the deploy artifacts under `deploy/`.
- Installed omp: `bun install -g @oh-my-pi/pi-coding-agent@17.2.12`.
  Ran `omp --mode rpc --no-session` by hand and observed the startup frame
  sequence: `ready` (protocolVersion=1, supportedProtocolVersions=[1,2],
  maxFrameBytes=1MiB, maxReassembledFrameBytes=64MiB), then
  `extension_ui_request setWidget autoresearch`, then
  `available_commands_update` with ~30 built-in slash commands.

## pi-web-ui feature inventory (from actual bundle, not README)

Server (`dist/server/index.js`) accepts 34 client-message types:
`get_state`, `hello`, `set_cwd`, `complete_path`, `new_chat`, `prompt`,
`abort`, `edit_message`, `switch_conversation`, `switch_session`,
`list_sessions`, `list_projects`, `list_files`, `read_file`,
`terminal_create`, `terminal_input`, `terminal_kill`, `terminal_resize`,
`list_commands`, `save_commands`, `run_command`, `list_models`,
`list_providers`, `list_models_config`, `save_model_config`,
`delete_model_config`, `set_model`, `set_provider_api_key`, `cycle_model`,
`cycle_thinking`, `set_thinking`, `install_pi_agent`, `check_update`,
`update_app`, `dialog_response`.

Frontend UI features found in `web/dist/assets/index-*.js`:
- **Sound effects** (start/done/error/question tones, per-event enable, volume,
  localStorage-persisted under key `pi-web-sounds`).
- **Plugin dialogs** — SDK-driven modal `select`, `confirm`, `input` dialogs
  with keyboard nav, Escape to cancel, `dialog_response` reply.
- **Path autocomplete** for cwd (server `complete_path`, list of dir/file items
  under a text input).
- **Model config CRUD** — full create/update/delete of provider registry
  entries in `~/.pi/agent/models.yml` from the UI, including provider API-key
  entry (`set_provider_api_key`).
- **Model + thinking-level cycling** matching pi TUI hotkeys.
- **Recent projects** panel: list of previously used workspaces, per-project
  session dirs, one-click switch.
- **Attach modes**: inline vs reference chip for workspace files.
- **Image Q&A**: paste (Ctrl+V), drag onto input, or attach from workspace;
  emits a `warning` toast with 10-second cooldown if the active model is not
  vision-capable.
- **File chat**: any file dropped onto input becomes a base64 attachment,
  20 MiB cap.
- **File preview** with line-number selection (click / shift-click / drag),
  add-to-chat with range, truncation notice at 512 KiB / hex fallback for
  binary.
- **Self-update** panel: shows version, checks npm for latest, `npm i -g` in
  one click, restart required note.
- **Install pi-agent** button (`install_pi_agent`).
- **i18n**: zh-CN default, en fallback; every visible string routed through
  `Ft()` locale hook.
- **Long-chat collapse**: last 15 full, older collapse to summary rows
  (documented; not re-verified in the bundle).
- **Terminal three-pane**: command list + xterm.js pane + VSCode-style vertical
  tab strip. Commands persisted per workspace (`.pi-web-ui/commands.json`
  via `save_commands`/`list_commands`).

Deploy surface: launchd plist (`com.xingshuyin.pi-web-ui.plist`), systemd unit
(`pi-web-ui.service`), Windows Task Scheduler XML (`pi-web-ui-task.xml`),
CLI subcommands `server install|uninstall|start|stop|restart|status`.

## Column-by-column comparison

| Capability | pi-web-ui v0.15.0 | omp-webui (this repo) | Parity? |
| --- | --- | --- | --- |
| Streaming assistant + thinking blocks | ✅ (snapshot-driven, 60 ms) | ✅ (incremental journal + snapshot) | ✅ |
| Tool cards with live output + status | ✅ | ✅ (unknown-tool renderer for uncovered ids) | ✅ + strict fallback |
| Session persistence + browse | ✅ per-clientId sessions dir | ✅ SQLite index over omp JSONL | ✅ |
| Fork on edit-message | ✅ `edit_message` server-side fork | ✅ `session.reask` fork with parent link | ✅ |
| Long-chat virtualization | ✅ collapse older, keep last 15 | ✅ collapse older, keep last N | ✅ |
| File preview with line ranges | ✅ | ✅ (parity spec) | ✅ |
| Workspace file browser + live refresh | ✅ tree + `file_changed` push | ✅ FileTreePanel + `file.list` + debounced fs.watch push | ✅ |
| Attach files (inline + reference) | ✅ | ✅ inline; reference mode = attach-as-URL not implemented | ⚠ minor UX gap |
| Paste image + vision-guard toast | ✅ 10 s cooldown warning | ✅ `[image omitted: model does not support vision]` placeholder | ✅ (different UX) |
| Multi-tab xterm.js terminal | ✅ three-pane, tabs | ✅ tabs + rename + shortcuts + export/import | ✅ / ✅ + we exceed |
| Project commands.json | ✅ (`save_commands`/`list_commands`) | ✅ (`.omp/commands.json` write + export/import UI) | ✅ |
| Model listing + switch | ✅ `list_models` + `set_model` + cycle | ✅ ModelPickerDialog: provider-grouped listbox with metadata (ctx window, reasoning, cost) + model.cycle passthrough | ✅ |
| Provider/model CRUD + API keys from UI | ✅ full CRUD | ✅ Providers drawer tab → daemon writes `~/.omp/agent/models.yml`; apiKey masked in listings (write-only field); model add/remove per provider | ✅ |
| Thinking-level control | ✅ set + cycle | ✅ full 7-level range (off…xhigh/max) in ModelPickerDialog + thinking.cycle passthrough | ✅ |
| Plugin dialogs (select/confirm/input/editor) | ✅ generic modal | ✅ method-specific dialogs (Select/Input/Editor + Approval for confirm) — see gap #4 note below | ✅ |
| Path autocomplete for cwd | ✅ `complete_path` | ✅ daemon `path.complete` + datalist on open-path input | ✅ |
| Recent projects list | ✅ | ✅ MRU (8 entries) in Sidebar | ✅ |
| Sound effects | ✅ opt-in, per-event | ❌ | ❌ nice-to-have gap |
| Self-update from UI | ✅ npm-based | ❌ (out of scope for us — omp installs via bun/curl) | N/A |
| Install pi-agent from UI | ✅ | ❌ (out of scope — omp is a separate binary the user installs) | N/A |
| i18n (zh-CN + en) | ✅ | ❌ English only | ❌ gap |
| System service install (launchd/systemd/Task Scheduler) | ✅ CLI subcommands generate + install units | ❌ (user explicitly deprioritized) | Deferred |
| Docker deploy | ✅ | ❌ (deferred) | Deferred |
| Loopback-only bind + token+origin auth | Bearer over WS with origin check (from bundle) | ✅ token + origin, loopback default | ✅ |
| Bounded frame size / prompt cap | maxPayload defaults | ✅ 32 MiB WS maxPayload, 512 KiB prompt cap, 100 KiB markdown cap | ✅ + we are stricter |
| PTY host isolation | node-pty in-process | ✅ pty-host.mjs Node shim under separate process | ✅ + we exceed |

**omp-specific surfaces pi-web-ui doesn't handle at all** (real omp emits
these; verified against `omp v17.2.12 --mode rpc`):

- `extension_ui_request setWidget` — omp requests the UI show a specific widget
  key on startup (e.g. `autoresearch`). **Our daemon does forward this** as
  `session.updated{payload:{extensionUI:…}}` — the web UI just doesn't render
  it yet.
- `available_commands_update` — omp streams the slash-command catalog live;
  ~30 built-in commands (`security`, `prewalk`, `todo`, `memory`, `mcp`,
  `ssh`, `compact`, `shake`, `browser`, `share`, `advisor`, `vision`, `fast`,
  `computer`, `usage`, `stats`, `changelog`, `tools`, `context`, `session`,
  `jobs`, `fresh`, `dump`, `export`, `mm` mental-models family, …). **Our
  daemon does forward this** as `session.updated{payload:{availableCommands:…}}`
  — the web UI just doesn't render a palette yet.
- Protocol negotiation — omp reports `supportedProtocolVersions=[1,2]`,
  `maxFrameBytes`, `maxReassembledFrameBytes` on `ready`; we track only v1.

## Real end-to-end verification (this session)

Installed `omp v17.2.12` (`bun install -g @oh-my-pi/pi-coding-agent`), pointed
our daemon at a fresh workspace (`/tmp/omp-realtest`) with the deterministic
stub-llm provider registered in `~/.omp/agent/models.yml`, and drove the
protocol end-to-end with a `ws` client (`/tmp/omp-realtest/probe.mjs`).

**Observed frame sequence (all fields real, not simulated):**

```
connection.ready protocolVersion=1
response cid=1  workspace.list -> [existing workspaces]
response cid=2  workspace.open -> {workspace:{id,root,name,...}}
worker.ready
session.updated {extensionUI:{method:setWidget,widgetKey:autoresearch}}
session.updated {availableCommands:[security,prewalk,todo,memory,...30 more]}
context.updated {model:{id:stub-1,provider:teststub,baseUrl:127.0.0.1:8788}}
response cid=3  session.create -> {sessionFile:~/.omp/agent/sessions/…jsonl, sessionId:019fee94-…}
response cid=4  prompt.submit  -> {accepted:true}
status.updated {isStreaming:true}
message.started
message.completed {message:{role:user,text:"…prompt…"}}
message.started
message.delta   (multiple)
message.completed {message:{role:assistant,text:"Hello from the stub model.…"}}
```

What this proves:

1. Our daemon correctly spawns `omp --mode rpc`, negotiates protocol
   version 1, and streams JSON frames to the web-facing WS with our normalized
   `payload` envelope.
2. `extension_ui_request` and `available_commands_update` are already
   forwarded to the browser (previous claim they weren't was wrong — corrected
   above).
3. Full assistant round-trip works: user prompt → omp → provider →
   `message.delta` stream → `message.completed{role:assistant, text}`.
4. The omp session JSONL file is written to disk at the expected path and
   our snapshot rebuild has correct source data.
5. Error paths propagate: when stub-llm was unreachable, omp emitted
   `message.failed{stopReason:"error", error:"Unable to connect.…"}` followed
   by `status.updated{retrying:{attempt:1,maxAttempts:10,error:…}}` and our
   daemon forwarded both. No silent hangs.
6. Restart behavior works: killing/restarting the daemon and stub-llm and
   re-running the probe reproduced the full sequence deterministically.

## Honest gap list to close for real parity

1. ~~**Slash-command palette**~~ — **shipped this session.** `SlashCommandPalette`
   component subscribes to `sessionState.availableCommands` (populated from
   `session.updated.availableCommands` in the reducer), opens on Cmd/Ctrl+K
   OR when the user types `/` at position 0 in the composer, supports
   arrow-key navigation, fuzzy filtering, subcommand expansion via Enter or
   ArrowRight, and inserts the chosen command into the composer for the user
   to add arguments and submit. First iteration renders the same ~30 builtin
   omp slash commands verified in the probe above. `ExtensionWidget` renders
   `session.updated.extensionUI` at the top of the conversation area with a
   registry-based label for known widgetKeys (e.g. `autoresearch`) and a
   neutral fallback for unknown ones. Verified end-to-end by
   `packages/e2e/slash-palette.spec.ts` (2 tests) against real omp v17.2.12.
2. ~~**`extension_ui_request` handling**~~ — **shipped this session** for the
   `setWidget` method (ambient banner with registry-based labels; unknown
   widgetKeys fall back to a neutral badge).
3. **Model picker + thinking-level control** — `omp --mode rpc` exposes model
   selection through the same frame types the CLI uses; we should surface it.
4. ~~**Input-request dialogs**~~ — **shipped this session**. All 11 methods
   emitted by real omp v17.2.12's `extension_ui_request` frame are now handled
   (schema verified against `@oh-my-pi/pi-coding-agent@17.2.12`
   `rpc-types.d.ts`):
   - **Interactive (require a response frame back to omp)**
     - `confirm` — routed to `ApprovalDialog`; response `{confirmed}`
     - `select` with `["Approve","Deny"]` — normalized to `ApprovalDialog`
     - `select` (general) — dedicated `SelectDialog` with arrow-key nav,
       Enter to submit, no free-form textarea; response `{value}`
     - `input` — `InputDialog` (single-line, Enter to submit); response `{value}`
     - `editor` — new `EditorDialog` with `prefill` honored, `promptStyle`
       switching between prompt (Enter submits) and code (Cmd/Ctrl-Enter
       submits) modes; response `{value}` or `{cancelled:true}`
   - **Fire-and-forget (informational; no response)**
     - `notify` (info/warning/error) — new `NotifyToast` with per-type styling,
       auto-dismiss for info/warning, sticky for error
     - `setStatus` — new `ExtensionStatusPills` (keyed; empty statusText removes
       the key)
     - `setTitle` — reflected into `document.title` when omp is started with
       `PI_RPC_EMIT_TITLE` set
     - `set_editor_text` — applied to the composer textarea with a fired
       `input` event so React state syncs; one-shot cleared after apply
     - `open_url` — new `OpenUrlDialog` (OAuth login flows), honors omp's
       recommendation to surface `launchUrl` as the copy target while the
       anchor opens the full `url` in a new tab
     - `setWidget` — pre-existing `ExtensionWidget` banner
     - `cancel` — pre-existing (dismisses the pending interaction by targetId)

   Verified by 12 daemon direct-drive tests over `SessionRuntime#onWorkerFrame`
   (each real method + response frame shape), 17 web unit tests over the split
   dialogs + reducer slices + notification/status merge behavior, and the
   existing Playwright approval-dialog test through `completeApprovedToolTurn`
   which continues to pass end-to-end against real omp v17.2.12.
5. **Provider/model CRUD** — omp reads `~/.omp/agent/models.yml`; a UI that
   reads/writes it would match pi-web-ui's provider panel.
6. **Recent-projects MRU switcher** in the sidebar (small; cosmetic parity).
7. **Path autocomplete** for the workspace picker (small).
8. **i18n scaffold** — even without translations, wrap strings so contributors
   can add zh-CN.
9. **Sound effects** — trivial to add; not required.
10. **Reference-mode attachments** — attach a workspace path as a URL/reference
    rather than inlining bytes.

Non-goals confirmed (user-deprioritized): system-service installers, Docker
compose, self-update panel, cross-platform launchd/Task Scheduler.

## Bug found while running the real integration

`packages/daemon/src/worker.ts:60` passes `--session <file>` to omp.
Real `omp --help` does not list `--session`; the flag is silently accepted
(omp does not fail on unknown flags in this mode) but has no effect. omp
actually uses `--session-dir=<dir>` for storage location and `--resume=<id>`
to resume a specific session. Our transcript-from-JSONL path still works
because we compute the session file path ourselves and read it directly, but
we are not actually telling omp where to write. Filed as follow-up.

## Verdict

Against the **written UX capabilities** of pi-web-ui v0.15.0:
we match ~70% of the features and exceed on containment, journal-based
protocol, PTY isolation, resource bounds, and terminal polish (rename,
shortcuts, export/import). The largest missing categories are: **slash-command
palette**, **model/provider control**, **input-request modal**, and **i18n**.

Against the **real omp backend**: we cover the streaming/tool/reask/terminal
surfaces cleanly, but we do not yet handle two frame types omp emits on every
startup (`extension_ui_request` and `available_commands_update`). Closing
those is the highest-value next work item.

## 2026-08-11 re-baseline — pi-web-ui 0.15.0 → 0.17.1, omp 17.2.12 → 17.2.13

Both upstreams moved since the original comparison. Method: `npm pack` of
`pi-web-ui@0.15.0` and `pi-web-ui@0.17.1`, string/identifier diff of
`dist/server/agent-service.js`, `dist/server/index.js`, and the web bundles;
`npm pack` of `@oh-my-pi/pi-coding-agent@17.2.13` and a file-level diff of
`dist/` against the installed 17.2.12.

### omp 17.2.12 → 17.2.13: no protocol drift

47 files changed, but `dist/types/modes/rpc/rpc-types.d.ts` is **byte-identical**.
The one RPC-touching changelog entry ("Fixed RPC `message_end` frames being
serialized more than once before output") explicitly "preserv[es] v1 and v2 wire
bytes". Everything else is TUI rendering, advisor internals, provider/search
features, and bug fixes that do not touch the frame surface we consume.

Local omp upgraded to 17.2.13 and the full battery re-run against it:

| Suite | Result |
| --- | --- |
| daemon `bun test` | 43/43 |
| web `vitest run` | 56/56 |
| web `tsc --noEmit` + `vite build` | clean |
| Playwright default (real omp 17.2.13 + stub-llm) | 17/17 |
| Playwright terminal | 1/1 |

### pi-web-ui 0.15.0 → 0.17.1: what actually changed

The README was restructured (shorter), but bundle-level diff shows the real
feature deltas:

1. **Native slash-command palette + server-side execution.** The server now
   broadcasts a `slash_commands` catalog (native builtins + `skill:*` +
   extension + template + prompt sources) and executes native commands
   itself (`/new`, `/model`, `/compact`, `/cwd`, `/thinking`, `/resume`,
   `/reload`, `/help`, `/copy`) without passing them to the SDK. The web UI
   gained a sectioned slash menu (↑↓ select, Enter/Tab complete, "type /
   anytime" hint). **Our position:** we shipped the equivalent in Phase 8 —
   palette fed by omp's `available_commands_update`, which is arguably the
   more correct architecture for us since omp owns command semantics.
   ✅ parity held.
2. **`file_changed` server push.** The server `fs.watch`es the currently
   listed directory (one level) and pushes `file_changed` so the file-listing
   panel refreshes instantly instead of on the 10 s poll. This is an
   incremental improvement to their **workspace file browser panel**, which
   we do not have at all (pre-existing gap, now slightly larger). ❌ gap
   (unchanged classification: file browser is the gap; watch-push is polish
   on top of it).
3. **Questions nav bar** ("问题列表"/"Questions") — a side bar listing every
   user question in the conversation with click-to-jump (`data-msg-id`
   anchors + `msg-flash` highlight). New minor UX feature. ❌ new minor gap.
4. **`nginx-subpath.conf`** deploy artifact. N/A for us (deploy deferred).
5. No features were removed (no removed UI strings; only an internal
   `followUp` identifier disappeared from the server).

Features we previously recorded as gaps (model/provider CRUD panel, path
autocomplete, thinking-level control, recent-projects MRU, sound, i18n) all
still exist in 0.17.1 — gap list below remains accurate.

### Updated honest gap list (post-re-baseline)

| # | Gap | Status vs 0.17.1 |
| --- | --- | --- |
| 1 | Slash-command palette | ✅ shipped (Phase 8), parity held vs their new native palette |
| 2 | `extension_ui_request` handling | ✅ shipped (all 11 methods, this session) |
| 3 | Model picker + thinking-level control | ✅ shipped 2026-08-11 — ModelPickerDialog (provider-grouped, metadata-rich, full 7-level thinking range) + `model.cycle`/`thinking.cycle` daemon passthroughs; verified live against omp 17.2.13 (daemon test `model-commands.test.ts`, 9 web unit tests, happy-path E2E rewritten to drive the dialog) |
| 4 | Input-request dialogs | ✅ shipped (this session) |
| 5 | Provider/model CRUD | ✅ shipped 2026-08-11 — daemon `provider.list/add/remove` + `model.add/remove` write omp's `models.yml` (schema verified against installed 17.2.13 zod types; `yaml` pkg, atomic tmp+rename writes, apiKey never sent to the browser); idle ready workers are stopped post-write so the next spawn reloads (omp has no models.yml watcher — verified against dist/cli.js watch sites). Web: Providers drawer tab (list/add/remove provider + models, key field, `providers.changed` broadcast). E2E adds a provider, selects its model in the picker, serves a real turn through it, then removes it |
| 6 | Workspace file browser panel (+ their new `file_changed` push) | ✅ shipped 2026-08-11 — FileTreePanel (navigable dirs-first tree, preview + add-to-conversation per entry) backed by daemon `file.list` (boundary-contained, 500-entry cap) and a debounced non-recursive fs.watch that pushes `file.changed` to the listing client; E2E verifies external writes refresh the tree without reload |
| 7 | Questions nav bar | ✅ shipped 2026-08-11 — Questions drawer tab lists user messages with click-to-jump (`data-msg-id` anchors + `msg-flash` highlight), mirroring pi-web-ui's 问题列表 |
| 8 | Recent-projects MRU switcher | ✅ shipped 2026-08-11 — localStorage-backed MRU (8 entries, deduped, most-recent-first) recorded centrally on every workspace open, rendered in Sidebar with click-to-reopen |
| 9 | Path autocomplete | ✅ shipped 2026-08-11 — daemon `path.complete` (host-dir completion, `~` expansion, hidden/node_modules filtered, 50-result cap) feeding a datalist on the open-path input |
| 10 | i18n scaffold | ❌ open |
| 11 | Sound effects | ❌ open (nice-to-have) |
| 12 | Reference-mode attachments | ❌ open |

Non-goals confirmed unchanged: system-service installers, Docker, self-update
panel, cross-platform service managers (their 0.17.x `server` subcommand work
is all in this deferred category).
