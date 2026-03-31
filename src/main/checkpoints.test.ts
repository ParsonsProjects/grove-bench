import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock git module before importing
vi.mock('./git.js', () => ({
  git: vi.fn(),
  gitEnv: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Mock fs — capture() now writes commit messages to a temp file
vi.mock('node:fs', () => ({
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { git, gitEnv } from './git.js';
import { CheckpointManager } from './checkpoints.js';
import * as fs from 'node:fs';

const mockGit = vi.mocked(git);
const mockGitEnv = vi.mocked(gitEnv);
const mockFs = vi.mocked(fs);

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

      // Verify commit-tree uses -F (temp file) for Windows newline compat
      expect(mockGit).toHaveBeenCalledWith(
        ['commit-tree', 'abc123tree', '-F', expect.any(String)], '/repo'
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
      const SEP = '@@GROVE_SEP@@';
      mockGit.mockResolvedValueOnce(
        `refs/grove/checkpoints/sess1/turn/1${SEP}grove checkpoint turn=1 uuid=uuid-a${SEP}text=hello\n` +
        `refs/grove/checkpoints/sess1/turn/3${SEP}grove checkpoint turn=3 uuid=uuid-c${SEP}text=third\n` +
        `refs/grove/checkpoints/sess1/turn/2${SEP}grove checkpoint turn=2 uuid=uuid-b${SEP}text=second`
      );

      const mgr = new CheckpointManager();
      const result = await mgr.list('sess1', '/repo');

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ uuid: 'uuid-c', turn: 3, ref: 'refs/grove/checkpoints/sess1/turn/3', text: 'third' });
      expect(result[1]).toEqual({ uuid: 'uuid-b', turn: 2, ref: 'refs/grove/checkpoints/sess1/turn/2', text: 'second' });
      expect(result[2]).toEqual({ uuid: 'uuid-a', turn: 1, ref: 'refs/grove/checkpoints/sess1/turn/1', text: 'hello' });
    });

    it('returns checkpoints without text when body is empty', async () => {
      const SEP = '@@GROVE_SEP@@';
      mockGit.mockResolvedValueOnce(
        `refs/grove/checkpoints/sess1/turn/1${SEP}grove checkpoint turn=1 uuid=uuid-a${SEP}`
      );

      const mgr = new CheckpointManager();
      const result = await mgr.list('sess1', '/repo');

      expect(result).toHaveLength(1);
      expect(result[0].text).toBeUndefined();
    });

    it('skips lines without uuid', async () => {
      const SEP = '@@GROVE_SEP@@';
      mockGit.mockResolvedValueOnce(
        `refs/grove/checkpoints/sess1/turn/1${SEP}grove checkpoint turn=1 uuid=uuid-a${SEP}text=hello\n` +
        `refs/grove/checkpoints/sess1/turn/2${SEP}malformed line${SEP}`
      );

      const mgr = new CheckpointManager();
      const result = await mgr.list('sess1', '/repo');
      expect(result).toHaveLength(1);
      expect(result[0].uuid).toBe('uuid-a');
    });

    it('filters out __baseline__ checkpoint', async () => {
      const SEP = '@@GROVE_SEP@@';
      mockGit.mockResolvedValueOnce(
        `refs/grove/checkpoints/sess1/turn/1${SEP}grove checkpoint turn=1 uuid=__baseline__${SEP}\n` +
        `refs/grove/checkpoints/sess1/turn/2${SEP}grove checkpoint turn=2 uuid=uuid-a${SEP}text=first\n` +
        `refs/grove/checkpoints/sess1/turn/3${SEP}grove checkpoint turn=3 uuid=uuid-b${SEP}text=second`
      );

      const mgr = new CheckpointManager();
      const result = await mgr.list('sess1', '/repo');

      expect(result).toHaveLength(2);
      expect(result.every(c => c.uuid !== '__baseline__')).toBe(true);
      expect(result[0].uuid).toBe('uuid-b');
      expect(result[1].uuid).toBe('uuid-a');
    });

    it('calls git for-each-ref with correct args', async () => {
      mockGit.mockResolvedValueOnce('');
      const mgr = new CheckpointManager();
      await mgr.list('sess1', '/repo');

      const SEP = '@@GROVE_SEP@@';
      expect(mockGit).toHaveBeenCalledWith(
        ['for-each-ref', `--format=%(refname)${SEP}%(subject)${SEP}%(body)`, 'refs/grove/checkpoints/sess1/'],
        '/repo'
      );
    });
  });

  describe('capture() with text', () => {
    /** Helper: get the commit message written to the temp file by capture(). */
    function getWrittenCommitMsg(): string {
      const writeCall = mockFs.writeFileSync.mock.calls.find(
        (c) => String(c[0]).includes('grove-msg-'),
      );
      return writeCall ? String(writeCall[1]) : '';
    }

    it('includes text in commit message with double newline for body separation', async () => {
      mockGitEnv.mockResolvedValue('');
      mockGitEnv.mockResolvedValueOnce(''); // read-tree
      mockGitEnv.mockResolvedValueOnce(''); // add -A
      mockGitEnv.mockResolvedValueOnce('tree1'); // write-tree
      mockGit.mockResolvedValueOnce('commit1'); // commit-tree
      mockGit.mockResolvedValueOnce(''); // update-ref

      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-1', 'Fix the login bug');

      const msg = getWrittenCommitMsg();
      // Subject line should have uuid
      expect(msg).toContain('uuid=uuid-1');
      // Body should be separated by blank line and contain text=
      expect(msg).toContain('\n\ntext=Fix the login bug');

      // commit-tree should use -F (temp file) not -m
      const commitTreeCall = mockGit.mock.calls.find(c => c[0][0] === 'commit-tree');
      expect(commitTreeCall![0]).toContain('-F');
    });

    it('strips \\r\\n from text for Windows compatibility', async () => {
      mockGitEnv.mockResolvedValue('');
      mockGitEnv.mockResolvedValueOnce('');
      mockGitEnv.mockResolvedValueOnce('');
      mockGitEnv.mockResolvedValueOnce('tree1');
      mockGit.mockResolvedValueOnce('commit1');
      mockGit.mockResolvedValueOnce('');

      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-1', 'line1\r\nline2\nline3');

      const msg = getWrittenCommitMsg();
      expect(msg).toContain('text=line1 line2 line3');
    });

    it('truncates text to 200 characters', async () => {
      mockGitEnv.mockResolvedValue('');
      mockGitEnv.mockResolvedValueOnce('');
      mockGitEnv.mockResolvedValueOnce('');
      mockGitEnv.mockResolvedValueOnce('tree1');
      mockGit.mockResolvedValueOnce('commit1');
      mockGit.mockResolvedValueOnce('');

      const longText = 'a'.repeat(300);
      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-1', longText);

      const msg = getWrittenCommitMsg();
      const textPart = msg.split('text=')[1];
      expect(textPart).toHaveLength(200);
    });

    it('omits text line when text is empty', async () => {
      mockGitEnv.mockResolvedValue('');
      mockGitEnv.mockResolvedValueOnce('');
      mockGitEnv.mockResolvedValueOnce('');
      mockGitEnv.mockResolvedValueOnce('tree1');
      mockGit.mockResolvedValueOnce('commit1');
      mockGit.mockResolvedValueOnce('');

      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-1');

      const msg = getWrittenCommitMsg();
      expect(msg).not.toContain('text=');
      expect(msg).not.toContain('\n\n');
    });
  });

  describe('waitForPending()', () => {
    it('resolves immediately when no session exists', async () => {
      const mgr = new CheckpointManager();
      await mgr.waitForPending('unknown'); // should not throw
    });

    it('waits for in-flight capture to complete', async () => {
      let resolveCapture!: () => void;
      const capturePromise = new Promise<void>(r => { resolveCapture = r; });
      let captureStarted = false;

      mockGitEnv.mockImplementation(async () => {
        captureStarted = true;
        await capturePromise;
        return '';
      });
      mockGit.mockResolvedValue('oid');

      const mgr = new CheckpointManager();
      const capP = mgr.capture('sess1', '/repo', 'uuid-1');

      // Start waiting — should not resolve until capture finishes
      let waitDone = false;
      const waitP = mgr.waitForPending('sess1').then(() => { waitDone = true; });

      // Give microtasks a chance to settle
      await new Promise(r => setTimeout(r, 10));
      expect(captureStarted).toBe(true);
      expect(waitDone).toBe(false);

      // Release the capture
      resolveCapture();
      await Promise.all([capP, waitP]);
      expect(waitDone).toBe(true);
    });
  });

  describe('pruneAfter()', () => {
    it('deletes refs with turns after the rewind point', async () => {
      // Set up captures for turns 1-3
      mockGitEnv.mockResolvedValue('');
      mockGit.mockResolvedValue('oid');
      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-a');
      await mgr.capture('sess1', '/repo', 'uuid-b');
      await mgr.capture('sess1', '/repo', 'uuid-c');

      mockGit.mockClear();
      // for-each-ref returns all refs
      mockGit.mockResolvedValueOnce(
        'refs/grove/checkpoints/sess1/turn/1\n' +
        'refs/grove/checkpoints/sess1/turn/2\n' +
        'refs/grove/checkpoints/sess1/turn/3'
      );
      // update-ref -d calls
      mockGit.mockResolvedValue('');

      await mgr.pruneAfter('sess1', '/repo', 'uuid-a');

      // Should delete turns 2 and 3 but not turn 1
      expect(mockGit).toHaveBeenCalledWith(['update-ref', '-d', 'refs/grove/checkpoints/sess1/turn/2'], '/repo');
      expect(mockGit).toHaveBeenCalledWith(['update-ref', '-d', 'refs/grove/checkpoints/sess1/turn/3'], '/repo');
      expect(mockGit).not.toHaveBeenCalledWith(['update-ref', '-d', 'refs/grove/checkpoints/sess1/turn/1'], '/repo');
    });

    it('removes pruned uuids from in-memory map', async () => {
      mockGitEnv.mockResolvedValue('');
      mockGit.mockResolvedValue('oid');
      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-a');
      await mgr.capture('sess1', '/repo', 'uuid-b');

      expect(mgr.has('sess1', 'uuid-b')).toBe(true);

      mockGit.mockClear();
      mockGit.mockResolvedValueOnce(
        'refs/grove/checkpoints/sess1/turn/1\n' +
        'refs/grove/checkpoints/sess1/turn/2'
      );
      mockGit.mockResolvedValue('');

      await mgr.pruneAfter('sess1', '/repo', 'uuid-a');

      expect(mgr.has('sess1', 'uuid-a')).toBe(true);
      expect(mgr.has('sess1', 'uuid-b')).toBe(false);
    });

    it('resets turnCount so next capture continues from rewind point', async () => {
      mockGitEnv.mockResolvedValue('');
      mockGit.mockResolvedValue('oid');
      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-a'); // turn 1
      await mgr.capture('sess1', '/repo', 'uuid-b'); // turn 2
      await mgr.capture('sess1', '/repo', 'uuid-c'); // turn 3

      mockGit.mockClear();
      // for-each-ref for pruneAfter
      mockGit.mockResolvedValueOnce(
        'refs/grove/checkpoints/sess1/turn/1\n' +
        'refs/grove/checkpoints/sess1/turn/2\n' +
        'refs/grove/checkpoints/sess1/turn/3'
      );
      mockGit.mockResolvedValue('');

      await mgr.pruneAfter('sess1', '/repo', 'uuid-a'); // rewind to turn 1

      // Next capture should be turn 2
      mockGitEnv.mockResolvedValue('');
      mockGit.mockClear();
      mockGitEnv.mockResolvedValueOnce('');
      mockGitEnv.mockResolvedValueOnce('');
      mockGitEnv.mockResolvedValueOnce('newtree');
      mockGit.mockResolvedValueOnce('newcommit');
      mockGit.mockResolvedValueOnce('');

      await mgr.capture('sess1', '/repo', 'uuid-d');

      const updateRefCalls = mockGit.mock.calls.filter(c => c[0][0] === 'update-ref');
      expect(updateRefCalls[0][0][1]).toContain('turn/2');
    });

    it('does nothing when uuid is not found', async () => {
      // resolveRef will do a fallback scan via for-each-ref, returning no matches
      mockGit.mockResolvedValueOnce('');
      const mgr = new CheckpointManager();
      // Should not throw
      await mgr.pruneAfter('sess1', '/repo', 'missing');
      // Only the resolveRef fallback call, no update-ref -d calls
      const deleteRefCalls = mockGit.mock.calls.filter(c => c[0][0] === 'update-ref');
      expect(deleteRefCalls).toHaveLength(0);
    });

    it('handles for-each-ref failure gracefully', async () => {
      mockGitEnv.mockResolvedValue('');
      mockGit.mockResolvedValue('oid');
      const mgr = new CheckpointManager();
      await mgr.capture('sess1', '/repo', 'uuid-a');

      mockGit.mockClear();
      // for-each-ref fails
      mockGit.mockRejectedValueOnce(new Error('git error'));

      // Should not throw
      await mgr.pruneAfter('sess1', '/repo', 'uuid-a');
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
