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
}

export interface WorktreeRepoConfig {
  copyFiles: string[];
  copyDirs: string[];
}

// ─── Session ───

export interface CreateSessionOpts {
  repoPath: string;
  branchName: string;
  baseBranch?: string;
  useExisting?: boolean;
}

export type SessionStatus = 'starting' | 'running' | 'stopped' | 'error';

export interface SessionInfo {
  id: string;
  branch: string;
  worktreePath: string;
  repoPath: string;
  status: SessionStatus;
  agentType: 'claude-code';
  createdAt: number;
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
  };
}

// ─── Agent Events (renderer-side, serializable) ───

/** Flattened content block from an assistant message */
export interface AgentTextBlock {
  type: 'text';
  text: string;
}

export interface AgentToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface AgentToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AgentContentBlock = AgentTextBlock | AgentToolUseBlock | AgentToolResultBlock;

/**
 * Serializable events sent from main → renderer via IPC.
 * These are derived from the SDK's SDKMessage types but simplified
 * for safe serialization across the IPC boundary.
 */
export type AgentEvent =
  | { type: 'system_init'; sessionId: string; model: string; tools: string[] }
  | { type: 'assistant_text'; text: string; uuid: string }
  | { type: 'assistant_tool_use'; toolName: string; toolInput: unknown; toolUseId: string; uuid: string }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'result'; subtype: string; result?: string; totalCostUsd?: number; durationMs?: number; isError: boolean; errors?: string[] }
  | { type: 'permission_request'; toolName: string; toolInput: unknown; toolUseId: string; requestId: string }
  | { type: 'thinking'; thinking: string; uuid: string }
  | { type: 'partial_text'; text: string }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | { type: 'process_exit'; exitCode?: number };

/** Permission decision from renderer → main */
export interface PermissionDecision {
  requestId: string;
  behavior: 'allow' | 'deny' | 'allowAlways';
  message?: string; // denial message
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
  listSessions(): Promise<SessionInfo[]>;

  // Worktree operations
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>;

  // Branch operations
  listBranches(repoPath: string): Promise<string[]>;

  // Agent I/O (replaces terminal I/O)
  sendMessage(sessionId: string, content: string): void;
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

  // File operations (for @ file picker)
  listFiles(sessionId: string): Promise<string[]>;
  readFile(sessionId: string, filePath: string): Promise<string>;
  openInEditor(sessionId: string, filePath: string, line?: number): Promise<void>;

  // App lifecycle
  onAppClosing(callback: () => void): () => void;
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
  SESSION_LIST: 'session:list',
  WORKTREE_LIST: 'worktree:list',
  BRANCH_LIST: 'branch:list',
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
} as const;
