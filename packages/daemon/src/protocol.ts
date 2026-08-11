/**
 * protocol.ts — browser-facing omp-webui WebSocket protocol v1.
 * This is the narrow adapter boundary: omp wire shapes never leak raw to the browser.
 */

export const PROTOCOL_VERSION = 1;

/** Every frame on the wire uses this envelope. */
export interface Envelope<T = unknown> {
  protocolVersion: number;
  type: string;
  sessionId?: string;
  eventId?: string;
  sequence?: number;
  correlationId?: string;
  payload?: T;
  error?: { message: string; code?: string };
}

// ---------------------------------------------------------------------------
// Server → client events
// ---------------------------------------------------------------------------

export type ServerEventType =
  | "connection.ready"
  | "connection.error"
  | "workspace.list"
  | "session.list"
  | "session.snapshot"
  | "session.created"
  | "session.updated"
  | "session.archived"
  | "session.forked"
  | "worker.starting"
  | "worker.ready"
  | "worker.stopped"
  | "worker.crashed"
  | "message.started"
  | "message.delta"
  | "message.completed"
  | "message.failed"
  | "status.updated"
  | "context.updated"
  | "tool.started"
  | "tool.updated"
  | "tool.completed"
  | "tool.failed"
  | "approval.requested"
  | "question.requested"
  | "subagent.started"
  | "subagent.updated"
  | "subagent.completed"
  | "plan.updated"
  | "todos.updated"
  | "queue.updated"
  | "git.updated"
  | "file.changed"
  | "terminal.output"
  | "terminal.exit"
  | "replay.completed"
  | "response"; // command correlation responses

export interface TranscriptItem {
  id: string;
  /** Authoritative JSONL entry id when the item was rebuilt from a session file. */
  entryId?: string;
  kind: "user" | "assistant" | "tool" | "status" | "error";
  role?: string;
  text: string;
  toolName?: string;
  toolCallId?: string;
  toolState?: "running" | "success" | "failure" | "cancelled";
  toolArgs?: unknown;
  toolResult?: unknown;
  isError?: boolean;
  timestamp?: number;
}

export interface SessionSummary {
  sessionId: string;
  sessionFile: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  archived: boolean;
  workerState: "stopped" | "starting" | "ready" | "crashed";
  isStreaming?: boolean;
}

export interface SessionStatePayload {
  model?: {
    provider: string;
    id: string;
    name?: string;
    /** OMP model metadata is provider-defined; retained for capability-aware UI hints. */
    capabilities?: unknown;
    input?: unknown;
  };
  thinkingLevel?: string;
  isStreaming: boolean;
  isCompacting?: boolean;
  messageCount?: number;
  queuedMessageCount?: number;
  contextUsage?: { tokens: number; contextWindow: number; percent: number };
  todos?: unknown;
}

// ---------------------------------------------------------------------------
// Client → server commands
// ---------------------------------------------------------------------------

export type ClientCommandType =
  | "connection.resume"
  | "workspace.list"
  | "workspace.open"
  | "session.list"
  | "session.create"
  | "session.open"
  | "session.archive"
  | "session.fork"
  | "session.reask"
  | "prompt.submit"
  | "prompt.queue"
  | "prompt.steer"
  | "prompt.abort"
  | "approval.respond"
  | "question.respond"
  | "file.search"
  | "file.read"
  | "file.list"
  | "file.upload"
  | "git.status"
  | "git.diff"
  | "settings.update"
  | "model.set"
  | "model.list"
  | "model.cycle"
  | "thinking.set"
  | "thinking.cycle"
  | "terminal.create"
  | "terminal.input"
  | "terminal.resize"
  | "terminal.kill"
  | "terminal.commands";

export interface ClientCommand<P = unknown> {
  protocolVersion: number;
  type: ClientCommandType;
  id: string; // correlation id
  sessionId?: string;
  payload?: P;
}

export function makeEvent<T>(
  type: ServerEventType,
  opts: Partial<Envelope<T>> & { payload?: T },
): Envelope<T> {
  return { protocolVersion: PROTOCOL_VERSION, type, ...opts };
}
