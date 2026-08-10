# Extension API and RPC UI bridge

## Loading and custom tools

Extension loading accepts a module factory exported as `default`, and that factory can return a promise (`docs/extension-loading.md:206-213`). The documented custom-tool API supplies definition/execute behavior and is registered in an extension (`docs/custom-tools.md:3-60`; `docs/extensions.md:303-371`). The broader runtime contract is `ExtensionUIContext` in `packages/coding-agent/src/extensibility/extensions/types.ts:229-344`.

## Terminal-only versus declarative UI

Extensions can render terminal TUI content through call/result render hooks and component/widget facilities (`docs/extensions.md:375-477`; `extensions/types.ts:207-215`). The RPC bridge does **not** serialize arbitrary components: it converts its supported UI calls to primitive `extension_ui_request` frames and reports bridge errors as `extension_error` (`packages/coding-agent/src/modes/rpc/rpc-mode.ts:793-940`). A browser must therefore treat terminal-component content as terminal-only, while implementing the finite request union below.

## Exact `extension_ui_request` surface

`RpcExtensionUIRequest` in `packages/coding-agent/src/modes/rpc/rpc-types.ts:372-428` is authoritative. Every arm includes `type: "extension_ui_request"` and `id: string`.

| Method | Exact payload fields |
|---|---|
| `select` | `title: string`, `options: string[]`, `timeout?: number` |
| `confirm` | `title: string`, `message: string`, `timeout?: number` |
| `input` | `title: string`, `placeholder?: string`, `timeout?: number` |
| `editor` | `title: string`, `prefill?: string`, `promptStyle?: boolean` |
| `notify` | `message: string`, `notifyType?: "info" \| "warning" \| "error"` |
| `setStatus` | `statusKey: string`, `statusText: string \| undefined` |
| `setWidget` | `widgetKey: string`, `widgetLines: string[] \| undefined`, `widgetPlacement?: "aboveEditor" \| "belowEditor"` |
| `setTitle` | `title: string` |
| `set_editor_text` | `text: string` |
| `open_url` | `url: string`, `launchUrl?: string`, `instructions?: string` |
| `cancel` | `targetId: string` |

Preserve literal discriminants: `setStatus`, `setWidget`, and `setTitle` are camel case, while `set_editor_text` is snake case (`rpc-types.ts:372-428`).

The host returns `RpcExtensionUIResponse`: exactly a string `value`, boolean `confirmed`, or `cancelled: true` with optional `timedOut`, each correlated by `id` (`rpc-types.ts:535-538`). Use a promise broker for select/confirm/input/editor; render notify/status/widget/title/editor text/URL as state/action frames.

## Documentation/code reconciliation

The docs accurately describe the full terminal extension API, but its component facilities are broader than the RPC transport. WebUI compatibility is therefore defined by `RpcExtensionUIRequest`, not by terminal renderer documentation (`docs/extensions.md:375-477`; `rpc-types.ts:372-428`).
