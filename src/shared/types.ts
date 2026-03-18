// ─── Worktree ───

export interface WorktreeConfig {
  repoPath: string;
  branchName: string;
  baseBranch?: string;
  useExisting?: boolean;
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
}

export type SessionStatus = 'starting' | 'installing' | 'running' | 'stopped' | 'error';

export interface SessionInfo {
  id: string;
  branch: string;
  worktreePath: string;
  repoPath: string;
  status: SessionStatus;
  agentType: 'claude-code';
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
  claudeCode: {
    available: boolean;
    path?: string;
    authenticated?: boolean;
    authMethod?: string;
    email?: string;
  };
}

// ─── Agent Events (renderer-side, serializable) ───

/**
 * Serializable events sent from main → renderer via IPC.
 * These are derived from the SDK's SDKMessage types but simplified
 * for safe serialization across the IPC boundary.
 */
export type AgentEvent =
  | { type: 'system_init'; sessionId: string; model: string; tools: string[]; agents?: string[]; skills?: string[]; slashCommands?: string[]; mcpServers?: { name: string; status: string }[] }
  | { type: 'assistant_text'; text: string; uuid: string }
  | { type: 'assistant_tool_use'; toolName: string; toolInput: unknown; toolUseId: string; uuid: string }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'result'; subtype: string; result?: string; structured_output?: unknown; totalCostUsd?: number; durationMs?: number; isError: boolean; errors?: string[]; numTurns?: number; contextWindow?: number }
  | { type: 'permission_request'; toolName: string; toolInput: unknown; toolUseId: string; requestId: string; decisionReason?: string; suggestions?: unknown[] }
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
  // Permission mode sync (from SDK status messages)
  | { type: 'mode_sync'; mode: PermissionMode };

/** Permission decision from renderer → main */
export interface PermissionDecision {
  requestId: string;
  behavior: 'allow' | 'deny' | 'allowAlways';
  message?: string; // denial message
  updatedPermissions?: unknown[]; // PermissionUpdate[] from SDK suggestions
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

  // Branch operations
  listBranches(repoPath: string): Promise<string[]>;
  renameBranch(sessionId: string, newBranchName: string): Promise<{ branch: string }>;

  // Agent I/O (replaces terminal I/O)
  sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): void;
  respondToPermission(sessionId: string, decision: PermissionDecision): void;
  onAgentEvent(sessionId: string, callback: (event: AgentEvent) => void): () => void;
  offAgentEvent(sessionId: string): void;
  getEventHistory(sessionId: string): Promise<AgentEvent[]>;

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
  startDevServer(sessionId: string, command?: string): Promise<{ port: number; url: string } | null>;
  stopDevServer(sessionId: string): Promise<void>;

  // Plugins
  pluginList(): Promise<PluginListResult>;
  pluginInstall(pluginId: string, scope?: string): Promise<void>;
  pluginUninstall(pluginId: string): Promise<void>;
  pluginEnable(pluginId: string): Promise<void>;
  pluginDisable(pluginId: string): Promise<void>;

  // Folder
  openSessionFolder(sessionId: string): Promise<void>;

  // Settings
  getSettings(): Promise<GroveBenchSettings>;
  saveSettings(settings: GroveBenchSettings): Promise<void>;

  // App state persistence
  getActiveTab(): Promise<string | null>;
  setActiveTab(id: string | null): void;

  // App lifecycle
  onAppClosing(callback: () => void): () => void;

  // Window controls
  winMinimize(): void;
  winMaximize(): void;
  winClose(): void;
  winIsMaximized(): Promise<boolean>;
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

  // General
  defaultBaseBranch: string;
  theme: 'system' | 'dark' | 'light';
  alwaysOnTop: boolean;
}

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
  BRANCH_LIST: 'branch:list',
  BRANCH_RENAME: 'branch:rename',
  PREREQUISITES_CHECK: 'prerequisites:check',
  AGENT_EVENT: 'agent:event',          // agent:event:{sessionId}
  AGENT_SEND: 'agent:send',
  AGENT_PERMISSION: 'agent:permission',
  AGENT_HISTORY: 'agent:history',
  SESSION_STATUS: 'session:status',
  APP_CLOSING: 'app:closing',
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
  OPEN_SESSION_FOLDER: 'session:openFolder',
} as const;
