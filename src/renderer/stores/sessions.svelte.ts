import type { SessionInfo, PrerequisiteStatus, SessionStatus } from '../../shared/types.js';

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
}

class SessionStore {
  sessions = $state<SessionEntry[]>([]);
  repos = $state<string[]>(loadRepos());
  activeSessionId = $state<string | null>(null);
  prerequisites = $state<PrerequisiteStatus | null>(null);
  error = $state<string | null>(null);
  creating = $state(false);

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

  repoDisplayName(path: string): string {
    return path.split(/[/\\]/).pop() || path;
  }

  addSession(entry: SessionEntry) {
    this.sessions = [...this.sessions, entry];
    this.activeSessionId = entry.id;
  }

  removeSession(id: string) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    if (this.activeSessionId === id) {
      this.activeSessionId = this.sessions[0]?.id ?? null;
    }
  }

  updateStatus(id: string, status: SessionStatus) {
    this.sessions = this.sessions.map((s) =>
      s.id === id ? { ...s, status } : s
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
