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
  fileDiff,
  synthesizeUntrackedDiff,
  detectBinaryDiff,
  imageExtFor,
  looksBinary,
  mimeForImageExt,
  stageFile,
  unstageFile,
  commit,
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

describe('stageFile()', () => {
  it('calls git add for the given path', async () => {
    mockExeca.mockResolvedValue({ stdout: '' } as any);
    await stageFile('/repo', 'src/a.ts');
    expect(mockExeca).toHaveBeenCalledWith('git', ['add', '--', 'src/a.ts'], { cwd: '/repo' });
  });
});

describe('unstageFile()', () => {
  it('calls git reset HEAD for the given path', async () => {
    mockExeca.mockResolvedValue({ stdout: '' } as any);
    await unstageFile('/repo', 'src/a.ts');
    expect(mockExeca).toHaveBeenCalledWith('git', ['reset', '-q', 'HEAD', '--', 'src/a.ts'], { cwd: '/repo' });
  });
});

describe('commit()', () => {
  it('calls git commit with the message', async () => {
    mockExeca.mockResolvedValue({ stdout: '' } as any);
    await commit('/repo', 'my message');
    expect(mockExeca).toHaveBeenCalledWith('git', ['commit', '-m', 'my message'], { cwd: '/repo' });
  });

  it('rejects an empty or whitespace-only message without calling git', async () => {
    await expect(commit('/repo', '   ')).rejects.toThrow();
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('fileDiff()', () => {
  it('diffs the working tree against the index for unstaged changes', async () => {
    mockExeca.mockResolvedValue({ stdout: 'unstaged patch' } as any);
    const out = await fileDiff('/repo', 'src/a.ts', { staged: false });
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff', '--', 'src/a.ts'], { cwd: '/repo' });
    expect(out).toBe('unstaged patch');
  });

  it('diffs the index against HEAD for staged changes (--cached)', async () => {
    mockExeca.mockResolvedValue({ stdout: 'staged patch' } as any);
    const out = await fileDiff('/repo', 'src/a.ts', { staged: true });
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff', '--cached', '--', 'src/a.ts'], { cwd: '/repo' });
    expect(out).toBe('staged patch');
  });

  it('defaults to the unstaged (working-tree) diff', async () => {
    mockExeca.mockResolvedValue({ stdout: '' } as any);
    await fileDiff('/repo', 'src/a.ts');
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff', '--', 'src/a.ts'], { cwd: '/repo' });
  });
});

describe('detectBinaryDiff()', () => {
  it('detects git "Binary files ... differ" output', () => {
    const out = 'diff --git a/logo.png b/logo.png\nindex e69..f00 100644\nBinary files a/logo.png and b/logo.png differ\n';
    expect(detectBinaryDiff(out)).toBe(true);
  });

  it('detects a GIT binary patch block', () => {
    expect(detectBinaryDiff('diff --git a/x b/x\nGIT binary patch\n...')).toBe(true);
  });

  it('returns false for a normal text patch', () => {
    const out = '@@ -1,2 +1,2 @@\n-old\n+new\n context\n';
    expect(detectBinaryDiff(out)).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(detectBinaryDiff('')).toBe(false);
  });
});

describe('imageExtFor()', () => {
  it('returns the lowercased extension for known image types', () => {
    expect(imageExtFor('assets/logo.PNG')).toBe('png');
    expect(imageExtFor('a/b/photo.jpeg')).toBe('jpeg');
    expect(imageExtFor('icon.webp')).toBe('webp');
  });

  it('returns null for non-image extensions', () => {
    expect(imageExtFor('src/index.ts')).toBeNull();
    expect(imageExtFor('README.md')).toBeNull();
  });

  it('treats SVG as text (returns null) since it diffs as XML', () => {
    expect(imageExtFor('icon.svg')).toBeNull();
  });
});

describe('looksBinary()', () => {
  it('returns true when a NUL byte is present', () => {
    expect(looksBinary(Buffer.from([0x68, 0x00, 0x69]))).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(looksBinary(Buffer.from('hello\nworld', 'utf-8'))).toBe(false);
  });

  it('returns false for empty buffer', () => {
    expect(looksBinary(Buffer.alloc(0))).toBe(false);
  });
});

describe('mimeForImageExt()', () => {
  it('maps known image extensions to MIME types', () => {
    expect(mimeForImageExt('png')).toBe('image/png');
    expect(mimeForImageExt('jpg')).toBe('image/jpeg');
    expect(mimeForImageExt('jpeg')).toBe('image/jpeg');
    expect(mimeForImageExt('ico')).toBe('image/x-icon');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(mimeForImageExt('xyz')).toBe('application/octet-stream');
  });
});

describe('synthesizeUntrackedDiff()', () => {
  it('builds an all-add unified diff from file content', () => {
    const patch = synthesizeUntrackedDiff('src/new.ts', 'line1\nline2');
    expect(patch).toContain('--- /dev/null');
    expect(patch).toContain('+++ b/src/new.ts');
    expect(patch).toContain('@@ -0,0 +1,2 @@');
    expect(patch).toContain('+line1');
    expect(patch).toContain('+line2');
  });

  it('normalizes Windows path separators to forward slashes', () => {
    const patch = synthesizeUntrackedDiff('src\\nested\\new.ts', 'x');
    expect(patch).toContain('+++ b/src/nested/new.ts');
  });
});
