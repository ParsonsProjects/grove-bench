import type { PrerequisiteStatus, SessionStatus } from '../../shared/types.js';

const REPOS_KEY = 'grove-bench:repos';

function loadRepos(): string[] {
  try {
    const saved = localStorage.getItem(REPOS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

interface SessionEntry {
  id: string;
  branch: string;
  repoPath: string;
  status: SessionStatus;
  direct?: boolean;
  /** If set, this session is a child of the given parent (e.g. orch subtask). */
  parentSessionId?: string | null;
  /** If set, this session is the orchestrator for the given job. */
  orchJobId?: string | null;
}

class SessionStore {
  sessions = $state<SessionEntry[]>([]);
  repos = $state<string[]>(loadRepos());
  activeSessionId = $state<string | null>(null);
  error = $state<string | null>(null);
  creating = $state(false);
  prerequisites = $state<PrerequisiteStatus | null>(null);

  get count() {
    return this.sessions.length;
  }

  get canCreate() {
    return this.repos.length > 0;
  }

  get activeSession() {
    return this.sessions.find((s) => s.id === this.activeSessionId) ?? null;
  }

  private persistRepos() {
    localStorage.setItem(REPOS_KEY, JSON.stringify(this.repos));
  }

  addRepo(path: string) {
    if (!this.repos.includes(path)) {
      this.repos = [...this.repos, path];
      this.persistRepos();
    }
  }

  removeRepo(path: string) {
    this.repos = this.repos.filter((r) => r !== path);
    this.persistRepos();
  }

  canRemoveRepo(path: string): boolean {
    return this.sessionsForRepo(path).length === 0;
  }

  sessionsForRepo(path: string): SessionEntry[] {
    return this.sessions.filter((s) => s.repoPath === path);
  }

  /** Top-level sessions (no parent) for a repo. */
  topLevelSessionsForRepo(path: string): SessionEntry[] {
    return this.sessions.filter((s) => s.repoPath === path && !s.parentSessionId);
  }

  /** Child sessions of a given parent. */
  childSessions(parentId: string): SessionEntry[] {
    return this.sessions.filter((s) => s.parentSessionId === parentId);
  }

  repoDisplayName(path: string): string {
    return path.split(/[/\\]/).pop() || path;
  }

  addSession(entry: SessionEntry, focus = true) {
    this.sessions = [...this.sessions, entry];
    if (focus) {
      this.activeSessionId = entry.id;
    }
  }

  removeSession(id: string) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    if (this.activeSessionId === id) {
      // Prefer a running session, fall back to any session
      const next = this.sessions.find((s) => s.status === 'running')
        ?? this.sessions[0];
      this.activeSessionId = next?.id ?? null;
    }
  }

  reorderSession(fromId: string, toId: string) {
    const sessions = [...this.sessions];
    const fromIdx = sessions.findIndex((s) => s.id === fromId);
    const toIdx = sessions.findIndex((s) => s.id === toId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const [moved] = sessions.splice(fromIdx, 1);
    sessions.splice(toIdx, 0, moved);
    this.sessions = sessions;
  }

  updateStatus(id: string, status: SessionStatus) {
    this.sessions = this.sessions.map((s) =>
      s.id === id ? { ...s, status } : s
    );
  }

  updateBranch(id: string, branch: string) {
    this.sessions = this.sessions.map((s) =>
      s.id === id ? { ...s, branch } : s
    );
  }

  setError(msg: string | null) {
    this.error = msg;
  }

  clearError() {
    this.error = null;
  }
}

export const store = new SessionStore();
