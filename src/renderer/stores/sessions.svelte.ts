import type { PrerequisiteStatus, SessionStatus } from '../../shared/types.js';

interface SessionEntry {
  id: string;
  branch: string;
  repoPath: string;
  status: SessionStatus;
  direct?: boolean;
  /** User-assigned display name — shown instead of branch when set. */
  displayName?: string | null;
}

class SessionStore {
  sessions = $state<SessionEntry[]>([]);
  repos = $state<string[]>([]);
  activeSessionId = $state<string | null>(null);
  error = $state<string | null>(null);
  creating = $state(false);
  prerequisites = $state<PrerequisiteStatus | null>(null);

  /** Pending status updates for sessions not yet added to the store.
   *  SESSION_STATUS can arrive before addSession during fast worktree setup. */
  private pendingStatuses = new Map<string, SessionStatus>();

  get count() {
    return this.sessions.length;
  }

  get canCreate() {
    return this.repos.length > 0;
  }

  get activeSession() {
    return this.sessions.find((s) => s.id === this.activeSessionId) ?? null;
  }

  /** Load repos from the worktree manifest (main process). Must be called before restoreWorktrees. */
  async loadRepos() {
    this.repos = await window.groveBench.listRepos();
    // Migrate any repos stuck in legacy localStorage
    try {
      const legacy = localStorage.getItem('grove-bench:repos');
      if (legacy) {
        const legacyRepos: string[] = JSON.parse(legacy);
        for (const r of legacyRepos) {
          if (!this.repos.includes(r)) {
            this.repos = [...this.repos, r];
          }
        }
        localStorage.removeItem('grove-bench:repos');
      }
    } catch { /* ignore */ }
  }

  addRepo(path: string) {
    if (!this.repos.includes(path)) {
      this.repos = [...this.repos, path];
    }
  }

  removeRepo(path: string) {
    this.repos = this.repos.filter((r) => r !== path);
  }

  canRemoveRepo(path: string): boolean {
    return this.sessionsForRepo(path).length === 0;
  }

  sessionsForRepo(path: string): SessionEntry[] {
    return this.sessions.filter((s) => s.repoPath === path);
  }

  repoDisplayName(path: string): string {
    return path.split(/[/\\]/).pop() || path;
  }

  addSession(entry: SessionEntry, focus = true) {
    // Apply any pending status that arrived before addSession (race condition
    // where SESSION_STATUS fires before the renderer has added the session).
    const pending = this.pendingStatuses.get(entry.id);
    if (pending) {
      entry = { ...entry, status: pending };
      this.pendingStatuses.delete(entry.id);
    }
    this.sessions = [...this.sessions, entry];
    if (focus) {
      this.activeSessionId = entry.id;
    }
    // Ensure the repo is tracked when a session is added
    this.addRepo(entry.repoPath);
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
    const exists = this.sessions.some((s) => s.id === id);
    if (!exists) {
      // Session not in store yet — buffer the status so addSession can apply it.
      this.pendingStatuses.set(id, status);
      return;
    }
    this.sessions = this.sessions.map((s) =>
      s.id === id ? { ...s, status } : s
    );
  }

  updateBranch(id: string, branch: string) {
    this.sessions = this.sessions.map((s) =>
      s.id === id ? { ...s, branch } : s
    );
  }

  updateDisplayName(id: string, displayName: string | null) {
    this.sessions = this.sessions.map((s) =>
      s.id === id ? { ...s, displayName } : s
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
