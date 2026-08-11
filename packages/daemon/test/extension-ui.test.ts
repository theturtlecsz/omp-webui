/**
 * Direct-drive tests for SessionRuntime#onExtensionUI.
 *
 * The web-side vitest suite verifies that dialogs render correctly given a
 * normalized envelope. This suite verifies the OTHER half of the contract:
 * that raw `extension_ui_request` frames — shaped exactly as real omp v17.2.12
 * emits them (schema verified against
 * `@oh-my-pi/pi-coding-agent/dist/types/modes/rpc/rpc-types.d.ts`) — are
 * normalized into the correct browser envelopes, and that the response frames
 * we send back to omp match the expected extension_ui_response shape.
 *
 * These tests exercise the real runtime code path with no mocks of the code
 * under test — only the collaborators (store, worker) are stubbed since they
 * are not the subject.
 */
import { describe, expect, test } from "bun:test";
import { SessionRuntime } from "../src/session-runtime";
import type { OmpWorker } from "../src/worker";
import type { Store } from "../src/store";
import type { Envelope } from "../src/protocol";

type Emitted = { type: string; payload: unknown };

function makeRuntime() {
  const events: Emitted[] = [];
  const sent: Record<string, unknown>[] = [];
  const worker = { send: (frame: Record<string, unknown>) => { sent.push(frame); } } as unknown as OmpWorker;
  const runtime = new SessionRuntime(
    "/tmp/session-runtime-test-cwd",
    undefined,
    {} as Store,
    (event: Omit<Envelope, "protocolVersion" | "sessionId" | "eventId" | "sequence">) => {
      events.push({ type: String(event.type), payload: event.payload });
    },
  );
  runtime.attachWorker(worker);
  return { runtime, events, sent };
}

describe("SessionRuntime extension_ui_request normalization", () => {
  test("select { options } is exposed as a question event without approval normalization", () => {
    const { runtime, events } = makeRuntime();
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "q1", method: "select", title: "Pick one", options: ["Apples", "Oranges"] });
    const question = events.find((event) => event.type === "question.requested");
    expect(question).toBeDefined();
    const payload = question!.payload as Record<string, unknown>;
    expect(payload.interactionId).toBe("q1");
    expect(payload.method).toBe("select");
    expect(payload.options).toEqual(["Apples", "Oranges"]);
    // A pending interaction is tracked so a later response can be delivered.
    expect(runtime.pendingInteractions().some((entry) => entry.id === "q1")).toBe(true);
  });

  test("select-shaped tool approval (['Approve','Deny']) is normalized to approval", () => {
    const { runtime, events } = makeRuntime();
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "a1", method: "select", title: "Allow tool: bash", options: ["Approve", "Deny"] });
    const approval = events.find((event) => event.type === "approval.requested");
    expect(approval).toBeDefined();
    const payload = approval!.payload as Record<string, unknown>;
    expect(payload.interactionId).toBe("a1");
    expect(payload.toolName).toBe("bash");
  });

  test("confirm is normalized to approval and confirmed:true round-trips correctly", () => {
    const { runtime, events, sent } = makeRuntime();
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "c1", method: "confirm", title: "Restart worker?", message: "This will end the current run." });
    const approval = events.find((event) => event.type === "approval.requested");
    expect(approval).toBeDefined();
    runtime.respondToInteraction("c1", { confirmed: true });
    expect(sent).toContainEqual({ type: "extension_ui_response", id: "c1", confirmed: true });
  });

  test("input is a question and the response uses value", () => {
    const { runtime, events, sent } = makeRuntime();
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "i1", method: "input", title: "Your name", placeholder: "e.g. Casey" });
    const question = events.find((event) => event.type === "question.requested");
    expect(question).toBeDefined();
    runtime.respondToInteraction("i1", { value: "Casey" });
    expect(sent).toContainEqual({ type: "extension_ui_response", id: "i1", value: "Casey" });
  });

  test("editor forwards prefill and a cancelled response emits cancelled:true", () => {
    const { runtime, events, sent } = makeRuntime();
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "e1", method: "editor", title: "Refine", prefill: "draft body", promptStyle: false });
    const question = events.find((event) => event.type === "question.requested");
    expect(question).toBeDefined();
    const payload = question!.payload as Record<string, unknown>;
    expect(payload.prefill).toBe("draft body");
    runtime.respondToInteraction("e1", { cancelled: true });
    expect(sent).toContainEqual({ type: "extension_ui_response", id: "e1", cancelled: true });
  });

  test("cancel targeting a pending interaction emits a cancelled follow-up", () => {
    const { runtime, events } = makeRuntime();
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "i2", method: "input", title: "Name" });
    events.length = 0;
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "sys", method: "cancel", targetId: "i2" });
    const cancelled = events.find((event) => event.type === "question.requested" && (event.payload as Record<string, unknown>).cancelled === true);
    expect(cancelled).toBeDefined();
    expect(runtime.pendingInteractions().some((entry) => entry.id === "i2")).toBe(false);
  });

  test("notify emits extensionNotification with the original notifyType preserved", () => {
    const { runtime, events } = makeRuntime();
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "n1", method: "notify", message: "Compaction complete", notifyType: "warning" });
    const notify = events.find((event) => event.type === "session.updated" && (event.payload as Record<string, unknown>).extensionNotification);
    expect(notify).toBeDefined();
    const payload = (notify!.payload as Record<string, unknown>).extensionNotification as Record<string, unknown>;
    expect(payload).toMatchObject({ id: "n1", notifyType: "warning", message: "Compaction complete" });
  });

  test("setStatus emits extensionStatus with statusKey and statusText", () => {
    const { runtime, events } = makeRuntime();
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "s1", method: "setStatus", statusKey: "context", statusText: "87% used" });
    const status = events.find((event) => event.type === "session.updated" && (event.payload as Record<string, unknown>).extensionStatus);
    expect(status).toBeDefined();
    expect((status!.payload as Record<string, unknown>).extensionStatus).toEqual({ statusKey: "context", statusText: "87% used" });
  });

  test("setTitle emits extensionTitle, setWidget emits extensionUI, neither clobbers the other", () => {
    const { runtime, events } = makeRuntime();
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "t1", method: "setTitle", title: "Task 42" });
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "w1", method: "setWidget", widgetKey: "autoresearch" });
    const title = events.find((event) => event.type === "session.updated" && (event.payload as Record<string, unknown>).extensionTitle);
    const widget = events.find((event) => event.type === "session.updated" && (event.payload as Record<string, unknown>).extensionUI);
    expect((title!.payload as Record<string, unknown>).extensionTitle).toBe("Task 42");
    expect(((widget!.payload as Record<string, unknown>).extensionUI as Record<string, unknown>).widgetKey).toBe("autoresearch");
    // Crucially, these are distinct events on distinct slice keys so the reducer
    // can merge them without one overwriting the other.
    expect(title !== widget).toBe(true);
  });

  test("set_editor_text emits extensionEditorText slice with the raw text", () => {
    const { runtime, events } = makeRuntime();
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "ed1", method: "set_editor_text", text: "/undo last message" });
    const editor = events.find((event) => event.type === "session.updated" && (event.payload as Record<string, unknown>).extensionEditorText);
    expect(editor).toBeDefined();
    expect((editor!.payload as Record<string, unknown>).extensionEditorText).toBe("/undo last message");
  });

  test("open_url emits extensionOpenUrl slice with url, launchUrl, and instructions", () => {
    const { runtime, events } = makeRuntime();
    runtime.onWorkerFrame({
      type: "extension_ui_request", id: "o1", method: "open_url",
      url: "https://oauth.example/authorize?code=verylong",
      launchUrl: "http://127.0.0.1:5555/cb",
      instructions: "Complete sign-in in your browser.",
    });
    const open = events.find((event) => event.type === "session.updated" && (event.payload as Record<string, unknown>).extensionOpenUrl);
    expect(open).toBeDefined();
    expect((open!.payload as Record<string, unknown>).extensionOpenUrl).toMatchObject({
      id: "o1",
      url: "https://oauth.example/authorize?code=verylong",
      launchUrl: "http://127.0.0.1:5555/cb",
      instructions: "Complete sign-in in your browser.",
    });
  });

  test("unknown method surfaces a debug status.updated without throwing", () => {
    const { runtime, events } = makeRuntime();
    runtime.onWorkerFrame({ type: "extension_ui_request", id: "u1", method: "some_future_method", payload: {} });
    const debug = events.find((event) => event.type === "status.updated" && String((event.payload as Record<string, unknown>).level) === "debug");
    expect(debug).toBeDefined();
  });
});
