# Tool / extension compatibility layer handoff

## Files written

- `docs/omp-webui/TOOL_UI.md`
- `packages/web/src/tool-render/webview.ts`
- `packages/web/src/tool-render/registry.ts`
- `packages/web/src/tool-render/generic-model.ts`
- `packages/web/test/tool-render/webview.test.ts`
- `packages/web/test/tool-render/generic-model.test.ts`

## APIs added

- `validateWebView(input): WebView | null`
- `validateWebViewDetailed(input): WebViewValidationResult`
- `webViewValidationError(input): string | null`
- `buildGenericToolModel(toolEvent): GenericToolModel`
- `extractToolText(value): string`
- `registerToolRenderer(name, render): void`
- `resolveToolRenderer(toolName): ToolRenderer`
- `genericToolRenderer`, `normalizeToolName`, and renderer prop/state types.

## Verification

- `PATH="/home/user/.bun/bin:$PATH" bun x vitest run packages/web/test/tool-render`
  - Passed: 2 test files, 9 tests.
- The three new source modules also passed an independent strict TypeScript check.
- Repository-wide `tsc --noEmit` remains blocked by an unrelated missing declaration for `better-sqlite3` in `packages/daemon/src/store.ts`.

## Limitations / intentional deferrals

- No React or `.tsx` components were added.
- L4 iframe extension apps are an architecture/specification only and remain disabled.
- The declarative schema validates data but does not sanitize/render markdown, enforce link navigation policy, or dispatch actions; those remain frontend host responsibilities.
- The registry is a trusted application-code API, not an extension-code registration channel.

## Review focus

1. Confirm the L3 WebView field vocabulary before extension authors rely on it.
2. Confirm the canonical alias set (`shell` to `bash`, `search` to `grep`, etc.) against daemon normalization.
3. Ensure the React card boundary catches a specialized renderer failure and falls back to `genericToolRenderer`.
4. Design the host action broker, approval dialog state, markdown sanitization, and link/artifact policy before rendering untrusted extension output.
