import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage before importing the store
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// We need to test the SessionStore class. Since it's instantiated as a singleton with
// Svelte 5 runes ($state), we'll test the exported `store` instance.
// Svelte 5 runes compile to regular JS in node via the svelte plugin.
import { store } from './sessions.svelte.js';
import type { SessionStatus } from '../../shared/types.js';

interface SessionEntry {
  id: string;
  branch: string;
  repoPath: string;
  status: SessionStatus;
  direct?: boolean;
  parentSessionId?: string | null;
  orchJobId?: string | null;
}

function makeSession(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: `session-${Math.random().toString(36).slice(2, 8)}`,
    branch: 'feat/test',
    repoPath: '/repo/test',
    status: 'running',
    ...overrides,
  };
}

describe('SessionStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    // Remove all sessions
    while (store.sessions.length > 0) {
      const id = store.sessions[0].id;
      store.sessions = store.sessions.filter(s => s.id !== id);
    }
    store.activeSessionId = null;
    store.error = null;
    store.creating = false;
    // Reset repos
    store.repos = [];
    localStorageMock.clear();
  });

  describe('repos', () => {
    it('addRepo adds a new repo', () => {
      store.addRepo('/repo/a');
      expect(store.repos).toContain('/repo/a');
    });

    it('addRepo does not duplicate', () => {
      store.addRepo('/repo/a');
      store.addRepo('/repo/a');
      expect(store.repos.filter(r => r === '/repo/a')).toHaveLength(1);
    });

    it('removeRepo removes a repo', () => {
      store.addRepo('/repo/a');
      store.addRepo('/repo/b');
      store.removeRepo('/repo/a');
      expect(store.repos).toEqual(['/repo/b']);
    });

    it('persists repos to localStorage', () => {
      store.addRepo('/repo/a');
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'grove-bench:repos',
        expect.stringContaining('/repo/a'),
      );
    });

    it('canCreate is false with no repos', () => {
      expect(store.canCreate).toBe(false);
    });

    it('canCreate is true with repos', () => {
      store.addRepo('/repo/a');
      expect(store.canCreate).toBe(true);
    });
  });

  describe('sessions', () => {
    it('addSession adds and focuses by default', () => {
      const session = makeSession({ id: 's1' });
      store.addSession(session);
      expect(store.sessions).toHaveLength(1);
      expect(store.activeSessionId).toBe('s1');
    });

    it('addSession with focus=false does not change active', () => {
      const s1 = makeSession({ id: 's1' });
      const s2 = makeSession({ id: 's2' });
      store.addSession(s1);
      store.addSession(s2, false);
      expect(store.activeSessionId).toBe('s1');
    });

    it('count reflects session count', () => {
      expect(store.count).toBe(0);
      store.addSession(makeSession());
      expect(store.count).toBe(1);
      store.addSession(makeSession());
      expect(store.count).toBe(2);
    });

    it('removeSession removes and picks next active', () => {
      const s1 = makeSession({ id: 's1', status: 'stopped' });
      const s2 = makeSession({ id: 's2', status: 'running' });
      store.addSession(s1);
      store.addSession(s2);
      store.activeSessionId = 's1';

      store.removeSession('s1');

      expect(store.sessions).toHaveLength(1);
      // Prefers running session
      expect(store.activeSessionId).toBe('s2');
    });

    it('removeSession sets null when no sessions left', () => {
      const s1 = makeSession({ id: 's1' });
      store.addSession(s1);
      store.removeSession('s1');
      expect(store.activeSessionId).toBeNull();
    });

    it('removeSession keeps activeSessionId if not the removed one', () => {
      const s1 = makeSession({ id: 's1' });
      const s2 = makeSession({ id: 's2' });
      store.addSession(s1);
      store.addSession(s2);
      store.activeSessionId = 's1';

      store.removeSession('s2');
      expect(store.activeSessionId).toBe('s1');
    });

    it('activeSession returns the active session', () => {
      const s1 = makeSession({ id: 's1' });
      store.addSession(s1);
      expect(store.activeSession).toEqual(s1);
    });

    it('activeSession returns null when no active', () => {
      expect(store.activeSession).toBeNull();
    });
  });

  describe('reorderSession', () => {
    it('moves a session to a new position', () => {
      const s1 = makeSession({ id: 's1' });
      const s2 = makeSession({ id: 's2' });
      const s3 = makeSession({ id: 's3' });
      store.addSession(s1, false);
      store.addSession(s2, false);
      store.addSession(s3, false);

      store.reorderSession('s3', 's1');

      expect(store.sessions.map(s => s.id)).toEqual(['s3', 's1', 's2']);
    });

    it('no-ops when fromId equals toId', () => {
      const s1 = makeSession({ id: 's1' });
      store.addSession(s1, false);
      store.reorderSession('s1', 's1');
      expect(store.sessions.map(s => s.id)).toEqual(['s1']);
    });

    it('no-ops when id not found', () => {
      const s1 = makeSession({ id: 's1' });
      store.addSession(s1, false);
      store.reorderSession('missing', 's1');
      expect(store.sessions.map(s => s.id)).toEqual(['s1']);
    });
  });

  describe('updateStatus', () => {
    it('updates session status', () => {
      const s1 = makeSession({ id: 's1', status: 'running' });
      store.addSession(s1);
      store.updateStatus('s1', 'stopped');
      expect(store.sessions.find(s => s.id === 's1')?.status).toBe('stopped');
    });

    it('does not affect other sessions', () => {
      const s1 = makeSession({ id: 's1', status: 'running' });
      const s2 = makeSession({ id: 's2', status: 'running' });
      store.addSession(s1, false);
      store.addSession(s2, false);
      store.updateStatus('s1', 'error');
      expect(store.sessions.find(s => s.id === 's2')?.status).toBe('running');
    });
  });

  describe('updateBranch', () => {
    it('updates session branch', () => {
      const s1 = makeSession({ id: 's1', branch: 'old-branch' });
      store.addSession(s1);
      store.updateBranch('s1', 'new-branch');
      expect(store.sessions.find(s => s.id === 's1')?.branch).toBe('new-branch');
    });
  });

  describe('filtering', () => {
    it('sessionsForRepo returns sessions for a specific repo', () => {
      store.addSession(makeSession({ id: 's1', repoPath: '/repo/a' }), false);
      store.addSession(makeSession({ id: 's2', repoPath: '/repo/b' }), false);
      store.addSession(makeSession({ id: 's3', repoPath: '/repo/a' }), false);

      const result = store.sessionsForRepo('/repo/a');
      expect(result).toHaveLength(2);
      expect(result.every(s => s.repoPath === '/repo/a')).toBe(true);
    });

    it('topLevelSessionsForRepo excludes child sessions', () => {
      store.addSession(makeSession({ id: 's1', repoPath: '/repo/a' }), false);
      store.addSession(makeSession({ id: 's2', repoPath: '/repo/a', parentSessionId: 's1' }), false);

      const result = store.topLevelSessionsForRepo('/repo/a');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('s1');
    });

    it('childSessions returns children of a parent', () => {
      store.addSession(makeSession({ id: 's1', repoPath: '/repo/a' }), false);
      store.addSession(makeSession({ id: 's2', repoPath: '/repo/a', parentSessionId: 's1' }), false);
      store.addSession(makeSession({ id: 's3', repoPath: '/repo/a', parentSessionId: 's1' }), false);

      const children = store.childSessions('s1');
      expect(children).toHaveLength(2);
    });

    it('canRemoveRepo returns true when no sessions', () => {
      store.addRepo('/repo/a');
      expect(store.canRemoveRepo('/repo/a')).toBe(true);
    });

    it('canRemoveRepo returns false when sessions exist', () => {
      store.addRepo('/repo/a');
      store.addSession(makeSession({ repoPath: '/repo/a' }), false);
      expect(store.canRemoveRepo('/repo/a')).toBe(false);
    });
  });

  describe('repoDisplayName', () => {
    it('extracts last segment from unix path', () => {
      expect(store.repoDisplayName('/home/user/my-project')).toBe('my-project');
    });

    it('extracts last segment from windows path', () => {
      expect(store.repoDisplayName('C:\\Users\\user\\my-project')).toBe('my-project');
    });

    it('returns full path if no separator', () => {
      expect(store.repoDisplayName('my-project')).toBe('my-project');
    });
  });

  describe('error handling', () => {
    it('setError sets the error', () => {
      store.setError('Something went wrong');
      expect(store.error).toBe('Something went wrong');
    });

    it('clearError clears the error', () => {
      store.setError('error');
      store.clearError();
      expect(store.error).toBeNull();
    });

    it('setError with null clears', () => {
      store.setError('error');
      store.setError(null);
      expect(store.error).toBeNull();
    });
  });
});
