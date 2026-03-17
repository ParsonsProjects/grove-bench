import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock execa before importing git module
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import {
  git,
  gitVersion,
  isGitRepo,
  branchExists,
  branchExistsAnywhere,
  listBranches,
  validateBranchName,
  mergeNoCommit,
  abortMerge,
  branchHasRemote,
  renameBranch,
} from './git.js';

const mockExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('git()', () => {
  it('calls execa with correct args and cwd', async () => {
    mockExeca.mockResolvedValue({ stdout: 'output' } as any);
    const result = await git(['status'], '/repo');
    expect(mockExeca).toHaveBeenCalledWith('git', ['status'], { cwd: '/repo' });
    expect(result).toBe('output');
  });

  it('propagates errors', async () => {
    mockExeca.mockRejectedValue(new Error('fatal'));
    await expect(git(['bad'], '/repo')).rejects.toThrow('fatal');
  });
});

describe('gitVersion()', () => {
  it('parses version string', async () => {
    mockExeca.mockResolvedValue({ stdout: 'git version 2.39.1' } as any);
    const v = await gitVersion();
    expect(v).toEqual({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
  });

  it('returns null on error', async () => {
    mockExeca.mockRejectedValue(new Error('not found'));
    expect(await gitVersion()).toBeNull();
  });

  it('returns null for unparseable output', async () => {
    mockExeca.mockResolvedValue({ stdout: 'something weird' } as any);
    expect(await gitVersion()).toBeNull();
  });
});

describe('isGitRepo()', () => {
  it('returns true when git rev-parse succeeds', async () => {
    mockExeca.mockResolvedValue({ stdout: '.git' } as any);
    expect(await isGitRepo('/repo')).toBe(true);
  });

  it('returns false when git rev-parse fails', async () => {
    mockExeca.mockRejectedValue(new Error('not a repo'));
    expect(await isGitRepo('/not-a-repo')).toBe(false);
  });
});

describe('branchExists()', () => {
  it('returns true when branch exists', async () => {
    mockExeca.mockResolvedValue({ stdout: 'abc123' } as any);
    expect(await branchExists('/repo', 'main')).toBe(true);
  });

  it('returns false when branch does not exist', async () => {
    mockExeca.mockRejectedValue(new Error('not a valid ref'));
    expect(await branchExists('/repo', 'nope')).toBe(false);
  });
});

describe('branchExistsAnywhere()', () => {
  it('returns true when branch exists locally', async () => {
    // First call: branchExists succeeds
    mockExeca.mockResolvedValueOnce({ stdout: 'abc123' } as any);
    expect(await branchExistsAnywhere('/repo', 'main')).toBe(true);
  });

  it('checks remote refs when not local', async () => {
    // branchExists fails (first call to rev-parse)
    mockExeca.mockRejectedValueOnce(new Error('not found'));
    // branch -r returns remote refs
    mockExeca.mockResolvedValueOnce({
      stdout: 'origin/main\norigin/feat/foo\nupstream/dev',
    } as any);

    expect(await branchExistsAnywhere('/repo', 'feat/foo')).toBe(true);
  });

  it('returns false when not found anywhere', async () => {
    mockExeca.mockRejectedValueOnce(new Error('not found'));
    mockExeca.mockResolvedValueOnce({ stdout: 'origin/main\norigin/dev' } as any);
    expect(await branchExistsAnywhere('/repo', 'feat/missing')).toBe(false);
  });

  it('returns false when remote check fails', async () => {
    mockExeca.mockRejectedValueOnce(new Error('not found'));
    mockExeca.mockRejectedValueOnce(new Error('no remote'));
    expect(await branchExistsAnywhere('/repo', 'feat/x')).toBe(false);
  });
});

describe('listBranches()', () => {
  beforeEach(() => {
    // Default: fetch succeeds, remotes returns "origin", branch -a returns some branches
    mockExeca
      .mockResolvedValueOnce({ stdout: '' } as any) // fetch --prune (via git())
      .mockResolvedValueOnce({ stdout: 'origin' } as any) // remote (via git())
      .mockResolvedValueOnce({ stdout: 'main\nfeat/foo\norigin/main\norigin/feat/bar\norigin/HEAD' } as any); // branch -a (via git())
  });

  it('deduplicates local and remote branches', async () => {
    const branches = await listBranches('/repo');
    expect(branches).toContain('main');
    // Should only appear once despite being both local and remote
    expect(branches.filter(b => b === 'main')).toHaveLength(1);
  });

  it('strips remote prefix from branch names', async () => {
    const branches = await listBranches('/repo');
    expect(branches).toContain('feat/bar');
    expect(branches).not.toContain('origin/feat/bar');
  });

  it('skips HEAD pointers', async () => {
    const branches = await listBranches('/repo');
    expect(branches).not.toContain('HEAD');
    expect(branches).not.toContain('origin/HEAD');
  });

  it('handles fetch failure gracefully', async () => {
    mockExeca.mockReset();
    mockExeca
      .mockRejectedValueOnce(new Error('offline')) // fetch fails
      .mockResolvedValueOnce({ stdout: '' } as any) // remote
      .mockResolvedValueOnce({ stdout: 'main\ndev' } as any); // branch -a
    const branches = await listBranches('/repo');
    expect(branches).toContain('main');
    expect(branches).toContain('dev');
  });
});

describe('mergeNoCommit()', () => {
  it('returns success when merge succeeds', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: '' } as any) // merge
      .mockResolvedValueOnce({ stdout: '' } as any); // commit
    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result).toEqual({ success: true });
  });

  it('detects conflicts from porcelain status (UU lines)', async () => {
    // merge fails
    mockExeca.mockRejectedValueOnce(new Error('merge conflict'));
    // status --porcelain returns UU lines
    mockExeca.mockResolvedValueOnce({ stdout: 'UU src/file1.ts\nUU src/file2.ts\nM  src/clean.ts' } as any);

    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result.success).toBe(false);
    expect(result.conflicts).toEqual(['src/file1.ts', 'src/file2.ts']);
  });

  it('detects conflicts from AA/DD/DU/UD/AU/UA patterns', async () => {
    mockExeca.mockRejectedValueOnce(new Error('merge conflict'));
    mockExeca.mockResolvedValueOnce({ stdout: 'AA src/both-added.ts\nDD src/both-deleted.ts' } as any);

    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result.success).toBe(false);
    expect(result.conflicts).toContain('src/both-added.ts');
    expect(result.conflicts).toContain('src/both-deleted.ts');
  });

  it('falls back to diff --name-only when no UU lines', async () => {
    mockExeca.mockRejectedValueOnce(new Error('merge conflict'));
    // status shows no conflict markers
    mockExeca.mockResolvedValueOnce({ stdout: 'M  src/clean.ts' } as any);
    // diff --name-only returns conflicts
    mockExeca.mockResolvedValueOnce({ stdout: 'src/conflicted.ts' } as any);

    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result.success).toBe(false);
    expect(result.conflicts).toContain('src/conflicted.ts');
  });

  it('falls back to parsing error message when all else fails', async () => {
    const mergeErr = new Error('something');
    (mergeErr as any).stderr = 'CONFLICT (content): Merge conflict in src/index.ts';
    mockExeca.mockRejectedValueOnce(mergeErr);
    // status shows nothing useful
    mockExeca.mockResolvedValueOnce({ stdout: '' } as any);
    // diff also empty
    mockExeca.mockResolvedValueOnce({ stdout: '' } as any);

    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result.success).toBe(false);
    expect(result.conflicts).toContain('src/index.ts');
  });

  it('returns error message snippet when no conflicts detected', async () => {
    const mergeErr = new Error('some unknown error');
    (mergeErr as any).stderr = 'fatal: some unknown error';
    mockExeca.mockRejectedValueOnce(mergeErr);
    mockExeca.mockResolvedValueOnce({ stdout: '' } as any); // status
    mockExeca.mockResolvedValueOnce({ stdout: '' } as any); // diff

    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result.success).toBe(false);
    expect(result.conflicts!.length).toBe(1);
    expect(result.conflicts![0]).toContain('fatal');
  });

  it('handles status check failure', async () => {
    const mergeErr = new Error('conflict');
    (mergeErr as any).stderr = 'merge failed';
    mockExeca.mockRejectedValueOnce(mergeErr);
    // status itself fails
    mockExeca.mockRejectedValueOnce(new Error('status failed'));

    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result.success).toBe(false);
    expect(result.conflicts!.length).toBeGreaterThan(0);
  });
});

describe('abortMerge()', () => {
  it('calls git merge --abort', async () => {
    mockExeca.mockResolvedValue({ stdout: '' } as any);
    await abortMerge('/repo');
    expect(mockExeca).toHaveBeenCalledWith('git', ['merge', '--abort'], { cwd: '/repo' });
  });

  it('does not throw when no merge in progress', async () => {
    mockExeca.mockRejectedValue(new Error('no merge'));
    await expect(abortMerge('/repo')).resolves.toBeUndefined();
  });
});

describe('branchHasRemote()', () => {
  it('returns true when remote tracking branch exists', async () => {
    mockExeca.mockResolvedValue({ stdout: '  origin/feat/x' } as any);
    expect(await branchHasRemote('/repo', 'feat/x')).toBe(true);
  });

  it('returns false when no remote tracking branch', async () => {
    mockExeca.mockResolvedValue({ stdout: '' } as any);
    expect(await branchHasRemote('/repo', 'feat/x')).toBe(false);
  });

  it('returns false on error', async () => {
    mockExeca.mockRejectedValue(new Error('fail'));
    expect(await branchHasRemote('/repo', 'feat/x')).toBe(false);
  });
});

describe('validateBranchName()', () => {
  it('returns true for valid names', async () => {
    mockExeca.mockResolvedValue({ stdout: '' } as any);
    expect(await validateBranchName('feat/valid-name')).toBe(true);
  });

  it('returns false for invalid names', async () => {
    mockExeca.mockRejectedValue(new Error('invalid'));
    expect(await validateBranchName('..bad')).toBe(false);
  });
});

describe('renameBranch()', () => {
  it('calls git branch -m', async () => {
    mockExeca.mockResolvedValue({ stdout: '' } as any);
    await renameBranch('/repo', 'old', 'new');
    expect(mockExeca).toHaveBeenCalledWith('git', ['branch', '-m', 'old', 'new'], { cwd: '/repo' });
  });
});
