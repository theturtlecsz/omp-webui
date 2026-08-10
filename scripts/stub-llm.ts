/**
 * stub-llm.ts — deterministic OpenAI-compatible chat-completions server used ONLY
 * as a test/dev provider boundary for omp (never in production paths).
 *
 * Behavior is scripted by the last user message:
 *  - contains "use a tool"   -> one bash tool call, then a final summary
 *  - contains "two tools"    -> two sequential bash tool calls, then summary
 *  - contains "long"         -> long multi-chunk streamed reply
 *  - contains "think"        -> includes reasoning_content deltas
 *  - otherwise               -> short streamed reply
 * After a tool result arrives, replies with a final text summary.
 *
 * Usage: bun scripts/stub-llm.ts [port]
 */

const port = Number(process.argv[2] ?? 8788);

type Msg = { role: string; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string; name?: string };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c?.type === "text" ? c.text : "")).join("");
  return "";
}

function sse(chunks: object[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}

function chunk(delta: Record<string, unknown>, finish: string | null = null): object {
  return {
    id: "chatcmpl-stub",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "stub-1",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

function textChunks(text: string, perChunk = 12): object[] {
  const out: object[] = [chunk({ role: "assistant", content: "" })];
  for (let i = 0; i < text.length; i += perChunk) out.push(chunk({ content: text.slice(i, i + perChunk) }));
  out.push(chunk({}, "stop"));
  return out;
}

function toolCallChunks(toolName: string, args: Record<string, unknown>): object[] {
  const argStr = JSON.stringify(args);
  return [
    chunk({ role: "assistant", content: "" }),
    chunk({ tool_calls: [{ index: 0, id: "call_stub_1", type: "function", function: { name: toolName, arguments: "" } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: argStr } }] }),
    chunk({}, "tool_calls"),
  ];
}

function pickTool(tools: unknown[] | undefined, preferred: string): string {
  if (!Array.isArray(tools) || tools.length === 0) return preferred;
  const names = tools.map((t: any) => t?.function?.name).filter(Boolean);
  return names.includes(preferred) ? preferred : names[0];
}

function plan(messages: Msg[], tools: unknown[] | undefined): object[] {
  const last = messages[messages.length - 1];
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userText = textOf(lastUser?.content).toLowerCase();

  // Test-only: acknowledge image attachments so E2E can assert the round trip.
  // omp's vision guard substitutes a placeholder for non-vision models (like
  // this stub), so accept either the real image part or the placeholder.
  const hasImage = messages.some((m) => Array.isArray(m.content) && m.content.some((c: any) => typeof c?.type === "string" && c.type.includes("image")));
  if (hasImage || userText.includes("[image omitted")) return textChunks("I received an image attachment.");
  // Test-only: emit rich markdown so E2E can assert the renderer.
  if (userText.includes("markdown")) {
    return textChunks("Here is **bold** text with `inline code`.\n\n| col A | col B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst answer = 42;\n```");
  }

  // After a tool result, summarize and stop.
  if (last?.role === "tool") {
    const resultText = textOf(last.content).slice(0, 200);
    return textChunks(`Tool execution complete. The tool returned: ${resultText}`);
  }
  if (userText.includes("two tools")) {
    const bash = pickTool(tools, "bash");
    const which = messages.some((m) => m.role === "tool") ? "second" : "first";
    return toolCallChunks(bash, { command: `echo ${which}-tool-output` });
  }
  if (userText.includes("use a tool")) {
    const bash = pickTool(tools, "bash");
    return toolCallChunks(bash, { command: "echo hello-from-omp-tool" });
  }
  if (userText.includes("long")) {
    return textChunks("Streaming chunk. ".repeat(400), 24);
  }
  if (userText.includes("think")) {
    return [
      chunk({ role: "assistant", content: "" }),
      chunk({ reasoning_content: "Let me consider this carefully. " }),
      chunk({ reasoning_content: "The answer is straightforward." }),
      ...textChunks("I thought about it: hello from the stub model."),
    ];
  }
  return textChunks("Hello from the stub model. I am a deterministic test double at the provider boundary.");
}

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/v1/models" && req.method === "GET") {
      return Response.json({ object: "list", data: [{ id: "stub-1", object: "model", created: 0, owned_by: "stub" }] });
    }
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      const body = (await req.json()) as { messages: Msg[]; tools?: unknown[]; stream?: boolean };
      const chunks = plan(body.messages ?? [], body.tools);
      if (body.stream === false) {
        const text = chunks
          .map((c: any) => c.choices?.[0]?.delta?.content ?? "")
          .join("");
        return Response.json({
          id: "chatcmpl-stub",
          object: "chat.completion",
          created: 0,
          model: "stub-1",
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });
      }
      return new Response(sse(chunks), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`stub-llm listening on http://127.0.0.1:${server.port}/v1`);
