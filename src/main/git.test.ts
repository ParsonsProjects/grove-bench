import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock execa before importing git module
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  git,
  gitVersion,
  isGitRepo,
  branchExists,
  branchExistsAnywhere,
  getDefaultBranch,
  listBranches,
  validateBranchName,
  mergeNoCommit,
  abortMerge,
  branchHasRemote,
  renameBranch,
  fileDiff,
  blobLines,
  gitPatch,
  MAX_TEXT_FILE_BYTES,
  isTracked,
  synthesizeUntrackedDiff,
  detectBinaryDiff,
  imageExtFor,
  looksBinary,
  mimeForImageExt,
  stageFile,
  unstageFile,
  commit,
  push,
  syncStatus,
  branchCommits,
  gitOperation,
  continueGitOperation,
  parseBranchCommits,
  rebaseOnto,
  cherryPick,
  squashSince,
  logCommits,
  parseLogCommits,
  currentBranch,
  recentCheckouts,
  parseCheckoutBranches,
  localBranchExists,
  remoteTrackingRef,
  parseWorktreeBranches,
  checkoutBranch,
  isWorkingTreeClean,
  getGitIdentity,
  isRefArg,
  listProjectFiles,
  resolveMergeBase,
  revertFile,
} from './git.js';

const mockExeca = vi.mocked(execa);
/** What execa resolves with when git prints `stdout`: git() reads only that. */
type GitResult = Parameters<typeof mockExeca.mockResolvedValue>[0];
const printed = (stdout: string | Buffer) => ({ stdout }) as GitResult;

/** Answer git by command (args joined with spaces, matched by prefix)
 *  rather than by call order. Unmatched commands print nothing. */
function scriptGit(answers: Record<string, string | Error>) {
  mockExeca.mockImplementation((async (_cmd: string, args: string[]) => {
    const line = args.join(' ');
    const key = Object.keys(answers).find((k) => line.startsWith(k));
    const answer = key === undefined ? '' : answers[key];
    if (answer instanceof Error) throw answer;
    return { stdout: answer };
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('git()', () => {
  it('calls execa with correct args and cwd', async () => {
    mockExeca.mockResolvedValue(printed('output'));
    const result = await git(['status'], '/repo');
    expect(mockExeca).toHaveBeenCalledWith('git', ['status'], { cwd: '/repo' });
    expect(result).toBe('output');
  });

  it('propagates errors', async () => {
    mockExeca.mockRejectedValue(new Error('fatal'));
    await expect(git(['bad'], '/repo')).rejects.toThrow('fatal');
  });
});

describe('git() without optional locks', () => {
  it('asks git not to take them, through the environment, leaving the arguments as they are', async () => {
    mockExeca.mockResolvedValue({ stdout: '' } as never);
    await git(['status', '--porcelain=v1'], '/wt', { optionalLocks: false });
    const [, args, opts] = mockExeca.mock.calls[0] as unknown as [string, string[], { env?: Record<string, string> }];
    expect(args).toEqual(['status', '--porcelain=v1']);
    expect(opts.env?.GIT_OPTIONAL_LOCKS).toBe('0');

    mockExeca.mockClear();
    await git(['status'], '/wt');
    expect((mockExeca.mock.calls[0] as unknown as [string, string[], { env?: unknown }])[2].env).toBeUndefined();
  });
});

describe('gitVersion()', () => {
  it('parses version string', async () => {
    mockExeca.mockResolvedValue(printed('git version 2.39.1'));
    const v = await gitVersion();
    expect(v).toEqual({ version: 'git version 2.39.1', major: 2, minor: 39, patch: 1 });
  });

  it("reads Git for Windows' version, which has a suffix", async () => {
    mockExeca.mockResolvedValue({ stdout: 'git version 2.23.0.windows.1\n' } as never);
    expect(await gitVersion()).toEqual({ version: 'git version 2.23.0.windows.1', major: 2, minor: 23, patch: 0 });
  });

  it('returns null on error', async () => {
    mockExeca.mockRejectedValue(new Error('not found'));
    expect(await gitVersion()).toBeNull();
  });

  it('returns null for unparseable output', async () => {
    mockExeca.mockResolvedValue(printed('something weird'));
    expect(await gitVersion()).toBeNull();
  });
});

describe('isGitRepo()', () => {
  it('returns true when git rev-parse succeeds', async () => {
    mockExeca.mockResolvedValue(printed('.git'));
    expect(await isGitRepo('/repo')).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('git', ['rev-parse', '--git-dir'], { cwd: '/repo' });
  });

  it('returns false when git rev-parse fails', async () => {
    mockExeca.mockRejectedValue(new Error('not a repo'));
    expect(await isGitRepo('/not-a-repo')).toBe(false);
    expect(mockExeca).toHaveBeenCalledWith('git', ['rev-parse', '--git-dir'], { cwd: '/not-a-repo' });
  });
});

describe('branchExists()', () => {
  it('returns true when branch exists', async () => {
    mockExeca.mockResolvedValue(printed('abc123'));
    expect(await branchExists('/repo', 'main')).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('git', ['rev-parse', '--verify', 'main'], { cwd: '/repo' });
  });

  it('returns false when branch does not exist', async () => {
    mockExeca.mockRejectedValue(new Error('not a valid ref'));
    expect(await branchExists('/repo', 'nope')).toBe(false);
    expect(mockExeca).toHaveBeenCalledWith('git', ['rev-parse', '--verify', 'nope'], { cwd: '/repo' });
  });
});

describe('branchExistsAnywhere()', () => {
  it('returns true when branch exists locally', async () => {
    // First call: branchExists succeeds
    mockExeca.mockResolvedValueOnce(printed('abc123'));
    expect(await branchExistsAnywhere('/repo', 'main')).toBe(true);
  });

  it('checks remote refs when not local', async () => {
    // branchExists fails (first call to rev-parse)
    mockExeca.mockRejectedValueOnce(new Error('not found'));
    // branch -r returns remote refs
    mockExeca.mockResolvedValueOnce(printed('origin/main\norigin/feat/foo\nupstream/dev'));

    expect(await branchExistsAnywhere('/repo', 'feat/foo')).toBe(true);
  });

  it('returns false when not found anywhere', async () => {
    mockExeca.mockRejectedValueOnce(new Error('not found'));
    mockExeca.mockResolvedValueOnce(printed('origin/main\norigin/dev'));
    expect(await branchExistsAnywhere('/repo', 'feat/missing')).toBe(false);
  });

  it('returns false when remote check fails', async () => {
    mockExeca.mockRejectedValueOnce(new Error('not found'));
    mockExeca.mockRejectedValueOnce(new Error('no remote'));
    expect(await branchExistsAnywhere('/repo', 'feat/x')).toBe(false);
  });
});

describe('getDefaultBranch()', () => {
  it('uses origin/HEAD when set', async () => {
    mockExeca.mockResolvedValueOnce(printed('origin/develop\n'));
    expect(await getDefaultBranch('/repo')).toBe('develop');
    expect(mockExeca).toHaveBeenCalledWith(
      'git',
      ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
      { cwd: '/repo' },
    );
  });

  it('falls back to main when it exists and origin/HEAD is unset', async () => {
    mockExeca.mockRejectedValueOnce(new Error('no origin/HEAD')); // symbolic-ref
    mockExeca.mockResolvedValueOnce(printed('abc123')); // rev-parse main
    expect(await getDefaultBranch('/repo')).toBe('main');
  });

  it('falls back to master when main does not exist', async () => {
    mockExeca.mockRejectedValueOnce(new Error('no origin/HEAD')); // symbolic-ref
    mockExeca.mockRejectedValueOnce(new Error('no main')); // rev-parse main
    mockExeca.mockResolvedValueOnce(printed('origin/master')); // branch -r for main
    // "main" not in remote refs → try master
    mockExeca.mockResolvedValueOnce(printed('abc123')); // rev-parse master
    expect(await getDefaultBranch('/repo')).toBe('master');
  });

  it('returns main when nothing can be detected', async () => {
    mockExeca.mockRejectedValue(new Error('fail'));
    expect(await getDefaultBranch('/repo')).toBe('main');
  });
});

describe('listBranches()', () => {
  beforeEach(() => {
    // Default: fetch succeeds, remotes returns "origin", branch -a returns some branches
    mockExeca
      .mockResolvedValueOnce(printed('')) // fetch --prune (via git())
      .mockResolvedValueOnce(printed('origin')) // remote (via git())
      .mockResolvedValueOnce(printed('main\nfeat/foo\norigin/main\norigin/feat/bar\norigin/HEAD')); // branch -a (via git())
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

  it('caps the fetch so a dead network cannot hang it', async () => {
    await listBranches('/repo');
    expect(mockExeca).toHaveBeenCalledWith('git', ['fetch', '--prune'], { cwd: '/repo', timeout: 30_000 });
  });

  it('skips the fetch when asked', async () => {
    mockExeca.mockReset();
    mockExeca
      .mockResolvedValueOnce(printed('origin')) // remote
      .mockResolvedValueOnce(printed('main\norigin/dev')); // branch -a
    const branches = await listBranches('/repo', { fetch: false });
    expect(branches).toEqual(['main', 'dev']);
    expect(mockExeca).not.toHaveBeenCalledWith('git', ['fetch', '--prune'], expect.anything());
  });

  it('handles fetch failure gracefully', async () => {
    mockExeca.mockReset();
    mockExeca
      .mockRejectedValueOnce(new Error('offline')) // fetch fails
      .mockResolvedValueOnce(printed('')) // remote
      .mockResolvedValueOnce(printed('main\ndev')); // branch -a
    const branches = await listBranches('/repo');
    expect(branches).toContain('main');
    expect(branches).toContain('dev');
  });
});

describe('mergeNoCommit()', () => {
  it('returns success when merge succeeds', async () => {
    mockExeca
      .mockResolvedValueOnce(printed('')) // merge
      .mockResolvedValueOnce(printed('')); // commit
    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result).toEqual({ success: true });
  });

  it('detects conflicts from porcelain status (UU lines)', async () => {
    // merge fails
    mockExeca.mockRejectedValueOnce(new Error('merge conflict'));
    // status --porcelain returns UU lines
    mockExeca.mockResolvedValueOnce(printed('UU src/file1.ts\0UU src/file2.ts\0M  src/clean.ts\0'));

    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result.success).toBe(false);
    expect(result.conflicts).toEqual(['src/file1.ts', 'src/file2.ts']);
  });

  it('reads the names whole, past a rename and its old name', async () => {
    mockExeca.mockRejectedValueOnce(new Error('merge conflict'));
    // -z: no quoting, and a rename's old name is a record of its own. This
    // one starts like a conflict, so reading it as a status would find one.
    mockExeca.mockResolvedValueOnce(printed('R  docs/new name.md\0UU old\0UU src/café.ts\0 R b.ts\0AA x\0'));

    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result.conflicts).toEqual(['src/café.ts']);
    expect(mockExeca.mock.calls[1][1]).toEqual(['status', '--porcelain', '-z']);
  });

  it('detects conflicts from AA/DD/DU/UD/AU/UA patterns', async () => {
    mockExeca.mockRejectedValueOnce(new Error('merge conflict'));
    mockExeca.mockResolvedValueOnce(printed('AA src/both-added.ts\0DD src/both-deleted.ts\0'));

    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result.success).toBe(false);
    expect(result.conflicts).toContain('src/both-added.ts');
    expect(result.conflicts).toContain('src/both-deleted.ts');
  });

  it('falls back to diff --name-only when no UU lines', async () => {
    mockExeca.mockRejectedValueOnce(new Error('merge conflict'));
    // status shows no conflict markers
    mockExeca.mockResolvedValueOnce(printed('M  src/clean.ts\0'));
    // diff --name-only returns conflicts
    mockExeca.mockResolvedValueOnce(printed('src/conflicted.ts\0src/café.ts\0'));

    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result.success).toBe(false);
    expect(result.conflicts).toEqual(['src/conflicted.ts', 'src/café.ts']);
    expect(mockExeca.mock.calls[2][1]).toEqual(['diff', '--name-only', '--diff-filter=U', '-z']);
  });

  it('falls back to parsing error message when all else fails', async () => {
    const mergeErr = new Error('something');
    (mergeErr as any).stderr = 'CONFLICT (content): Merge conflict in src/index.ts';
    mockExeca.mockRejectedValueOnce(mergeErr);
    // status shows nothing useful
    mockExeca.mockResolvedValueOnce(printed(''));
    // diff also empty
    mockExeca.mockResolvedValueOnce(printed(''));

    const result = await mergeNoCommit('/repo', 'feat/x');
    expect(result.success).toBe(false);
    expect(result.conflicts).toContain('src/index.ts');
  });

  it('returns error message snippet when no conflicts detected', async () => {
    const mergeErr = new Error('some unknown error');
    (mergeErr as any).stderr = 'fatal: some unknown error';
    mockExeca.mockRejectedValueOnce(mergeErr);
    mockExeca.mockResolvedValueOnce(printed('')); // status
    mockExeca.mockResolvedValueOnce(printed('')); // diff

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
    mockExeca.mockResolvedValue(printed(''));
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
    mockExeca.mockResolvedValue(printed('  origin/feat/x'));
    expect(await branchHasRemote('/repo', 'feat/x')).toBe(true);
  });

  it('returns false when no remote tracking branch', async () => {
    mockExeca.mockResolvedValue(printed(''));
    expect(await branchHasRemote('/repo', 'feat/x')).toBe(false);
  });

  it('returns false on error', async () => {
    mockExeca.mockRejectedValue(new Error('fail'));
    expect(await branchHasRemote('/repo', 'feat/x')).toBe(false);
  });
});

describe('validateBranchName()', () => {
  it('returns true for valid names', async () => {
    mockExeca.mockResolvedValue(printed(''));
    expect(await validateBranchName('feat/valid-name')).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('git', ['check-ref-format', '--branch', 'feat/valid-name']);
  });

  it('returns false for invalid names', async () => {
    mockExeca.mockRejectedValue(new Error('invalid'));
    expect(await validateBranchName('..bad')).toBe(false);
    expect(mockExeca).toHaveBeenCalledWith('git', ['check-ref-format', '--branch', '..bad']);
  });
});

describe('renameBranch()', () => {
  it('calls git branch -m', async () => {
    mockExeca.mockResolvedValue(printed(''));
    await renameBranch('/repo', 'old', 'new');
    expect(mockExeca).toHaveBeenCalledWith('git', ['branch', '-m', 'old', 'new'], { cwd: '/repo' });
  });
});

describe('stageFile()', () => {
  it('calls git add for the given path', async () => {
    mockExeca.mockResolvedValue(printed(''));
    await stageFile('/repo', 'src/a.ts');
    expect(mockExeca).toHaveBeenCalledWith('git', ['add', '--', ':(literal)src/a.ts'], { cwd: '/repo' });
  });
});

describe('unstageFile()', () => {
  it('calls git reset HEAD for the given path', async () => {
    mockExeca.mockResolvedValue(printed(''));
    await unstageFile('/repo', 'src/a.ts');
    expect(mockExeca).toHaveBeenCalledWith('git', ['reset', '-q', 'HEAD', '--', ':(literal)src/a.ts'], { cwd: '/repo' });
  });
});

describe('commit()', () => {
  it('calls git commit with the message', async () => {
    mockExeca.mockResolvedValue(printed(''));
    await commit('/repo', 'my message');
    expect(mockExeca).toHaveBeenCalledWith('git', ['commit', '-m', 'my message'], { cwd: '/repo' });
  });

  it('rejects an empty or whitespace-only message without calling git', async () => {
    await expect(commit('/repo', '   ')).rejects.toThrow();
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('isTracked()', () => {
  it('asks git whether the path is in the index', async () => {
    mockExeca.mockResolvedValue(printed('src/a.ts'));
    expect(await isTracked('/repo', 'src/a.ts')).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('git', ['ls-files', '--error-unmatch', '--', 'src/a.ts'], { cwd: '/repo' });

    mockExeca.mockRejectedValue(new Error("error: pathspec 'new.ts' did not match any file(s) known to git"));
    expect(await isTracked('/repo', 'new.ts')).toBe(false);
  });
});

describe('fileDiff()', () => {
  it('diffs the working tree against the index for unstaged changes', async () => {
    mockExeca.mockResolvedValue(printed('unstaged patch'));
    const out = await fileDiff('/repo', 'src/a.ts', { staged: false });
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff', '--', 'src/a.ts'], { cwd: '/repo', maxBuffer: MAX_TEXT_FILE_BYTES + 1 });
    expect(out).toBe('unstaged patch');
  });

  it('diffs the index against HEAD for staged changes (--cached)', async () => {
    mockExeca.mockResolvedValue(printed('staged patch'));
    const out = await fileDiff('/repo', 'src/a.ts', { staged: true });
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff', '--cached', '--', 'src/a.ts'], { cwd: '/repo', maxBuffer: MAX_TEXT_FILE_BYTES + 1 });
    expect(out).toBe('staged patch');
  });

  it('defaults to the unstaged (working-tree) diff', async () => {
    mockExeca.mockResolvedValue(printed(''));
    await fileDiff('/repo', 'src/a.ts');
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff', '--', 'src/a.ts'], { cwd: '/repo', maxBuffer: MAX_TEXT_FILE_BYTES + 1 });
  });

  it('stops git at a limit the caller gives', async () => {
    mockExeca.mockResolvedValue(printed('patch'));
    await gitPatch(['diff'], '/repo', 1000);
    expect(mockExeca).toHaveBeenCalledWith('git', ['diff'], { cwd: '/repo', maxBuffer: 1001 });
  });

  it('gives null for a patch git was stopped writing, and passes other failures on', async () => {
    mockExeca.mockRejectedValueOnce(Object.assign(new Error("Command's stdout was larger than 4194304 characters"), { isMaxBuffer: true }));
    expect(await fileDiff('/repo', 'src/a.ts')).toBeNull();
    mockExeca.mockRejectedValueOnce(new Error('fatal: bad revision'));
    await expect(fileDiff('/repo', 'src/a.ts')).rejects.toThrow('bad revision');
  });
});

describe('blobLines()', () => {
  const bytes = (text: string) => printed(Buffer.from(text));

  it("reads a file's raw bytes, stopping git past the size limit", async () => {
    mockExeca.mockResolvedValueOnce(bytes('one\ntwo\n'));
    expect(await blobLines('/repo', '', 'a.ts')).toEqual(['one', 'two']);
    expect(mockExeca).toHaveBeenCalledWith('git', ['cat-file', 'blob', ':a.ts'], { cwd: '/repo', encoding: 'buffer', stripFinalNewline: false, maxBuffer: MAX_TEXT_FILE_BYTES });
  });

  it('gives null for a file over the limit, and passes other failures on', async () => {
    mockExeca.mockRejectedValueOnce(Object.assign(new Error("Command's stdout was larger than 4194304 bytes"), { isMaxBuffer: true }));
    expect(await blobLines('/repo', 'tree', 'big.json')).toBeNull();
    mockExeca.mockRejectedValueOnce(new Error("fatal: path 'gone.ts' does not exist in 'tree'"));
    await expect(blobLines('/repo', 'tree', 'gone.ts')).rejects.toThrow('does not exist');
  });

  it('gives null for a binary file', async () => {
    mockExeca.mockResolvedValueOnce(printed(Buffer.from([0x50, 0x00, 0x01])));
    expect(await blobLines('/repo', '', 'logo.png')).toBeNull();
  });

  it('splits lines as the working-tree copy is split', async () => {
    mockExeca.mockResolvedValueOnce(bytes('\n'));
    expect(await blobLines('/repo', '', 'blank.txt')).toEqual(['']);
    mockExeca.mockResolvedValueOnce(bytes(''));
    expect(await blobLines('/repo', '', 'empty.txt')).toEqual([]);
    mockExeca.mockResolvedValueOnce(bytes('a\r\nb\r\n'));
    expect(await blobLines('/repo', '', 'crlf.txt')).toEqual(['a\r', 'b\r']);
  });

  it('names the file with forward slashes, as <rev>:<path> needs', async () => {
    mockExeca.mockResolvedValueOnce(bytes('x\n'));
    await blobLines('/repo', 'tree', 'src\\lib\\a.ts');
    expect(mockExeca).toHaveBeenCalledWith('git', ['cat-file', 'blob', 'tree:src/lib/a.ts'], expect.anything());
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

  it('does not count the final newline as another line', () => {
    expect(synthesizeUntrackedDiff('new.ts', 'hi\n')).toBe('--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,1 @@\n+hi');
    expect(synthesizeUntrackedDiff('two.ts', 'a\nb\n')).toBe('--- /dev/null\n+++ b/two.ts\n@@ -0,0 +1,2 @@\n+a\n+b');
    // A file holding one empty line still shows that line; an empty file shows none
    expect(synthesizeUntrackedDiff('blank.txt', '\n')).toBe('--- /dev/null\n+++ b/blank.txt\n@@ -0,0 +1,1 @@\n+');
    expect(synthesizeUntrackedDiff('empty.txt', '')).toBe('');
  });
});

describe('push()', () => {
  it('pushes with --set-upstream to origin', async () => {
    mockExeca.mockResolvedValue(printed(''));
    await push('/repo', 'feat/x');
    expect(mockExeca).toHaveBeenCalledWith('git', ['push', '--set-upstream', 'origin', 'feat/x'], { cwd: '/repo' });
  });

  it('surfaces stderr on failure', async () => {
    mockExeca.mockRejectedValue(Object.assign(new Error('Command failed: git push ...'), {
      stderr: 'remote: Permission denied',
    }));
    await expect(push('/repo', 'feat/x')).rejects.toThrow('remote: Permission denied');
  });
});

describe('syncStatus()', () => {
  it('reports no upstream when @{u} does not resolve', async () => {
    mockExeca.mockRejectedValue(new Error('no upstream configured'));
    expect(await syncStatus('/repo')).toEqual({ upstream: null, ahead: 0, behind: 0 });
  });

  it('parses ahead/behind counts against the upstream', async () => {
    mockExeca
      .mockResolvedValueOnce(printed('origin/feat/x\n'))
      .mockResolvedValueOnce(printed('1\t3\n'));
    expect(await syncStatus('/repo')).toEqual({ upstream: 'origin/feat/x', ahead: 3, behind: 1 });
    expect(mockExeca).toHaveBeenNthCalledWith(2, 'git', ['rev-list', '--left-right', '--count', '@{u}...HEAD'], { cwd: '/repo' });
  });

  it('falls back to zero counts when rev-list fails', async () => {
    mockExeca
      .mockResolvedValueOnce(printed('origin/feat/x'))
      .mockRejectedValueOnce(new Error('bad revision'));
    expect(await syncStatus('/repo')).toEqual({ upstream: 'origin/feat/x', ahead: 0, behind: 0 });
  });
});

describe('parseBranchCommits()', () => {
  it('splits records on \\x1e and fields on \\x1f', () => {
    const raw = 'feat: add login\x1fLonger body\nsecond line\x1e\nfix: typo\x1f\x1e\n';
    expect(parseBranchCommits(raw)).toEqual([
      { subject: 'feat: add login', body: 'Longer body\nsecond line' },
      { subject: 'fix: typo', body: '' },
    ]);
  });

  it('returns empty for empty output', () => {
    expect(parseBranchCommits('')).toEqual([]);
  });
});

describe('branchCommits()', () => {
  it('logs commits between the base branch and HEAD', async () => {
    mockExeca.mockResolvedValue(printed('subject\x1fbody\x1e'));
    const result = await branchCommits('/repo', 'main');
    expect(mockExeca).toHaveBeenCalledWith('git', ['log', '--format=%s%x1f%b%x1e', 'main..HEAD'], { cwd: '/repo' });
    expect(result).toEqual([{ subject: 'subject', body: 'body' }]);
  });

  it('falls back to origin/<base> when the local base ref is missing', async () => {
    scriptGit({
      'merge-base main HEAD': new Error('unknown revision'),
      'merge-base origin/main HEAD': 'mb',
      'log': 'subject\x1f\x1e',
    });
    const result = await branchCommits('/repo', 'main');
    expect(mockExeca).toHaveBeenCalledWith('git', ['log', '--format=%s%x1f%b%x1e', 'origin/main..HEAD'], { cwd: '/repo' });
    expect(result).toEqual([{ subject: 'subject', body: '' }]);
  });

  it('uses origin/<base> when the local base is behind it', async () => {
    scriptGit({
      'merge-base main HEAD': 'old',
      'merge-base origin/main HEAD': 'new',
      'merge-base --is-ancestor old new': '',
      'log': '',
    });
    await branchCommits('/repo', 'main');
    expect(mockExeca).toHaveBeenCalledWith('git', ['log', '--format=%s%x1f%b%x1e', 'origin/main..HEAD'], { cwd: '/repo' });
  });

  it('returns empty when neither ref resolves', async () => {
    mockExeca.mockRejectedValue(new Error('unknown revision'));
    expect(await branchCommits('/repo', 'main')).toEqual([]);
  });

  it('never passes a base that git would read as an option', async () => {
    // `git log --output=<file>..HEAD` would write a file.
    expect(await branchCommits('/repo', '--output=/tmp/x')).toEqual([]);
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('resolveMergeBase()', () => {
  it('keeps the local base when origin/<base> is behind or has diverged', async () => {
    scriptGit({
      'merge-base main HEAD': 'local',
      'merge-base origin/main HEAD': 'remote',
      'merge-base --is-ancestor local remote': new Error('not an ancestor'),
    });
    expect(await resolveMergeBase('/repo', 'main')).toEqual({ ref: 'main', mergeBase: 'local' });
  });

  it('never passes a base that git would read as an option', async () => {
    expect(await resolveMergeBase('/repo', '--independent')).toBeNull();
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe('isRefArg()', () => {
  it('accepts branch-like names and rejects options and non-strings', () => {
    expect(isRefArg('main')).toBe(true);
    expect(isRefArg('feat/a-b')).toBe(true);
    expect(isRefArg('-x')).toBe(false);
    expect(isRefArg('')).toBe(false);
    expect(isRefArg(undefined)).toBe(false);
  });
});

describe('listProjectFiles()', () => {
  it('lists tracked and untracked, unignored files, unquoted', async () => {
    mockExeca.mockResolvedValue(printed('café.ts\0src/a b.ts\0'));
    expect(await listProjectFiles('/repo')).toEqual(['café.ts', 'src/a b.ts']);
    expect(mockExeca).toHaveBeenCalledWith('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: '/repo' });
  });

  it('lists a conflicted file once', async () => {
    mockExeca.mockResolvedValue(printed('a.ts\0a.ts\0a.ts\0b.ts\0'));
    expect(await listProjectFiles('/repo')).toEqual(['a.ts', 'b.ts']);
  });
});

describe('revertFile()', () => {
  /** What `git status --porcelain=v1 -z` says now. */
  const status = (...records: string[]) => mockExeca.mockResolvedValueOnce(printed(records.map((r) => `${r}\0`).join('')));
  const ok = () => mockExeca.mockResolvedValue(printed(''));
  const gitCalls = () => mockExeca.mock.calls.map((c) => c[1]);

  it('reads the whole tree, where a rename shows as one', async () => {
    status('M  a.ts');
    ok();
    await revertFile('/repo', 'a.ts', true);
    expect(gitCalls()[0]).toEqual(['status', '--porcelain=v1', '-z']);
  });

  it('deletes a file staged as new, which isn\'t in HEAD', async () => {
    status('A  new.ts');
    ok();
    await revertFile('/repo', 'new.ts', true);
    expect(gitCalls().at(-1)).toEqual(['rm', '-f', '-q', '--', ':(literal)new.ts']);
  });

  it("deletes a staged copy, leaving its source alone", async () => {
    status('C  copy.ts', 'orig.ts');
    ok();
    await revertFile('/repo', 'copy.ts', true);
    expect(gitCalls().slice(1)).toEqual([['rm', '-f', '-q', '--', ':(literal)copy.ts']]);
  });

  it('deletes a file added with git add -N, whose content git never had', async () => {
    status(' A new.ts');
    ok();
    await revertFile('/repo', 'new.ts', false);
    expect(gitCalls().slice(1)).toEqual([['rm', '-f', '-q', '--', ':(literal)new.ts']]);
  });

  it('deletes a file put back with git add -N after git rm --cached (DA)', async () => {
    status('DA f.ts');
    ok();
    await revertFile('/repo', 'f.ts', false);
    expect(gitCalls().slice(1)).toEqual([['rm', '-f', '-q', '--', ':(literal)f.ts']]);
  });

  it('refuses a file with a merge conflict, on either side', async () => {
    for (const staged of [true, false]) {
      mockExeca.mockReset();
      status('AA both.ts');
      await expect(revertFile('/repo', 'both.ts', staged)).rejects.toThrow('both.ts has a merge conflict');
      expect(gitCalls()).toHaveLength(1);
    }
  });

  it('resets a staged change to HEAD', async () => {
    status('M  a.ts');
    ok();
    await revertFile('/repo', 'a.ts', true);
    expect(gitCalls().at(-1)).toEqual(['checkout', 'HEAD', '--', ':(literal)a.ts']);
  });

  it('resets an unstaged change to the index, keeping a staged new file', async () => {
    status('AM new.ts');
    ok();
    await revertFile('/repo', 'new.ts', false);
    expect(gitCalls().at(-1)).toEqual(['checkout', '--', ':(literal)new.ts']);
  });

  it('undoes a staged rename: the old path back from HEAD, then the new one deleted', async () => {
    status('R  b.ts', 'a.ts');
    ok();
    await revertFile('/repo', 'b.ts', true, 'a.ts');
    expect(gitCalls().slice(1)).toEqual([['checkout', 'HEAD', '--', ':(literal)a.ts'], ['rm', '-f', '-q', '--', ':(literal)b.ts']]);
  });

  it('undoes a rename in the worktree from the index', async () => {
    status(' R b.ts', 'a.ts');
    ok();
    await revertFile('/repo', 'b.ts', false, 'a.ts');
    expect(gitCalls().slice(1)).toEqual([['checkout', '--', ':(literal)a.ts'], ['rm', '-f', '-q', '--', ':(literal)b.ts']]);
  });

  it("deletes nothing when the old path can't come back", async () => {
    status('R  b.ts', 'a.ts');
    mockExeca.mockRejectedValueOnce(new Error("pathspec 'a.ts' did not match"));
    await expect(revertFile('/repo', 'b.ts', true, 'a.ts')).rejects.toThrow();
    expect(gitCalls()).toHaveLength(2);
  });

  it('does nothing when git no longer shows the rename it was told of', async () => {
    // The rename was unstaged while the dialog was open.
    status(' D a.ts', '?? b.ts');
    await expect(revertFile('/repo', 'b.ts', true, 'a.ts')).rejects.toThrow('b.ts has changed since the list was read');
    expect(gitCalls()).toHaveLength(1);
  });

  it("does nothing to a rename it wasn't told of", async () => {
    status('R  b.ts', 'a.ts');
    await expect(revertFile('/repo', 'b.ts', true)).rejects.toThrow('has changed since the list was read');
    expect(gitCalls()).toHaveLength(1);
  });

  it('does nothing while something is at the old path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-revert-'));
    fs.writeFileSync(path.join(dir, 'a.ts'), 'a new file');
    status('R  b.ts', 'a.ts');
    await expect(revertFile(dir, 'b.ts', true, 'a.ts')).rejects.toThrow("Can't undo the rename while something is at a.ts");
    expect(gitCalls()).toHaveLength(1);
  });

  it('says so for a rename of letter case only, where the old name finds the file itself', async () => {
    // As on Windows: the old name, Foo.ts, opens foo.ts.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-revert-'));
    fs.writeFileSync(path.join(dir, 'Foo.ts'), 'x');
    status('R  foo.ts', 'Foo.ts');
    await expect(revertFile(dir, 'foo.ts', true, 'Foo.ts')).rejects.toThrow('only changes letter case');
    expect(gitCalls()).toHaveLength(1);
  });

  it('deletes an untracked file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-revert-'));
    fs.writeFileSync(path.join(dir, 'scratch.ts'), 'x');
    status('?? scratch.ts');
    await revertFile(dir, 'scratch.ts', false);
    expect(fs.existsSync(path.join(dir, 'scratch.ts'))).toBe(false);
    expect(mockExeca).toHaveBeenCalledTimes(1);
  });
});

describe('branch operations', () => {
  const clean = () => mockExeca.mockResolvedValueOnce(printed('')); // status --porcelain

  describe('rebaseOnto()', () => {
    it('refuses on a dirty tree without running rebase', async () => {
      mockExeca.mockResolvedValueOnce(printed(' M src/a.ts'));
      const r = await rebaseOnto('/repo', 'main');
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/uncommitted/);
      expect(mockExeca).toHaveBeenCalledTimes(1);
    });

    it('rebases a clean tree', async () => {
      clean();
      mockExeca.mockResolvedValueOnce(printed('Successfully rebased'));
      const r = await rebaseOnto('/repo', 'main');
      expect(r).toEqual({ success: true });
      expect(mockExeca).toHaveBeenCalledWith('git', ['rebase', 'main'], { cwd: '/repo' });
    });

    it('aborts and reports conflicting files', async () => {
      clean();
      mockExeca.mockRejectedValueOnce(Object.assign(new Error('rebase failed'), { stderr: 'CONFLICT (content): Merge conflict in src/a.ts' }));
      mockExeca.mockResolvedValueOnce(printed('UU src/a.ts\0UU src/b.ts\0')); // status
      mockExeca.mockResolvedValueOnce(printed('')); // rebase --abort
      const r = await rebaseOnto('/repo', 'main');
      expect(r).toEqual({ success: false, conflicts: ['src/a.ts', 'src/b.ts'] });
      expect(mockExeca).toHaveBeenCalledWith('git', ['rebase', '--abort'], { cwd: '/repo' });
    });

    it('reports a non-conflict failure as an error and still unwinds', async () => {
      clean();
      mockExeca.mockRejectedValueOnce(Object.assign(new Error('x'), { stderr: 'fatal: invalid upstream nope' }));
      mockExeca.mockRejectedValueOnce(new Error('no rebase in progress')); // abort
      const r = await rebaseOnto('/repo', 'nope');
      expect(r.success).toBe(false);
      expect(r.error).toBe('fatal: invalid upstream nope');
      expect(r.conflicts).toBeUndefined();
    });
  });

  describe('cherryPick()', () => {
    it('rejects a malformed commit id before touching git', async () => {
      const r = await cherryPick('/repo', '--not-a-sha');
      expect(r.success).toBe(false);
      expect(mockExeca).not.toHaveBeenCalled();
    });

    it('applies a commit on a clean tree', async () => {
      clean();
      mockExeca.mockResolvedValueOnce(printed(''));
      const r = await cherryPick('/repo', 'abc1234');
      expect(r).toEqual({ success: true });
      expect(mockExeca).toHaveBeenCalledWith('git', ['cherry-pick', 'abc1234'], { cwd: '/repo' });
    });

    it('aborts on conflict', async () => {
      clean();
      mockExeca.mockRejectedValueOnce(Object.assign(new Error('x'), { stderr: 'error: could not apply abc1234... subject\nCONFLICT (content): Merge conflict in src/c.ts' }));
      mockExeca.mockResolvedValueOnce(printed('UU src/c.ts\0'));
      mockExeca.mockResolvedValueOnce(printed('')); // abort
      const r = await cherryPick('/repo', 'abc1234');
      expect(r).toEqual({ success: false, conflicts: ['src/c.ts'] });
      expect(mockExeca).toHaveBeenCalledWith('git', ['cherry-pick', '--abort'], { cwd: '/repo' });
    });
  });

  describe('squashSince()', () => {
    it('requires a message', async () => {
      const r = await squashSince('/repo', 'main', '   ');
      expect(r.success).toBe(false);
      expect(mockExeca).not.toHaveBeenCalled();
    });

    it('soft-resets to the merge base and commits', async () => {
      scriptGit({
        'merge-base main HEAD': 'base123\n',
        'merge-base origin/main HEAD': new Error('no remote'),
        'rev-list --count': '3\n',
      });
      const r = await squashSince('/repo', 'main', 'One commit');
      expect(r).toEqual({ success: true });
      expect(mockExeca).toHaveBeenCalledWith('git', ['merge-base', 'main', 'HEAD'], { cwd: '/repo' });
      expect(mockExeca).toHaveBeenCalledWith('git', ['reset', '--soft', 'base123'], { cwd: '/repo' });
      expect(mockExeca).toHaveBeenCalledWith('git', ['commit', '-m', 'One commit'], { cwd: '/repo' });
    });

    it('refuses with fewer than two commits', async () => {
      scriptGit({ 'merge-base main HEAD': 'base123', 'merge-base origin/main HEAD': new Error('no remote'), 'rev-list --count': '1' });
      const r = await squashSince('/repo', 'main', 'msg');
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/Only one commit/);
      expect(mockExeca).not.toHaveBeenCalledWith('git', expect.arrayContaining(['reset']), expect.anything());
    });

    it('squashes only since origin/<base> when the local base is behind it', async () => {
      scriptGit({
        'merge-base main HEAD': 'stale',
        'merge-base origin/main HEAD': 'fresh',
        'merge-base --is-ancestor stale fresh': '',
        'rev-list --count fresh..HEAD': '2',
      });
      expect(await squashSince('/repo', 'main', 'msg')).toEqual({ success: true });
      expect(mockExeca).toHaveBeenCalledWith('git', ['reset', '--soft', 'fresh'], { cwd: '/repo' });
    });

    it('reports a missing merge base', async () => {
      scriptGit({ 'merge-base': Object.assign(new Error('x'), { stderr: 'fatal: Not a valid object name nope' }) });
      const r = await squashSince('/repo', 'nope', 'msg');
      expect(r.success).toBe(false);
      expect(r.error).toContain('merge base');
    });
  });

  describe('logCommits() / parseLogCommits()', () => {
    it('parses sha, short sha and subject records', () => {
      const raw = 'aaaa\x1fa1\x1fFirst\x1e\nbbbb\x1fb1\x1fSecond\x1e\n';
      expect(parseLogCommits(raw)).toEqual([
        { sha: 'aaaa', shortSha: 'a1', subject: 'First' },
        { sha: 'bbbb', shortSha: 'b1', subject: 'Second' },
      ]);
      expect(parseLogCommits('')).toEqual([]);
    });

    it('falls back to origin/<base> when the local base is missing', async () => {
      mockExeca.mockRejectedValueOnce(new Error('unknown revision'));
      mockExeca.mockResolvedValueOnce(printed('cccc\x1fc1\x1fThird\x1e'));
      const r = await logCommits('/repo', 'feat/x', 'main');
      expect(r).toEqual([{ sha: 'cccc', shortSha: 'c1', subject: 'Third' }]);
      expect(mockExeca).toHaveBeenLastCalledWith('git', ['log', '--format=%H%x1f%h%x1f%s%x1e', 'origin/main..feat/x'], { cwd: '/repo' });
    });
  });
});

describe('currentBranch()', () => {
  it('returns the checked-out branch name', async () => {
    mockExeca.mockResolvedValue(printed('feat/x\n'));
    expect(await currentBranch('/wt')).toBe('feat/x');
    expect(mockExeca).toHaveBeenCalledWith('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: '/wt' });
  });

  it('returns null when HEAD is detached or git fails', async () => {
    mockExeca.mockResolvedValue(printed('HEAD\n'));
    expect(await currentBranch('/wt')).toBeNull();
    mockExeca.mockRejectedValue(new Error('not a git repo'));
    expect(await currentBranch('/wt')).toBeNull();
  });
});

describe('parseCheckoutBranches()', () => {
  const raw = [
    'HEAD@{1700000400}\tcommit: tweak',
    'HEAD@{1700000300}\tcheckout: moving from feat/x to feat/x-part-2',
    'HEAD@{1700000200}\tcheckout: moving from 0123456789abcdef0123456789abcdef01234567 to feat/x',
    'HEAD@{1700000100}\tcheckout: moving from main to 0123456789abcdef0123456789abcdef01234567',
    'HEAD@{1699999000}\tcheckout: moving from old/branch to main',
  ].join('\n');

  it('collects distinct branches from checkouts within the window, most recent first', () => {
    expect(parseCheckoutBranches(raw, 1700000000 * 1000)).toEqual(['feat/x-part-2', 'feat/x', 'main']);
  });

  it('skips detached-HEAD SHAs and entries older than the window', () => {
    const names = parseCheckoutBranches(raw, 1700000000 * 1000);
    expect(names).not.toContain('old/branch');
    expect(names.some((n) => /^[0-9a-f]{40}$/.test(n))).toBe(false);
  });

  it('includes everything when the window starts before the reflog', () => {
    expect(parseCheckoutBranches(raw, 0)).toEqual(['feat/x-part-2', 'feat/x', 'main', 'old/branch']);
  });

  it('returns an empty list for an empty reflog', () => {
    expect(parseCheckoutBranches('', 0)).toEqual([]);
  });
});

describe('recentCheckouts()', () => {
  it('reads the HEAD reflog with unix dates and parses it', async () => {
    mockExeca.mockResolvedValue(printed('HEAD@{1700000300}\tcheckout: moving from feat/x to feat/y\n'));
    expect(await recentCheckouts('/wt', 1700000000 * 1000)).toEqual(['feat/y', 'feat/x']);
    expect(mockExeca).toHaveBeenCalledWith('git', ['reflog', 'show', '--date=unix', '--format=%gd%x09%gs', 'HEAD'], { cwd: '/wt' });
  });

  it('returns an empty list when git fails', async () => {
    mockExeca.mockRejectedValue(new Error('boom'));
    expect(await recentCheckouts('/wt', 0)).toEqual([]);
  });
});

describe('localBranchExists()', () => {
  it('checks refs/heads only, so a tag or SHA with the name does not count', async () => {
    mockExeca.mockResolvedValue(printed(''));
    expect(await localBranchExists('/wt', 'feat/x')).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('git', ['show-ref', '--verify', '--quiet', 'refs/heads/feat/x'], { cwd: '/wt' });
  });

  it('returns false when the ref is missing', async () => {
    mockExeca.mockRejectedValue(new Error('not a valid ref'));
    expect(await localBranchExists('/wt', 'nope')).toBe(false);
  });
});

describe('getGitIdentity()', () => {
  /** `git config <key>` prints the value from `values`, or exits 1 like git when unset. */
  function mockConfig(values: Record<string, string>) {
    mockExeca.mockImplementation(((_cmd: string, args: string[]) =>
      args[1] in values ? Promise.resolve({ stdout: `${values[args[1]]}\n` }) : Promise.reject(new Error('exit code 1'))
    ) as never);
  }

  it('returns the configured name and email', async () => {
    mockConfig({ 'user.name': 'Ada', 'user.email': 'ada@example.com' });
    expect(await getGitIdentity('/wt')).toEqual({ name: 'Ada', email: 'ada@example.com' });
    expect(mockExeca).toHaveBeenCalledWith('git', ['config', 'user.name'], { cwd: '/wt' });
    expect(mockExeca).toHaveBeenCalledWith('git', ['config', 'user.email'], { cwd: '/wt' });
  });

  it.each([
    ['nothing is set', {}],
    ['only the name is set', { 'user.name': 'Ada' }],
    ['only the email is set', { 'user.email': 'ada@example.com' }],
    ['the name is blank', { 'user.name': '  ', 'user.email': 'ada@example.com' }],
  ])('returns null instead of a made-up identity when %s', async (_label, values) => {
    mockConfig(values);
    expect(await getGitIdentity('/wt')).toBeNull();
  });
});

describe('remoteTrackingRef()', () => {
  /** `git remote` lists `remotes`; `show-ref` succeeds only for refs in `present`. */
  function mockRefs(remotes: string, present: string[]) {
    mockExeca.mockImplementation(((_cmd: string, args: string[]) => {
      if (args[0] === 'remote') return Promise.resolve({ stdout: remotes });
      return present.includes(args[3]) ? Promise.resolve({ stdout: '' }) : Promise.reject(new Error('not a valid ref'));
    }) as never);
  }

  it('prefers origin when several remotes have the branch', async () => {
    mockRefs('upstream\norigin', ['refs/remotes/upstream/feat/x', 'refs/remotes/origin/feat/x']);
    expect(await remoteTrackingRef('/wt', 'feat/x')).toBe('origin/feat/x');
  });

  it('falls back to another remote that has the branch', async () => {
    mockRefs('origin\nfork', ['refs/remotes/fork/feat/x']);
    expect(await remoteTrackingRef('/wt', 'feat/x')).toBe('fork/feat/x');
  });

  it('returns null when no remote has the branch', async () => {
    mockRefs('origin', []);
    expect(await remoteTrackingRef('/wt', 'feat/x')).toBeNull();
  });
});

describe('parseWorktreeBranches()', () => {
  it('maps each checked-out branch to its worktree path and skips detached ones', () => {
    const raw = [
      'worktree C:/Users/me/repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree C:/Users/me/AppData/grove/abc/wt-1',
      'HEAD 2222222222222222222222222222222222222222',
      'detached',
      '',
      'worktree C:/Users/me/AppData/grove/abc/wt-2',
      'HEAD 3333333333333333333333333333333333333333',
      'branch refs/heads/feat/x',
      '',
    ].join('\n');
    expect(parseWorktreeBranches(raw)).toEqual(new Map([
      ['main', 'C:/Users/me/repo'],
      ['feat/x', 'C:/Users/me/AppData/grove/abc/wt-2'],
    ]));
  });
});

describe('checkoutBranch()', () => {
  beforeEach(() => {
    mockExeca.mockResolvedValue(printed(''));
  });

  it('checks out an existing branch with -- so the name is never read as a path', async () => {
    await checkoutBranch('/wt', 'feat/x');
    expect(mockExeca).toHaveBeenCalledWith('git', ['checkout', 'feat/x', '--'], { cwd: '/wt' });
  });

  it('creates a local branch tracking a remote-only branch', async () => {
    await checkoutBranch('/wt', 'feat/x', { track: 'origin/feat/x' });
    expect(mockExeca).toHaveBeenCalledWith('git', ['checkout', '-b', 'feat/x', '--track', 'origin/feat/x'], { cwd: '/wt' });
  });

  it('creates a new branch at HEAD', async () => {
    await checkoutBranch('/wt', 'feat/new', { create: true });
    expect(mockExeca).toHaveBeenCalledWith('git', ['checkout', '-b', 'feat/new'], { cwd: '/wt' });
  });
});

describe('isWorkingTreeClean()', () => {
  it('counts untracked files by default', async () => {
    mockExeca.mockResolvedValue(printed('?? .claude/\n'));
    expect(await isWorkingTreeClean('/wt')).toBe(false);
    expect(mockExeca).toHaveBeenCalledWith('git', ['status', '--porcelain'], { cwd: '/wt' });
  });

  it('can leave untracked files out', async () => {
    mockExeca.mockResolvedValue(printed(''));
    expect(await isWorkingTreeClean('/wt', { ignoreUntracked: true })).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: '/wt' });
  });
});

describe('gitOperation()', () => {
  const dirs: string[] = [];
  const temp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-op-')); dirs.push(dir); return dir; };
  afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

  it('starts no git process when nothing is under way, as the status asks on every refresh', async () => {
    const dir = temp();
    fs.mkdirSync(path.join(dir, '.git'));
    mockExeca.mockClear();
    expect(await gitOperation(dir)).toBeNull();
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it("finds a linked worktree's state through its .git file", async () => {
    const dir = temp();
    const gitDir = path.join(dir, 'main', '.git', 'worktrees', 'wt');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'CHERRY_PICK_HEAD'), '1a2b3c4d5e6f\n');
    fs.mkdirSync(path.join(dir, 'wt'));
    fs.writeFileSync(path.join(dir, 'wt', '.git'), 'gitdir: ../main/.git/worktrees/wt\n');
    mockExeca.mockClear();
    expect(await gitOperation(path.join(dir, 'wt'))).toEqual({ kind: 'cherry-pick', commit: '1a2b3c4' });
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it("continues a rebase when git can't say whether files have unstaged changes, leaving the error to git", async () => {
    const dir = temp();
    fs.mkdirSync(path.join(dir, '.git', 'rebase-merge'), { recursive: true });
    mockExeca.mockImplementation(((_cmd: string, args: string[]) => Promise.resolve(
      args[0] === 'diff'
        ? { stdout: '', stderr: 'fatal: index file corrupt', exitCode: args[1] === '--cached' ? 1 : 128 }
        : { stdout: '', exitCode: 0 },
    )) as never);

    await continueGitOperation(dir, 'rebase');
    expect(mockExeca).toHaveBeenCalledWith('git', ['rebase', '--continue'], expect.anything());
  });

  it("says what git wrote to stdout and stderr when it stops, as newer git keeps only its hints on stderr", async () => {
    const dir = temp();
    fs.mkdirSync(path.join(dir, '.git', 'rebase-apply'), { recursive: true });
    const stopped = Object.assign(new Error('Command failed with exit code 1: git rebase --continue'), {
      stdout: "Applying: feat\nNo changes - did you forget to use 'git add'?",
      stderr: 'hint: You can instead skip this commit: run "git rebase --skip".',
    });
    mockExeca.mockImplementation(((_cmd: string, args: string[]) =>
      args[0] === 'rebase' ? Promise.reject(stopped) : Promise.resolve({ stdout: '', exitCode: 0 })) as never);

    await expect(continueGitOperation(dir, 'rebase')).rejects.toThrow(
      "Applying: feat\nNo changes - did you forget to use 'git add'?\nhint: You can instead skip this commit: run \"git rebase --skip\".",
    );
  });
});
