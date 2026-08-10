# RPC mode inventory

## Wire envelope, ready frame, and negotiation

RPC is newline-delimited JSON on stdin/stdout (`packages/coding-agent/src/modes/rpc/rpc-types.ts:1-6`). A command is an `RpcCommand` object with optional `id`; responses use the `RpcResponse` discriminated union (`rpc-types.ts:28-93,196-342`).

The initial `RpcReadyFrame` is exactly `{ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: number, maxReassembledFrameBytes: number }` (`rpc-types.ts:144-150`; emitted by `rpc-mode.ts:690-703`). The host requests `negotiate_protocol` with a numeric `protocolVersion`; only a successful selection returns `{ protocolVersion: 2 }` (`rpc-types.ts:28-30,196-204`). v2 switches the frame encoder only after negotiation (`rpc-frame.ts:263-285`).

## Complete `RpcCommand` union and successful response data

Every union arm below has `id?: string`. This table transcribes `RpcCommand` and its matching `RpcResponse` arms (`rpc-types.ts:28-93,196-339`). “None” means the successful response has no `data` property.

| Command `type` | Additional command fields | Successful response `data` |
|---|---|---|
| `negotiate_protocol` | `protocolVersion: number` | `{ protocolVersion: 2 }` |
| `prompt` | `message`, `images?: ImageContent[]`, `streamingBehavior?: "steer" \| "followUp"` | optional `{ agentInvoked: boolean }` |
| `steer`, `follow_up` | `message`, `images?: ImageContent[]` | None |
| `abort` | — | None |
| `abort_and_prompt` | `message`, `images?: ImageContent[]` | None |
| `new_session` | `parentSession?: string` | `{ cancelled: boolean }` |
| `get_state` | — | `RpcSessionState` |
| `set_fast_mode` | `enabled: boolean` | `{ enabled: boolean, active: boolean }` |
| `get_available_commands` | — | `{ commands: RpcAvailableSlashCommand[] }` |
| `set_todos` | `phases: TodoPhase[]` | `{ todoPhases: TodoPhase[] }` |
| `set_host_tools` | `tools: RpcHostToolDefinition[]` | `{ toolNames: string[] }` |
| `set_host_uri_schemes` | `schemes: RpcHostUriSchemeDefinition[]` | `{ schemes: string[] }` |
| `set_subagent_subscription` | `level: RpcSubagentSubscriptionLevel` | `{ level }` |
| `get_subagents` | — | `{ subagents: RpcSubagentSnapshot[] }` |
| `get_subagent_messages` | `subagentId?: string`, `sessionFile?: string`, `fromByte?: number` | `RpcSubagentMessagesResult` |
| `set_model` | `provider: string`, `modelId: string` | `Model` |
| `cycle_model` | — | `{ model: Model, thinkingLevel: ThinkingLevel \| undefined, isScoped: boolean } \| null` |
| `get_available_models` | — | `{ models: Model[] }` |
| `set_thinking_level` | `level: ThinkingLevel` | None |
| `cycle_thinking_level` | — | `{ level: Effort } \| null` |
| `set_steering_mode`, `set_follow_up_mode` | `mode: "all" \| "one-at-a-time"` | None |
| `set_interrupt_mode` | `mode: "immediate" \| "wait"` | None |
| `compact` | `customInstructions?: string` | `CompactionResult` |
| `set_auto_compaction` | `enabled: boolean` | None |
| `set_auto_retry` | `enabled: boolean` | None |
| `abort_retry` | — | None |
| `bash` | `command: string` | `BashResult` |
| `abort_bash` | — | None |
| `get_session_stats` | — | `SessionStats` |
| `export_html` | `outputPath?: string` | `{ path: string }` |
| `switch_session` | `sessionPath: string` | `{ cancelled: boolean }` |
| `branch` | `entryId: string` | `{ text: string, cancelled: boolean }` |
| `get_branch_messages` | — | `{ messages: Array<{ entryId: string, text: string }> }` |
| `get_last_assistant_text` | — | `{ text: string \| null }` |
| `set_session_name` | `name: string` | None |
| `handoff` | `customInstructions?: string` | `RpcHandoffResult \| null` |
| `get_messages` | — | `{ messages: AgentMessage[] }` |
| `get_messages_page` | `cursor?: string`, `limit?: number` | `RpcMessagesPage` |
| `get_login_providers` | — | `{ providers: Array<{ id, name, available, authenticated }> }` |
| `login` | `providerId: string` | `{ providerId: string }` |

`RpcSessionState` exposes `model`, `thinkingLevel`, streaming/compaction booleans, all three queue modes, `sessionFile`, `sessionId`, `sessionName`, auto-compaction/fast-mode data, rate/count fields, `todoPhases`, optional dump content, and `contextUsage` (`rpc-types.ts:99-122`).

## Errors and codes

A failed response is exactly `{ id?, type: "response", command: string, success: false, error: string, code?: string }` (`rpc-types.ts:341-342`). `code` is explicitly optional and documented only as a machine-readable reason; the current `rpc-mode.ts` error-response call sites pass a message rather than a named code (`rpc-mode.ts:337,383,400`). Consequently, display `error`, branch on `code` only when received, and do not hard-code an enum of code values from 17.2.12.

## Outbound frame inventory

| Family | Type(s) and exact fields |
|---|---|
| Session events | `RpcSessionEventFrame = AgentSessionEvent \| RpcSubagentFrame` (`rpc-types.ts:348-365`). `AgentSessionEvent` includes core `AgentEvent` except that `agent_end` adds `isTerminal?: boolean`; extended types are `auto_compaction_start`, `auto_compaction_end`, `auto_retry_start`, `auto_retry_end`, `retry_fallback_applied`, `retry_fallback_succeeded`, `model_changed`, `ttsr_triggered`, `todo_reminder`, `todo_auto_clear`, `irc_message`, `notice`, `thinking_level_changed`, and `goal_updated` (`session/agent-session-events.ts:11-64`). |
| Subagent | `subagent_lifecycle`, `subagent_progress`, and `subagent_event`, each with `payload`; their union is `RpcSubagentFrame` (`rpc-types.ts:348-365`). Snapshots include `id`, `index`, `agent`, `agentSource`, `status`, optional description/task/assignment/session file/progress, update time, and parent tool-call id (`rpc-types.ts:165-189`). |
| State/prompt | `available_commands_update` with `commands: RpcAvailableSlashCommand[]`; `prompt_result` with `id?` and `agentInvoked` (`rpc-types.ts:133-142`). |
| Extension UI | `extension_ui_request` frames in the exact union below (`rpc-types.ts:372-428`). |
| Host tool | Server→host `host_tool_call { id, toolCallId, toolName, arguments }` and `host_tool_cancel { id, targetId }` (`rpc-types.ts:444-458`). Host→server has `host_tool_update { id, partialResult }` and `host_tool_result { id, result, isError? }` (`rpc-types.ts:460-473`). |
| Host URI | Server→host `host_uri_request { id, operation: "read" \| "write", url, content? }` and `host_uri_cancel { id, targetId }` (`rpc-types.ts:490-507`). Host→server `host_uri_result` has `id`, optional `content`, `contentType`, `notes`, `immutable`, `isError`, and `error` (`rpc-types.ts:509-528`). |
| Other notifications | `command_output`, `session_info_update`, and `config_update` are emitted in `rpc-mode.ts:999-1006`; extension/UI bridge failures emit `extension_error` (`rpc-mode.ts:940`). |

## `extension_ui_request` frames and replies

All request arms have `{ type: "extension_ui_request", id: string }` (`rpc-types.ts:372-428`).

| `method` | Exact additional fields |
|---|---|
| `select` | `title: string`, `options: string[]`, `timeout?: number` |
| `confirm` | `title: string`, `message: string`, `timeout?: number` |
| `input` | `title: string`, `placeholder?: string`, `timeout?: number` |
| `editor` | `title: string`, `prefill?: string`, `promptStyle?: boolean` |
| `cancel` | `targetId: string` |
| `notify` | `message: string`, `notifyType?: "info" \| "warning" \| "error"` |
| `setStatus` | `statusKey: string`, `statusText: string \| undefined` |
| `setWidget` | `widgetKey: string`, `widgetLines: string[] \| undefined`, `widgetPlacement?: "aboveEditor" \| "belowEditor"` |
| `setTitle` | `title: string` |
| `set_editor_text` | `text: string` |
| `open_url` | `url: string`, `launchUrl?: string`, `instructions?: string` |

A host reply is one of `{ type: "extension_ui_response", id, value: string }`, `{ ..., confirmed: boolean }`, or `{ ..., cancelled: true, timedOut?: boolean }` (`rpc-types.ts:535-538`).

## v2 chunking and frame limits

`MAX_RPC_FRAME_BYTES` is 1 MiB including newline; `MAX_RPC_REASSEMBLED_BYTES` is 64 MiB; payload chunks are 256 KiB before base64 (`rpc-frame.ts:5-10,87-116`). `RpcChunkFrame` is `{ type: "rpc_chunk", chunkId, index, count, byteLength, data }` (`rpc-types.ts:152-159`).

* v2 emits `rpc_chunk` frames only for an oversized logical frame after terminal `agent_end` compaction; frames above 64 MiB become overflow frames (`rpc-frame.ts:87-116,279-285`). v1 performs compaction/shrink passes then returns a single overflow frame (`rpc-frame.ts:191-259`).
* The decoder requires strict base64; a nonempty id at most 128 characters; integer `index`, `count`, and `byteLength`; count at least 2; contiguous ordered indices from 0; matching metadata; each decoded payload at most 256 KiB; and total bytes exactly equal to declared byte length. Reassembled size must be from 1 MiB through 64 MiB (`rpc-frame.ts:119-188`).
* Interrupted, mismatched, oversized, malformed, or non-object frames cause decoder errors (`rpc-frame.ts:135-188`). A client must reassemble before dispatch; a newline is only a physical transport boundary after v2 negotiation.
