/**
 * Renderer selection only. This module has no React import: renderers return a
 * model or framework-specific value chosen by the application shell.
 */
import { buildGenericToolModel, type GenericToolModel } from "./generic-model";

export type ToolRenderState = "pending" | "running" | "completed" | "error" | "cancelled" | "unknown";

export interface ToolRendererProps {
	toolCallId: string;
	toolName: string;
	args: unknown;
	state: ToolRenderState;
	partialResult?: unknown;
	result?: unknown;
	isError?: boolean;
	startedAt?: string | number | Date;
	endedAt?: string | number | Date;
}

/** A renderer receives normalized invocation data and returns a host-owned display model. */
export interface ToolRenderer {
	(props: ToolRendererProps): unknown;
}

const aliases: Readonly<Record<string, string>> = {
	shell: "bash",
	sh: "bash",
	command: "bash",
	apply_patch: "edit",
	find: "glob",
	search: "grep",
	puppeteer: "browser",
	javascript: "eval",
	js: "eval",
	python: "eval",
	notebook: "eval",
	await: "job",
	poll: "job",
	cancel_job: "job",
};

const renderers = new Map<string, ToolRenderer>();

/**
 * Canonicalizes display/wire variants without touching double underscores used
 * by MCP names (for example `mcp__filesystem__delete`).
 */
export function normalizeToolName(name: string): string {
	return name.trim().toLowerCase().replace(/[\s./-]+/g, "_");
}

function canonicalToolName(name: string): string {
	const normalized = normalizeToolName(name);
	return aliases[normalized] ?? normalized;
}

/**
 * Registers or replaces a trusted built-in renderer. Extension payloads never
 * receive this API; they use declarative WebViews instead.
 */
export function registerToolRenderer(name: string, render: ToolRenderer): void {
	if (typeof name !== "string" || canonicalToolName(name) === "") throw new TypeError("Tool renderer name must be a non-empty string");
	if (typeof render !== "function") throw new TypeError("Tool renderer must be a function");
	renderers.set(canonicalToolName(name), render);
}

/** Pure fallback for unknown, malformed, or not-yet-implemented tools. */
export const genericToolRenderer: ToolRenderer = (props: ToolRendererProps): GenericToolModel => buildGenericToolModel(props);

/** Resolves aliases before returning a registered renderer; unknown names always receive the generic fallback. */
export function resolveToolRenderer(toolName: string): ToolRenderer {
	if (typeof toolName !== "string") return genericToolRenderer;
	return renderers.get(canonicalToolName(toolName)) ?? genericToolRenderer;
}
