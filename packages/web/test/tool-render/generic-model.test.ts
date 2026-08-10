import { describe, expect, it } from "vitest";
import { buildGenericToolModel, extractToolText } from "../../src/tool-render/generic-model";

describe("buildGenericToolModel", () => {
	it("extracts partial and final text from agent content arrays", () => {
		const model = buildGenericToolModel({
			toolCallId: "call-17",
			toolName: "custom_report",
			args: { format: "markdown" },
			state: "running",
			partialResult: { content: [{ type: "text", text: "first chunk" }, { type: "image", data: "ignored" }, { type: "text", text: "second chunk" }] },
			result: { content: [{ type: "text", text: "final report" }] },
			startedAt: 1_000,
			endedAt: 1_250,
		});

		expect(model.toolName).toBe("custom_report");
		expect(model.state).toBe("running");
		expect(model.prettyArgs).toBe('{\n  "format": "markdown"\n}');
		expect(model.partialText).toBe("first chunk\nsecond chunk");
		expect(model.resultText).toBe("final report");
		expect(model.displayText).toBe("final report");
		expect(model.timing.durationMs).toBe(250);
		expect(model.rawJson).toContain('"toolCallId": "call-17"');
	});

	it("builds a safe complete model for unknown tool events with weird shapes", () => {
		const cyclic: Record<string, unknown> = { content: "not an array" };
		cyclic.self = cyclic;
		const malformed = {
			toolCallId: 42,
			toolName: { not: "a name" },
			args: BigInt(3),
			state: "what-even-is-this",
			partialResult: ["bad shape"],
			result: cyclic,
			startedAt: "not a timestamp",
			endedAt: {},
		} as unknown;

		expect(() => buildGenericToolModel(malformed as never)).not.toThrow();
		const model = buildGenericToolModel(malformed as never);
		expect(model.toolCallId).toBe("unknown-call");
		expect(model.toolName).toBe("unknown tool");
		expect(model.state).toBe("unknown");
		expect(model.prettyArgs).toBe('"3n"');
		expect(model.partialText).toBe("");
		expect(model.resultText).toBe("");
		expect(model.timing.startedAt).toBe("not a timestamp");
		expect(model.timing.durationMs).toBeNull();
		expect(model.rawJson).toContain("[Circular]");
	});

	it("promotes structured result errors and preserves an error text fallback", () => {
		const model = buildGenericToolModel({
			toolName: "future_tool",
			state: "completed",
			result: { isError: true, content: [{ type: "text", text: "permission denied" }] },
		});

		expect(model.isError).toBe(true);
		expect(model.state).toBe("error");
		expect(model.errorText).toBe("permission denied");
	});

	it("exports standalone extraction for plain strings and content arrays", () => {
		expect(extractToolText("live text")).toBe("live text");
		expect(extractToolText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("a\nb");
		expect(extractToolText({ content: [{ type: "image", data: "x" }] })).toBe("");
	});
});
