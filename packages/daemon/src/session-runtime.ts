/**
 * session-runtime.ts — one runtime per active omp session.
 * Translates raw omp RPC frames into normalized browser-protocol events.
 * This is the ONLY place omp wire shapes are interpreted.
 */
import { randomUUID } from "node:crypto";
import type { OmpWorker, WorkerState } from "./worker.js";
import type { Store } from "./store.js";
import type { Envelope, SessionStatePayload, TranscriptItem } from "./protocol.js";

type EmitFn = (event: Omit<Envelope, "protocolVersion" | "sessionId" | "eventId" | "sequence">) => void;

interface PendingInteraction {
  id: string;
  kind: "approval" | "question";
  method: string;
  payload: Record<string, unknown>;
}

export class SessionRuntime {
  sessionFile: string | undefined; // learned from get_state after worker ready
  readonly cwd: string;
  sessionId = "";
  worker: OmpWorker | null = null;
  state: SessionStatePayload = { isStreaming: false };

  #store: Store;
  #emitRaw: EmitFn;
  #pendingInteractions = new Map<string, PendingInteraction>();
  #disposed = false;

  constructor(cwd: string, sessionFile: string | undefined, store: Store, emit: EmitFn) {
    this.cwd = cwd;
    this.sessionFile = sessionFile;
    this.#store = store;
    this.#emitRaw = emit;
  }

  /** Emit a normalized event: journal it, then fan out to clients. */
  #emit(type: string, payload: unknown, opts: { journal?: boolean } = {}) {
    if (this.#disposed) return;
    this.#emitRaw({ type: type as Envelope["type"], payload });
  }

  attachWorker(worker: OmpWorker): void {
    this.worker = worker;
  }

  workerStateChanged(state: WorkerState, detail?: string): void {
    const map: Record<WorkerState, string> = {
      starting: "worker.starting",
      ready: "worker.ready",
      stopped: "worker.stopped",
      crashed: "worker.crashed",
    };
    this.#emit(map[state], { state, detail });
  }

  /** Main translation: raw omp frame -> normalized browser events. */
  onWorkerFrame(frame: Record<string, unknown>): void {
    const type = frame.type as string;
    switch (type) {
      case "ready":
        break; // handled by worker
      case "agent_start":
        this.state.isStreaming = true;
        this.#emit("status.updated", { isStreaming: true });
        break;
      case "agent_end":
        this.state.isStreaming = false;
        this.#emit("status.updated", { isStreaming: false, isTerminal: frame.isTerminal !== false });
        break;
      case "message_start":
        this.#emit("message.started", { message: normalizeMessage(frame.message) });
        break;
      case "message_update": {
        const ev = frame.assistantMessageEvent as Record<string, unknown> | undefined;
        this.#emit("message.delta", {
          deltaType: ev?.type,
          delta: ev?.delta,
          contentIndex: ev?.contentIndex,
          message: normalizeMessage(frame.message),
        });
        break;
      }
      case "message_end": {
        const msg = frame.message as Record<string, unknown> | undefined;
        const stopReason = msg?.stopReason as string | undefined;
        if (stopReason === "error" || stopReason === "aborted") {
          this.#emit("message.failed", {
            message: normalizeMessage(msg),
            stopReason,
            error: msg?.errorMessage,
          });
        } else {
          this.#emit("message.completed", { message: normalizeMessage(msg) });
        }
        break;
      }
      case "tool_execution_start":
        this.#emit("tool.started", {
          toolCallId: frame.toolCallId, toolName: frame.toolName, args: frame.args,
        });
        break;
      case "tool_execution_update":
        this.#emit("tool.updated", {
          toolCallId: frame.toolCallId, toolName: frame.toolName, args: frame.args,
          partialResult: frame.partialResult,
        });
        break;
      case "tool_execution_end": {
        const isError = frame.isError === true;
        this.#emit(isError ? "tool.failed" : "tool.completed", {
          toolCallId: frame.toolCallId, toolName: frame.toolName,
          result: frame.result, isError,
        });
        break;
      }
      case "extension_ui_request":
        this.#onExtensionUI(frame);
        break;
      case "extension_error":
        this.#emit("status.updated", { level: "warn", message: `Extension error: ${frame.error}` });
        break;
      case "available_commands_update":
        this.#emit("session.updated", { availableCommands: frame.commands });
        break;
      case "command_output":
        this.#emit("session.updated", { commandOutput: frame });
        break;
      case "session_info_update":
      case "config_update":
        this.#emit("session.updated", { [type]: frame });
        break;
      case "model_changed":
        this.state.model = frame.model as SessionStatePayload["model"];
        this.#emit("context.updated", { model: frame.model });
        break;
      case "thinking_level_changed":
        this.state.thinkingLevel = frame.thinkingLevel as string;
        this.#emit("context.updated", { thinkingLevel: frame.thinkingLevel });
        break;
      case "auto_compaction_start":
        this.state.isCompacting = true;
        this.#emit("status.updated", { isCompacting: true });
        break;
      case "auto_compaction_end":
        this.state.isCompacting = false;
        this.#emit("status.updated", { isCompacting: false });
        break;
      case "auto_retry_start":
        this.#emit("status.updated", { retrying: { attempt: frame.attempt, maxAttempts: frame.maxAttempts, error: frame.errorMessage } });
        break;
      case "auto_retry_end":
        this.#emit("status.updated", { retrying: null });
        break;
      case "todo_reminder":
        this.#emit("todos.updated", frame);
        break;
      case "subagent_lifecycle":
        this.#emit(subagentLifecycleEvent(frame), frame);
        break;
      case "subagent_progress":
        this.#emit("subagent.updated", frame);
        break;
      case "subagent_event":
        this.#emit("subagent.updated", { nested: true, ...frame });
        break;
      case "prompt_result":
      case "turn_start":
      case "turn_end":
      case "response":
        // low-signal for the UI; prompt acks are correlated in the daemon
        break;
      default:
        // Never silently drop: surface unknown frames as status notices (bounded).
        this.#emit("status.updated", {
          level: "debug",
          message: `Unhandled omp event: ${String(type).slice(0, 80)}`,
        });
    }
  }

  #onExtensionUI(frame: Record<string, unknown>): void {
    const id = String(frame.id ?? "");
    const method = String(frame.method ?? "");
    // Dialog-like methods -> browser approval/question dialogs
    if (method === "confirm") {
      this.#pendingInteractions.set(id, { id, kind: "approval", method, payload: frame });
      this.#emit("approval.requested", { ...frame, interactionId: id, title: frame.title ?? frame.message });
    } else if (method === "select" && isToolApprovalSelect(frame)) {
      // omp tool approvals arrive as select(["Approve","Deny"]) — normalize to approval
      const title = String(frame.title ?? "Approve tool call?");
      const toolName = /^Allow tool: (.+)$/m.exec(title)?.[1]?.trim();
      const payload = { ...frame, interactionId: id, title, toolName, options: frame.options };
      this.#pendingInteractions.set(id, { id, kind: "approval", method, payload });
      this.#emit("approval.requested", payload);
    } else if (method === "select" || method === "input" || method === "editor") {
      const payload = { ...frame, interactionId: id };
      this.#pendingInteractions.set(id, { id, kind: "question", method, payload });
      this.#emit("question.requested", payload);
    } else if (method === "cancel") {
      const pending = this.#pendingInteractions.get(String(frame.targetId ?? id));
      if (pending) {
        this.#pendingInteractions.delete(pending.id);
        this.#emit(pending.kind === "approval" ? "approval.requested" : "question.requested", { ...pending.payload, cancelled: true });
      }
    } else if (method === "notify") {
      this.#emit("status.updated", { level: "info", message: frame.message ?? frame.title });
    } else if (method === "setStatus") {
      this.#emit("status.updated", { extensionStatus: frame });
    } else if (method === "setWidget" || method === "setTitle" || method === "set_editor_text" || method === "open_url") {
      // terminal-centric surfaces: acknowledge existence without a browser dialog
      this.#emit("session.updated", { extensionUI: { method, ...frame } });
    } else {
      this.#emit("status.updated", { level: "debug", message: `Unknown extension UI method: ${method.slice(0, 60)}` });
    }
  }

  /** Answer a pending approval/question; returns false if id unknown. */
  respondToInteraction(id: string, response: Record<string, unknown>): boolean {
    const pending = this.#pendingInteractions.get(id);
    if (!pending) return false;
    this.#pendingInteractions.delete(id);
    let rpc: Record<string, unknown>;
    if (response.cancelled === true) {
      rpc = { type: "extension_ui_response", id, cancelled: true };
    } else if (pending.method === "select") {
      // select answers carry a value; approvals-normalized-from-select translate
      // confirmed -> "Approve"/"Deny"
      const options = Array.isArray(pending.payload.options) ? (pending.payload.options as unknown[]).map(String) : [];
      let value = typeof response.value === "string" ? response.value : "";
      if (!value && typeof response.confirmed === "boolean") {
        value = response.confirmed
          ? (options.find((o) => /^approve$/i.test(o)) ?? options[0] ?? "Approve")
          : (options.find((o) => /^deny$/i.test(o)) ?? options[1] ?? "Deny");
      }
      rpc = { type: "extension_ui_response", id, value };
    } else if (pending.method === "confirm") {
      rpc = { type: "extension_ui_response", id, confirmed: response.confirmed === true };
    } else {
      rpc = { type: "extension_ui_response", id, value: String(response.value ?? "") };
    }
    this.worker?.send(rpc);
    return true;
  }

  pendingInteractions(): PendingInteraction[] {
    return [...this.#pendingInteractions.values()];
  }

  async refreshState(): Promise<void> {
    if (!this.worker || this.worker.state !== "ready") return;
    try {
      const data = (await this.worker.command({ type: "get_state" }, 10_000)) as Record<string, unknown>;
      this.state = {
        model: data.model as SessionStatePayload["model"],
        thinkingLevel: data.thinkingLevel as string,
        isStreaming: Boolean(data.isStreaming),
        isCompacting: Boolean(data.isCompacting),
        messageCount: data.messageCount as number,
        queuedMessageCount: data.queuedMessageCount as number,
        contextUsage: data.contextUsage as SessionStatePayload["contextUsage"],
        todos: data.todoPhases,
      };
      if (typeof data.sessionId === "string") this.sessionId = data.sessionId;
      if (typeof data.sessionFile === "string") this.sessionFile = data.sessionFile;
      this.#emit("context.updated", this.state);
    } catch { /* worker busy or gone */ }
  }

  dispose(): void {
    this.#disposed = true;
  }
}

function subagentLifecycleEvent(frame: Record<string, unknown>): string {
  const phase = String(frame.phase ?? frame.lifecycle ?? "");
  if (phase === "started" || phase === "start") return "subagent.started";
  if (phase === "completed" || phase === "failed" || phase === "killed" || phase === "done") return "subagent.completed";
  return "subagent.updated";
}

/** Reduce an omp message object to the transcript-friendly shape. */
export function normalizeMessage(msg: unknown): Partial<TranscriptItem> | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  const role = m.role as string | undefined;
  const parts: string[] = [];
  const content = m.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c && typeof c === "object") {
        const cc = c as Record<string, unknown>;
        if (cc.type === "text" && typeof cc.text === "string") parts.push(cc.text);
        // thinking blocks are intentionally excluded from transcript text
      }
    }
  } else if (typeof content === "string") {
    parts.push(content);
  }
  return {
    role,
    text: parts.join(""),
    kind: role === "user" ? "user" : "assistant",
    timestamp: typeof m.timestamp === "number" ? m.timestamp : undefined,
  };
}

export function newEventId(): string {
  return `ev_${randomUUID()}`;
}

/** omp tool approvals arrive as select(["Approve","Deny"]) with an "Allow tool:" title. */
function isToolApprovalSelect(frame: Record<string, unknown>): boolean {
  const title = String(frame.title ?? "");
  const options = Array.isArray(frame.options) ? (frame.options as unknown[]).map(String) : [];
  return title.startsWith("Allow tool:") && options.includes("Approve") && options.includes("Deny");
}
