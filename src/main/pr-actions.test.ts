import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ gh: vi.fn() }));
vi.mock('./gh.js', async (importOriginal) => ({ ...(await importOriginal<object>()), gh: m.gh }));

import { deletePrBranch, isCommitSha, isMergeMethod, isPrNumber, parseActionOptions, prActionOptions, prMerge, prSetAutoMerge, prSetDraft, prSetOpen, prTarget, prUpdateBranch, type PrTarget } from './pr-actions.js';

const REPO = 'C:/repo';
const URL = 'https://github.com/acme/app/pull/42';
const T: PrTarget = { number: 42, repo: { host: 'github.com', owner: 'acme', name: 'app' } };
const MERGE = { number: 42, url: URL, method: 'squash' as const, headSha: 'abc1234' };
const calls = () => m.gh.mock.calls.map((c: unknown[]) => c[0] as string[]);
const failWith = (stderr: string) => Object.assign(new Error('gh failed'), { stderr });
const answer = (repository: unknown) => JSON.stringify({ data: { repository } });
const merged = answer({ pullRequest: { state: 'MERGED', isInMergeQueue: false, autoMergeRequest: null } });

/** The branch query's answer: a merged PR whose branch is still at the
 *  merged commit, with nothing else using it, unless `over` says so. */
function branchAnswer(over: { pr?: object; ref?: object | null; basedOn?: number } = {}) {
  return answer({
    pullRequest: { state: 'MERGED', isCrossRepository: false, headRefName: 'feat/x', headRefOid: 'a'.repeat(40), ...over.pr },
    ref: over.ref === null ? null : { target: { oid: 'a'.repeat(40) }, associatedPullRequests: { totalCount: 0 }, ...over.ref },
    pullRequests: { totalCount: over.basedOn ?? 0 },
  });
}

beforeEach(() => {
  m.gh.mockReset();
  m.gh.mockResolvedValue('');
});

describe('prTarget', () => {
  it("takes a PR's URL and number only when they agree", () => {
    expect(prTarget({ number: 42, url: URL })).toEqual(T);
    expect(prTarget({ number: 42, url: 'https://ghe.example.com/acme/app/pull/42' })?.repo.host).toBe('ghe.example.com');
    expect(prTarget({ number: 43, url: URL })).toBeNull();
    expect(prTarget({ number: 42, url: 'https://github.com/acme/app/issues/42' })).toBeNull();
    expect(prTarget({ number: '42', url: URL })).toBeNull();
    expect(prTarget(null)).toBeNull();
  });
});

describe('prActionOptions', () => {
  it("asks the PR's own host and repository what it allows and what this account may do, in one query", async () => {
    m.gh.mockResolvedValueOnce(answer({
      squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: false, autoMergeAllowed: true, deleteBranchOnMerge: false, viewerPermission: 'WRITE',
      pullRequest: { viewerCanMergeAsAdmin: true, viewerCanEnableAutoMerge: true, viewerCanDisableAutoMerge: false, viewerCanUpdateBranch: true, isCrossRepository: false, isMergeQueueEnabled: true },
      pullRequests: { totalCount: 1 },
    }));

    expect(await prActionOptions(REPO, T, 'feat/x')).toEqual({
      methods: ['squash', 'merge'], deleteBranchOnMerge: false, autoMergeAllowed: true, mergeQueue: true,
      canMergeAsAdmin: true, canEnableAutoMerge: true, canDisableAutoMerge: false, canUpdateBranch: true, canDeleteBranch: true,
      stackedPrs: 1,
    });
    const [args, cwd] = m.gh.mock.calls[0] as [string[], string];
    expect(cwd).toBe(REPO);
    expect(args.slice(0, 4)).toEqual(['api', 'graphql', '--hostname', 'github.com']);
    expect(args).toEqual(expect.arrayContaining(['owner=acme', 'repo=app', 'number=42', 'head=feat/x']));
    expect(args.find((a) => a.startsWith('query='))).toContain('viewerCanMergeAsAdmin');
  });

  it("offers to delete the branch only to an account that can push, and never a fork's", () => {
    const opts = (viewerPermission: string, isCrossRepository: boolean) =>
      parseActionOptions({ data: { repository: { viewerPermission, pullRequest: { isCrossRepository } } } }).canDeleteBranch;
    expect([opts('ADMIN', false), opts('MAINTAIN', false), opts('WRITE', false)]).toEqual([true, true, true]);
    expect([opts('TRIAGE', false), opts('READ', false), opts('WRITE', true)]).toEqual([false, false, false]);
  });

  it('offers nothing GitHub might refuse when the answer is missing or odd', () => {
    expect(parseActionOptions({ errors: [{ message: 'Could not resolve' }] })).toEqual({
      methods: [], deleteBranchOnMerge: false, autoMergeAllowed: false, mergeQueue: false, canMergeAsAdmin: false,
      canEnableAutoMerge: false, canDisableAutoMerge: false, canUpdateBranch: false, canDeleteBranch: false, stackedPrs: 0,
    });
  });
});

describe('prMerge', () => {
  it("merges only the commit the user saw, in the PR's repository, without gh deleting the local branch", async () => {
    m.gh.mockResolvedValueOnce('').mockResolvedValueOnce(merged);
    expect(await prMerge(REPO, T, MERGE)).toEqual({ merged: true });
    expect(calls()[0]).toEqual(['pr', 'merge', '42', '--repo', 'acme/app', '--squash', '--match-head-commit', 'abc1234']);
  });

  it('names the host for a PR off github.com', async () => {
    m.gh.mockResolvedValueOnce('').mockResolvedValueOnce(merged);
    await prMerge(REPO, { ...T, repo: { ...T.repo, host: 'ghe.example.com' } }, MERGE);
    expect(calls()[0]).toContain('ghe.example.com/acme/app');
    expect(calls()[1].slice(0, 4)).toEqual(['api', 'graphql', '--hostname', 'ghe.example.com']);
  });

  it('bypasses the rules only when asked', async () => {
    m.gh.mockResolvedValueOnce('').mockResolvedValueOnce(merged);
    await prMerge(REPO, T, { ...MERGE, method: 'merge', admin: true });
    expect(calls()[0]).toEqual(['pr', 'merge', '42', '--repo', 'acme/app', '--merge', '--match-head-commit', 'abc1234', '--admin']);
  });

  it("keeps the branch when the PR went to the merge queue, which closes a PR whose branch goes", async () => {
    m.gh.mockResolvedValueOnce('').mockResolvedValueOnce(answer({ pullRequest: { state: 'OPEN', isInMergeQueue: true, autoMergeRequest: null } }));
    expect(await prMerge(REPO, T, { ...MERGE, deleteBranch: true }, 'feat/x')).toEqual({ note: 'In the merge queue: GitHub merges it when its turn comes.' });
    expect(calls()).toHaveLength(2);
  });

  it("says so when GitHub turned on auto-merge instead, and when it can't tell", async () => {
    m.gh.mockResolvedValueOnce('').mockResolvedValueOnce(answer({ pullRequest: { state: 'OPEN', isInMergeQueue: false, autoMergeRequest: { enabledAt: 'x' } } }));
    expect((await prMerge(REPO, T, { ...MERGE, deleteBranch: true }, 'feat/x')).note).toMatch(/auto-merge/);

    m.gh.mockReset();
    m.gh.mockResolvedValueOnce('').mockRejectedValueOnce(failWith('timeout'));
    expect(await prMerge(REPO, T, { ...MERGE, deleteBranch: true }, 'feat/x')).toEqual({ note: expect.stringMatching(/didn't say/) });
  });

  it('then deletes the branch on GitHub', async () => {
    m.gh.mockResolvedValueOnce('').mockResolvedValueOnce(merged).mockResolvedValueOnce(branchAnswer());
    expect(await prMerge(REPO, T, { ...MERGE, deleteBranch: true }, 'feat/x')).toEqual({ merged: true, branchDeleted: true });
    expect(calls()[3]).toEqual(['api', '--hostname', 'github.com', '-X', 'DELETE', 'repos/acme/app/git/refs/heads/feat/x']);
  });

  it("reports a branch that couldn't go, but not as a failed merge", async () => {
    m.gh.mockResolvedValueOnce('').mockResolvedValueOnce(merged).mockResolvedValueOnce(branchAnswer()).mockRejectedValueOnce(failWith('gh: Forbidden (HTTP 403)'));
    const result = await prMerge(REPO, T, { ...MERGE, deleteBranch: true }, 'feat/x');
    expect(result.merged).toBe(true);
    expect(result.note).toMatch(/^Merged, but the branch couldn't be deleted: Forbidden \(HTTP 403\)/);
  });

  it("fails with GitHub's reason when it refuses the merge", async () => {
    m.gh.mockRejectedValueOnce(failWith('GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)'));
    await expect(prMerge(REPO, T, MERGE)).rejects.toThrow(/Head branch was modified/);
  });
});

describe('deletePrBranch', () => {
  it('encodes the branch name for the API, and asks about the exact ref', async () => {
    m.gh.mockResolvedValueOnce(branchAnswer({ pr: { headRefName: 'feat/x y' } }));
    expect(await deletePrBranch(REPO, T, 'feat/x y')).toEqual({ branchDeleted: true });
    expect(calls()[0]).toEqual(expect.arrayContaining(['ref=refs/heads/feat/x y', 'branch=feat/x y']));
    expect(calls()[1].at(-1)).toBe('repos/acme/app/git/refs/heads/feat/x%20y');
  });

  it.each([
    ['the PR is not merged', { pr: { state: 'OPEN' } }, "Kept feat/x: #42 isn't merged."],
    ['the branch is in a fork', { pr: { isCrossRepository: true } }, "Kept feat/x: it's in a fork, not this repository."],
    ['commits were pushed after the merge', { ref: { target: { oid: 'b'.repeat(40) } } }, "Kept feat/x: it has commits #42 didn't merge."],
    ['an open PR comes from it', { ref: { associatedPullRequests: { totalCount: 1 } } }, 'Kept feat/x: an open PR comes from it.'],
    ['an open PR is based on it', { basedOn: 1 }, 'Kept feat/x: another open PR is based on it.'],
  ])('keeps it when %s', async (_why, over, note) => {
    m.gh.mockResolvedValueOnce(branchAnswer(over));
    expect(await deletePrBranch(REPO, T, 'feat/x')).toEqual({ note });
    expect(calls()).toHaveLength(1);
  });

  it("refuses a branch that isn't the PR's", async () => {
    m.gh.mockResolvedValueOnce(branchAnswer({ pr: { headRefName: 'main' } }));
    await expect(deletePrBranch(REPO, T, 'feat/x')).rejects.toThrow("feat/x isn't #42's branch");
  });

  it('counts a branch already gone (the repository deleted it) as deleted', async () => {
    m.gh.mockResolvedValueOnce(branchAnswer({ ref: null }));
    expect(await deletePrBranch(REPO, T, 'feat/x')).toEqual({ branchDeleted: true });
    expect(calls()).toHaveLength(1);

    m.gh.mockReset();
    m.gh.mockResolvedValueOnce(branchAnswer()).mockRejectedValueOnce(failWith('gh: Reference does not exist (HTTP 422)'));
    expect(await deletePrBranch(REPO, T, 'feat/x')).toEqual({ branchDeleted: true });
  });
});

describe('the other actions', () => {
  it("runs the gh command for each, in the PR's repository", async () => {
    await prSetAutoMerge(REPO, T, true, 'rebase');
    await prSetAutoMerge(REPO, T, false);
    await prSetDraft(REPO, T, false);
    await prSetDraft(REPO, T, true);
    await prSetOpen(REPO, T, false);
    await prSetOpen(REPO, T, true);
    await prUpdateBranch(REPO, T, false);
    await prUpdateBranch(REPO, T, true);
    const r = ['--repo', 'acme/app'];
    expect(calls()).toEqual([
      ['pr', 'merge', '42', ...r, '--auto', '--rebase'],
      ['pr', 'merge', '42', ...r, '--disable-auto'],
      ['pr', 'ready', '42', ...r],
      ['pr', 'ready', '42', ...r, '--undo'],
      ['pr', 'close', '42', ...r],
      ['pr', 'reopen', '42', ...r],
      ['pr', 'update-branch', '42', ...r],
      ['pr', 'update-branch', '42', ...r, '--rebase'],
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
