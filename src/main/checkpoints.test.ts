import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock git module before importing
vi.mock('./git.js', () => ({
  git: vi.fn(),
  gitEnv: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Mock fs.rmSync
vi.mock('node:fs', () => ({
  rmSync: vi.fn(),
}));

import { git, gitEnv } from './git.js';
import { CheckpointManager } from './checkpoints.js';

const mockGit = vi.mocked(git);
const mockGitEnv = vi.mocked(gitEnv);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CheckpointManager', () => {
  describe('capture()', () => {
    it('runs correct git plumbing sequence and records uuid→ref mapping', async () => {
      mockGitEnv.mockResolvedValue(''); // read-tree, add
      mockGitEnv.mockResolvedValueOnce(''); // read-tree
      mockGitEnv.mockResolvedValueOnce(''); // add -A
      mockGitEnv.mockResolvedValueOnce('abc123tree'); // write-tree
      mockGit.mockResolvedValueOnce('def456commit'); // commit-tree
      mockGit.mockResolvedValueOnce(''); // update-ref

      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-1');

      // Verify gitEnv was called with GIT_INDEX_FILE env
      expect(mockGitEnv).toHaveBeenCalledWith(
        ['read-tree', 'HEAD'], '/repo', expect.objectContaining({ GIT_INDEX_FILE: expect.any(String) })
      );
      expect(mockGitEnv).toHaveBeenCalledWith(
        ['add', '-A'], '/repo', expect.objectContaining({ GIT_INDEX_FILE: expect.any(String) })
      );
      expect(mockGitEnv).toHaveBeenCalledWith(
        ['write-tree'], '/repo', expect.objectContaining({ GIT_INDEX_FILE: expect.any(String) })
      );

      // Verify commit-tree and update-ref
      expect(mockGit).toHaveBeenCalledWith(
        ['commit-tree', 'abc123tree', '-m', expect.stringContaining('uuid=uuid-1')], '/repo'
      );
      expect(mockGit).toHaveBeenCalledWith(
        ['update-ref', 'refs/grove/checkpoints/sess1/turn/1', 'def456commit'], '/repo'
      );

      // UUID should be recorded
      expect(mgr.has('sess1', 'uuid-1')).toBe(true);
    });

    it('increments turn counter for subsequent captures', async () => {
      mockGitEnv.mockResolvedValue('');
      mockGitEnv.mockResolvedValue('tree1');
      mockGit.mockResolvedValue('commit1');

      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-1');
      await mgr.capture('sess1', '/repo', 'uuid-2');

      // Second capture should use turn/2
      const updateRefCalls = mockGit.mock.calls.filter(c => c[0][0] === 'update-ref');
      expect(updateRefCalls[1][0][1]).toContain('turn/2');
    });

    it('swallows capture failures without throwing', async () => {
      mockGitEnv.mockRejectedValue(new Error('git failed'));

      const mgr = new CheckpointManager();
      // Should not throw
      await mgr.capture('sess1', '/repo', 'uuid-1');
      expect(mgr.has('sess1', 'uuid-1')).toBe(false);
    });

    it('serializes concurrent captures via queue', async () => {
      const callOrder: number[] = [];
      let captureCount = 0;

      mockGitEnv.mockImplementation(async () => {
        callOrder.push(++captureCount);
        return '';
      });
      mockGit.mockResolvedValue('oid');

      const mgr = new CheckpointManager();
      // Fire two captures concurrently
      const p1 = mgr.capture('sess1', '/repo', 'uuid-1');
      const p2 = mgr.capture('sess1', '/repo', 'uuid-2');
      await Promise.all([p1, p2]);

      // Both should complete (all gitEnv calls executed)
      expect(mockGitEnv).toHaveBeenCalled();
    });
  });

  describe('restore()', () => {
    it('runs restore/clean/reset sequence', async () => {
      // Set up a captured checkpoint first
      mockGitEnv.mockResolvedValue('');
      mockGit.mockResolvedValue('oid');
      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-1');

      mockGit.mockClear();
      // rev-parse returns oid
      mockGit.mockResolvedValueOnce('abc123');
      // restore, clean, reset
      mockGit.mockResolvedValueOnce('');
      mockGit.mockResolvedValueOnce('');
      mockGit.mockResolvedValueOnce('');

      await mgr.restore('sess1', '/repo', 'uuid-1');

      expect(mockGit).toHaveBeenCalledWith(
        ['rev-parse', expect.stringContaining('refs/grove/checkpoints/sess1/')], '/repo'
      );
      expect(mockGit).toHaveBeenCalledWith(
        ['restore', '--source', 'abc123', '--worktree', '--staged', '--', '.'], '/repo'
      );
      expect(mockGit).toHaveBeenCalledWith(
        ['clean', '-fd', '--', '.'], '/repo'
      );
      expect(mockGit).toHaveBeenCalledWith(
        ['reset', '--quiet', '--', '.'], '/repo'
      );
    });

    it('throws when uuid not found', async () => {
      const mgr = new CheckpointManager();
      await expect(mgr.restore('sess1', '/repo', 'missing')).rejects.toThrow('No checkpoint found');
    });
  });

  describe('diff()', () => {
    it('returns git diff output', async () => {
      mockGitEnv.mockResolvedValue('');
      mockGit.mockResolvedValue('oid');
      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-1');

      mockGit.mockClear();
      mockGit.mockResolvedValueOnce('diff --git a/file.ts b/file.ts\n+added line');

      const result = await mgr.diff('sess1', '/repo', 'uuid-1');
      expect(result).toContain('+added line');
      expect(mockGit).toHaveBeenCalledWith(
        ['diff', expect.stringContaining('refs/grove/checkpoints/sess1/'), '--', '.'], '/repo'
      );
    });

    it('returns message when no checkpoint found', async () => {
      const mgr = new CheckpointManager();
      const result = await mgr.diff('sess1', '/repo', 'missing');
      expect(result).toBe('No checkpoint found for this message');
    });

    it('returns "(no changes)" when diff is empty', async () => {
      mockGitEnv.mockResolvedValue('');
      mockGit.mockResolvedValue('oid');
      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-1');

      mockGit.mockClear();
      mockGit.mockResolvedValueOnce('');

      const result = await mgr.diff('sess1', '/repo', 'uuid-1');
      expect(result).toBe('(no changes)');
    });
  });

  describe('cleanup()', () => {
    it('deletes all session refs', async () => {
      mockGit.mockResolvedValueOnce('refs/grove/checkpoints/sess1/turn/1\nrefs/grove/checkpoints/sess1/turn/2');
      mockGit.mockResolvedValue(''); // update-ref -d calls

      const mgr = new CheckpointManager();
      await mgr.cleanup('sess1', '/repo');

      expect(mockGit).toHaveBeenCalledWith(
        ['for-each-ref', '--format=%(refname)', 'refs/grove/checkpoints/sess1/'], '/repo'
      );
      expect(mockGit).toHaveBeenCalledWith(['update-ref', '-d', 'refs/grove/checkpoints/sess1/turn/1'], '/repo');
      expect(mockGit).toHaveBeenCalledWith(['update-ref', '-d', 'refs/grove/checkpoints/sess1/turn/2'], '/repo');
    });

    it('handles no refs gracefully', async () => {
      mockGit.mockRejectedValue(new Error('no refs'));
      const mgr = new CheckpointManager();
      // Should not throw
      await mgr.cleanup('sess1', '/repo');
    });
  });

  describe('has()', () => {
    it('returns true for captured uuid', async () => {
      mockGitEnv.mockResolvedValue('');
      mockGit.mockResolvedValue('oid');

      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-1');
      expect(mgr.has('sess1', 'uuid-1')).toBe(true);
    });

    it('returns false for unknown uuid', () => {
      const mgr = new CheckpointManager();
      expect(mgr.has('sess1', 'unknown')).toBe(false);
    });

    it('returns false for unknown session', () => {
      const mgr = new CheckpointManager();
      expect(mgr.has('unknown', 'uuid-1')).toBe(false);
    });
  });

  describe('list()', () => {
    it('returns empty array for unknown session', async () => {
      const mgr = new CheckpointManager();
      const result = await mgr.list('unknown', '/repo');
      expect(result).toEqual([]);
    });

    it('returns empty array when no refs exist', async () => {
      mockGit.mockRejectedValueOnce(new Error('no refs'));
      const mgr = new CheckpointManager();
      const result = await mgr.list('sess1', '/repo');
      expect(result).toEqual([]);
    });

    it('returns checkpoints sorted newest-first', async () => {
      mockGit.mockResolvedValueOnce(
        'refs/grove/checkpoints/sess1/turn/1 grove checkpoint turn=1 uuid=uuid-a\n' +
        'refs/grove/checkpoints/sess1/turn/3 grove checkpoint turn=3 uuid=uuid-c\n' +
        'refs/grove/checkpoints/sess1/turn/2 grove checkpoint turn=2 uuid=uuid-b'
      );

      const mgr = new CheckpointManager();
      const result = await mgr.list('sess1', '/repo');

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ uuid: 'uuid-c', turn: 3, ref: 'refs/grove/checkpoints/sess1/turn/3' });
      expect(result[1]).toEqual({ uuid: 'uuid-b', turn: 2, ref: 'refs/grove/checkpoints/sess1/turn/2' });
      expect(result[2]).toEqual({ uuid: 'uuid-a', turn: 1, ref: 'refs/grove/checkpoints/sess1/turn/1' });
    });

    it('skips lines without uuid', async () => {
      mockGit.mockResolvedValueOnce(
        'refs/grove/checkpoints/sess1/turn/1 grove checkpoint turn=1 uuid=uuid-a\n' +
        'refs/grove/checkpoints/sess1/turn/2 malformed line'
      );

      const mgr = new CheckpointManager();
      const result = await mgr.list('sess1', '/repo');
      expect(result).toHaveLength(1);
      expect(result[0].uuid).toBe('uuid-a');
    });

    it('calls git for-each-ref with correct args', async () => {
      mockGit.mockResolvedValueOnce('');
      const mgr = new CheckpointManager();
      await mgr.list('sess1', '/repo');

      expect(mockGit).toHaveBeenCalledWith(
        ['for-each-ref', '--format=%(refname) %(subject)', 'refs/grove/checkpoints/sess1/'],
        '/repo'
      );
    });
  });

  describe('resume()', () => {
    it('rebuilds state from existing refs', async () => {
      mockGit.mockResolvedValueOnce(
        'refs/grove/checkpoints/sess1/turn/1 grove checkpoint turn=1 uuid=uuid-a\n' +
        'refs/grove/checkpoints/sess1/turn/2 grove checkpoint turn=2 uuid=uuid-b'
      );

      const mgr = new CheckpointManager();
      await mgr.resume('sess1', '/repo');

      expect(mgr.has('sess1', 'uuid-a')).toBe(true);
      expect(mgr.has('sess1', 'uuid-b')).toBe(true);
    });

    it('sets turnCount to max existing turn', async () => {
      mockGit.mockResolvedValueOnce(
        'refs/grove/checkpoints/sess1/turn/3 grove checkpoint turn=3 uuid=uuid-c'
      );

      const mgr = new CheckpointManager();
      await mgr.resume('sess1', '/repo');

      // Next capture should use turn/4
      mockGitEnv.mockResolvedValue('');
      mockGit.mockResolvedValue('oid');
      await mgr.capture('sess1', '/repo', 'uuid-d');

      const updateRefCalls = mockGit.mock.calls.filter(c => c[0][0] === 'update-ref');
      const lastRef = updateRefCalls[updateRefCalls.length - 1][0][1];
      expect(lastRef).toContain('turn/4');
    });

    it('handles no existing refs gracefully', async () => {
      mockGit.mockRejectedValue(new Error('no refs'));
      const mgr = new CheckpointManager();
      // Should not throw
      await mgr.resume('sess1', '/repo');
      expect(mgr.has('sess1', 'anything')).toBe(false);
    });
  });
});
