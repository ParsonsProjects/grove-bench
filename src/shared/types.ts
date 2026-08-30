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
  /** Timestamp (ms) of the last user interaction (message sent). */
  lastActiveAt?: number;
  /** True when session runs directly on the repo (no worktree created). */
  direct?: boolean;
  /** User-assigned or auto-generated display name, persisted across restart. */
  displayName?: string | null;
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
  /** Attach a new (direct) session to an existing session's checkout + branch,
   *  sharing its worktree instead of running on the repo's default branch.
   *  Implies direct mode; the branch/path are resolved from the source session. */
  attachToSessionId?: string;
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
  /** GitHub CLI — optional; only gates PR automation, never blocks the app. */
  gh?: {
    available: boolean;
    version?: string;
    authenticated?: boolean;
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
  | { type: 'user_message'; text: string; uuid?: string }
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
  // Permission mode sync — source is required so the renderer knows whether to
  // respect user-explicit overrides ('sdk' may be stale, 'session' is authoritative)
  | { type: 'mode_sync'; mode: PermissionMode; source: 'sdk' | 'session' }
  // Permission resolved (authoritative — emitted by main for all resolution paths)
  | { type: 'permission_resolved'; requestId: string; toolUseId: string; decision: 'allow' | 'deny' }
  // Memory auto-save status
  | { type: 'memory_autosave'; status: 'started' | 'completed' | 'skipped'; filesWritten?: string[] }
  // Rewind checkpoint
  | { type: 'rewind'; toMessageId: string; conversationOnly?: boolean };

/** A single full-history search match (main-process search over event history). */
export interface EventSearchHit {
  /** Index of the matching event in the session's (prelaunch-prefixed) history. */
  eventIndex: number;
  /** Display category for the dropdown (user / assistant / thinking / tool / …). */
  kind: string;
  /** Whitespace-collapsed text window around the match, ellipsised when truncated. */
  snippet: string;
}

/** A search match from the cross-session search (SessionFinder "in conversations"). */
export interface CrossSessionSearchHit extends EventSearchHit {
  /** Session whose history contained the match. */
  sessionId: string;
}

/** Lightweight conversation context for a session, derived from its event history.
 *  Used for sidebar subtitles / search entries when the renderer hasn't loaded
 *  the session's messages (e.g. stopped sessions). */
export interface SessionPreview {
  /** First real user prompt (slash commands skipped), whitespace-collapsed. */
  firstPrompt: string;
  /** Most recent user/assistant text, whitespace-collapsed. */
  lastText: string;
}

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
  /** Line counts from `git diff --numstat` (combined vs HEAD); absent for untracked files. */
  additions?: number;
  deletions?: number;
}

export interface GitStatusResult {
  entries: GitStatusEntry[];
}

/** Result of a single-file diff request. Text files carry a unified patch; binary
 *  and image files are flagged so the UI can show a card / thumbnails instead of garbled text. */
export type FileDiffResult =
  | { kind: 'text'; patch: string }
  | { kind: 'binary' }
  | { kind: 'image'; ext: string };

/** Base64 data URLs for an image file's working-tree and HEAD versions (either may be null). */
export interface ImageDiffContent {
  working: string | null;
  head: string | null;
}

export interface CheckpointListItem {
  uuid: string;
  turn: number;
  ref: string;
  text?: string;
}

/** Aggregate diff statistics (git diff --numstat totals). */
export interface DiffStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

/** One turn in the session's diff history: what that turn changed on disk. */
export interface DiffHistoryEntry extends DiffStats {
  uuid: string;
  turn: number;
  text?: string;
}

/** Per-turn diff history plus the cumulative stats across the whole session. */
export interface DiffHistoryResult {
  entries: DiffHistoryEntry[];
  total: DiffStats;
}

// ─── PR Info ───

/** Rollup of a PR's status checks (CI). Null when the PR has no checks. */
export interface PrChecksSummary {
  total: number;
  passed: number;
  failed: number;
  pending: number;
}

export interface PrInfo {
  number: number;
  url: string;
  state?: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft?: boolean;
  title?: string;
  /** APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | '' (no reviews requested). */
  reviewDecision?: string;
  checks?: PrChecksSummary | null;
  /** Head commit the checks ran against. */
  headSha?: string;
  /** Names of the currently failing checks. */
  failingChecks?: string[];
  /** Opaque ids of conversation comments + submitted reviews — diffed to detect new feedback. */
  commentSignature?: string[];
}

/** A review comment or review body on a PR (flattened for prompts/UI). */
export interface PrReviewComment {
  id: string;
  author: string;
  /** OWNER | MEMBER | COLLABORATOR | CONTRIBUTOR | NONE | ... */
  authorAssociation: string;
  /** File the comment is anchored to (absent for review bodies / conversation comments). */
  path?: string;
  line?: number;
  body: string;
}

export interface PrCreateOpts {
  title: string;
  body: string;
  base: string;
  draft?: boolean;
}

/** Local branch position vs its upstream. Upstream null = branch never pushed. */
export interface GitSyncStatus {
  upstream: string | null;
  ahead: number;
  behind: number;
}

/** One commit on the session branch that isn't on the base branch. */
export interface BranchCommit {
  subject: string;
  body: string;
}

// ─── Thinking Level ───

/** Provider-agnostic thinking/reasoning effort level. Each adapter maps these
 *  to its own mechanism (token budgets, effort params, on/off, ...).
 *  'high' means the provider's default/maximum reasoning behavior.
 *  'adaptive' lets the model decide when and how much to think. */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'adaptive';

/** Cycle order for the status-bar control and Alt+T shortcut. */
export const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'adaptive'];

// ─── MCP Servers ───

/** Provider-agnostic snapshot of an agent's MCP server connection. */
export interface McpServerInfo {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  /** Error message when status is 'failed'. */
  error?: string;
  /** Config scope (e.g. project, user, local) when the provider reports one. */
  scope?: string;
  /** Number of tools the server exposes, when connected. */
  toolCount?: number;
}

/** An MCP server from the agent CLI's configuration (settings page view).
 *  Unlike McpServerInfo this is config-level, not tied to a running session. */
export interface McpConfiguredServer {
  name: string;
  /** Command line (stdio) or URL (http/sse) the server is configured with. */
  target: string;
  /** Transport when the CLI reports one (e.g. HTTP, SSE). */
  transport?: string;
  status: McpServerInfo['status'];
}

export type McpConfigScope = 'local' | 'user' | 'project';

/** Options for registering a new MCP server in the agent CLI's config. */
export interface McpAddServerOpts {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  /** Command (stdio) or URL (http/sse). */
  commandOrUrl: string;
  /** Extra command arguments (stdio only). */
  args?: string[];
  /** Environment variables (stdio only). */
  env?: Record<string, string>;
  /** Request headers, e.g. "Authorization: Bearer ..." (http/sse only). */
  headers?: string[];
  scope: McpConfigScope;
  /** Repo directory the scope is resolved against (local/project scopes). */
  cwd?: string;
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

/** Sidebar session ordering: key + direction (persisted via app-state). */
export interface SessionSortState {
  key: 'name' | 'age';
  dir: 'asc' | 'desc';
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
  listRepos(): Promise<string[]>;

  // Branch operations
  listBranches(repoPath: string): Promise<string[]>;
  /** The repo's default branch (origin/HEAD, falling back to main/master). */
  getDefaultBranch(repoPath: string): Promise<string>;
  renameBranch(sessionId: string, newBranchName: string): Promise<{ branch: string }>;

  // Agent I/O (replaces terminal I/O)
  sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): void;
  respondToPermission(sessionId: string, decision: PermissionDecision): Promise<boolean>;
  onAgentEvent(sessionId: string, callback: (event: AgentEvent) => void): () => void;
  offAgentEvent(sessionId: string): void;
  getEventHistory(sessionId: string): Promise<AgentEvent[]>;
  /** Load the last `limit` events, optionally ending before `beforeIndex`. */
  getEventHistoryPage(sessionId: string, limit: number, beforeIndex?: number): Promise<{ events: AgentEvent[]; totalCount: number; startIndex: number }>;
  /** Get the total number of persisted events for a session. */
  getEventHistoryCount(sessionId: string): Promise<number>;
  /** Search the full event history (main-process), newest match first. */
  searchEventHistory(sessionId: string, query: string, limit?: number): Promise<EventSearchHit[]>;
  /** Search every given session's full history (main-process). Hits are capped
   *  per session and tagged with their sessionId, newest match first per session. */
  searchAllEventHistory(sessionIds: string[], query: string, limitPerSession?: number): Promise<CrossSessionSearchHit[]>;
  /** First-prompt / last-message previews for the given sessions (main-process). */
  getSessionPreviews(sessionIds: string[]): Promise<Record<string, SessionPreview>>;
  clearEventHistory(sessionId: string): Promise<void>;
  /** Resolve a message's stable SDK uuid to its absolute event index (or null). */
  findEventIndexByUuid(sessionId: string, uuid: string): Promise<number | null>;

  // Bookmarks
  listBookmarks(): Promise<Bookmark[]>;
  addBookmark(bookmark: Omit<Bookmark, 'id' | 'createdAt'>): Promise<Bookmark>;
  removeBookmark(id: string): Promise<void>;
  updateBookmark(id: string, patch: Partial<Pick<Bookmark, 'note' | 'eventIndex'>>): Promise<void>;

  // Prerequisites
  checkPrerequisites(): Promise<PrerequisiteStatus>;

  // Session status updates (from main → renderer)
  onSessionStatus(callback: (sessionId: string, status: SessionStatus) => void): () => void;

  // Mode control
  setMode(sessionId: string, mode: PermissionMode): Promise<void>;

  // Model control
  setModel(sessionId: string, model?: string): Promise<void>;

  // Thinking control
  setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<void>;

  // MCP server control
  listMcpServers(sessionId: string): Promise<McpServerInfo[]>;
  reconnectMcpServer(sessionId: string, serverName: string): Promise<void>;
  setMcpServerEnabled(sessionId: string, serverName: string, enabled: boolean): Promise<void>;

  // File operations (for @ file picker)
  listFiles(sessionId: string): Promise<string[]>;
  readFile(sessionId: string, filePath: string): Promise<string>;
  openInEditor(sessionId: string, filePath: string, line?: number): Promise<void>;

  // File revert (for changes review)
  revertFile(sessionId: string, filePath: string, staged?: boolean): Promise<void>;
  getFileDiff(sessionId: string, filePath: string, staged?: boolean): Promise<FileDiffResult>;
  getImageDiffContent(sessionId: string, filePath: string): Promise<ImageDiffContent>;
  stageFile(sessionId: string, filePath: string): Promise<void>;
  unstageFile(sessionId: string, filePath: string): Promise<void>;
  commit(sessionId: string, message: string): Promise<void>;
  /** Ask the agent to write a commit message for the staged changes. */
  generateCommitMessage(sessionId: string): Promise<string>;
  push(sessionId: string): Promise<void>;
  getGitSyncStatus(sessionId: string): Promise<GitSyncStatus>;
  getBranchCommits(sessionId: string, base: string): Promise<BranchCommit[]>;

  // Checkpoint rewind
  rewindSession(sessionId: string, userMessageId: string, options?: { conversationOnly?: boolean }): Promise<void>;
  getCheckpointDiff(sessionId: string, userMessageId: string): Promise<string>;
  listCheckpoints(sessionId: string): Promise<CheckpointListItem[]>;

  // Diff history tracking
  getDiffHistory(sessionId: string): Promise<DiffHistoryResult>;
  getTurnDiff(sessionId: string, userMessageId: string): Promise<string>;
  getFullThreadDiff(sessionId: string): Promise<string>;

  // Git status
  getGitStatus(sessionId: string): Promise<GitStatusResult>;

  // PR info
  getPrInfo(sessionId: string): Promise<PrInfo | null>;
  createPr(sessionId: string, opts: PrCreateOpts): Promise<PrInfo>;
  getPrReviewComments(sessionId: string, prNumber: number): Promise<PrReviewComment[]>;

  // External links
  openExternal(url: string): Promise<void>;

  // MCP server configuration (agent CLI config, not per-session)
  mcpConfigList(cwd?: string): Promise<McpConfiguredServer[]>;
  mcpConfigAdd(opts: McpAddServerOpts): Promise<void>;
  mcpConfigRemove(name: string, scope?: McpConfigScope, cwd?: string): Promise<void>;

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
  memoryCompact(repoPath: string): Promise<MemoryCompactionStatus>;
  memoryListBackups(repoPath: string): Promise<MemoryBackupInfo[]>;
  memoryRestoreBackup(repoPath: string, backupId: string): Promise<MemoryRestoreStatus>;
  memoryStats(repoPath: string): Promise<MemoryStatsResult>;
  memoryBackupPreview(repoPath: string, backupId: string): Promise<MemoryBackupFile[]>;
  memoryReadBackupFile(repoPath: string, backupId: string, relativePath: string): Promise<string | null>;

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
  getCollapsedRepos(): Promise<Record<string, boolean>>;
  setCollapsedRepos(map: Record<string, boolean>): void;
  getSessionSort(): Promise<SessionSortState>;
  setSessionSort(sort: SessionSortState): void;
  getSidebarWidth(): Promise<number | null>;
  setSidebarWidth(width: number): void;

  // App lifecycle
  onAppClosing(callback: () => void): () => void;
  onPowerResume(callback: (resumeIds: string[]) => void): () => void;

  // Window controls
  winMinimize(): void;
  winMaximize(): void;
  winClose(): void;
  winIsMaximized(): Promise<boolean>;

  // Agent adapters
  listAdapters(): Promise<Array<{ id: string; displayName: string; capabilities: Record<string, boolean> }>>;
  getModels(adapterType?: string): Promise<Array<{ id: string; label: string; family?: string; contextWindow?: number }>>;

  // Auto-update
  checkForUpdate(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
}

// ─── Caveman ───

export type CavemanMode = 'off' | 'lite' | 'full' | 'ultra';

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
  /** Default thinking level for new sessions. 'high' = provider default. */
  defaultThinkingLevel: ThinkingLevel;
  /** Caveman mode — terse output to reduce token usage. Default 'off'. */
  cavemanMode: CavemanMode;
  workingDirectories: string[];
  defaultSystemPromptAppend: string;

  // Memory
  /** Enable auto-save of memories at end of session / compaction. Default true. */
  memoryAutoSave: boolean;
  /** Enable automatic memory compaction (dedupe, contradiction resolution,
   *  session-note pruning) when memory grows past its budget. Default true. */
  memoryAutoCompact: boolean;

  // Worktree
  /** Automatically run npm install in new worktrees. Default false. */
  autoInstallDeps: boolean;

  // Sessions
  /** Auto-stop a session after this many minutes idle (not focused, not running
   *  a turn, no pending permission) to reclaim its processes. 0 disables. Default 30. */
  idleAutoStopMinutes: number;

  // General
  /** Base branch for new worktrees and PRs. Empty = auto-detect the
   *  repository's default branch (origin/HEAD, falling back to main/master). */
  defaultBaseBranch: string;
  theme: 'system' | 'dark' | 'light';
  alwaysOnTop: boolean;

  // Appearance
  /** Custom accent color per repository path. Keys are repo paths, values are hex colors. */
  repoColors: Record<string, string>;

  // Editor
  /** Default diff view mode in the Changes tab. */
  diffViewMode: 'unified' | 'side-by-side';
  /** Enable spell checking in the prompt textarea. */
  spellcheck: boolean;

  // Privacy
  /** Enable anonymous usage analytics (PostHog). Off by default. */
  analyticsEnabled: boolean;
  /** Whether the user has been shown the analytics consent prompt. */
  analyticsPrompted: boolean;
}

// ─── Memory ───

export interface MemoryEntry {
  relativePath: string;  // e.g. "repo/overview.md"
  title: string;         // from frontmatter
  updatedAt: string;     // ISO date from frontmatter
  folder: string;        // e.g. "repo", "conventions", "sessions"
}

export interface MemoryCompactionStatus {
  compacted: boolean;
  skippedReason?: string;   // why compaction was skipped, when it was
  filesChanged: string[];   // paths written, rewritten, or deleted
  /** Per-file summary of what the pass did (action, path, model's reason). */
  changes?: Array<{ action: 'update' | 'delete'; path: string; reason: string }>;
  /** Snapshot taken before applying — restore it to undo the compaction. */
  backupId?: string;
}

export interface MemoryStatsResult {
  totalBytes: number;        // non-session memory bytes (frontmatter stripped)
  budgetBytes: number;       // system-prompt budget
  fileCount: number;         // non-session files
  sessionNoteCount: number;
  skippedFiles: string[];    // files that no longer fit in the prompt budget
  lastCompactedAt: string | null;
  lastAuto?: boolean;        // last pass was automatic (vs the panel button)
  lastFilesChanged?: number;
}

export interface MemoryBackupFile {
  path: string;
  bytes: number;
}

export interface MemoryBackupInfo {
  id: string;               // snapshot folder name, sortable
  createdAt: string;        // ISO timestamp
  fileCount: number;
}

export interface MemoryRestoreStatus {
  restored: boolean;
  error?: string;
  filesChanged: string[];   // paths written or deleted by the restore
}

// ─── Bookmarks ───

export interface Bookmark {
  id: string;                 // randomUUID, assigned in main on add
  sessionId: string;          // per-run session id: fast same-run jump + grouping
  repoPath: string;           // durable grouping/label key
  sessionLabel: string;       // snapshot of displayName/branch for headings
  messageUuid: string | null; // primary durable anchor (SDK event uuid); null if unavailable
  eventIndex: number | null;  // cached fast-jump hint; may go stale -> re-resolve via uuid
  selectedText: string;       // the bookmarked snippet (preview + ultimate fallback)
  note?: string;              // optional user note
  createdAt: number;
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
  BRANCH_DEFAULT: 'branch:default',
  BRANCH_RENAME: 'branch:rename',
  PREREQUISITES_CHECK: 'prerequisites:check',
  AGENT_EVENT: 'agent:event',          // agent:event:{sessionId}
  AGENT_SEND: 'agent:send',
  AGENT_PERMISSION: 'agent:permission',
  AGENT_HISTORY: 'agent:history',
  AGENT_HISTORY_PAGE: 'agent:history-page',
  AGENT_HISTORY_COUNT: 'agent:history-count',
  AGENT_HISTORY_SEARCH: 'agent:history-search',
  AGENT_HISTORY_SEARCH_ALL: 'agent:history-search-all',
  SESSION_PREVIEWS: 'session:previews',
  AGENT_CLEAR_HISTORY: 'agent:clear-history',
  SESSION_STATUS: 'session:status',
  APP_CLOSING: 'app:closing',
  POWER_RESUME: 'power:resume',
  FILE_LIST: 'file:list',
  FILE_READ: 'file:read',
  AGENT_SET_MODE: 'agent:setMode',
  OPEN_EXTERNAL: 'shell:openExternal',
  FILE_REVERT: 'file:revert',
  FILE_DIFF: 'file:diff',
  FILE_CONTENT_DATA_URL: 'file:contentDataUrl',
  FILE_STAGE: 'file:stage',
  FILE_UNSTAGE: 'file:unstage',
  GIT_STATUS: 'git:status',
  GIT_COMMIT: 'git:commit',
  GIT_PUSH: 'git:push',
  GIT_SYNC_STATUS: 'git:syncStatus',
  GIT_BRANCH_COMMITS: 'git:branchCommits',
  GIT_GENERATE_COMMIT_MESSAGE: 'git:generateCommitMessage',
  PR_INFO: 'pr:info',
  PR_CREATE: 'pr:create',
  PR_REVIEW_COMMENTS: 'pr:reviewComments',
  AGENT_SET_MODEL: 'agent:setModel',
  AGENT_SET_THINKING: 'agent:setThinking',
  AGENT_MCP_LIST: 'agent:mcpList',
  AGENT_MCP_RECONNECT: 'agent:mcpReconnect',
  AGENT_MCP_TOGGLE: 'agent:mcpToggle',
  MCP_CONFIG_LIST: 'mcpConfig:list',
  MCP_CONFIG_ADD: 'mcpConfig:add',
  MCP_CONFIG_REMOVE: 'mcpConfig:remove',
  PLUGIN_LIST: 'plugin:list',
  PLUGIN_INSTALL: 'plugin:install',
  PLUGIN_UNINSTALL: 'plugin:uninstall',
  PLUGIN_ENABLE: 'plugin:enable',
  PLUGIN_DISABLE: 'plugin:disable',
  WIN_MINIMIZE: 'win:minimize',
  WIN_MAXIMIZE: 'win:maximize',
  WIN_CLOSE: 'win:close',
  WIN_IS_MAXIMIZED: 'win:isMaximized',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  APP_STATE_GET_ACTIVE_TAB: 'appState:getActiveTab',
  APP_STATE_SET_ACTIVE_TAB: 'appState:setActiveTab',
  APP_STATE_GET_OPEN_TABS: 'appState:getOpenTabs',
  APP_STATE_SET_OPEN_TABS: 'appState:setOpenTabs',
  APP_STATE_GET_COLLAPSED_REPOS: 'appState:getCollapsedRepos',
  APP_STATE_SET_COLLAPSED_REPOS: 'appState:setCollapsedRepos',
  APP_STATE_GET_SESSION_SORT: 'appState:getSessionSort',
  APP_STATE_SET_SESSION_SORT: 'appState:setSessionSort',
  APP_STATE_GET_SIDEBAR_WIDTH: 'appState:getSidebarWidth',
  APP_STATE_SET_SIDEBAR_WIDTH: 'appState:setSidebarWidth',
  OPEN_SESSION_FOLDER: 'session:openFolder',
  BOOKMARKS_LIST: 'bookmarks:list',
  BOOKMARK_ADD: 'bookmarks:add',
  BOOKMARK_REMOVE: 'bookmarks:remove',
  BOOKMARK_UPDATE: 'bookmarks:update',
  FIND_EVENT_INDEX_BY_UUID: 'agent:findEventIndexByUuid',
  MEMORY_LIST: 'memory:list',
  MEMORY_READ: 'memory:read',
  MEMORY_WRITE: 'memory:write',
  MEMORY_DELETE: 'memory:delete',
  MEMORY_COMPACT: 'memory:compact',
  MEMORY_LIST_BACKUPS: 'memory:listBackups',
  MEMORY_RESTORE_BACKUP: 'memory:restoreBackup',
  MEMORY_STATS: 'memory:stats',
  MEMORY_BACKUP_PREVIEW: 'memory:backupPreview',
  MEMORY_BACKUP_READ_FILE: 'memory:backupReadFile',
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
  AGENT_REWIND: 'agent:rewind',
  AGENT_CHECKPOINT_DIFF: 'agent:checkpointDiff',
  AGENT_LIST_CHECKPOINTS: 'agent:listCheckpoints',
  AGENT_DIFF_HISTORY: 'agent:diffHistory',
  AGENT_TURN_DIFF: 'agent:turnDiff',
  AGENT_FULL_THREAD_DIFF: 'agent:fullThreadDiff',
  AGENT_LIST_ADAPTERS: 'agent:listAdapters',
  AGENT_GET_MODELS: 'agent:getModels',
  // Auto-updater
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS: 'update:status',
} as const;
