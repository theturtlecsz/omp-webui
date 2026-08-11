import type { SessionSummary, TranscriptItem } from '../../../daemon/src/protocol';
import { buildGenericToolModel } from '../tool-render/generic-model';
import type { AppState, PendingInteraction, ServerEnvelope, ToolCard } from './types';

export const SEEN_EVENTS_LIMIT = 10_000;

export const initialAppState: AppState = {
  connection: 'connecting', workspaces: [], sessions: [], transcript: [], toolCards: {},
  pendingInteractions: [], sessionState: { isStreaming: false }, queuedPrompts: [],
  drafts: {}, seenEvents: {}, lastSequences: {}, replayDone: {},
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((block) => record(block).type === 'text').map((block) => String(record(block).text ?? '')).join('\n')
      : '';

function messageItem(payload: Record<string, unknown>, fallback: string): TranscriptItem | null {
  const msg = record(payload.message);
  if (!Object.keys(msg).length) return null;
  const role = String(msg.role ?? 'assistant');
  const timestamp = typeof msg.timestamp === 'number' ? msg.timestamp : undefined;
  const id = String(msg.id ?? msg.responseId ?? `${role}_${timestamp ?? fallback}`);
  return {
    id,
    entryId: typeof msg.entryId === 'string' ? msg.entryId : undefined,
    kind: typeof msg.kind === 'string'
      ? msg.kind as TranscriptItem['kind']
      : role === 'user' ? 'user' : role === 'toolResult' ? 'tool' : 'assistant',
    role,
    text: typeof msg.text === 'string' ? msg.text : textOf(msg.content),
    timestamp,
    toolName: typeof msg.toolName === 'string' ? msg.toolName : undefined,
    toolCallId: typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined,
    toolResult: role === 'toolResult' ? { content: msg.content, details: msg.details } : undefined,
    isError: msg.isError === true,
  };
}

function upsert(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
  const at = items.findIndex((candidate) => candidate.id === item.id);
  return at < 0 ? [...items, item] : items.map((candidate, index) => index === at ? { ...candidate, ...item } : candidate);
}

function card(payload: Record<string, unknown>, old?: ToolCard, state?: ToolCard['state']): ToolCard {
  const toolCallId = String(payload.toolCallId ?? old?.toolCallId ?? 'unknown');
  const next: ToolCard = {
    toolCallId,
    toolName: String(payload.toolName ?? old?.toolName ?? 'Unknown tool'),
    args: payload.args ?? old?.args,
    partialResult: payload.partialResult ?? old?.partialResult,
    result: payload.result ?? old?.result,
    state: state ?? old?.state ?? 'running',
    isError: payload.isError === true || old?.isError,
    startedAt: old?.startedAt ?? Date.now(),
    endedAt: state && state !== 'running' ? Date.now() : old?.endedAt,
    collapsed: old?.collapsed,
  };
  const generic = buildGenericToolModel({
    toolCallId: next.toolCallId, toolName: next.toolName, args: next.args, state: next.state,
    partialResult: next.partialResult, result: next.result, isError: next.isError,
    startedAt: next.startedAt, endedAt: next.endedAt,
  });
  return { ...next, collapsed: generic.displayText.length > 4096 };
}

/** Object property order is insertion order, which gives this small cache LRU semantics. */
const seenEventSize = Symbol('seenEventSize');
type SeenEventCache = Record<string, true> & { [seenEventSize]?: number };
function rememberEvent(seenEvents: Record<string, true>, key?: string): Record<string, true> {
  if (!key) return seenEvents;
  // This bounded cache is intentionally updated in place. Copying a 10k-key object
  // for every streaming event turns reconnect replay into O(n²) work; the enclosing
  // reducer still returns a fresh AppState object for Zustand subscribers.
  const cache = seenEvents as SeenEventCache;
  let size = cache[seenEventSize] ?? Object.keys(cache).length;
  const known = Boolean(cache[key]);
  delete cache[key];
  cache[key] = true;
  if (!known) size++;
  if (size > SEEN_EVENTS_LIMIT) {
    // The first enumerable key is the least recently used one. Do not materialize
    // all keys merely to evict this single entry.
    for (const stale in cache) {
      delete cache[stale];
      size--;
      break;
    }
  }
  if (cache[seenEventSize] === undefined) {
    Object.defineProperty(cache, seenEventSize, { value: size, writable: true, configurable: true });
  } else {
    cache[seenEventSize] = size;
  }
  return cache;
}

function snapshotToolCards(items: TranscriptItem[]): Record<string, ToolCard> {
  return items.filter((item) => item.kind === 'tool' && item.toolCallId).reduce<Record<string, ToolCard>>((cards, item) => ({
    ...cards,
    [item.toolCallId!]: {
      toolCallId: item.toolCallId!,
      toolName: item.toolName ?? 'Unknown tool',
      args: item.toolArgs,
      result: item.toolResult,
      state: item.toolState ?? 'success',
      isError: item.isError,
      collapsed: buildGenericToolModel({
        toolCallId: item.toolCallId!, toolName: item.toolName, args: item.toolArgs,
        result: item.toolResult, state: item.toolState,
      }).displayText.length > 4096,
    },
  }), {});
}

function forkSummary(payload: Record<string, unknown>, sessionId: string, sessionFile: string): SessionSummary {
  return {
    sessionId,
    sessionFile,
    cwd: '',
    title: String(payload.title ?? 'Forked session'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
    archived: false,
    workerState: 'ready',
  };
}

export function applyServerEvent(state: AppState, event: ServerEnvelope): AppState {
  const key = event.eventId ?? (event.sequence !== undefined && event.sessionId ? `${event.sessionId}:${event.sequence}` : undefined);
  const lastSequence = event.sessionId && event.sequence !== undefined ? state.lastSequences[event.sessionId] ?? 0 : undefined;
  // Journal sequences survive LRU eviction and make replayed/out-of-order events idempotent.
  if ((key && state.seenEvents[key]) || (lastSequence !== undefined && event.sequence! <= lastSequence)) return state;

  const payload = record(event.payload);
  let next: AppState = {
    ...state,
    seenEvents: rememberEvent(state.seenEvents, key),
    lastSequences: event.sessionId && event.sequence !== undefined
      ? { ...state.lastSequences, [event.sessionId]: event.sequence }
      : state.lastSequences,
  };
  if (event.sessionId && state.replayDone[event.sessionId] === false && event.type !== 'session.snapshot' && event.type !== 'replay.completed') {
    return next;
  }

  switch (event.type) {
    case 'session.snapshot': {
      const items = Array.isArray(payload.items) ? payload.items as TranscriptItem[] : [];
      return {
        ...next,
        transcript: items,
        toolCards: snapshotToolCards(items),
        activeSession: payload.sessionId && payload.sessionFile
          ? { sessionId: String(payload.sessionId), sessionFile: String(payload.sessionFile) }
          : state.activeSession,
        replayDone: event.sessionId ? { ...state.replayDone, [event.sessionId]: false } : state.replayDone,
      };
    }
    case 'session.forked': {
      const sessionId = String(payload.sessionId ?? event.sessionId ?? '');
      const sessionFile = String(payload.sessionFile ?? payload.to ?? '');
      if (!sessionId || !sessionFile || payload.activate !== true) return next;
      const summary = forkSummary(payload, sessionId, sessionFile);
      const sessions = [
        summary,
        ...next.sessions.filter((session) => session.sessionId !== sessionId && session.sessionFile !== sessionFile),
      ];
      return {
        ...next,
        sessions,
        activeWorkspaceId: typeof payload.workspaceId === 'string' ? payload.workspaceId : next.activeWorkspaceId,
        activeSession: { sessionId, sessionFile },
        transcript: [],
        toolCards: {},
        pendingInteractions: [],
        sessionState: { ...next.sessionState, isStreaming: false },
        replayDone: { ...next.replayDone, [sessionId]: false },
      };
    }
    case 'message.started':
    case 'message.delta':
    case 'message.completed':
    case 'message.failed': {
      const item = messageItem(payload, event.eventId ?? String(event.sequence ?? Date.now()));
      if (!item) return next;
      const failed = event.type === 'message.failed';
      return {
        ...next,
        transcript: upsert(next.transcript, { ...item, isError: failed || item.isError, kind: failed ? 'error' : item.kind }),
        sessionState: { ...next.sessionState, isStreaming: event.type === 'message.completed' || failed ? false : next.sessionState.isStreaming },
      };
    }
    case 'tool.started':
    case 'tool.updated':
    case 'tool.completed':
    case 'tool.failed': {
      const id = String(payload.toolCallId ?? 'unknown');
      const stateValue = event.type === 'tool.failed' ? 'failure' : event.type === 'tool.completed' ? 'success' : 'running';
      const toolCard = card(payload, next.toolCards[id], stateValue);
      const toolItem: TranscriptItem = {
        id: `tool_${id}`, kind: 'tool', text: '', toolCallId: id, toolName: toolCard.toolName,
        toolState: toolCard.state, toolArgs: toolCard.args, toolResult: toolCard.result ?? toolCard.partialResult,
        isError: toolCard.isError,
      };
      return { ...next, toolCards: { ...next.toolCards, [id]: toolCard }, transcript: upsert(next.transcript, toolItem) };
    }
    case 'approval.requested':
    case 'question.requested': {
      const id = String(payload.id ?? payload.interactionId ?? '');
      if (!id) return next;
      if (payload.cancelled === true) return { ...next, pendingInteractions: next.pendingInteractions.filter((item) => item.id !== id) };
      const interaction: PendingInteraction = {
        id, method: String(payload.method ?? ''), kind: event.type.startsWith('approval') ? 'approval' : 'question', payload,
      };
      return {
        ...next,
        pendingInteractions: next.pendingInteractions.some((item) => item.id === id)
          ? next.pendingInteractions
          : [...next.pendingInteractions, interaction],
      };
    }
    case 'status.updated':
    case 'context.updated':
      return {
        ...next,
        sessionState: {
          ...next.sessionState, ...payload,
          isStreaming: typeof payload.isStreaming === 'boolean' ? payload.isStreaming : next.sessionState.isStreaming,
          statusMessage: typeof payload.message === 'string' ? payload.message : next.sessionState.statusMessage,
        },
      };
    case 'todos.updated':
    case 'plan.updated':
      return { ...next, sessionState: { ...next.sessionState, todos: payload.todoPhases ?? payload.todos ?? payload } };
    case 'queue.updated':
      return { ...next, queuedPrompts: Array.isArray(payload.messages) ? payload.messages.map(String) : next.queuedPrompts };
    case 'worker.starting':
    case 'worker.ready':
    case 'worker.stopped':
    case 'worker.crashed':
      return { ...next, sessionState: { ...next.sessionState, workerState: event.type.split('.')[1] } };
    case 'replay.completed':
      return { ...next, replayDone: event.sessionId ? { ...next.replayDone, [event.sessionId]: true } : next.replayDone };
    case 'session.updated': {
      // Merge omp-forwarded session-scoped surfaces (slash commands, extension widgets, etc.)
      // Only known keys are extracted so unknown ones do not pollute sessionState.
      const patch: Record<string, unknown> = {};
      if (Array.isArray(payload.availableCommands)) patch.availableCommands = payload.availableCommands;
      if (payload.extensionUI && typeof payload.extensionUI === 'object') patch.extensionUI = payload.extensionUI;
      if (Object.keys(patch).length === 0) return next;
      return { ...next, sessionState: { ...next.sessionState, ...patch } };
    }
    default:
      return next;
  }
}
