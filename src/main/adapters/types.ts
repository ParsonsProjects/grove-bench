/**
 * Agent adapter interfaces.
 *
 * Any AI agent (Claude Code, Codex CLI, Aider, Gemini CLI, etc.) can be
 * plugged into Grove Bench by implementing the AgentAdapter interface.
 */
import type { ToolView } from '../../shared/tool-view.js';
import type { AgentStage, AgentEvent, MemoryEntry, PermissionMode, ControlDescriptor, ProviderUsage, McpServerInfo, McpAuthStartResult, McpConfiguredServer, McpAddServerOpts, McpConfigScope, McpElicitationRequest, McpElicitationResponse, McpServerContextCost, McpSupport, SkillDefinition, SkillInfo, ToolCategory, ToolRule, ImageAttachment, ImageMediaType } from '../../shared/types.js';

// ─── Capability Flags ───

export interface AgentCapabilities {
  /** Supports permission prompting via canUseTool callback */
  permissions: boolean;
  /** Supports switching permission modes at runtime */
  permissionModes: boolean;
  /** Supports resuming a previous conversation */
  resume: boolean;
  /** Can resume a conversation cut off at an earlier point, forgetting the
   *  turns after it (AdapterConfig.resumeAtUuid). Rewinding a conversation on
   *  an agent without it starts the agent on a new conversation. */
  rewind?: boolean;
  /** Supports switching models at runtime */
  modelSwitching: boolean;
  /** Supports adjusting the thinking/reasoning level at runtime */
  thinking: boolean;
  /** Can return a readable summary of the model's thinking, switched by the
   *  showThinkingSummaries setting (see AdapterConfig.thinkingSummaries). */
  thinkingSummaries?: boolean;
  /** Supports plugins/extensions */
  plugins: boolean;
  /** Supports packaged skill instructions (discovery via listSkills, authoring
   *  via addSkill, and the AdapterConfig.skills allowlist filter). */
  skills?: boolean;
  /** Reports account-level plan usage windows (see AgentQueryHandle.getUsage) */
  usage?: boolean;
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
  /** What the call does, for adapters whose tools aren't Claude Code's (see
   *  shared/tool-view.ts). Read-safe mode and the prompt's display use it. */
  toolView?: ToolView;
  /** Plan text extracted by the adapter for plan execution permissions. */
  planText?: string;
}

export type PermissionResponse =
  | { behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { behavior: 'deny'; message: string };

export type PermissionHandler = (request: PermissionRequest) => Promise<PermissionResponse>;

/** Ask the user to answer an MCP elicitation. `signal` aborts when the agent
 *  stops waiting (the server gave up or the query ended). */
export type ElicitationHandler = (request: McpElicitationRequest, signal: AbortSignal) => Promise<McpElicitationResponse>;

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

// ─── Preview (browser) Operations ───

/** Where to click or type: a CSS selector, the visible text of a clickable
 *  element, or the label/placeholder/name of a form field. */
export interface PreviewTarget {
  selector?: string;
  text?: string;
  label?: string;
}

export interface PreviewScreenshot {
  data: Buffer;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  url: string;
}

/** Adapter-agnostic browser operations on the conversation's Preview page for
 *  the agent (its own page, separate from the one the user drives). Text
 *  results are ready to show the agent. Failures throw with a readable message. */
export interface PreviewOperations {
  open(opts: { url?: string; width?: number; height?: number }): Promise<string>;
  screenshot(): Promise<PreviewScreenshot>;
  read(opts: { selector?: string; maxChars?: number }): Promise<string>;
  logs(opts: { errorsOnly?: boolean; all?: boolean }): Promise<string>;
  /** `dialogs`: how to answer an alert or confirm the action opens (default accept). */
  click(target: PreviewTarget, opts?: { dialogs?: 'accept' | 'dismiss' }): Promise<string>;
  type(target: PreviewTarget, text: string, opts: { clear?: boolean; submit?: boolean; dialogs?: 'accept' | 'dismiss' }): Promise<string>;
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
  /** Values for the adapter's declared controls (see getControls) to start
   *  the session with, keyed by control id. permissionMode is passed
   *  separately. Missing ids mean the provider default applies. */
  controls?: Record<string, string> | null;
  /** Show a readable summary of the model's thinking (false: show none).
   *  Unset means true. Only adapters with the thinkingSummaries capability
   *  read it. */
  thinkingSummaries?: boolean;
  /** Memory operations for this session's repo. Adapters decide how to surface
   *  these to the agent (e.g. Claude Code registers them as an SDK MCP server). */
  memoryOperations?: MemoryOperations | null;
  /** Browser operations on the conversation's Preview page. Unset when the
   *  user turned the agent's browser tools off. */
  previewOperations?: PreviewOperations | null;
  resumeSessionId?: string | null;
  /** Resume the conversation only up to and including this provider chain-entry
   *  UUID, forking to a new provider session id (used by rewind so the agent
   *  keeps the turns before the rewind point and forgets everything after).
   *  Only meaningful together with resumeSessionId. */
  resumeAtUuid?: string | null;
  onPermissionRequest: PermissionHandler;
  /** Answers MCP elicitations. Without it the adapter declines them. */
  onElicitation?: ElicitationHandler;
  toolAllowRules: ToolRule[];
  toolDenyRules: ToolRule[];
  alwaysAllowedTools: Set<string>;
}

// ─── Running Query Handle ───

/** Image data a tool returned, before the session manager saves it. */
export interface ToolImageData {
  /** base64-encoded image data (no data: prefix) */
  data: string;
  mediaType: ImageMediaType;
}

/** An event as an adapter yields it: an AgentEvent, except that a tool_result
 *  carries the image data its tool returned. The session manager saves those
 *  images and passes the event on with references instead (attachments.ts). */
export type AdapterEvent =
  | Exclude<AgentEvent, { type: 'tool_result' }>
  | (Omit<Extract<AgentEvent, { type: 'tool_result' }>, 'images'> & { imageData?: ToolImageData[] });

/** Thrown by a handle's `events` when the agent no longer has the conversation
 *  it was asked to resume (e.g. its transcript was deleted). The session
 *  manager then starts a new conversation instead. */
export class ResumeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeNotFoundError';
  }
}

/** Represents a running agent query. Returned by adapter.start(). */
export interface AgentQueryHandle {
  /** Async iterable of events from the agent */
  events: AsyncIterable<AdapterEvent>;
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
  /** Stop a single running background task by id. The adapter emits a
   *  task_notification with taskStatus 'stopped' once it is gone. Optional. */
  stopTask?(taskId: string): Promise<void>;
  /** The provider-specific session ID (for resumption), available after system_init */
  getSessionId(): string | null;
  /** Signal no more messages — for single-shot sessions */
  closeInput?(): void;
  /** PID of the local agent process while it is running: undefined before it
   *  spawns and once it has exited. Closing the conversation kills this
   *  process tree so background tasks don't keep ports open. */
  processId?(): number | undefined;

  // ─── Optional runtime controls — check adapter capabilities first ───

  setModel?(model: string): Promise<void>;
  setPermissionMode?(mode: PermissionMode): void;
  /** Apply a declared control (anything but permissionMode) mid-session.
   *  Adapters map the value to their provider's mechanism (token budgets,
   *  effort params, flag settings, ...). Values are pre-validated against
   *  the descriptors from getControls(). */
  setControl?(controlId: string, value: string): Promise<void>;

  /** Current plan usage for the account behind this query. Returns null when
   *  the provider has no such data. Check capabilities.usage first. */
  getUsage?(): Promise<ProviderUsage | null>;

  // ─── Optional MCP server control — declare each in AgentAdapter.mcp.controls ───

  /** Current status of the agent's MCP server connections. */
  listMcpServers?(): Promise<McpServerInfo[]>;
  /** Context-window cost of each server's tool definitions. */
  getMcpContextCost?(): Promise<McpServerContextCost[]>;
  /** Reconnect a (failed or disconnected) MCP server by name. */
  reconnectMcpServer?(serverName: string): Promise<void>;
  /** Enable (connect) or disable (disconnect) an MCP server by name. */
  setMcpServerEnabled?(serverName: string, enabled: boolean): Promise<void>;
  /** Start an OAuth sign-in for a server stuck in `needs-auth`. Returns the
   *  URL the user must open; the caller is responsible for opening it. */
  authenticateMcpServer?(serverName: string): Promise<McpAuthStartResult>;
}

// ─── Prerequisite Status ───

export interface AdapterPrerequisiteStatus {
  available: boolean;
  path?: string;
  authenticated?: boolean;
  /** Signing in can't be checked before a session starts, so `authenticated`
   *  only means nothing says it is missing. */
  authUnchecked?: boolean;
  authMethod?: string;
  email?: string;
  errorMessage?: string;
  installCommand?: string;
  /** The agent's own words the last time it turned Grove down for sign-in
   *  (e.g. Gemini CLI's "This client is no longer supported..."). */
  authMessage?: string;
  /** Conversations need the installed program even with a saved key. */
  installRequired?: boolean;
}

/** What a sign-in check found: signed in, turned down (with the agent's
 *  reason), or couldn't tell (null). */
export interface SignInCheck {
  signedIn: boolean | null;
  message?: string;
}

/** An API key the user can enter in the app instead of signing in through the
 *  provider's CLI. The main process stores it encrypted (see credentials.ts)
 *  and the adapter passes it to the agent in `envVar`. */
export interface ApiKeyDescriptor {
  /** Environment variable the agent reads the key from. */
  envVar: string;
  /** Field label shown in the UI, e.g. "Anthropic API key". */
  label: string;
  /** Page where the user can create a key. */
  helpUrl: string;
  /** How using a key is paid for, shown under the field, e.g. that it is
   *  billed separately from a subscription. */
  billingNote?: string;
  /** ACP agents: the sign-in method to ask for with the saved key when the
   *  agent turns a session down (Gemini CLI's 'gemini-api-key'). The key
   *  goes in the request's `_meta['api-key']`. */
  authMethodId?: string;
}

/** Signing in through the provider's own CLI instead of an API key: the
 *  user runs the CLI in a terminal and its own sign-in flow stores the
 *  credentials. Grove never handles them. */
export interface CliSignInDescriptor {
  /** What the sign-in uses, for a heading such as "Use your Claude plan". */
  accountLabel: string;
  /** Who can sign in this way, e.g. "Pro, Max, Team or Enterprise". */
  accountDetail?: string;
  /** The CLI's product name, e.g. "Claude Code". */
  cliName: string;
  /** The command that signs in, or starts the CLI so it asks
   *  (e.g. `copilot login`, `claude`). Shown with a copy button. */
  command: string;
  /** The provider's install and setup page. */
  setupUrl: string;
}

// ─── The Adapter Interface ───

export interface AgentAdapter {
  /** Unique identifier: 'claude-code', 'codex-cli', 'aider', etc. */
  readonly id: string;
  /** Human-readable name for UI display */
  readonly displayName: string;
  /** What this adapter supports */
  readonly capabilities: AgentCapabilities;
  /** How the agent handles MCP servers: which controls the UI may offer, and
   *  the wording and rules it uses. Omit when the agent has no MCP support
   *  Grove can drive; the UI then shows none. */
  readonly mcp?: McpSupport;

  /** Available models for this provider, default first. May change at run
   *  time when the provider reports its current list (see onModelsChanged). */
  getModels(): ModelInfo[];

  /** Subscribe to changes in getModels() (and anything derived from it, such
   *  as getControls or backgroundModel). Returns an unsubscribe function. */
  onModelsChanged?(listener: () => void): () => void;

  /** Runtime controls this provider exposes for `model` (null = provider
   *  default model). Must include a `permissionMode` descriptor whose values
   *  are Grove PermissionMode ids the adapter can honour; every other id is
   *  provider-defined. Option sets may differ per model — the session manager
   *  resets values that stop being valid after a model switch. */
  getControls(model?: string | null): ControlDescriptor[];

  /** Check if the agent CLI/SDK is available and authenticated */
  checkPrerequisites(): Promise<AdapterPrerequisiteStatus>;

  /** Start a new agent query, returning a handle to interact with it */
  start(config: AdapterConfig): Promise<AgentQueryHandle>;

  /** Human-readable error message shown when authentication fails.
   *  E.g. 'Please run "claude auth login"' or 'Set OPENAI_API_KEY'. */
  readonly authErrorMessage: string;

  /** Set when the provider accepts an API key entered in the app. */
  readonly apiKey?: ApiKeyDescriptor;

  /** Ask the provider whether `key` works, before it is saved: true when it
   *  is accepted, false when it is refused, null when that couldn't be told
   *  (offline, a custom endpoint). Omit to save keys unchecked. */
  verifyApiKey?(key: string): Promise<boolean | null>;

  /** Set when the user can sign in with the provider's CLI instead. */
  readonly cliSignIn?: CliSignInDescriptor;

  /** Find out for real whether the agent is signed in, for agents whose
   *  prerequisite check can't tell (it starts the agent briefly). */
  checkSignIn?(): Promise<SignInCheck>;

  /** Cheap model for background tasks run on this agent: memory notes and
   *  compaction, commit messages, skill suggestions. Used unless the user
   *  picks another in Settings > Agents. Omit to use the agent's own default. */
  readonly backgroundModel?: string;

  /** 'alpha' while Grove Bench's support for the agent is still being
   *  tested: it is offered only once the user turns it on (AgentStage). */
  readonly stage?: AgentStage;

  /** Release any adapter-level resources (open connections, child processes).
   *  Called during app shutdown. Optional — stateless adapters can omit. */
  dispose?(): Promise<void>;

  // ─── Optional MCP server configuration (CLI config, not per-session) ───

  /** List MCP servers from the provider's configuration (Settings > MCP servers;
   *  describe it in mcp.config). `cwd` scopes local/project servers. */
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
   *  Used by memory-autosave to run extraction without being coupled to a specific SDK.
   *  `model` overrides the provider default (e.g. a cheaper model for background calls). */
  generateText?(systemPrompt: string, userMessage: string, options?: { cwd?: string; abortSignal?: AbortSignal; model?: string }): Promise<string>;

  // ─── Optional conversation title ───

  /** The provider's own title for a conversation (e.g. one it generated from
   *  the first prompt), or null when it has none yet. `cwd` is the directory
   *  the conversation ran in. Grove falls back to a heuristic name without it. */
  getConversationTitle?(providerSessionId: string, cwd: string): Promise<string | null>;

  // ─── Optional worktree configuration ───

  /** Untracked files generateWorktreeSettings writes, relative to the
   *  worktree with forward slashes. Deleting a worktree doesn't count them as
   *  unsaved work. */
  readonly generatedFiles?: readonly string[];

  /** Generate agent-specific settings files inside a worktree directory.
   *  E.g. Claude Code creates `.claude/settings.local.json`. `repoPath` is the
   *  project the worktree belongs to, for settings carried over from it. */
  generateWorktreeSettings?(wtPath: string, repoPath?: string): Promise<void>;

  /** Approve a project-scope MCP server (e.g. from `.mcp.json`) in each of
   *  `dirs`: the project root and its conversations' worktrees. */
  approveProjectMcpServer?(name: string, dirs: string[]): Promise<void>;
}
