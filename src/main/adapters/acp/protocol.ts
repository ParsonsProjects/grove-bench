/**
 * The parts of the Agent Client Protocol (version 1) Grove uses, as TypeScript
 * types. Field names follow the published schema:
 * https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/schema.json
 *
 * Everything the agent sends is checked at the point of use rather than
 * trusted to match these types: a missing field degrades to "not provided".
 */

export const ACP_PROTOCOL_VERSION = 1;

export interface AcpImplementation {
  name: string;
  title?: string | null;
  version?: string | null;
}

export interface AcpInitializeResponse {
  protocolVersion: number;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
    mcpCapabilities?: { http?: boolean; sse?: boolean };
    sessionCapabilities?: { resume?: object | null; close?: object | null; list?: object | null } | null;
  };
  agentInfo?: AcpImplementation | null;
  authMethods?: Array<{ id: string; name: string; description?: string | null; type?: string }>;
}

export interface AcpSessionMode {
  id: string;
  name: string;
  description?: string | null;
}

export interface AcpModeState {
  currentModeId: string;
  availableModes: AcpSessionMode[];
}

export interface AcpConfigSelectOption {
  value: string;
  name: string;
  description?: string | null;
}

export interface AcpConfigOption {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  type: string;
  currentValue: string | boolean;
  /** Flat values, or groups of values. */
  options?: Array<AcpConfigSelectOption | { group: string; name: string; options: AcpConfigSelectOption[] }>;
}

/** Gemini CLI's model list (the unstable `models` field, before config options). */
export interface AcpModelState {
  currentModelId: string;
  availableModels: Array<{ modelId: string; name: string; description?: string | null }>;
}

export interface AcpSessionSetup {
  sessionId?: string;
  modes?: AcpModeState | null;
  configOptions?: AcpConfigOption[] | null;
  models?: AcpModelState | null;
}

export type AcpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string; uri?: string | null }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource_link'; uri: string; name: string; title?: string | null }
  | { type: 'resource'; resource: { uri: string; text?: string; blob?: string; mimeType?: string | null } };

export type AcpToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';
export type AcpToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type AcpToolContent =
  | { type: 'content'; content: AcpContentBlock }
  | { type: 'diff'; path: string; oldText?: string | null; newText: string }
  | { type: 'terminal'; terminalId: string };

/** A tool call as reported so far (`tool_call`, merged with each `tool_call_update`). */
export interface AcpToolCall {
  toolCallId: string;
  title?: string | null;
  name?: string | null;
  kind?: AcpToolKind | null;
  status?: AcpToolStatus | null;
  content?: AcpToolContent[] | null;
  locations?: Array<{ path: string; line?: number | null }> | null;
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpPlanEntry {
  content: string;
  priority?: string;
  status?: 'pending' | 'in_progress' | 'completed';
}

export type AcpSessionUpdate =
  | { sessionUpdate: 'user_message_chunk'; content: AcpContentBlock; messageId?: string | null }
  | { sessionUpdate: 'agent_message_chunk'; content: AcpContentBlock; messageId?: string | null }
  | { sessionUpdate: 'agent_thought_chunk'; content: AcpContentBlock; messageId?: string | null }
  | ({ sessionUpdate: 'tool_call' } & AcpToolCall)
  | ({ sessionUpdate: 'tool_call_update' } & AcpToolCall)
  | { sessionUpdate: 'plan'; entries: AcpPlanEntry[] }
  | { sessionUpdate: 'available_commands_update'; availableCommands: Array<{ name: string; description?: string }> }
  | { sessionUpdate: 'current_mode_update'; currentModeId: string }
  | { sessionUpdate: 'config_option_update'; configOptions: AcpConfigOption[] }
  | { sessionUpdate: 'session_info_update'; title?: string | null; updatedAt?: string | null }
  | { sessionUpdate: 'usage_update'; used: number; size: number; cost?: { amount: number; currency: string } | null };

export type AcpStopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

/** session/prompt's answer. `usage` is the turn's token counts, when the
 *  agent reports them (OpenCode does). */
export interface AcpPromptResponse {
  stopReason: AcpStopReason;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
}

export type AcpPermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: AcpPermissionOptionKind;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: AcpToolCall;
  options: AcpPermissionOption[];
}

export type AcpPermissionOutcome =
  | { outcome: { outcome: 'cancelled' } }
  | { outcome: { outcome: 'selected'; optionId: string } };

export type AcpMcpServer =
  | { type: 'http'; name: string; url: string; headers: Array<{ name: string; value: string }> }
  | { name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> };
