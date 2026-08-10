/**
 * A no-throw, presentation-neutral fallback for every tool event. React (or
 * any future renderer) consumes this model; this module owns no DOM concerns.
 */

export type GenericToolState = "pending" | "running" | "completed" | "error" | "cancelled" | "unknown";

/**
 * Deliberately permissive at the transport boundary. A normalizer may provide
 * well-typed values, but the generic fallback must also survive malformed or
 * forward-compatible events without throwing.
 */
export interface NormalizedToolEvent {
	toolCallId?: unknown;
	toolName?: unknown;
	args?: unknown;
	state?: unknown;
	partialResult?: unknown;
	result?: unknown;
	isError?: unknown;
	startedAt?: unknown;
	endedAt?: unknown;
	/** Optional transport error retained by adapters that expose it. */
	error?: unknown;
}

export interface GenericToolTiming {
	startedAt: string | null;
	endedAt: string | null;
	durationMs: number | null;
}

export interface GenericToolModel {
	toolCallId: string;
	toolName: string;
	state: GenericToolState;
	stateLabel: string;
	isError: boolean;
	prettyArgs: string;
	partialText: string;
	resultText: string;
	/** Final result text when present, otherwise the live partial text. */
	displayText: string;
	errorText: string | null;
	timing: GenericToolTiming;
	/** A safe JSON representation of the complete incoming event for an expandable inspector. */
	rawJson: string;
}

type UnknownRecord = Record<string, unknown>;

function recordOf(value: unknown): UnknownRecord | null {
	try {
		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : null;
	} catch {
		return null;
	}
}

function property(record: UnknownRecord | null, key: string): unknown {
	try {
		return record?.[key];
	} catch {
		return undefined;
	}
}

function text(value: unknown): string | null {
	try {
		return typeof value === "string" ? value : null;
	} catch {
		return null;
	}
}

function normalizedState(value: unknown): GenericToolState {
	if (typeof value !== "string") return "unknown";
	switch (value.trim().toLowerCase()) {
		case "pending":
		case "queued":
		case "created":
			return "pending";
		case "running":
		case "streaming":
		case "in_progress":
		case "in-progress":
			return "running";
		case "completed":
		case "complete":
		case "success":
		case "succeeded":
		case "done":
			return "completed";
		case "error":
		case "failed":
		case "failure":
			return "error";
		case "cancelled":
		case "canceled":
		case "aborted":
			return "cancelled";
		default:
			return "unknown";
	}
}

function labelForState(state: GenericToolState): string {
	switch (state) {
		case "pending":
			return "Pending";
		case "running":
			return "Running";
		case "completed":
			return "Completed";
		case "error":
			return "Failed";
		case "cancelled":
			return "Cancelled";
		default:
			return "Unknown state";
	}
}

/** Extracts readable text from raw strings or agent-style `{ content: [{ type: "text", text }] }` values. */
export function extractToolText(value: unknown): string {
	try {
		if (typeof value === "string") return value;
		const record = recordOf(value);
		if (!record) return "";
		const directText = text(property(record, "text"));
		if (directText !== null) return directText;
		const content = property(record, "content");
		if (!Array.isArray(content)) return "";
		const parts: string[] = [];
		for (const block of content) {
			const item = recordOf(block);
			if (item && property(item, "type") === "text") {
				const blockText = text(property(item, "text"));
				if (blockText !== null) parts.push(blockText);
			}
		}
		return parts.join("\n");
	} catch {
		return "";
	}
}

function errorTextOf(event: UnknownRecord, result: unknown, partialResult: unknown, isError: boolean): string | null {
	const candidates = [
		property(event, "error"),
		property(recordOf(result), "error"),
		property(recordOf(result), "errorText"),
		property(recordOf(result), "message"),
		property(recordOf(partialResult), "error"),
	];
	for (const candidate of candidates) {
		const value = text(candidate);
		if (value !== null && value.trim() !== "") return value;
	}
	if (isError) return extractToolText(result) || extractToolText(partialResult) || "Tool failed without an error message";
	return null;
}

function safeJson(value: unknown, fallback: string): string {
	try {
		const seen = new WeakSet<object>();
		const serialized = JSON.stringify(
			value,
			(_key, item: unknown) => {
				if (typeof item === "bigint") return `${item.toString()}n`;
				if (typeof item === "function") return "[Function]";
				if (typeof item === "symbol") return item.toString();
				if (typeof item === "object" && item !== null) {
					if (seen.has(item)) return "[Circular]";
					seen.add(item);
				}
				return item;
			},
			2,
		);
		return serialized ?? fallback;
	} catch {
		return fallback;
	}
}

function stringifyArgs(value: unknown): string {
	return value === undefined ? "{}" : safeJson(value, "[Arguments unavailable]");
}

function timestamp(value: unknown): { display: string | null; milliseconds: number | null } {
	try {
		if (typeof value === "number" && Number.isFinite(value)) return { display: new Date(value).toISOString(), milliseconds: value };
		if (typeof value === "string" && value.trim() !== "") {
			const parsed = Date.parse(value);
			return { display: value, milliseconds: Number.isNaN(parsed) ? null : parsed };
		}
		if (value instanceof Date && Number.isFinite(value.getTime())) return { display: value.toISOString(), milliseconds: value.getTime() };
	} catch {
		// Invalid date-like values are display-only absent.
	}
	return { display: null, milliseconds: null };
}

/** Builds a complete generic model and intentionally never throws for malformed event input. */
export function buildGenericToolModel(toolEvent: NormalizedToolEvent): GenericToolModel {
	try {
		const event = recordOf(toolEvent) ?? {};
		const result = property(event, "result");
		const partialResult = property(event, "partialResult");
		const resultRecord = recordOf(result);
		const explicitError = property(event, "isError") === true;
		const resultError = property(resultRecord, "isError") === true;
		const incomingState = normalizedState(property(event, "state"));
		const isError = explicitError || resultError || incomingState === "error";
		const state = isError && incomingState !== "cancelled" ? "error" : incomingState;
		const partialText = extractToolText(partialResult);
		const resultText = extractToolText(result);
		const started = timestamp(property(event, "startedAt"));
		const ended = timestamp(property(event, "endedAt"));
		const durationMs = started.milliseconds !== null && ended.milliseconds !== null ? Math.max(0, ended.milliseconds - started.milliseconds) : null;
		const rawJson = safeJson(toolEvent, '{"unavailable":true}');
		return {
			toolCallId: text(property(event, "toolCallId")) ?? "unknown-call",
			toolName: text(property(event, "toolName")) ?? "unknown tool",
			state,
			stateLabel: labelForState(state),
			isError,
			prettyArgs: stringifyArgs(property(event, "args")),
			partialText,
			resultText,
			displayText: resultText || partialText,
			errorText: errorTextOf(event, result, partialResult, isError),
			timing: { startedAt: started.display, endedAt: ended.display, durationMs },
			rawJson,
		};
	} catch {
		return {
			toolCallId: "unknown-call",
			toolName: "unknown tool",
			state: "unknown",
			stateLabel: "Unknown state",
			isError: false,
			prettyArgs: "[Arguments unavailable]",
			partialText: "",
			resultText: "",
			displayText: "",
			errorText: null,
			timing: { startedAt: null, endedAt: null, durationMs: null },
			rawJson: '{"unavailable":true}',
		};
	}
}
