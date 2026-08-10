# Oh My Pi 17.2.12 repository map

## Scope and method

This is a static inventory of `/home/user/workspace/oh-my-pi-upstream`. A package is classified **npm-publishable** only when its own `package.json` has `"private": false`; **workspace-only** means `"private": true`. This is deliberately a publish-permission classification, not evidence that a particular release was actually published.

## JavaScript/TypeScript packages

| Directory | npm name | Version | `private` | Classification |
|---|---|---:|---:|---|
| `packages/agent` | `@oh-my-pi/pi-agent-core` | 17.2.12 | false | npm-publishable |
| `packages/ai` | `@oh-my-pi/pi-ai` | 17.2.12 | false | npm-publishable |
| `packages/browser-relay` | `@oh-my-pi/browser-relay` | 0.1.0 | true | workspace-only |
| `packages/catalog` | `@oh-my-pi/pi-catalog` | 17.2.12 | false | npm-publishable |
| `packages/coding-agent` | `@oh-my-pi/pi-coding-agent` | 17.2.12 | false | npm-publishable |
| `packages/collab-web` | `@oh-my-pi/collab-web` | 16.3.6 | true | workspace-only |
| `packages/hashline` | `@oh-my-pi/hashline` | 17.2.12 | false | npm-publishable |
| `packages/metaharness` | `@oh-my-pi/pi-metaharness` | 0.0.1 | true | workspace-only |
| `packages/mnemopi` | `@oh-my-pi/pi-mnemopi` | 17.2.12 | false | npm-publishable |
| `packages/natives` | `@oh-my-pi/pi-natives` | 17.2.12 | false | npm-publishable |
| `packages/omptype` | `@oh-my-pi/omptype` | 17.2.12 | false | npm-publishable |
| `packages/snapcompact` | `@oh-my-pi/snapcompact` | 17.2.12 | false | npm-publishable |
| `packages/stats` | `@oh-my-pi/omp-stats` | 17.2.12 | false | npm-publishable |
| `packages/tui` | `@oh-my-pi/pi-tui` | 17.2.12 | false | npm-publishable |
| `packages/typescript-edit-benchmark` | `@oh-my-pi/typescript-edit-benchmark` | 0.0.1 | true | workspace-only |
| `packages/utils` | `@oh-my-pi/pi-utils` | 17.2.12 | false | npm-publishable |
| `packages/wire` | `@oh-my-pi/pi-wire` | 17.2.12 | false | npm-publishable |

**Evidence.** Each row is directly declared by the corresponding `packages/<directory>/package.json:2-5` (`name`, `version`, and `private`). The root workspace includes `packages/*` and `python/robomp/web` in `package.json:11-15`; the root is itself private in `package.json:2-5`. The release script uses `npm publish -ws --access public` in `package.json:161-164`, so package-local `private` is the controlling exclusion mechanism.

## Rust crates

| Directory | Crate package name | Version source | Notes |
|---|---|---|---|
| `crates/pi-ast` | `pi-ast` | workspace 17.2.12 | Workspace member. |
| `crates/pi-builtins` | `pi-builtins` | 0.8.0 | Explicit crate version. |
| `crates/pi-iso` | `pi-iso` | workspace 17.2.12 | Workspace member. |
| `crates/pi-natives` | `pi-natives` | workspace 17.2.12 | Native target built by Bazel. |
| `crates/pi-shell` | `pi-shell` | workspace 17.2.12 | Workspace member. |
| `crates/pi-voice` | `pi-voice` | workspace 17.2.12 | Workspace member. |
| `crates/pi-walker` | `pi-walker` | workspace 17.2.12 | Workspace member. |
| `crates/vendor/brush-core` | `brush-core` | 0.5.0 | Vendored workspace member. |

**Evidence.** The Cargo workspace member patterns are `crates/pi-*` and `crates/vendor/*`; it sets workspace version `17.2.12`, edition `2024`, and resolver `3` in `Cargo.toml:1-7`. Individual names/version inheritance are in each crate's `Cargo.toml` package section (for example, `crates/pi-natives/Cargo.toml:1-8` and `crates/vendor/brush-core/Cargo.toml:1-8`).

## Build-system boundaries

1. **Bun workspace and scripts.** The root selects `bun@1.3.14` (`package.json:6`), defines the workspace (`package.json:11-15`), central dependency catalog (`package.json:26-93`), and workspace build/test scripts including `build:workspaces` (`package.json:95-159`).
2. **npm packaging.** Publishable packages use their own package metadata above; the root's workspace publication command is `npm publish -ws --access public` (`package.json:161-164`). The root package cannot itself be published because it is private (`package.json:2-5`).
3. **Cargo.** Rust is a separate Cargo workspace, not a Bun package subproject; Cargo glob membership and shared package settings are in `Cargo.toml:1-7`.
4. **Bazel.** Bazel's module declares native-side dependencies and crate-universe configuration in `MODULE.bazel:1-19`. The root `BUILD.bazel:1-34` provides the `pi-natives` native build targets. This is complementary to Cargo rather than a replacement for the Bun workspace.

## Practical boundary for OMP WebUI

Use `@oh-my-pi/pi-coding-agent` and `@oh-my-pi/pi-wire` as the two published JavaScript packages most relevant to protocol integration. Do not assume `@oh-my-pi/collab-web` is installable: it is explicitly private and is also at `16.3.6`, unlike the upstream `17.2.12` package set (`packages/collab-web/package.json:2-5`; `packages/coding-agent/package.json:2-5`).
