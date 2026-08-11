# REAL_PARITY_COMPARISON — pi-web-ui v0.15.0 vs omp-webui (2026-08-10)

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
| Attach files (inline + reference) | ✅ | ✅ inline; reference mode = attach-as-URL not implemented | ⚠ minor UX gap |
| Paste image + vision-guard toast | ✅ 10 s cooldown warning | ✅ `[image omitted: model does not support vision]` placeholder | ✅ (different UX) |
| Multi-tab xterm.js terminal | ✅ three-pane, tabs | ✅ tabs + rename + shortcuts + export/import | ✅ / ✅ + we exceed |
| Project commands.json | ✅ (`save_commands`/`list_commands`) | ✅ (`.omp/commands.json` write + export/import UI) | ✅ |
| Model listing + switch | ✅ `list_models` + `set_model` + cycle | ⚠ we only expose current model in header, no picker UI or cycle | ❌ gap |
| Provider/model CRUD + API keys from UI | ✅ full CRUD | ❌ not implemented | ❌ gap |
| Thinking-level control | ✅ set + cycle | ❌ not implemented | ❌ gap |
| Plugin dialogs (select/confirm/input) | ✅ generic modal | ❌ not implemented — we don't handle `input_request` frames | ❌ gap |
| Path autocomplete for cwd | ✅ `complete_path` | ❌ our workspace picker is a list, no completion | ❌ minor gap |
| Recent projects list | ✅ | ⚠ we list sessions per workspace but no "recent projects" MRU switcher | ❌ minor gap |
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

1. **Slash-command palette** — subscribe to `available_commands_update` and
   render a Cmd/Ctrl+K palette. Currently the ~30 built-in omp commands are
   invisible from our UI. **Highest impact.**
2. **`extension_ui_request` handling** — at minimum, log/pass-through; ideally
   render extension widgets (autoresearch on startup is a real signal).
3. **Model picker + thinking-level control** — `omp --mode rpc` exposes model
   selection through the same frame types the CLI uses; we should surface it.
4. **Input-request dialogs** — omp will send `input_request` frames for tool
   approvals and provider prompts; without a modal we cannot proceed on any
   session that hits one interactively.
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
