import { describe, expect, it } from "vitest";
import {
	MAX_WEBVIEW_ARRAY_LENGTH,
	MAX_WEBVIEW_STRING_LENGTH,
	validateWebView,
	validateWebViewDetailed,
	webViewValidationError,
} from "../../src/tool-render/webview";

describe("validateWebView", () => {
	it("accepts sanitized valid declarative views", () => {
		const input = {
			kind: "form",
			title: "Deployment settings",
			fields: [
				{ kind: "text", id: "branch", label: "Branch", value: "main" },
				{
					kind: "select",
					id: "region",
					label: "Region",
					options: [{ value: "us-east-1", label: "US East" }],
				},
				{ kind: "checkbox", id: "dry-run", label: "Dry run", checked: true },
			],
			actions: [{ id: "submit", label: "Deploy", style: "primary", confirm: "Deploy now?" }],
			untrustedExtra: { should: "not be retained" },
		};

		const view = validateWebView(input);

		expect(view).toEqual({
			kind: "form",
			title: "Deployment settings",
			fields: input.fields,
			actions: input.actions,
		});
		expect(view).not.toHaveProperty("untrustedExtra");
	});

	it("accepts every supported kind at its minimal valid shape", () => {
		const views: unknown[] = [
			{ kind: "markdown", markdown: "# Hello" },
			{ kind: "code", code: "const x = 1", language: "typescript" },
			{ kind: "diff", before: "old", after: "new" },
			{ kind: "table", columns: ["Name"], rows: [["OMP"]] },
			{ kind: "progress", value: 2, max: 3 },
			{ kind: "keyValue", entries: [{ key: "status", value: "ok" }] },
			{ kind: "list", items: [{ label: "Ready", tone: "success" }] },
			{ kind: "links", links: [{ label: "OMP", href: "https://example.test" }] },
			{ kind: "artifacts", artifacts: [{ id: "a1", label: "log", sizeBytes: 0 }] },
			{ kind: "form", fields: [] },
			{ kind: "status", text: "Done", tone: "success" },
		];

		for (const view of views) expect(validateWebView(view)).not.toBeNull();
	});

	it("rejects unknown kinds with a testable reason", () => {
		const result = validateWebViewDetailed({ kind: "terminalComponent", component: "anything" });

		expect(result).toEqual({ ok: false, value: null, error: 'webview.kind: unsupported kind "terminalComponent"' });
		expect(validateWebView({ kind: "terminalComponent" })).toBeNull();
		expect(webViewValidationError({ kind: "terminalComponent" })).toContain("unsupported kind");
	});

	it("rejects malformed forms and invalid scalar values", () => {
		expect(webViewValidationError({ kind: "form", fields: [{ kind: "select", id: "x", label: "X", options: "nope" }] })).toBe(
		"webview.fields[0].options: must be an array",
	);
		expect(webViewValidationError({ kind: "progress", value: Number.NaN })).toBe("webview.value: must be a finite number");
		expect(webViewValidationError({ kind: "diff", before: "only one side" })).toBe("webview.diff: requires diff or both before and after");
	});

	it("rejects oversized strings and arrays", () => {
		const oversizedString = "x".repeat(MAX_WEBVIEW_STRING_LENGTH + 1);
		const oversizedArray = Array.from({ length: MAX_WEBVIEW_ARRAY_LENGTH + 1 }, () => ({ label: "item" }));

		expect(webViewValidationError({ kind: "markdown", markdown: oversizedString })).toBe(
			`webview.markdown: exceeds ${MAX_WEBVIEW_STRING_LENGTH} character limit`,
		);
		expect(webViewValidationError({ kind: "list", items: oversizedArray })).toBe(
			`webview.items: exceeds ${MAX_WEBVIEW_ARRAY_LENGTH} entry limit`,
		);
	});
});
