/**
 * Agent adapter interfaces.
 *
 * Any AI agent (Claude Code, Codex CLI, Aider, Gemini CLI, etc.) can be
 * plugged into Grove Bench by implementing the AgentAdapter interface.
 */
import type { AgentEvent, PermissionMode, ToolRule, ImageAttachment } from '../../shared/types.js';

// ─── Capability Flags ───

export interface AgentCapabilities {
  /** Supports permission prompting via canUseTool callback */
  permissions: boolean;
  /** Supports switching permission modes at runtime */
  permissionModes: boolean;
  /** Supports resuming a previous conversation */
  resume: boolean;
  /** Supports switching models at runtime */
  modelSwitching: boolean;
  /** Supports toggling extended thinking */
  thinking: boolean;
  /** Supports plugins/extensions */
  plugins: boolean;
  /** Supports image attachments in messages */
  imageAttachments: boolean;
  /** Supports structured JSON output */
  structuredOutput: boolean;
  /** Supports sandbox/restricted execution */
  sandbox: boolean;
}

// ─── Model Info ───

export interface ModelInfo {
  id: string;
  label: string;
  /** Optional grouping, e.g. "Claude", "GPT" */
  family?: string;
}

// ─── Permission Handling ───

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolUseId: string;
  toolInput: Record<string, unknown>;
  decisionReason?: string;
  suggestions?: unknown[];
}

export type PermissionResponse =
  | { behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { behavior: 'deny'; message: string };

export type PermissionHandler = (request: PermissionRequest) => Promise<PermissionResponse>;

// ─── User Message ───

export interface UserMessage {
  text: string;
  images?: ImageAttachment[];
}

// ─── Adapter Configuration ───

export interface AdapterConfig {
  cwd: string;
  permissionMode: PermissionMode;
  appendSystemPrompt?: string | null;
  customSystemPrompt?: string | null;
  allowedTools?: Set<string> | null;
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> } | null;
  sandbox?: Record<string, unknown> | null;
  extraEnv?: Record<string, string> | null;
  resumeSessionId?: string | null;
  onPermissionRequest: PermissionHandler;
  toolAllowRules: ToolRule[];
  toolDenyRules: ToolRule[];
  alwaysAllowedTools: Set<string>;
}

// ─── Running Query Handle ───

/** Represents a running agent query. Returned by adapter.start(). */
export interface AgentQueryHandle {
  /** Async iterable of events from the agent */
  events: AsyncIterable<AgentEvent>;
  /** Send a follow-up user message into the conversation */
  sendMessage(message: UserMessage): void;
  /** Abort the current query */
  abort(): void;
  /** Close the query gracefully */
  close(): void;
  /** The provider-specific session ID (for resumption), available after system_init */
  getSessionId(): string | null;
  /** Signal no more messages — for single-shot sessions */
  closeInput?(): void;

  // ─── Optional runtime controls — check adapter capabilities first ───

  setModel?(model: string): Promise<void>;
  setPermissionMode?(mode: PermissionMode): void;
  setMaxThinkingTokens?(tokens: number | null): Promise<void>;
}

// ─── Prerequisite Status ───

export interface AdapterPrerequisiteStatus {
  available: boolean;
  path?: string;
  authenticated?: boolean;
  authMethod?: string;
  email?: string;
  errorMessage?: string;
  installInstructions?: string;
}

// ─── The Adapter Interface ───

export interface AgentAdapter {
  /** Unique identifier: 'claude-code', 'codex-cli', 'aider', etc. */
  readonly id: string;
  /** Human-readable name for UI display */
  readonly displayName: string;
  /** What this adapter supports */
  readonly capabilities: AgentCapabilities;

  /** Available models for this provider */
  getModels(): ModelInfo[];

  /** Check if the agent CLI/SDK is available and authenticated */
  checkPrerequisites(): Promise<AdapterPrerequisiteStatus>;

  /** Start a new agent query, returning a handle to interact with it */
  start(config: AdapterConfig): Promise<AgentQueryHandle>;

  /** Release any adapter-level resources (open connections, child processes).
   *  Called during app shutdown. Optional — stateless adapters can omit. */
  dispose?(): Promise<void>;
}
