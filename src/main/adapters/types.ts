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
  /** Set by the adapter when this permission is for executing a plan. */
  isPlanExecution?: boolean;
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

  /** Human-readable error message shown when authentication fails.
   *  E.g. 'Please run "claude auth login"' or 'Set OPENAI_API_KEY'. */
  readonly authErrorMessage: string;

  /** Release any adapter-level resources (open connections, child processes).
   *  Called during app shutdown. Optional — stateless adapters can omit. */
  dispose?(): Promise<void>;

  // ─── Optional plugin management ───

  /** List installed and available plugins. Only implement if capabilities.plugins is true. */
  listPlugins?(): Promise<{ installed: Array<{ id: string; name?: string; enabled?: boolean }>; available: unknown[] }>;
  /** Install a plugin by ID. */
  installPlugin?(pluginId: string, scope?: string): Promise<void>;
  /** Uninstall a plugin by ID. */
  uninstallPlugin?(pluginId: string): Promise<void>;
  /** Enable an installed plugin. */
  enablePlugin?(pluginId: string): Promise<void>;
  /** Disable an installed plugin. */
  disablePlugin?(pluginId: string): Promise<void>;

  // ─── Optional text generation (used by memory auto-save) ───

  /** Generate text from a system prompt and user message.
   *  Used by memory-autosave to run extraction without being coupled to a specific SDK. */
  generateText?(systemPrompt: string, userMessage: string, options?: { cwd?: string; abortSignal?: AbortSignal }): Promise<string>;

  // ─── Optional worktree configuration ───

  /** Generate agent-specific settings files inside a worktree directory.
   *  E.g. Claude Code creates `.claude/settings.local.json`. */
  generateWorktreeSettings?(wtPath: string): Promise<void>;
}
