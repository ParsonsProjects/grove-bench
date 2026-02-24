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

// ─── IPC API (exposed via contextBridge) ───

export interface GroveBenchAPI {
  // Repo operations
  addRepo(): Promise<string | null>;
  removeRepo(repoPath: string): Promise<void>;
  validateRepo(path: string): Promise<boolean>;

  // Session operations
  createSession(opts: CreateSessionOpts): Promise<{ id: string; branch: string }>;
  destroySession(id: string, deleteBranch?: boolean): Promise<void>;
  listSessions(): Promise<SessionInfo[]>;

  // Worktree operations
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>;

  // Branch operations
  listBranches(repoPath: string): Promise<string[]>;

  // Terminal I/O
  termWrite(sessionId: string, data: string): void;
  termResize(sessionId: string, cols: number, rows: number): void;
  onTermData(sessionId: string, callback: (data: string) => void): () => void;
  offTermData(sessionId: string): void;

  // Prerequisites
  checkPrerequisites(): Promise<PrerequisiteStatus>;

  // Session status updates (from main → renderer)
  onSessionStatus(callback: (sessionId: string, status: SessionStatus) => void): () => void;

  // App lifecycle
  onAppClosing(callback: () => void): () => void;
}

// ─── IPC Channel Names ───

export const IPC = {
  REPO_SELECT: 'repo:select',
  REPO_REMOVE: 'repo:remove',
  REPO_VALIDATE: 'repo:validate',
  SESSION_CREATE: 'session:create',
  SESSION_DESTROY: 'session:destroy',
  SESSION_LIST: 'session:list',
  WORKTREE_LIST: 'worktree:list',
  BRANCH_LIST: 'branch:list',
  PREREQUISITES_CHECK: 'prerequisites:check',
  TERM_WRITE: 'term:write',
  TERM_RESIZE: 'term:resize',
  TERM_DATA: 'term:data',       // term:data:{sessionId}
  SESSION_STATUS: 'session:status',
  APP_CLOSING: 'app:closing',
} as const;
