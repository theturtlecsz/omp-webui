# OMP WebUI tool and extension compatibility layer

## Goals and boundary

OMP WebUI renders tool activity from normalized RPC/session events. It reuses the upstream principle that every tool call remains readable even when its name is unknown, but it does not execute terminal UI components in the browser. The boundary is intentionally one-way: OMP/runtime/extension code supplies JSON data; the WebUI selects trusted built-in renderers or a generic model; browser interactions return only explicitly permitted RPC responses or action events.

The compatibility model has four levels. Each higher level is opt-in and may fall back to every lower level.

| Level | Contract | Availability | Trust model |
| --- | --- | --- | --- |
| L1 | Universal generic fallback | Required | Any normalized tool event |
| L2 | Built-in renderer registry | Required platform API | WebUI-bundled, trusted code only |
| L3 | Declarative WebView schema | Supported after validation | JSON data only; no code/functions/HTML |
| L4 | Sandboxed iframe extension app | Design only; disabled by default | Separate opaque origin and narrow message protocol |

## L1 — universal generic fallback

`buildGenericToolModel(toolEvent)` is the non-React source of truth for a card that can display **any** tool event. It must never throw, including when an extension emits malformed data or a newer runtime adds fields.

The model always includes:

- call id and tool name, with `unknown-call` / `unknown tool` fallbacks;
- normalized state and an error flag;
- pretty-printed arguments;
- text extracted independently from `partialResult` and `result`, including agent-shaped `content: [{ type: "text", text }]` arrays;
- an error message when one is available, or a safe error fallback;
- start/end timestamps and duration when both timestamps can be parsed; and
- safe JSON for an expandable raw-event inspector.

The generic UI must show tool name, state, arguments when non-empty, partial/final output, errors, and the raw inspector. It must never hide a call merely because a specialized renderer is absent. Images, terminal component trees, and arbitrary binary payloads are not rendered by L1; the raw inspector and artifact references remain available.

## L2 — trusted built-in renderer registry

The registry is intentionally presentation-framework-neutral:

```ts
interface ToolRendererProps {
  toolCallId: string;
  toolName: string;
  args: unknown;
  state: "pending" | "running" | "completed" | "error" | "cancelled" | "unknown";
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
  startedAt?: string | number | Date;
  endedAt?: string | number | Date;
}

interface ToolRenderer {
  (props: ToolRendererProps): unknown;
}

registerToolRenderer(name, renderer);
resolveToolRenderer(toolName);
```

A renderer returns a model chosen by the WebUI shell; it is not a React component contract. Only code shipped with the WebUI may call `registerToolRenderer`. Extensions and custom tools must not gain arbitrary JavaScript rendering rights through this registry.

### Renderer selection algorithm

1. Take the wire `toolName`. If it is not a string, use L1.
2. Normalize it as described below and resolve aliases.
3. Look up the canonical name in the trusted registry.
4. If a renderer is registered, invoke it with the normalized event props. The UI host should catch renderer failures and render L1 instead.
5. If no renderer is registered, use `genericToolRenderer`, which builds the L1 model.
6. A renderer may itself choose to validate and render an L3 WebView; validation failure returns to L1 or a renderer-specific safe diagnostic.

Registration is last-write-wins so application bootstrap can replace a stock renderer deliberately. It is not a runtime extension feature.

### Tool-name normalization and aliases

Normalization trims leading/trailing whitespace, lowercases, and replaces runs of spaces, dots, slashes, and hyphens with one underscore. Existing underscores are preserved, including double underscores in MCP names such as `mcp__filesystem__delete`.

Examples:

| Wire name | Canonical lookup |
| --- | --- |
| ` Bash ` | `bash` |
| `web-search` | `web_search` |
| `mcp__filesystem__delete` | unchanged |
| `shell`, `sh`, `command` | `bash` |
| `apply_patch` | `edit` |
| `find` | `glob` |
| `search` | `grep` |
| `puppeteer` | `browser` |
| `js`, `javascript`, `python`, `notebook` | `eval` |
| `await`, `poll`, `cancel_job` | `job` |

Aliases are a compatibility aid for old transcripts and known wire equivalents. Unknown names are never rejected or hidden: they are normalized only for a lookup and then use L1 unchanged in the display model when no renderer matches.

## L3 — declarative WebView

`webview.ts` defines a JSON-safe `WebView` union and `validateWebView(input)`. It supports these kinds:

- `markdown`, `code`, `diff`, `table`, `progress`, `keyValue`, `list`, `links`, `artifacts`, `form`, and `status`;
- typed form fields: `text`, `textarea`, `password`, `select`, and `checkbox`; and
- declarative action descriptors (`id`, label, visual style, disabled state, optional confirmation copy).

Actions only carry opaque IDs. The renderer must never evaluate a script, invoke a URL automatically, trust HTML, or interpret an action ID as a command. A host decides which action IDs are available for a particular tool and sends a constrained event/response after any required confirmation.

The validator returns a sanitized typed object or `null`. `validateWebViewDetailed` and `webViewValidationError` expose stable rejection reasons for telemetry and tests. It rejects unknown kinds, malformed fields, non-finite numeric values, arrays above 10,000 entries, table payloads above 10,000 total cells, and strings above 1,000,000 characters. Unknown object keys are dropped rather than passed through, enabling a safe reader to ignore future metadata.

L3 is appropriate for custom tools that want structured output without asking the browser to load extension code. Browser rendering still applies normal safety policies: markdown is rendered with an HTML sanitizer, links require an allowed navigation policy, artifacts require host-mediated access, and form submissions contain only validated primitive values.

## L4 — sandboxed iframe extension app (design only)

L4 is disabled by default and is not implemented by this work. It exists only for a future opt-in extension-app capability that L3 cannot cover.

When enabled, an extension app receives a dedicated iframe with no same-origin privilege, no ambient WebUI auth/session tokens, no direct RPC socket, and a strict Content Security Policy. Use a unique opaque origin (`sandbox` without `allow-same-origin`), disallow top-level navigation/popups/downloads unless a host-mediated request is approved, and restrict `postMessage` to a versioned allowlist:

- host → app: initial immutable data, theme tokens, resize limits, lifecycle/cancellation state;
- app → host: `ready`, validated height request, opaque declarative action request, and diagnostic message;
- no app-originated tool execution, filesystem access, arbitrary URL launch, or unbounded data transfer.

The host validates message shape, correlates requests with a tool-call id and nonce, rate-limits them, applies explicit user confirmation where required, and tears down the iframe on completion/cancel. L4 must never replace L1: when disabled, blocked, incompatible, or crashed, show the generic tool card plus a visible “extension app unavailable” note.

## Extension UI mapping

The upstream RPC transport exposes a finite `extension_ui_request` union. OMP WebUI treats dialog requests as modal browser interactions, returning one `extension_ui_response` correlated by `id`; it treats fire-and-forget requests as local state/UI updates.

| RPC method | Browser treatment | Reply/behavior |
| --- | --- | --- |
| `select` | Accessible modal with options, keyboard navigation, explicit cancel, and a visible timeout countdown when supplied. | Selected label: `{ value }`; cancel/timeout: `{ cancelled: true, timedOut? }`. |
| `confirm` | Modal showing title and untrusted message as text, with explicit Confirm/Cancel buttons. | `{ confirmed: boolean }`, or cancelled on dismissal/timeout. |
| `input` | Single-line modal input; placeholder is hint text, not a value. | `{ value }` or cancelled. |
| `editor` | Multi-line modal editor populated from `prefill`; `promptStyle` affects appearance only. | `{ value }` or cancelled. |
| `notify` | Toast/activity notification with info, warning, or error styling. | No response. |
| `setStatus` | Keyed status strip/extension activity panel; undefined clears the key. | No response. |
| `setWidget` | Keyed, text-only panel above or below the browser composer; preserve placement and cap visible lines. Clearing removes it. | No response. |
| `setTitle` | Update the WebUI document/session title only; never infer OS terminal control. | No response. |
| `set_editor_text` | Replace the WebUI composer text after respecting unsaved-draft policy. | No response. |
| `open_url` | Show a link/copy affordance and require host navigation policy; prefer `launchUrl` as the copy target when present. | No implicit navigation. |
| `cancel` | Dismiss/cancel the pending correlated browser dialog. | Complete the target using the standard cancelled reply when applicable. |

Dialog title/message/options/prefill text is untrusted extension data: render it as text, not HTML, and do not allow it to override WebUI safety policy. Timeouts must start when the dialog is actually shown; if a queued dialog becomes stale, respond with `cancelled: true, timedOut: true` rather than silently using a default.

## Terminal-only UI capabilities and browser equivalents

The extension docs describe an interactive terminal UI that is broader than the RPC bridge. Compatibility is based on the finite RPC request union, not on arbitrary terminal components.

| Extension capability | Browser status | Rationale / equivalent |
| --- | --- | --- |
| `select`, `confirm`, `input`, `editor` | Supported | Browser dialogs as mapped above. |
| `notify` | Supported | Toast/activity notification. |
| `setStatus` | Supported | Keyed status panel/strip. |
| `setWidget` with `string[]` | Supported | Text-only composer-adjacent widget; no terminal component factory. |
| `setTitle` | Supported with different target | Browser document/session title; not the terminal window title. |
| `setEditorText` / `pasteToEditor` | Supported with browser semantics | Composer replacement/paste; RPC currently carries `set_editor_text`. |
| `open_url` | Supported with host policy | Link/copy action, never automatic privileged navigation. |
| `getEditorText` | Browser-local only | The runtime RPC implementation cannot synchronously request it; WebUI may use local composer state but cannot promise it to an extension. |
| `onTerminalInput` | Unsupported | No raw terminal byte stream exists in a browser. |
| custom component overlays (`custom`), `setEditorComponent` | Unsupported at L1–L3 | Terminal component code is not serializable; future L4 would be separately sandboxed. |
| `setFooter`, `setHeader` | Unsupported | Terminal layout replacement has no portable RPC representation. |
| `setWorkingMessage` | Unsupported from RPC | It is a runtime RPC no-op; the WebUI controls its own activity copy. |
| `addAutocompleteProvider` | Unsupported | Browser composer providers are host-owned and cannot run extension code. |
| `setTheme`, theme loading/listing | Unsupported as extension control | WebUI theme is host-owned; extension content receives theme tokens only. |
| tool expansion controls | Host-local only | WebUI may expose user preferences but does not accept extension control. |
| `renderCall`, `renderResult`, custom message/thinking renderers | Terminal-only | These return pi-tui components, not transportable browser data. Use L3 instead. |

## Approval and question flow

Tool approval remains a runtime decision, not a rendering decision. When the backend asks for approval, the browser must show the exact tool name, tier/reason, and bounded tool-specific details; an unknown custom tool is treated as `exec` by the upstream approval policy. The UI must not treat tool output or extension-provided display text as authorization for real-world actions. For consequential operations, retain point-of-risk confirmation of the exact target, scope, and values.

The `ask` tool and `extension_ui_request` dialogs are question flows, not approval bypasses. They use the same accessible modal infrastructure but remain distinct event types and response contracts.

## Frontend implementation contract

A frontend renderer should:

1. normalize inbound tool lifecycle events once into `ToolRendererProps`/`NormalizedToolEvent`;
2. call `resolveToolRenderer(toolName)` and catch renderer failures at the card boundary;
3. render the L1 generic model whenever selection, a specialized renderer, or WebView validation fails;
4. validate every L3 payload before creating DOM nodes; and
5. keep L4 disabled unless a separately reviewed capability, CSP, permission UI, and message protocol are implemented.
