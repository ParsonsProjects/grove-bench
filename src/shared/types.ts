// ─── Worktree ───

export interface WorktreeConfig {
  repoPath: string;
  branchName: string;
  baseBranch?: string;
  useExisting?: boolean;
  /** Pre-generated ID — if omitted, a random one is created. */
  id?: string;
  /** Which adapter will run in this worktree (for generating agent-specific settings). */
  adapterType?: string;
}

export interface WorktreeInfo {
  id: string;
  path: string;
  branch: string;
  repoPath: string;
  createdAt: number;
  /** True when session runs directly on the repo (no worktree created). */
  direct?: boolean;
}

export interface WorktreeRepoConfig {
  copyFiles: string[];
}

// ─── Session ───

export interface CreateSessionOpts {
  repoPath: string;
  branchName: string;
  baseBranch?: string;
  useExisting?: boolean;
  /** Run directly on the repo checkout — no worktree is created. */
  direct?: boolean;
  /** Which adapter to use for this session (defaults to registry default). */
  adapterType?: string;
}

export type SessionStatus = 'starting' | 'installing' | 'running' | 'stopped' | 'error';

export interface SessionInfo {
  id: string;
  branch: string;
  worktreePath: string;
  repoPath: string;
  status: SessionStatus;
  agentType: string;
  createdAt: number;
  /** User-assigned display name — shown instead of branch when set. */
  displayName?: string | null;
}

// ─── Prerequisites ───

export interface PrerequisiteStatus {
  git: {
    available: boolean;
    version?: string;
    meetsMinimum?: boolean;
  };
  agent: {
    available: boolean;
    path?: string;
    authenticated?: boolean;
    authMethod?: string;
    email?: string;
    /** Adapter-provided error message when not available (e.g. install instructions). */
    errorMessage?: string;
    /** Adapter-provided message when not authenticated. */
    authErrorMessage?: string;
  };
}

// ─── Tool Categories (adapter-agnostic) ───

/**
 * Adapter-agnostic tool categories for renderer display logic.
 * Adapters map their provider-specific tool names to these categories
 * so the renderer doesn't need to know provider-specific tool names.
 */
export type ToolCategory = 'edit' | 'bash' | 'question' | 'web_fetch' | 'agent' | 'other';

// ─── Agent Events (renderer-side, serializable) ───

/**
 * Serializable events sent from main → renderer via IPC.
 * These are adapter-agnostic events simplified for safe serialization
 * across the IPC boundary.
 */
export type AgentEvent =
  | { type: 'system_init'; sessionId: string; model: string; tools: string[]; agents?: string[]; skills?: string[]; slashCommands?: string[]; mcpServers?: { name: string; status: string }[] }
  | { type: 'assistant_text'; text: string; uuid: string }
  | { type: 'assistant_tool_use'; toolName: string; toolInput: unknown; toolUseId: string; uuid: string; toolCategory?: ToolCategory }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'result'; subtype: string; result?: string; structured_output?: unknown; totalCostUsd?: number; durationMs?: number; isError: boolean; errors?: string[]; numTurns?: number; contextWindow?: number }
  | { type: 'permission_request'; toolName: string; toolInput: unknown; toolUseId: string; requestId: string; decisionReason?: string; suggestions?: unknown[]; isPlanExecution?: boolean; toolCategory?: ToolCategory; planText?: string }
  | { type: 'thinking'; thinking: string; uuid: string }
  | { type: 'partial_text'; text: string }
  | { type: 'partial_thinking'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number }
  | { type: 'compact_boundary'; trigger: 'manual' | 'auto'; preTokens: number }
  | { type: 'tool_progress'; toolName: string; toolUseId: string; elapsedSeconds: number }
  | { type: 'activity'; activity: 'thinking' | 'tool_starting' | 'generating' | 'idle' ; toolName?: string }
  | { type: 'user_message'; text: string }
  | { type: 'devserver_detected'; port: number; url: string }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | { type: 'process_exit'; exitCode?: number }
  // Rate limiting
  | { type: 'rate_limit'; status: 'allowed' | 'allowed_warning' | 'rejected'; resetsAt?: number; utilization?: number; rateLimitType?: string }
  // Background tasks (Agent tool sub-tasks)
  | { type: 'task_started'; taskId: string; toolUseId?: string; description: string; taskType?: string }
  | { type: 'task_progress'; taskId: string; toolUseId?: string; description: string; summary?: string; lastToolName?: string; totalTokens: number; toolUses: number; durationMs: number }
  | { type: 'task_notification'; taskId: string; toolUseId?: string; taskStatus: 'completed' | 'failed' | 'stopped'; summary: string; outputFile: string; totalTokens?: number; toolUses?: number; durationMs?: number }
  // Auth status
  | { type: 'auth_status'; isAuthenticating: boolean; output: string[]; authError?: string }
  // Tool use summary (after compaction)
  | { type: 'tool_use_summary'; summary: string; toolUseIds: string[] }
  // Prompt suggestions
  | { type: 'prompt_suggestion'; suggestion: string }
  // Hook execution
  | { type: 'hook_event'; subtype: 'started' | 'progress' | 'response'; hookId: string; hookName: string; hookEvent: string; output?: string; outcome?: string; exitCode?: number }
  // MCP elicitation complete
  | { type: 'elicitation_complete'; serverName: string; elicitationId: string }
  // Files persisted to disk
  | { type: 'files_persisted'; files: { filename: string; fileId: string }[]; failed: { filename: string; error: string }[] }
  // Permission mode sync (from adapter status messages)
  | { type: 'mode_sync'; mode: PermissionMode }
  // Permission resolved (authoritative — emitted by main for all resolution paths)
  | { type: 'permission_resolved'; requestId: string; toolUseId: string; decision: 'allow' | 'deny' }
  // Memory auto-save status
  | { type: 'memory_autosave'; status: 'started' | 'completed' | 'skipped'; filesWritten?: string[] };

// ─── PTY / Terminal ───

/** @deprecated Legacy shell output event — replaced by PTY data stream. */
export interface ShellOutputEvent {
  execId: string;
  stream: 'stdout' | 'stderr' | 'exit';
  data?: string;
  exitCode?: number;
}

/** Permission decision from renderer → main */
export interface PermissionDecision {
  requestId: string;
  behavior: 'allow' | 'deny' | 'allowAlways';
  message?: string; // denial message
  updatedPermissions?: unknown[]; // PermissionUpdate[] from adapter suggestions
}

// ─── Git Status ───

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied';

export interface GitStatusEntry {
  filePath: string;
  status: GitFileStatus;
  staged: boolean;
  origPath?: string;
}

export interface GitStatusResult {
  entries: GitStatusEntry[];
}

// ─── PR Info ───

export interface PrInfo {
  number: number;
  url: string;
}

// ─── Image Attachment ───

export interface ImageAttachment {
  /** base64-encoded image data (no data: prefix) */
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  name: string;
}

// ─── Plugins ───

export interface InstalledPlugin {
  id: string;
  version: string;
  scope: 'user' | 'project' | 'local';
  enabled: boolean;
  installPath: string;
  installedAt: string;
  lastUpdated: string;
  projectPath?: string;
}

export interface AvailablePlugin {
  pluginId: string;
  name: string;
  description: string;
  marketplaceName: string;
  version: string;
  source: string;
  installCount: number;
}

export interface PluginListResult {
  installed: InstalledPlugin[];
  available: AvailablePlugin[];
}

// ─── Dev Server ───

export interface DevServerSuccess {
  port: number;
  url: string;
}

export interface DevServerFailure {
  reason: 'exited' | 'error' | 'timeout';
  exitCode: number | null;
  lastOutput: string;
  errorMessage?: string;
}

export type DevServerResult = DevServerSuccess | DevServerFailure;

// ─── IPC API (exposed via contextBridge) ───

export interface GroveBenchAPI {
  // Repo operations
  addRepo(): Promise<string | null>;
  removeRepo(repoPath: string): Promise<void>;
  validateRepo(path: string): Promise<boolean>;

  // Session operations
  createSession(opts: CreateSessionOpts): Promise<{ id: string; branch: string }>;
  resumeSession(id: string, repoPath: string): Promise<{ id: string; branch: string }>;
  stopSession(id: string): Promise<void>;
  destroySession(id: string, deleteBranch?: boolean): Promise<void>;
  renameSession(sessionId: string, displayName: string): Promise<void>;
  listSessions(): Promise<SessionInfo[]>;

  // Worktree operations
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>;
  listRepos(): Promise<string[]>;

  // Branch operations
  listBranches(repoPath: string): Promise<string[]>;
  renameBranch(sessionId: string, newBranchName: string): Promise<{ branch: string }>;

  // Agent I/O (replaces terminal I/O)
  sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): void;
  respondToPermission(sessionId: string, decision: PermissionDecision): Promise<boolean>;
  onAgentEvent(sessionId: string, callback: (event: AgentEvent) => void): () => void;
  offAgentEvent(sessionId: string): void;
  getEventHistory(sessionId: string): Promise<AgentEvent[]>;
  clearEventHistory(sessionId: string): Promise<void>;

  // Prerequisites
  checkPrerequisites(): Promise<PrerequisiteStatus>;

  // Session status updates (from main → renderer)
  onSessionStatus(callback: (sessionId: string, status: SessionStatus) => void): () => void;

  // Mode control
  setMode(sessionId: string, mode: PermissionMode): Promise<void>;

  // Model control
  setModel(sessionId: string, model?: string): Promise<void>;

  // Thinking control
  setThinking(sessionId: string, enabled: boolean): Promise<void>;

  // File operations (for @ file picker)
  listFiles(sessionId: string): Promise<string[]>;
  readFile(sessionId: string, filePath: string): Promise<string>;
  openInEditor(sessionId: string, filePath: string, line?: number): Promise<void>;

  // File revert (for changes review)
  revertFile(sessionId: string, filePath: string, staged?: boolean): Promise<void>;
  getFileDiff(sessionId: string, filePath: string): Promise<string>;

  // Git status
  getGitStatus(sessionId: string): Promise<GitStatusResult>;

  // PR info
  getPrInfo(sessionId: string): Promise<PrInfo | null>;

  // External links
  openExternal(url: string): Promise<void>;

  // Localhost process cleanup
  killPort(port: number): Promise<void>;

  // Dev server
  startDevServer(sessionId: string, command?: string): Promise<DevServerResult>;
  stopDevServer(sessionId: string): Promise<void>;

  // Plugins
  pluginList(): Promise<PluginListResult>;
  pluginInstall(pluginId: string, scope?: string): Promise<void>;
  pluginUninstall(pluginId: string): Promise<void>;
  pluginEnable(pluginId: string): Promise<void>;
  pluginDisable(pluginId: string): Promise<void>;

  // Folder
  openSessionFolder(sessionId: string): Promise<void>;

  // Memory
  memoryList(repoPath: string): Promise<MemoryEntry[]>;
  memoryRead(repoPath: string, relativePath: string): Promise<string | null>;
  memoryWrite(repoPath: string, relativePath: string, content: string): Promise<void>;
  memoryDelete(repoPath: string, relativePath: string): Promise<boolean>;

  // Shell / Terminal (legacy)
  shellRun(sessionId: string, command: string): Promise<string>;
  shellKill(execId: string): Promise<void>;
  shellInput(execId: string, data: string): void;
  onShellOutput(sessionId: string, callback: (event: ShellOutputEvent) => void): () => void;

  // PTY Terminal (per-session persistent shell)
  ptySpawn(sessionId: string): Promise<boolean>;
  ptyWrite(sessionId: string, data: string): void;
  ptyResize(sessionId: string, cols: number, rows: number): void;
  ptyKill(sessionId: string): Promise<void>;
  ptyIsAlive(sessionId: string): Promise<boolean>;
  onPtyData(sessionId: string, callback: (data: string) => void): () => void;
  onPtyExit(sessionId: string, callback: (exitCode: number, signal?: number) => void): () => void;

  // Settings
  getSettings(): Promise<GroveBenchSettings>;
  saveSettings(settings: GroveBenchSettings): Promise<void>;

  // App state persistence
  getActiveTab(): Promise<string | null>;
  setActiveTab(id: string | null): void;
  getOpenTabs(): Promise<string[]>;
  setOpenTabs(ids: string[]): void;

  // App lifecycle
  onAppClosing(callback: () => void): () => void;
  onPowerResume(callback: () => void): () => void;

  // Window controls
  winMinimize(): void;
  winMaximize(): void;
  winClose(): void;
  winIsMaximized(): Promise<boolean>;

  // Agent adapters
  listAdapters(): Promise<Array<{ id: string; displayName: string; capabilities: Record<string, boolean> }>>;
  getModels(adapterType?: string): Promise<Array<{ id: string; label: string; family?: string }>>;

  // Auto-update
  checkForUpdate(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
}

// ─── Settings ───

export interface ToolRule {
  pattern: string; // e.g. "Bash(npm run *)", "Read(/src/**)", "mcp__*"
}

export type SettingsPermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';

export interface GroveBenchSettings {
  // Permission & Security
  defaultPermissionMode: SettingsPermissionMode;
  toolAllowRules: ToolRule[];
  toolDenyRules: ToolRule[];
  disableBypassMode: boolean;

  // Agent Defaults
  defaultModel: string;
  extendedThinking: boolean;
  workingDirectories: string[];
  defaultSystemPromptAppend: string;

  // Dev Server
  /** Default dev command (e.g. 'npm run dev'). Auto-detected from package.json if blank. */
  devCommand: string;

  // Memory
  /** Enable auto-save of memories at end of session / compaction. Default true. */
  memoryAutoSave: boolean;

  // Worktree
  /** Automatically run npm install in new worktrees. Default false. */
  autoInstallDeps: boolean;

  // General
  defaultBaseBranch: string;
  theme: 'system' | 'dark' | 'light';
  alwaysOnTop: boolean;

  // Editor
  /** Default diff view mode in the Changes tab. */
  diffViewMode: 'unified' | 'side-by-side';
  /** Enable spell checking in the prompt textarea. */
  spellcheck: boolean;
}

// ─── Memory ───

export interface MemoryEntry {
  relativePath: string;  // e.g. "repo/overview.md"
  title: string;         // from frontmatter
  updatedAt: string;     // ISO date from frontmatter
  folder: string;        // e.g. "repo", "conventions", "sessions"
}

// ─── Auto-Update ───

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseName?: string;
  releaseDate?: string;
}

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; info: UpdateInfo }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; info: UpdateInfo }
  | { state: 'error'; message: string };

// ─── IPC Channel Names ───

export type PermissionMode = 'default' | 'plan' | 'acceptEdits';

export const IPC = {
  FILE_OPEN_IN_EDITOR: 'file:openInEditor',
  REPO_SELECT: 'repo:select',
  REPO_REMOVE: 'repo:remove',
  REPO_VALIDATE: 'repo:validate',
  SESSION_CREATE: 'session:create',
  SESSION_RESUME: 'session:resume',
  SESSION_STOP: 'session:stop',
  SESSION_DESTROY: 'session:destroy',
  SESSION_RENAME: 'session:rename',
  SESSION_LIST: 'session:list',
  WORKTREE_LIST: 'worktree:list',
  WORKTREE_LIST_REPOS: 'worktree:listRepos',
  BRANCH_LIST: 'branch:list',
  BRANCH_RENAME: 'branch:rename',
  PREREQUISITES_CHECK: 'prerequisites:check',
  AGENT_EVENT: 'agent:event',          // agent:event:{sessionId}
  AGENT_SEND: 'agent:send',
  AGENT_PERMISSION: 'agent:permission',
  AGENT_HISTORY: 'agent:history',
  AGENT_CLEAR_HISTORY: 'agent:clear-history',
  SESSION_STATUS: 'session:status',
  APP_CLOSING: 'app:closing',
  POWER_RESUME: 'power:resume',
  FILE_LIST: 'file:list',
  FILE_READ: 'file:read',
  AGENT_SET_MODE: 'agent:setMode',
  OPEN_EXTERNAL: 'shell:openExternal',
  KILL_PORT: 'process:killPort',
  FILE_REVERT: 'file:revert',
  FILE_DIFF: 'file:diff',
  GIT_STATUS: 'git:status',
  PR_INFO: 'pr:info',
  AGENT_SET_MODEL: 'agent:setModel',
  AGENT_SET_THINKING: 'agent:setThinking',
  PLUGIN_LIST: 'plugin:list',
  PLUGIN_INSTALL: 'plugin:install',
  PLUGIN_UNINSTALL: 'plugin:uninstall',
  PLUGIN_ENABLE: 'plugin:enable',
  PLUGIN_DISABLE: 'plugin:disable',
  WIN_MINIMIZE: 'win:minimize',
  WIN_MAXIMIZE: 'win:maximize',
  WIN_CLOSE: 'win:close',
  WIN_IS_MAXIMIZED: 'win:isMaximized',
  DEV_SERVER_START: 'devServer:start',
  DEV_SERVER_STOP: 'devServer:stop',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  APP_STATE_GET_ACTIVE_TAB: 'appState:getActiveTab',
  APP_STATE_SET_ACTIVE_TAB: 'appState:setActiveTab',
  APP_STATE_GET_OPEN_TABS: 'appState:getOpenTabs',
  APP_STATE_SET_OPEN_TABS: 'appState:setOpenTabs',
  OPEN_SESSION_FOLDER: 'session:openFolder',
  MEMORY_LIST: 'memory:list',
  MEMORY_READ: 'memory:read',
  MEMORY_WRITE: 'memory:write',
  MEMORY_DELETE: 'memory:delete',
  SHELL_RUN: 'shell:run',
  SHELL_KILL: 'shell:kill',
  SHELL_INPUT: 'shell:input',
  SHELL_OUTPUT: 'shell:output',
  // PTY channels (per-session persistent terminal)
  PTY_SPAWN: 'pty:spawn',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_KILL: 'pty:kill',
  PTY_IS_ALIVE: 'pty:isAlive',
  PTY_DATA: 'pty:data',      // pty:data:{sessionId}
  PTY_EXIT: 'pty:exit',      // pty:exit:{sessionId}
  AGENT_LIST_ADAPTERS: 'agent:listAdapters',
  AGENT_GET_MODELS: 'agent:getModels',
  // Auto-updater
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS: 'update:status',
} as const;
