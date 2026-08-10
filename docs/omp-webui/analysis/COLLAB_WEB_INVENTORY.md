# `packages/collab-web` inventory and reuse assessment

## Package role and build/test/style baseline

`@oh-my-pi/collab-web` is private at version `16.3.6` (`packages/collab-web/package.json:2-5`). It is a Bun/React application: its scripts use Bun for dev/build/test (`package.json:6-38`), and its README states that it is a standalone collaboration web client with an interop test against `@oh-my-pi/pi-wire` (`packages/collab-web/README.md:30-37`).

Tests are Bun tests under `test/`, with a transcript DOM shim and protocol/UI-focused tests (`package.json:32-38`; `packages/collab-web/test/`). There is no Tailwind configuration in this package; styling is authored CSS imported by components, including `transcript.css`, `shell.css`, `agents.css`, and `tool-render.css` (`src/components/transcript/transcript.css`, `src/components/shell/shell.css`, `src/components/agents/agents.css`, `src/tool-render/tool-render.css`).

## Component inventory

| Area | Files/components |
|---|---|
| Transcript | `src/components/transcript/{Transcript,Markdown,ToolCard}.tsx` plus `transcript.css`. |
| Shell | `src/components/shell/{Banners,Composer,ConnectScreen,HeaderBar,ThemeToggle,Toasts}.tsx` plus `shell.css`. |
| Agents | `src/components/agents/{AgentDrawer,AgentsPanel}.tsx` plus `agents.css`. |
| Tool render infrastructure | `src/tool-render/{ToolView,element,generic,index,parts,registry,standalone,types,util}.tsx`/`.ts` plus `tool-render.css`. |
| Tool-specific renderers | `src/tool-render/tools/{ask,ast-edit,ast-grep,bash,browser,debug,edit,eval,fetch,generate-image,github,glob,goal,grep,hub,inspect-image,irc,job,lsp,memory-recall,memory-reflect,memory-retain,read,report-tool-issue,resolve,task,todo,web-search,write,yield}.tsx`. |

This is a source-tree inventory; names are taken from the files in the package and are assembled through `src/tool-render/registry.ts:1-85` and the component barrel/import graph.

## Data layer and relay protocol

| Module | Responsibility | Coupling |
|---|---|---|
| `src/lib/client.ts` | `GuestClient` holds immutable guest/session snapshots and translates client actions to wire frames. | High: uses `@oh-my-pi/pi-wire` host/guest protocol types. |
| `src/lib/socket.ts` | WebSocket lifecycle, reconnect behavior, and encrypted message transport. | High: relay transport assumptions. |
| `src/lib/codec.ts` | AES-256-GCM message sealing/opening codec. | High: relay-compatible encryption envelope. |
| `src/lib/use-guest.ts` | React subscription hook for `GuestClient` snapshots. | Medium/high: convenient only when retaining the client model. |
| `src/lib/format.ts`, `jsonl.ts`, `link.ts`, `theme.ts`, `transcript-poll.ts` | Formatting, JSONL helpers, links, theme, and transcript refresh utilities. | Mixed; inspect individually before vendoring. |

The protocol is defined by `@oh-my-pi/pi-wire`; `COLLAB_PROTO` is `3` (`packages/wire/src/index.ts:301-397`). `collab-web` speaks guest/host relay frames, not the coding-agent JSONL RPC described in `RPC_INVENTORY.md`; client action/state handling is in `src/lib/client.ts` and framing/crypto are in `src/lib/socket.ts` and `src/lib/codec.ts`.

## Tool renderer registry API

The registry is static—not a plugin registry. Its only exported lookup is:

```ts
export function resolveToolRenderer(name: string): ToolRenderer;
```

The `RENDERERS: Record<string, ToolRenderer>` map is module-private (`src/tool-render/registry.ts:38-85`). It maps current tool names and aliases to renderer functions; there is **no exported `register` API**. Unknown names resolve to `genericRenderer` (`registry.ts:83-85`; `generic.tsx`).

`ToolRenderProps` is `{ name: string; args: Record<string, unknown>; result?: ToolResultLike; running?: boolean; host?: ToolRenderHost }`; `ToolRenderer` is `{ Summary: ComponentType<ToolRenderProps>; Body?: ComponentType<ToolRenderProps> }` (`src/tool-render/types.ts:134-150`). `ToolViewProps` is `{ name: string; args?: unknown; result?: ToolResultLike; running?: boolean; intent?: string; partial?: string; defaultOpen?: boolean; host?: ToolRenderHost }` (`src/tool-render/ToolView.tsx:164-177`). `ToolView` resolves the renderer and normalizes `args`, including pi-wire's intent field, so a new backend needs either `@oh-my-pi/pi-wire` or an adapter that produces equivalent intent/tool fields (`ToolView.tsx:156-177` and implementation below that declaration).

## Reuse assessment for a local-daemon WebSocket app

| Candidate | Reuse decision | Reason/action |
|---|---|---|
| `tool-render/tools/*`, `generic.tsx`, `parts.tsx`, `util.ts`, `types.ts`, CSS | **Good vendor candidate** | Renderer components are presentation-oriented. Vendor them as a coherent set; retain/adapt the pi-wire intent/tool data dependency. |
| `ToolView.tsx` and `registry.ts` | **Good with adapter** | Static name→renderer selection is useful, but `ToolView` expects pi-wire’s intent field and registry is not dynamically extensible. Add a facade or fork registry if runtime registration is needed. |
| `Transcript`, `Markdown`, `ToolCard` | **Moderate candidate** | Useful React views, but their entry props use pi-wire session/transcript shapes. Introduce local view models/adapters at the boundary. |
| `AgentsPanel` | **Moderate candidate** | Mostly display logic, but input state is guest protocol shaped. |
| `AgentDrawer`, shell components, `App` | **Poor direct reuse** | Composer/connection flow assumes `GuestClient`, relay actions, and collaboration state. Rebuild against the daemon’s connection/session model. |
| `lib/client.ts`, `socket.ts`, `codec.ts`, `use-guest.ts` | **Do not vendor for a different backend** | These implement the collaboration relay’s guest protocol, reconnect flow, and AES envelope. Reuse only if the local daemon intentionally implements `@oh-my-pi/pi-wire` protocol version 3. |

## Recommended boundary

A new React app talking to coding-agent RPC should adopt the visual layer, define its own normalized `TranscriptItem`/`ToolInvocation` models, and translate JSONL RPC events into those models. Do not expose collab `GuestClient` throughout the app. The source README’s standalone/interop claim is compatible with this conclusion: it indicates package separation, not transport compatibility (`packages/collab-web/README.md:30-37`; `packages/wire/src/index.ts:301-397`).
