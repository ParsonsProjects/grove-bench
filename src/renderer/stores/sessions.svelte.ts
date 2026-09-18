import type { PrerequisiteStatus, Project, SessionStatus } from '../../shared/types.js';

interface SessionEntry {
  id: string;
  branch: string;
  repoPath: string;
  status: SessionStatus;
  direct?: boolean;
  /** Adapter id the session runs on (e.g. 'claude-code'). */
  agentType?: string;
  /** User-assigned display name — shown instead of branch when set. */
  displayName?: string | null;
  /** Timestamp (ms) when the worktree was created. */
  createdAt?: number;
  /** Timestamp (ms) of the last user interaction. */
  lastActiveAt?: number;
  /** Epoch ms when the user marked the session completed; null/absent while
   *  open. Completed sessions hide from the sidebar unless "Show completed". */
  completedAt?: number | null;
}

/** A stand-in project for a repo path the main process has not reported a
 *  project for. Should not happen in the app (the main process adopts every
 *  manifest path into a project), but keeps the sidebar consistent if a
 *  session arrives for an unknown path, and gives tests a cheap fixture. */
export function projectFromPath(path: string): Project {
  return {
    id: `path:${path}`,
    name: path.split(/[/\\]/).pop() || path,
    workspaces: [{ id: `path:${path}`, path, kind: 'git' }],
    createdAt: 0,
  };
}

class SessionStore {
  sessions = $state<SessionEntry[]>([]);
  /** Projects in sidebar order, as the main process persists them. */
  projects = $state<Project[]>([]);
  activeSessionId = $state<string | null>(null);
  error = $state<string | null>(null);
  creating = $state(false);
  prerequisites = $state<PrerequisiteStatus | null>(null);

  /** Whether the session finder (Ctrl+R palette) is open — toggled by the
   *  global shortcut in App and the sidebar's search field. */
  finderOpen = $state(false);

  /** Sessions that completed a turn while not focused — drives the "needs you"
   *  flash on their sidebar row until the user focuses them. */
  needsAttention = $state<Record<string, boolean>>({});

  /** Pending status updates for sessions not yet added to the store.
   *  SESSION_STATUS can arrive before addSession during fast worktree setup. */
  private pendingStatuses = new Map<string, SessionStatus>();

  /** LIFO stack of recently-closed session IDs for Ctrl+Shift+T re-open. */
  private recentlyClosedStack: string[] = [];

  get count() {
    return this.sessions.length;
  }

  get canCreate() {
    return this.projects.length > 0;
  }

  /** Workspace paths of every project, in project order. A project has one
   *  workspace today, so this is the list the rest of the app keys on
   *  (colors, memory, worktrees) and the sidebar iterates. */
  get repos(): string[] {
    return this.projects.map((p) => p.workspaces[0].path);
  }

  get activeSession() {
    return this.sessions.find((s) => s.id === this.activeSessionId) ?? null;
  }

  /**
   * Stopped sessions whose last activity is before the cutoff, oldest first —
   * candidates for the sidebar's session clean-up dialog. Sessions without a
   * timestamp get ts=0 and are listed first as unknown age, never hidden.
   * Running sessions are never candidates.
   */
  stoppedSessionsOlderThan(days: number): Array<SessionEntry & { ts: number }> {
    const cutoff = Date.now() - days * 86_400_000;
    return this.sessions
      .filter((s) => s.status === 'stopped')
      .map((s) => ({ ...s, ts: s.lastActiveAt ?? s.createdAt ?? 0 }))
      .filter((s) => s.ts < cutoff)
      .sort((a, b) => a.ts - b.ts);
  }

  /** Load projects from the main process. Must be called before restoreWorktrees. */
  async loadProjects() {
    this.projects = await window.groveBench.listProjects();
  }

  addProject(project: Project) {
    if (this.projects.some((p) => p.id === project.id)) return;
    // A placeholder for the same path (see projectFromPath) gives way to the real record.
    this.projects = [...this.projects.filter((p) => !this.projectSpans(p, project)), project];
  }

  /** Make sure `path` belongs to some project. Placeholder only; the main
   *  process is the source of truth (see projectFromPath). */
  addRepo(path: string) {
    if (!this.projectForPath(path)) {
      this.projects = [...this.projects, projectFromPath(path)];
    }
  }

  removeProject(projectId: string) {
    this.projects = this.projects.filter((p) => p.id !== projectId);
  }

  removeRepo(path: string) {
    const project = this.projectForPath(path);
    if (project) this.removeProject(project.id);
  }

  updateProjectName(projectId: string, name: string) {
    this.projects = this.projects.map((p) => (p.id === projectId ? { ...p, name } : p));
  }

  projectForPath(path: string): Project | undefined {
    return this.projects.find((p) => p.workspaces.some((w) => w.path === path));
  }

  private projectSpans(a: Project, b: Project): boolean {
    return a.workspaces.some((wa) => b.workspaces.some((wb) => wb.path === wa.path));
  }

  canRemoveRepo(path: string): boolean {
    return this.sessionsForRepo(path).length === 0;
  }

  sessionsForRepo(path: string): SessionEntry[] {
    return this.sessions.filter((s) => s.repoPath === path);
  }

  /** The project's name for a workspace path, falling back to the folder
   *  name when the path belongs to no known project. */
  repoDisplayName(path: string): string {
    return this.projectForPath(path)?.name || path.split(/[/\\]/).pop() || path;
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

  /** Quick-create a new session (no dialog) that lands on `sourceSessionId`'s
   *  branch, sharing its checkout. The main process resolves the branch + path
   *  from the source session, so a new session forked off a worktree session
   *  stays on that branch instead of the repo's default branch. Runs in-place
   *  (direct), so it never creates or removes a worktree. */
  async createAttachedSession(sourceSessionId: string, repoPath: string): Promise<void> {
    try {
      const result = await window.groveBench.createSession({ repoPath, branchName: '', direct: true, attachToSessionId: sourceSessionId });
      this.addSession({ id: result.id, branch: result.branch, repoPath, status: 'running', direct: true, agentType: result.agentType, createdAt: Date.now() });
    } catch (e: any) {
      this.setError(e?.message || String(e));
    }
  }

  removeSession(id: string) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.clearNeedsAttention(id);
    if (this.activeSessionId === id) {
      // Prefer a running session, fall back to any session
      const next = this.sessions.find((s) => s.status === 'running')
        ?? this.sessions[0];
      this.activeSessionId = next?.id ?? null;
    }
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

  updateLastActive(id: string) {
    const now = Date.now();
    this.sessions = this.sessions.map((s) =>
      s.id === id ? { ...s, lastActiveAt: now } : s
    );
    // New user activity reopens a completed session — it is clearly not done.
    if (this.sessions.find((s) => s.id === id)?.completedAt) {
      this.setCompleted(id, false).catch(() => {});
    }
  }

  get completedCount() {
    return this.sessions.filter((s) => !!s.completedAt).length;
  }

  /** Mark a session completed (or reopen it). Applied optimistically and
   *  persisted through main; rolled back if persistence fails. */
  async setCompleted(id: string, completed: boolean): Promise<void> {
    const previous = this.sessions.find((s) => s.id === id)?.completedAt ?? null;
    const next = completed ? Date.now() : null;
    if (!!previous === completed) return;
    this.sessions = this.sessions.map((s) => (s.id === id ? { ...s, completedAt: next } : s));
    if (completed) this.clearNeedsAttention(id);
    try {
      await window.groveBench.setSessionCompleted(id, completed);
    } catch (e) {
      console.warn('[setCompleted] persist failed, rolling back:', e);
      this.sessions = this.sessions.map((s) => (s.id === id ? { ...s, completedAt: previous } : s));
    }
  }

  updateDisplayName(id: string, displayName: string | null) {
    this.sessions = this.sessions.map((s) =>
      s.id === id ? { ...s, displayName } : s
    );
  }

  /** Mark a session as needing attention (turn completed while not focused). */
  markNeedsAttention(id: string) {
    if (!this.needsAttention[id]) {
      this.needsAttention = { ...this.needsAttention, [id]: true };
    }
  }

  /** Clear the needs-attention flag (e.g. when the session is focused). */
  clearNeedsAttention(id: string) {
    if (this.needsAttention[id]) {
      const next = { ...this.needsAttention };
      delete next[id];
      this.needsAttention = next;
    }
  }

  pushRecentlyClosed(id: string) {
    // Don't duplicate the top of stack
    if (this.recentlyClosedStack[this.recentlyClosedStack.length - 1] === id) return;
    this.recentlyClosedStack.push(id);
    // Cap at 20 entries
    if (this.recentlyClosedStack.length > 20) {
      this.recentlyClosedStack = this.recentlyClosedStack.slice(-20);
    }
  }

  popRecentlyClosed(): string | null {
    return this.recentlyClosedStack.pop() ?? null;
  }

  removeFromRecentlyClosed(id: string) {
    this.recentlyClosedStack = this.recentlyClosedStack.filter((s) => s !== id);
  }

  setError(msg: string | null) {
    this.error = msg;
  }

  clearError() {
    this.error = null;
  }
}

export const store = new SessionStore();
