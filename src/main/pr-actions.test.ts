import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ gh: vi.fn() }));
vi.mock('./gh.js', async (importOriginal) => ({ ...(await importOriginal<object>()), gh: m.gh }));

import { deletePrBranch, isCommitSha, isMergeMethod, isPrNumber, parseActionOptions, prActionOptions, prMerge, prSetAutoMerge, prSetDraft, prSetOpen, prUpdateBranch } from './pr-actions.js';

const REPO = 'C:/repo';
const calls = () => m.gh.mock.calls.map((c: unknown[]) => c[0] as string[]);
const failWith = (stderr: string) => Object.assign(new Error('gh failed'), { stderr });

beforeEach(() => {
  m.gh.mockReset();
  m.gh.mockResolvedValue('');
});

describe('prActionOptions', () => {
  it("asks GitHub what the repository allows and what this account may do, in one query", async () => {
    m.gh.mockResolvedValueOnce(JSON.stringify({ data: { repository: {
      squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: false, autoMergeAllowed: true, deleteBranchOnMerge: false,
      pullRequest: { viewerCanMergeAsAdmin: true, viewerCanEnableAutoMerge: true, viewerCanDisableAutoMerge: false, viewerCanUpdateBranch: true, viewerCanDeleteHeadRef: true },
      pullRequests: { totalCount: 1 },
    } } }));

    expect(await prActionOptions(REPO, 42, 'feat/x')).toEqual({
      methods: ['squash', 'merge'], deleteBranchOnMerge: false, autoMergeAllowed: true,
      canMergeAsAdmin: true, canEnableAutoMerge: true, canDisableAutoMerge: false, canUpdateBranch: true, canDeleteBranch: true,
      stackedPrs: 1,
    });
    const [args, cwd] = m.gh.mock.calls[0] as [string[], string];
    expect(cwd).toBe(REPO);
    expect(args.slice(0, 2)).toEqual(['api', 'graphql']);
    expect(args).toContain('number=42');
    expect(args).toContain('head=feat/x');
    expect(args).toContain('owner={owner}');
    expect(args.find((a) => a.startsWith('query='))).toContain('viewerCanMergeAsAdmin');
  });

  it('offers nothing GitHub might refuse when the answer is missing or odd', () => {
    expect(parseActionOptions({ errors: [{ message: 'Could not resolve' }] })).toEqual({
      methods: [], deleteBranchOnMerge: false, autoMergeAllowed: false, canMergeAsAdmin: false,
      canEnableAutoMerge: false, canDisableAutoMerge: false, canUpdateBranch: false, canDeleteBranch: false, stackedPrs: 0,
    });
  });
});

describe('prMerge', () => {
  it('merges only the commit the user saw, without gh deleting the local branch', async () => {
    await prMerge(REPO, { number: 42, method: 'squash', headSha: 'abc1234' });
    expect(calls()).toEqual([['pr', 'merge', '42', '--squash', '--match-head-commit', 'abc1234']]);
  });

  it('bypasses the rules only when asked', async () => {
    await prMerge(REPO, { number: 42, method: 'merge', headSha: 'abc1234', admin: true });
    expect(calls()[0]).toEqual(['pr', 'merge', '42', '--merge', '--match-head-commit', 'abc1234', '--admin']);
  });

  it('then deletes the branch on GitHub, and keeps it when an open PR is based on it', async () => {
    m.gh.mockResolvedValueOnce('').mockResolvedValueOnce('[]');
    expect(await prMerge(REPO, { number: 42, method: 'squash', headSha: 'abc1234', deleteBranch: true }, 'feat/x y')).toEqual({ branchDeleted: true });
    expect(calls()[2]).toEqual(['api', '-X', 'DELETE', 'repos/{owner}/{repo}/git/refs/heads/feat/x%20y']);

    m.gh.mockReset();
    m.gh.mockResolvedValueOnce('').mockResolvedValueOnce('[{"number":43}]');
    expect(await prMerge(REPO, { number: 42, method: 'squash', headSha: 'abc1234', deleteBranch: true }, 'feat/x')).toEqual({ branchKept: 'Kept feat/x: another open PR is based on it.' });
    expect(calls()).toHaveLength(2);
  });

  it("reports a branch that couldn't go, but not as a failed merge", async () => {
    m.gh.mockResolvedValueOnce('').mockResolvedValueOnce('[]').mockRejectedValueOnce(failWith('gh: Forbidden (HTTP 403)'));
    const result = await prMerge(REPO, { number: 42, method: 'squash', headSha: 'abc1234', deleteBranch: true }, 'feat/x');
    expect(result.branchKept).toMatch(/^Merged, but the branch couldn't be deleted: Forbidden \(HTTP 403\)/);
  });

  it("fails with GitHub's reason when it refuses the merge", async () => {
    m.gh.mockRejectedValueOnce(failWith('GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)'));
    await expect(prMerge(REPO, { number: 42, method: 'squash', headSha: 'abc1234' })).rejects.toThrow(/Head branch was modified/);
  });
});

describe('deletePrBranch', () => {
  it('counts a branch already gone (the repository deleted it) as deleted', async () => {
    m.gh.mockResolvedValueOnce('[]').mockRejectedValueOnce(failWith('gh: Reference does not exist (HTTP 422)'));
    expect(await deletePrBranch(REPO, 'feat/x')).toEqual({ branchDeleted: true });
  });
});

describe('the other actions', () => {
  it('runs the gh command for each', async () => {
    await prSetAutoMerge(REPO, 42, true, 'rebase');
    await prSetAutoMerge(REPO, 42, false);
    await prSetDraft(REPO, 42, false);
    await prSetDraft(REPO, 42, true);
    await prSetOpen(REPO, 42, false);
    await prSetOpen(REPO, 42, true);
    await prUpdateBranch(REPO, 42, false);
    await prUpdateBranch(REPO, 42, true);
    expect(calls()).toEqual([
      ['pr', 'merge', '42', '--auto', '--rebase'],
      ['pr', 'merge', '42', '--disable-auto'],
      ['pr', 'ready', '42'],
      ['pr', 'ready', '42', '--undo'],
      ['pr', 'close', '42'],
      ['pr', 'reopen', '42'],
      ['pr', 'update-branch', '42'],
      ['pr', 'update-branch', '42', '--rebase'],
    ]);
  });
});

describe('input checks', () => {
  it('takes only what gh can be given', () => {
    expect([42, 0, -1, 1.5, '42'].map(isPrNumber)).toEqual([true, false, false, false, false]);
    expect(['squash', 'merge', 'rebase', 'fast-forward'].map(isMergeMethod)).toEqual([true, true, true, false]);
    expect(['abc1234', 'ABC1234DEF', 'abc', 'abc123z', '--admin'].map(isCommitSha)).toEqual([true, true, false, false, false]);
  });
});
