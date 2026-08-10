# API stability assessment: coding-agent RPC and collab-web

## What is actually versioned

The coding-agent RPC has an explicit protocol negotiation mechanism, not a separately versioned schema package: the `ready` frame advertises `protocolVersion: 1`, `supportedProtocolVersions: [1, 2]`, and size limits; the client sends `negotiate_protocol` (`packages/coding-agent/src/modes/rpc/rpc-types.ts:28-45,144-159`; `rpc-mode.ts:690-703`). Version 2 is specifically the chunk-capable framing mode (`rpc-frame.ts:5-10,135-259`).

This protects the physical-frame encoding transition. It does **not** itself freeze the full `RpcCommand`, event, extension request, or session-event schema: those are TypeScript unions in the package source (`rpc-types.ts:28-544`). Treat unknown frames, new event types, optional fields, and optional error `code` as normal forward-compatibility cases.

## Changelog signals

The coding-agent changelog records protocol evolution, including v2/chunking work and malformed-frame handling (`packages/coding-agent/CHANGELOG.md:774-776,938,950`). These are concrete signals that framing semantics have changed within the project’s release history. They are not a declaration of a long-lived external compatibility guarantee.

## Pinning assessment: `@oh-my-pi/pi-coding-agent@17.2.12`

`@oh-my-pi/pi-coding-agent` is publishable and declares version `17.2.12` (`packages/coding-agent/package.json:2-5`). An exact pin is a reasonable reproducibility starting point, but it carries the following risks:

1. **Schema growth outside protocol-version bumps.** RPC v1/v2 negotiates framing capability, while command and event unions can add cases in source without a new transport version (`rpc-types.ts:28-544`).
2. **Frame behavior is protocol-significant.** A client that never negotiates v2 is limited to v1 shrink/overflow behavior; a v2 client must implement ordered chunk reassembly and 64 MiB limits (`rpc-frame.ts:135-259`; `rpc-client.ts:335-348`).
3. **Package version does not make internal file paths public API.** The source has no statement in the package metadata that `src/modes/rpc/*` is a stable SDK surface (`packages/coding-agent/package.json:2-38`). Integrate against the JSONL contract, not imports from those files.
4. **Extensions are not web-component portable.** Terminal UI hooks exceed the RPC declarative UI union; upgrading extensions can introduce terminal features that a WebUI cannot represent (`docs/extensions.md:375-477`; `rpc-types.ts:372-428`).
5. **collab-web is not a matched released dependency.** It is private at `16.3.6`, while coding-agent is `17.2.12`; pinning coding-agent does not pin or validate collab-web behavior (`packages/collab-web/package.json:2-5`; `packages/coding-agent/package.json:2-5`).
6. **Separate relay protocol.** Collab uses pi-wire `COLLAB_PROTO = 3`, rather than coding-agent JSONL RPC versions 1/2 (`packages/wire/src/index.ts:301-397`; `rpc-types.ts:144-159`). A local daemon must intentionally choose one boundary or implement an adapter.

## Documentation/code discrepancies and implementation rules

| Finding | Evidence | Action |
|---|---|---|
| Session location prose is stale. | Docs describe hash-style session directories as current (`docs/session.md:35-63`); code marks that scheme legacy and computes encoded paths for current sessions (`session-paths.ts:45-60,185-196`). | Locate sessions through the code’s resolver and support legacy paths for migration. |
| Extension docs describe a broader terminal UI than RPC can serialize. | Terminal component/render-hook docs (`docs/extensions.md:375-477`) versus finite primitive request union (`rpc-types.ts:372-428`) and bridge filtering (`rpc-mode.ts:793-940`). | Implement only `RpcExtensionUIRequest` in WebUI; provide a visible unsupported-UI fallback. |
| “One JSON line = one event” is not valid after negotiation. | JSONL transport statement (`rpc-types.ts:1-6`) versus v2 chunk rules (`rpc-frame.ts:135-259`). | Buffer/decode chunk frames before dispatching logical events. |
| `collab-web` is not an RPC reference client. | It uses pi-wire collaboration protocol (`packages/wire/src/index.ts:301-397`) and is private (`packages/collab-web/package.json:2-5`). | Reuse view code only behind adapters; do not copy its socket/client layer for coding-agent RPC. |

## Release-gate recommendation

Pin `@oh-my-pi/pi-coding-agent` exactly to `17.2.12`; record a fixture set containing ready/v1, ready+v2, chunked terminal event, failed response with `code`, host-tool request, host-URI request, and every extension UI method. Before any upgrade, diff `rpc-types.ts`, `rpc-frame.ts`, and `rpc-mode.ts` against the pinned revision and run those fixtures. This is justified by the finite type surface (`rpc-types.ts:28-544`) and the changelog’s history of RPC framing change (`CHANGELOG.md:774-776,938,950`), rather than an assumed semver stability promise.
