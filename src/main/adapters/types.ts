/**
 * Agent adapter interfaces.
 *
 * Any AI agent (Claude Code, Codex CLI, Aider, Gemini CLI, etc.) can be
 * plugged into Grove Bench by implementing the AgentAdapter interface.
 */
import type { AgentEvent, MemoryEntry, PermissionMode, ThinkingLevel, McpServerInfo, McpConfiguredServer, McpAddServerOpts, McpConfigScope, SkillDefinition, SkillInfo, ToolCategory, ToolRule, ImageAttachment } from '../../shared/types.js';

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
  /** Supports adjusting the thinking/reasoning level at runtime */
  thinking: boolean;
  /** Supports runtime MCP server control (list status, disconnect/reconnect) */
  mcpControl?: boolean;
  /** Supports plugins/extensions */
  plugins: boolean;
  /** Supports packaged skill instructions (discovery via listSkills, authoring
   *  via addSkill, and the AdapterConfig.skills allowlist filter). */
  skills?: boolean;
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
  /** Context window in tokens; display fallback until the SDK reports the real value */
  contextWindow?: number;
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
  /** Adapter-agnostic tool category for renderer display logic. */
  toolCategory?: ToolCategory;
  /** Plan text extracted by the adapter for plan execution permissions. */
  planText?: string;
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

// ─── Memory Operations ───

/** Adapter-agnostic memory operations. Each adapter decides how to expose
 *  these to the agent (MCP tools, function calls, etc.). */
export interface MemoryOperations {
  list(): MemoryEntry[];
  read(path: string): string | null;
  write(path: string, content: string): void;
  delete(path: string): boolean;
}

// ─── Adapter Configuration ───

export interface AdapterConfig {
  cwd: string;
  permissionMode: PermissionMode;
  /** Model to start the session with. When unset, the provider's own default is used. */
  model?: string | null;
  appendSystemPrompt?: string | null;
  customSystemPrompt?: string | null;
  allowedTools?: Set<string> | null;
  /** Skill allowlist for the session. When unset, the provider's own defaults
   *  apply (all discovered skills enabled). An array enables only the listed
   *  skills — used to honor the user's disabled-skills setting. */
  skills?: string[] | null;
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> } | null;
  sandbox?: Record<string, unknown> | null;
  extraEnv?: Record<string, string> | null;
  /** Thinking level to start the session at. When unset (or 'high'), the
   *  provider's own default reasoning behavior applies. */
  thinkingLevel?: ThinkingLevel | null;
  /** Memory operations for this session's repo. Adapters decide how to surface
   *  these to the agent (e.g. Claude Code registers them as an SDK MCP server). */
  memoryOperations?: MemoryOperations | null;
  resumeSessionId?: string | null;
  /** Resume the conversation only up to and including this provider chain-entry
   *  UUID, forking to a new provider session id (used by rewind so the agent
   *  keeps the turns before the rewind point and forgets everything after).
   *  Only meaningful together with resumeSessionId. */
  resumeAtUuid?: string | null;
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
  /** Interrupt the current turn *without* killing the process, so the session
   *  stays alive and the next message can be sent immediately (no cold respawn
   *  or resume). Optional — adapters that can't interrupt in place are stopped
   *  via close()/abort() and a fresh query instead. */
  interrupt?(): Promise<void>;
  /** The provider-specific session ID (for resumption), available after system_init */
  getSessionId(): string | null;
  /** Signal no more messages — for single-shot sessions */
  closeInput?(): void;

  // ─── Optional runtime controls — check adapter capabilities first ───

  setModel?(model: string): Promise<void>;
  setPermissionMode?(mode: PermissionMode): void;
  /** Adjust the thinking/reasoning level. Adapters map the level to their
   *  provider's mechanism (token budgets, effort params, plain on/off). */
  setThinkingLevel?(level: ThinkingLevel): Promise<void>;

  // ─── Optional MCP server control — check capabilities.mcpControl first ───

  /** Current status of the agent's MCP server connections. */
  listMcpServers?(): Promise<McpServerInfo[]>;
  /** Reconnect a (failed or disconnected) MCP server by name. */
  reconnectMcpServer?(serverName: string): Promise<void>;
  /** Enable (connect) or disable (disconnect) an MCP server by name. */
  setMcpServerEnabled?(serverName: string, enabled: boolean): Promise<void>;
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

  // ─── Optional MCP server configuration (CLI config, not per-session) ───

  /** List MCP servers from the provider's configuration. Only implement if
   *  capabilities.mcpControl is true. `cwd` scopes local/project servers. */
  listConfiguredMcpServers?(cwd?: string): Promise<McpConfiguredServer[]>;
  /** Register a new MCP server in the provider's configuration. */
  addConfiguredMcpServer?(opts: McpAddServerOpts): Promise<void>;
  /** Remove an MCP server from the provider's configuration. */
  removeConfiguredMcpServer?(name: string, scope?: McpConfigScope, cwd?: string): Promise<void>;

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

  // ─── Optional skill management ───

  /** Skills visible to a session rooted at `worktreePath`, in whatever native
   *  format the provider uses, mapped to neutral SkillInfo entries. Only
   *  implement if capabilities.skills is true. */
  listSkills?(worktreePath: string): Promise<SkillInfo[]>;
  /** Author a new skill from the neutral definition, serialized into the
   *  provider's native format (e.g. Claude Code writes
   *  `.claude/skills/<name>/SKILL.md`). Project scope writes into the
   *  worktree so the skill travels with the branch; user scope writes to the
   *  provider's global location. Rejects if the skill already exists. */
  addSkill?(worktreePath: string, def: SkillDefinition): Promise<SkillInfo>;

  // ─── Optional text generation (used by memory auto-save) ───

  /** Generate text from a system prompt and user message.
   *  Used by memory-autosave to run extraction without being coupled to a specific SDK. */
  generateText?(systemPrompt: string, userMessage: string, options?: { cwd?: string; abortSignal?: AbortSignal }): Promise<string>;

  // ─── Optional worktree configuration ───

  /** Generate agent-specific settings files inside a worktree directory.
   *  E.g. Claude Code creates `.claude/settings.local.json`. */
  generateWorktreeSettings?(wtPath: string): Promise<void>;
}
