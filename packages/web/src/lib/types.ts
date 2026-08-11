import type { Envelope, SessionStatePayload, SessionSummary, TranscriptItem } from '../../../daemon/src/protocol';
export type ConnectionState = 'connecting' | 'online' | 'reconnecting' | 'offline';
export type ToolCard = { toolCallId: string; toolName: string; args?: unknown; partialResult?: unknown; result?: unknown; state: 'running'|'success'|'failure'|'cancelled'; isError?: boolean; startedAt?: number; endedAt?: number; collapsed?: boolean };
export type PendingInteraction = { id: string; method: string; kind: 'approval'|'question'; payload: Record<string, unknown> };
export type Workspace = { id: string; root: string; [key: string]: unknown };
export type SlashSubcommand = { name: string; description?: string };
export type SlashCommand = { name: string; description?: string; aliases?: string[]; source?: string; input?: { hint?: string }; subcommands?: SlashSubcommand[] };
export type ExtensionWidget = { method: string; widgetKey?: string; title?: string; url?: string; text?: string; [key: string]: unknown };
export type ExtensionNotification = { id: string; notifyType: 'info'|'warning'|'error'; message: string; timestamp?: number };
export type ExtensionOpenUrl = { id: string; url: string; launchUrl?: string; instructions?: string };
export type ExtensionSessionState = SessionStatePayload & {
  workerState?: string;
  statusMessage?: string;
  tokensPerSecond?: number;
  availableCommands?: SlashCommand[];
  extensionUI?: ExtensionWidget;
  /** Latest sticky notification per id. Older toasts stay until dismissed. */
  extensionNotifications?: ExtensionNotification[];
  /** Keyed persistent status hints from omp setStatus. Empty string removes the key. */
  extensionStatus?: Record<string, string>;
  /** Latest omp-driven session title override (only present when PI_RPC_EMIT_TITLE is set). */
  extensionTitle?: string;
  /** One-shot composer replacement request from omp set_editor_text. Cleared after apply. */
  extensionEditorText?: string;
  /** OAuth-style link prompt from omp open_url. */
  extensionOpenUrl?: ExtensionOpenUrl;
};
export type AppState = { connection: ConnectionState; workspaces: Workspace[]; activeWorkspaceId?: string; sessions: SessionSummary[]; activeSession?: { sessionId: string; sessionFile: string }; transcript: TranscriptItem[]; toolCards: Record<string, ToolCard>; pendingInteractions: PendingInteraction[]; sessionState: ExtensionSessionState; queuedPrompts: string[]; drafts: Record<string,string>; seenEvents: Record<string,true>; lastSequences: Record<string,number>; replayDone: Record<string,boolean>; };
export type ServerEnvelope = Envelope<Record<string, unknown>>;
