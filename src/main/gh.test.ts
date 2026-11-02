import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// gh runs in the agent host (runInAgentHost), never in the git host or this
// process: execa is mocked only to see that nothing reaches it.
vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('./process-host-run.js', () => ({ runInAgentHost: vi.fn() }));

import { execa } from 'execa';
import { runInAgentHost } from './process-host-run.js';
import type { ProcessResult } from './process-host-protocol.js';
import { gh, ghVersion, ghAuthenticated, ghLogin, resetGhLoginCacheForTests, resetGhOfflineCooldownForTests, ghOffline, ghRateLimited, isNetworkError, isRateLimitError, summarizeChecks, failingCheckNames, failingActionsRuns, latestChecks, commentSignature, prStatus, prList, prsForBranches, sortPrs, prCreate, prReviewComments, parseOpenPrs, openPrs, prJobLog, prRerunFailed, GH_LOG_TIMEOUT_MS, GH_RERUN_TIMEOUT_MS, GH_TIMEOUT_MS, GH_OFFLINE_MESSAGE, GH_OFFLINE_COOLDOWN_MS, GH_RATE_LIMITED_MESSAGE, GH_RATE_LIMIT_COOLDOWN_MS, GH_RATE_LIMIT_MAX_COOLDOWN_MS } from './gh.js';

const mockRun = vi.mocked(runInAgentHost);
/** What runInAgentHost resolves with when gh prints `stdout` and exits 0. */
const printed = (stdout: string): ProcessResult => ({ stdout, stderr: '', exitCode: 0, failed: false, timedOut: false });

/** How a gh call that only reads runs: found on PATH as execa found it, and
 *  run once more if the agent host dies under it. */
const READS = { timeout: GH_TIMEOUT_MS, findCommand: true, idempotent: true };
/** How one that changes something runs: never twice. */
const WRITES = { timeout: GH_TIMEOUT_MS, findCommand: true };

/** An error shaped as runInAgentHost rejects with when gh exits non-zero. */
function exited(code: number, stderr: string, stdout = '') {
  return Object.assign(new Error(`Command failed with exit code ${code}: gh ...\n\n${stderr}`), {
    shortMessage: `Command failed with exit code ${code}: gh ...`, exitCode: code, stderr, stdout, failed: true, timedOut: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRun.mockReset();
  resetGhLoginCacheForTests();
  resetGhOfflineCooldownForTests();
});

afterEach(() => {
  expect(execa).not.toHaveBeenCalled();
});

describe('gh()', () => {
  it('runs gh in the agent host with its args, cwd and time limit, and returns its output', async () => {
    mockRun.mockResolvedValue({ stdout: '[]', stderr: '', exitCode: 0, failed: false, timedOut: false });
    expect(await gh(['pr', 'list', '--head', 'b'], '/repo')).toBe('[]');
    expect(mockRun).toHaveBeenCalledWith('gh', ['pr', 'list', '--head', 'b'], { cwd: '/repo', ...READS });
  });

  it('marks only the calls that read idempotent', async () => {
    mockRun.mockResolvedValue({ stdout: '', stderr: '', failed: false, timedOut: false });
    await gh(['api', 'user']);
    await gh(['pr', 'view', '7', '--json', 'headRefOid'], '/repo');
    await gh(['pr', 'create', '--head', 'b', '--title', 'T', '--body', ''], '/repo');
    await gh(['api', '-X', 'POST', 'repos/{owner}/{repo}/pulls/7/reviews', '--input', '-'], '/repo', '{}');
    expect(mockRun.mock.calls.map(([, args, options]) => [args[0], args[1], options?.idempotent === true])).toEqual([
      ['api', 'user', true],
      ['pr', 'view', true],
      ['pr', 'create', false],
      ['api', '-X', false],
    ]);
  });

  it("hands `input` to gh's stdin", async () => {
    mockRun.mockResolvedValue({ stdout: '{}', stderr: '', failed: false, timedOut: false });
    await gh(['api', '-X', 'POST', 'repos/{owner}/{repo}/pulls/7/reviews', '--input', '-'], '/repo', '{"event":"APPROVE"}');
    expect(mockRun).toHaveBeenCalledWith(
      'gh',
      ['api', '-X', 'POST', 'repos/{owner}/{repo}/pulls/7/reviews', '--input', '-'],
      { cwd: '/repo', ...WRITES, input: '{"event":"APPROVE"}' },
    );
  });

  it('rejects with the error runInAgentHost gives, fields and all', async () => {
    const error = exited(1, 'gh: Not Found (HTTP 404)', '{"message":"Not Found"}');
    mockRun.mockRejectedValue(error);
    await expect(gh(['api', 'repos/o/r'])).rejects.toBe(error);
  });
});

describe('what callers make of gh failing, as runInAgentHost reports it', () => {
  it('gh not installed: no version', async () => {
    // The agent host reports a command it can't find as Node does, on
    // Windows too (createSpawnRunner).
    mockRun.mockRejectedValue(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT', syscall: 'spawn gh', path: 'gh' }));
    expect(await ghVersion()).toBeNull();
  });

  it('not signed in: not authenticated, and no login', async () => {
    mockRun.mockRejectedValue(exited(1, 'You are not logged into any GitHub hosts. To log in, run: gh auth login'));
    expect(await ghAuthenticated()).toBe(false);
    expect(await ghLogin()).toBeNull();
    // Not a network failure: nothing backs off.
    expect(ghOffline()).toBe(false);
  });

  it('no PR for the branch: null, not an error', async () => {
    mockRun.mockRejectedValue(exited(1, 'no pull requests found for branch "feat/x"'));
    expect(await prStatus('/repo', 'feat/x')).toBeNull();
    expect(ghOffline()).toBe(false);
  });

  it('timed out (its tree killed): a network failure, so the sweep backs off', async () => {
    mockRun.mockRejectedValue(Object.assign(new Error(`Command timed out after ${GH_TIMEOUT_MS} milliseconds: gh pr view feat/x`), {
      shortMessage: `Command timed out after ${GH_TIMEOUT_MS} milliseconds: gh pr view feat/x`, stdout: '', stderr: '', failed: true, timedOut: true,
    }));
    await expect(prStatus('/repo', 'feat/x')).rejects.toThrow(/^gh pr view failed: Command timed out after 30000 milliseconds/);
    expect(ghOffline()).toBe(true);
  });
});

describe('ghVersion()', () => {
  it('parses the version from gh --version output', async () => {
    mockRun.mockResolvedValue(printed('gh version 2.40.1 (2023-12-13)\nhttps://github.com/cli/cli/releases/tag/v2.40.1'));
    expect(await ghVersion()).toBe('2.40.1');
    expect(mockRun).toHaveBeenCalledWith('gh', ['--version'], READS);
  });

  it('returns null when gh is not installed', async () => {
    mockRun.mockRejectedValue(new Error('not found'));
    expect(await ghVersion()).toBeNull();
  });
});

describe('ghAuthenticated()', () => {
  it('returns true when gh auth status exits cleanly', async () => {
    mockRun.mockResolvedValue(printed(''));
    expect(await ghAuthenticated()).toBe(true);
    expect(mockRun).toHaveBeenCalledWith('gh', ['auth', 'status'], READS);
  });

  it('returns false when gh auth status fails', async () => {
    mockRun.mockRejectedValue(new Error('not logged in'));
    expect(await ghAuthenticated()).toBe(false);
  });
});

describe('ghLogin()', () => {
  it('returns and caches the authenticated login', async () => {
    mockRun.mockResolvedValue(printed(JSON.stringify({ login: 'alan' })));
    expect(await ghLogin()).toBe('alan');
    expect(await ghLogin()).toBe('alan');
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('returns null without caching when gh fails, then succeeds later', async () => {
    mockRun.mockRejectedValueOnce(new Error('not logged in'));
    expect(await ghLogin()).toBeNull();
    mockRun.mockResolvedValueOnce(printed(JSON.stringify({ login: 'alan' })));
    expect(await ghLogin()).toBe('alan');
  });
});

describe('summarizeChecks()', () => {
  it('returns null for a missing or empty rollup', () => {
    expect(summarizeChecks(undefined)).toBeNull();
    expect(summarizeChecks(null)).toBeNull();
    expect(summarizeChecks([])).toBeNull();
  });

  it('counts CheckRun conclusions', () => {
    const rollup = [
      { conclusion: 'SUCCESS', status: 'COMPLETED' },
      { conclusion: 'FAILURE', status: 'COMPLETED' },
      { conclusion: 'SKIPPED', status: 'COMPLETED' },
      { conclusion: '', status: 'IN_PROGRESS' },
    ];
    expect(summarizeChecks(rollup)).toEqual({ total: 4, passed: 2, failed: 1, pending: 1 });
  });

  it('counts StatusContext states', () => {
    const rollup = [
      { state: 'SUCCESS' },
      { state: 'ERROR' },
      { state: 'PENDING' },
    ];
    expect(summarizeChecks(rollup)).toEqual({ total: 3, passed: 1, failed: 1, pending: 1 });
  });
});

describe('prStatus()', () => {
  it('returns the parsed PR view', async () => {
    mockRun.mockResolvedValue(printed(JSON.stringify({
        number: 42,
        url: 'https://github.com/o/r/pull/42',
        state: 'OPEN',
        isDraft: false,
        title: 'Add feature',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [{ conclusion: 'SUCCESS' }],
      })));

    const result = await prStatus('/repo', 'feat/x');
    expect(mockRun).toHaveBeenCalledWith(
      'gh',
      ['pr', 'view', 'feat/x', '--json', 'number,url,state,isDraft,title,reviewDecision,statusCheckRollup,headRefOid,comments,reviews,headRefName,baseRefName,author,mergeStateStatus,autoMergeRequest,latestReviews,reviewRequests'],
      { cwd: '/repo', ...READS },
    );
    expect(result).toEqual({
      number: 42,
      url: 'https://github.com/o/r/pull/42',
      state: 'OPEN',
      isDraft: false,
      title: 'Add feature',
      reviewDecision: 'APPROVED',
      checks: { total: 1, passed: 1, failed: 0, pending: 0 },
      failingChecks: [],
      commentSignature: [],
    });
  });

  it('carries head SHA, failing check names, and the comment signature', async () => {
    mockRun.mockResolvedValue(printed(JSON.stringify({
        number: 43,
        url: 'u',
        state: 'OPEN',
        headRefOid: 'abc123',
        statusCheckRollup: [
          { name: 'test', conclusion: 'FAILURE' },
          { name: 'lint', conclusion: 'SUCCESS' },
        ],
        comments: [{ id: 'C1', author: { login: 'alice' } }],
        reviews: [
          { id: 'R1', state: 'CHANGES_REQUESTED' },
          { id: 'R2', state: 'PENDING' },
        ],
      })));

    const result = await prStatus('/repo', 'feat/x');
    expect(result?.headSha).toBe('abc123');
    expect(result?.failingChecks).toEqual(['test']);
    expect(result?.commentSignature).toEqual(['c:C1', 'r:R1']);
    expect(result).not.toHaveProperty('failingRuns');
  });

  it('carries the Actions runs behind failing checks', async () => {
    mockRun.mockResolvedValue(printed(JSON.stringify({
        number: 44,
        url: 'https://github.com/o/r/pull/44',
        statusCheckRollup: [
          { name: 'test', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/123/job/456' },
          { context: 'codecov/patch', state: 'FAILURE', targetUrl: 'https://codecov.io/x' },
        ],
      })));

    const result = await prStatus('/repo', 'feat/x');
    expect(result?.failingRuns).toEqual([{ repo: 'o/r', runId: '123', jobs: [{ id: '456', name: 'test' }] }]);
    expect(result?.otherFailingChecks).toEqual(['codecov/patch']);
  });

  it('carries GitHub\'s merge verdict, auto-merge, reviewers, requested reviewers and running checks', async () => {
    mockRun.mockResolvedValue(printed(JSON.stringify({
        number: 45,
        url: 'https://github.com/o/r/pull/45',
        mergeStateStatus: 'BLOCKED',
        autoMergeRequest: { mergeMethod: 'SQUASH', enabledAt: '2026-11-01T10:00:00Z' },
        latestReviews: [
          { author: { login: 'alice' }, state: 'CHANGES_REQUESTED' },
          { author: { login: 'bob' }, state: 'APPROVED' },
          { author: { login: 'carol' }, state: 'DISMISSED' },
          { author: { login: 'dave' }, state: 'PENDING' },
          { author: {}, state: 'APPROVED' },
        ],
        reviewRequests: [{ __typename: 'User', login: 'erin' }, { __typename: 'Team', name: 'api-team', slug: 'org/api-team' }],
        statusCheckRollup: [
          { name: 'e2e', status: 'IN_PROGRESS', conclusion: '', workflowName: 'CI' },
          { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' },
        ],
      })));

    const result = await prStatus('/repo', 'feat/x');
    expect(result).toMatchObject({
      mergeState: 'blocked',
      autoMerge: true,
      reviewers: [{ login: 'alice', state: 'changes_requested' }, { login: 'bob', state: 'approved' }],
      requestedReviewers: ['erin', 'api-team'],
      runningChecks: ['e2e'],
    });
  });

  it('leaves the new fields out when GitHub gives none, or a merge state it doesn\'t know', async () => {
    mockRun.mockResolvedValue(printed(JSON.stringify({ number: 46, url: 'u', mergeStateStatus: 'SOMETHING_NEW', autoMergeRequest: null, latestReviews: [], reviewRequests: [] })));
    const result = await prStatus('/repo', 'feat/x');
    for (const key of ['mergeState', 'autoMerge', 'reviewers', 'requestedReviewers', 'runningChecks']) expect(result).not.toHaveProperty(key);
  });

  it('returns null when no PR exists for the branch', async () => {
    mockRun.mockRejectedValue(new Error('no pull requests found'));
    expect(await prStatus('/repo', 'feat/x')).toBeNull();
  });

  it('recognises the no-PR message on stderr as well as the error message', async () => {
    mockRun.mockRejectedValue(Object.assign(new Error('Command failed'), { stderr: 'no pull requests found for branch "feat/x"' }));
    expect(await prStatus('/repo', 'feat/x')).toBeNull();
  });

  it('throws on any other gh failure so the caller keeps its last snapshot', async () => {
    mockRun.mockRejectedValue(Object.assign(new Error('Command timed out'), { stderr: 'error connecting to api.github.com' }));
    await expect(prStatus('/repo', 'feat/x')).rejects.toThrow(/gh pr view failed: error connecting/);
  });

  it('returns null on malformed output', async () => {
    mockRun.mockResolvedValue(printed('not json'));
    expect(await prStatus('/repo', 'feat/x')).toBeNull();
  });
});

describe('prList()', () => {
  const FIELDS = 'number,url,state,isDraft,title,reviewDecision,statusCheckRollup,headRefOid,comments,reviews,headRefName,baseRefName,author,mergeStateStatus,autoMergeRequest,latestReviews,reviewRequests';

  it('lists every PR for the head branch, in any state, with head and base names', async () => {
    mockRun.mockResolvedValue(printed(JSON.stringify([
        { number: 50, url: 'u50', state: 'OPEN', headRefName: 'feat/x', baseRefName: 'main', statusCheckRollup: [] },
        { number: 41, url: 'u41', state: 'MERGED', headRefName: 'feat/x', baseRefName: 'release' },
      ])));

    const result = await prList('/repo', 'feat/x');
    expect(mockRun).toHaveBeenCalledWith(
      'gh',
      ['pr', 'list', '--head', 'feat/x', '--state', 'all', '--limit', '20', '--json', FIELDS],
      { cwd: '/repo', ...READS },
    );
    expect(result.map((pr) => [pr.number, pr.state, pr.headRefName, pr.baseRefName])).toEqual([
      [50, 'OPEN', 'feat/x', 'main'],
      [41, 'MERGED', 'feat/x', 'release'],
    ]);
  });

  it('returns an empty list when the branch has no PRs', async () => {
    mockRun.mockResolvedValue(printed('[]'));
    expect(await prList('/repo', 'feat/x')).toEqual([]);
  });

  it('says whether the gh account opened each PR, only when its login is known', async () => {
    mockRun.mockResolvedValue(printed(JSON.stringify([
        { number: 2, url: 'u2', author: { login: 'alan' } },
        { number: 3, url: 'u3', author: { login: 'grace' } },
      ])));
    expect((await prList('/repo', 'feat/x', 'alan')).map((pr) => pr.viewerIsAuthor)).toEqual([true, false]);
    expect((await prList('/repo', 'feat/x', null)).map((pr) => pr.viewerIsAuthor)).toEqual([undefined, undefined]);
  });

  it('drops entries that are not PRs and tolerates malformed output', async () => {
    mockRun.mockResolvedValue(printed(JSON.stringify([{ number: 1, url: 'u' }, { title: 'no number' }, null])));
    expect((await prList('/repo', 'feat/x')).map((pr) => pr.number)).toEqual([1]);
    mockRun.mockResolvedValue(printed('not json'));
    expect(await prList('/repo', 'feat/x')).toEqual([]);
  });

  it('throws on a gh failure so the caller keeps its last snapshot', async () => {
    mockRun.mockRejectedValue(Object.assign(new Error('Command failed'), { stderr: 'error connecting to api.github.com' }));
    await expect(prList('/repo', 'feat/x')).rejects.toThrow(/gh pr list failed: error connecting/);
  });
});

describe('offline cooldown', () => {
  const netFail = () => Object.assign(new Error('Command failed'), { stderr: 'error connecting to api.github.com' });

  it('classifies connection, DNS, and timeout failures as network failures', () => {
    expect(isNetworkError(netFail())).toBe(true);
    expect(isNetworkError(Object.assign(new Error('Command timed out after 30000 milliseconds'), { timedOut: true }))).toBe(true);
    expect(isNetworkError(Object.assign(new Error('boom'), { code: 'ENOTFOUND' }))).toBe(true);
    expect(isNetworkError(new Error(`gh pr list failed: ${GH_OFFLINE_MESSAGE}`))).toBe(true);
    expect(isNetworkError(new Error('no pull requests found'))).toBe(false);
    expect(isNetworkError(Object.assign(new Error('Command failed'), { stderr: 'gh auth login required' }))).toBe(false);
  });

  it('skips gh entirely for the next calls after a network failure', async () => {
    mockRun.mockRejectedValue(netFail());
    await expect(prList('/repo', 'feat/x')).rejects.toThrow(/error connecting/);
    expect(ghOffline()).toBe(true);

    mockRun.mockClear();
    await expect(prList('/repo', 'feat/y')).rejects.toThrow(GH_OFFLINE_MESSAGE);
    await expect(prStatus('/repo', 'feat/z')).rejects.toThrow(GH_OFFLINE_MESSAGE);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('stops a whole sweep at the first branch instead of timing out on each', async () => {
    mockRun.mockRejectedValue(netFail());
    await expect(prsForBranches('/repo', ['a', 'b', 'c'])).rejects.toThrow();
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('does not back off for a failure that is not the network', async () => {
    mockRun.mockRejectedValue(new Error('no pull requests found'));
    expect(await prStatus('/repo', 'feat/x')).toBeNull();
    expect(ghOffline()).toBe(false);
  });

  it('tries again once the cooldown expires, and a success reopens it', async () => {
    vi.useFakeTimers();
    try {
      mockRun.mockRejectedValue(netFail());
      await expect(prList('/repo', 'feat/x')).rejects.toThrow();
      expect(ghOffline()).toBe(true);

      vi.advanceTimersByTime(GH_OFFLINE_COOLDOWN_MS + 1);
      mockRun.mockReset();
      mockRun.mockResolvedValue(printed('[]'));
      expect(await prList('/repo', 'feat/x')).toEqual([]);
      expect(mockRun).toHaveBeenCalledTimes(1);
      expect(ghOffline()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still attempts a user-initiated PR create while the cooldown holds', async () => {
    mockRun.mockRejectedValue(netFail());
    await expect(prList('/repo', 'feat/x')).rejects.toThrow();
    expect(ghOffline()).toBe(true);

    mockRun.mockReset();
    mockRun
      .mockResolvedValueOnce(printed('https://github.com/o/r/pull/9'))
      .mockResolvedValueOnce(printed(JSON.stringify({ number: 9, url: 'u' })));
    expect((await prCreate('/repo', 'feat/x', { title: 'T', body: 'B', base: '' })).number).toBe(9);
  });
});

describe('rate-limit back-off', () => {
  const rateLimited = () => Object.assign(new Error('Command failed'), { stderr: 'GraphQL: API rate limit exceeded for user ID 1.' });

  it('classifies primary, secondary and HTTP 429 limits, but not other failures', () => {
    expect(isRateLimitError(rateLimited())).toBe(true);
    expect(isRateLimitError(Object.assign(new Error('x'), { stderr: 'You have exceeded a secondary rate limit.' }))).toBe(true);
    expect(isRateLimitError(Object.assign(new Error('x'), { stderr: 'HTTP 429: Too Many Requests' }))).toBe(true);
    expect(isRateLimitError(new Error(`gh pr list failed: ${GH_RATE_LIMITED_MESSAGE}`))).toBe(true);
    expect(isRateLimitError(Object.assign(new Error('x'), { stderr: 'error connecting to api.github.com' }))).toBe(false);
    expect(isRateLimitError(new Error('no pull requests found'))).toBe(false);
  });

  it('ignores the command line, which can hold a PR title', () => {
    const err = Object.assign(new Error('Command failed: gh pr create --title Handle rate limit errors'), { stderr: 'pull request create failed: GraphQL: Head sha can\'t be blank' });
    expect(isRateLimitError(err)).toBe(false);
  });

  it('skips gh for the next calls after a rate-limit hit, without marking GitHub offline', async () => {
    mockRun.mockRejectedValue(rateLimited());
    await expect(prList('/repo', 'feat/x')).rejects.toThrow(/rate limit exceeded/);
    expect(ghRateLimited()).toBe(true);
    expect(ghOffline()).toBe(false);

    mockRun.mockClear();
    await expect(prList('/repo', 'feat/y')).rejects.toThrow(GH_RATE_LIMITED_MESSAGE);
    await expect(prsForBranches('/repo', ['a', 'b'])).rejects.toThrow(GH_RATE_LIMITED_MESSAGE);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('doubles the wait on each further hit, up to the max, and a success resets it', async () => {
    vi.useFakeTimers();
    try {
      mockRun.mockRejectedValue(rateLimited());
      await expect(prList('/repo', 'feat/x')).rejects.toThrow();

      // First wait: the base cooldown.
      vi.advanceTimersByTime(GH_RATE_LIMIT_COOLDOWN_MS - 1);
      expect(ghRateLimited()).toBe(true);
      vi.advanceTimersByTime(2);
      expect(ghRateLimited()).toBe(false);

      // Second hit: twice as long.
      await expect(prList('/repo', 'feat/x')).rejects.toThrow(/rate limit exceeded/);
      vi.advanceTimersByTime(GH_RATE_LIMIT_COOLDOWN_MS * 2 - 1);
      expect(ghRateLimited()).toBe(true);
      vi.advanceTimersByTime(2);
      expect(ghRateLimited()).toBe(false);

      // Many more hits: capped.
      for (let i = 0; i < 10; i++) {
        await expect(prList('/repo', 'feat/x')).rejects.toThrow(/rate limit exceeded/);
        vi.advanceTimersByTime(GH_RATE_LIMIT_MAX_COOLDOWN_MS + 1);
      }
      await expect(prList('/repo', 'feat/x')).rejects.toThrow(/rate limit exceeded/);
      vi.advanceTimersByTime(GH_RATE_LIMIT_MAX_COOLDOWN_MS - 1);
      expect(ghRateLimited()).toBe(true);
      vi.advanceTimersByTime(2);
      expect(ghRateLimited()).toBe(false);

      // A success resets the doubling: the next hit waits the base cooldown again.
      mockRun.mockResolvedValueOnce(printed('[]'));
      expect(await prList('/repo', 'feat/x')).toEqual([]);
      await expect(prList('/repo', 'feat/x')).rejects.toThrow(/rate limit exceeded/);
      vi.advanceTimersByTime(GH_RATE_LIMIT_COOLDOWN_MS + 1);
      expect(ghRateLimited()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still attempts a user-initiated PR create while the back-off holds', async () => {
    mockRun.mockRejectedValue(rateLimited());
    await expect(prList('/repo', 'feat/x')).rejects.toThrow();
    expect(ghRateLimited()).toBe(true);

    mockRun.mockReset();
    mockRun
      .mockResolvedValueOnce(printed('https://github.com/o/r/pull/9'))
      .mockResolvedValueOnce(printed(JSON.stringify({ number: 9, url: 'u' })));
    expect((await prCreate('/repo', 'feat/x', { title: 'T', body: 'B', base: '' })).number).toBe(9);
  });
});

describe('sortPrs()', () => {
  it('puts open PRs first, newest first within each group', () => {
    const sorted = sortPrs([
      { number: 40, url: 'u', state: 'MERGED' },
      { number: 44, url: 'u', state: 'OPEN' },
      { number: 47, url: 'u', state: 'CLOSED' },
      { number: 45, url: 'u', state: 'OPEN' },
    ]);
    expect(sorted.map((pr) => pr.number)).toEqual([45, 44, 47, 40]);
  });
});

describe('prsForBranches()', () => {
  it('queries each distinct branch once and merges the results, deduplicated and sorted', async () => {
    mockRun.mockImplementation((_cmd, args) => {
      const head = args[args.indexOf('--head') + 1];
      const rows = head === 'feat/x'
        ? [{ number: 40, url: 'u', state: 'MERGED', headRefName: 'feat/x' }, { number: 45, url: 'u', state: 'OPEN', headRefName: 'feat/x' }]
        : [{ number: 48, url: 'u', state: 'OPEN', headRefName: 'feat/x-part-2' }];
      return Promise.resolve(printed(JSON.stringify(rows)));
    });

    const result = await prsForBranches('/repo', ['feat/x', 'feat/x-part-2', 'feat/x', '']);
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(result.map((pr) => pr.number)).toEqual([48, 45, 40]);
  });

  it('returns an empty list when no branch has a PR', async () => {
    mockRun.mockResolvedValue(printed('[]'));
    expect(await prsForBranches('/repo', ['feat/x'])).toEqual([]);
  });
});

describe('commentSignature()', () => {
  it('excludes the ignored user\'s own comments and reviews', () => {
    const comments = [
      { id: 'C1', author: { login: 'alan' } },
      { id: 'C2', author: { login: 'alice' } },
    ];
    const reviews = [
      { id: 'R1', state: 'COMMENTED', author: { login: 'alan' } },
      { id: 'R2', state: 'APPROVED', author: { login: 'bob' } },
    ];
    expect(commentSignature(comments, reviews, 'alan')).toEqual(['c:C2', 'r:R2']);
    expect(commentSignature(comments, reviews)).toEqual(['c:C1', 'c:C2', 'r:R1', 'r:R2']);
  });
});

describe('failingCheckNames()', () => {
  it('extracts names of failed checks only', () => {
    expect(failingCheckNames([
      { name: 'build', conclusion: 'SUCCESS' },
      { name: 'test', conclusion: 'FAILURE' },
      { context: 'ci/legacy', state: 'ERROR' },
      { conclusion: 'TIMED_OUT' },
    ])).toEqual(['test', 'ci/legacy', 'check']);
  });

  it('returns empty for non-arrays', () => {
    expect(failingCheckNames(undefined)).toEqual([]);
  });
});

describe('failingActionsRuns()', () => {
  const PR = 'https://github.com/Owner/Repo/pull/7';
  const run = (id: string, conclusion = 'FAILURE', repo = 'Owner/Repo', job = `9${id}`) =>
    ({ name: `job-${job}`, conclusion, detailsUrl: `https://github.com/${repo}/actions/runs/${id}/job/${job}` });

  it('lists each failing Actions run once, with its failed jobs', () => {
    expect(failingActionsRuns([
      run('101'), run('101', 'FAILURE', 'Owner/Repo', '8101'), run('101'),
      run('102', 'TIMED_OUT'), run('103', 'SUCCESS'),
    ], PR)).toEqual([
      { repo: 'Owner/Repo', runId: '101', jobs: [{ id: '9101', name: 'job-9101' }, { id: '8101', name: 'job-8101' }] },
      { repo: 'Owner/Repo', runId: '102', jobs: [{ id: '9102', name: 'job-9102' }] },
    ]);
  });

  it('names the workflow, and marks a run with jobs still going', () => {
    const going = { name: 'e2e', conclusion: '', status: 'IN_PROGRESS', detailsUrl: 'https://github.com/Owner/Repo/actions/runs/201/job/3' };
    expect(failingActionsRuns([
      { ...run('201'), workflowName: 'CI' },
      going,
      { ...run('202'), workflowName: '' },
      { ...run('203', 'SUCCESS'), status: 'COMPLETED' },
      { ...going, detailsUrl: 'https://github.com/someone/else/actions/runs/202/job/4' },
    ], PR)).toEqual([
      { repo: 'Owner/Repo', runId: '201', workflow: 'CI', jobs: [{ id: '9201', name: 'job-9201' }], pending: true },
      { repo: 'Owner/Repo', runId: '202', jobs: [{ id: '9202', name: 'job-9202' }] },
    ]);
  });

  it('gives a failed job how long it ran, when GitHub says', () => {
    const timed = { ...run('501'), startedAt: '2026-11-01T10:00:00Z', completedAt: '2026-11-01T10:04:12Z' };
    const queued = { ...run('502'), startedAt: '0001-01-01T00:00:00Z', completedAt: '0001-01-01T00:00:00Z' };
    const [first, second] = failingActionsRuns([timed, queued], PR);
    expect(first.jobs).toEqual([{ id: '9501', name: 'job-9501', seconds: 252 }]);
    expect(second.jobs).toEqual([{ id: '9502', name: 'job-9502' }]);
  });

  it('keeps a check whose link names only the run, as a job with no log', () => {
    expect(failingActionsRuns([{ name: 'build', conclusion: 'FAILURE', detailsUrl: 'https://github.com/Owner/Repo/actions/runs/301' }], PR))
      .toEqual([{ repo: 'Owner/Repo', runId: '301', jobs: [{ name: 'build' }] }]);
  });

  it('marks a run going only for checks not completed, not a stale one', () => {
    expect(failingActionsRuns([
      run('401'),
      { name: 'old', conclusion: 'STALE', status: 'COMPLETED', detailsUrl: 'https://github.com/Owner/Repo/actions/runs/401/job/7' },
    ], PR)[0]).not.toHaveProperty('pending');
  });

  it('matches the PR repository whatever the letter case', () => {
    expect(failingActionsRuns([run('104', 'FAILURE', 'owner/repo')], PR)).toEqual([{ repo: 'owner/repo', runId: '104', jobs: [{ id: '9104', name: 'job-9104' }] }]);
  });

  it('reads repositories whose name starts with a dot', () => {
    expect(failingActionsRuns([run('107', 'FAILURE', 'acme/.github')], 'https://github.com/acme/.github/pull/12'))
      .toEqual([{ repo: 'acme/.github', runId: '107', jobs: [{ id: '9107', name: 'job-9107' }] }]);
  });

  it('leaves out checks whose logs are not in an Actions run of the PR repository', () => {
    expect(failingActionsRuns([
      { context: 'ci/legacy', state: 'ERROR', targetUrl: 'https://ci.example.com/build/1' },
      { name: 'external', conclusion: 'FAILURE', detailsUrl: 'https://ci.example.com/o/r/actions/runs/1' },
      run('105', 'FAILURE', 'someone/else'),
      { name: 'odd', conclusion: 'FAILURE', detailsUrl: 'https://github.com/Owner/Repo/actions/runs/12x' },
      { name: 'no link', conclusion: 'FAILURE' },
    ], PR)).toEqual([]);
  });

  it('keeps the host for GitHub Enterprise', () => {
    const rollup = [{ name: 't', conclusion: 'FAILURE', detailsUrl: 'https://ghe.corp.io/team/app/actions/runs/55' }];
    expect(failingActionsRuns(rollup, 'https://ghe.corp.io/team/app/pull/3')).toEqual([{ repo: 'ghe.corp.io/team/app', runId: '55', jobs: [{ name: 't' }] }]);
  });

  it('returns none without a PR URL it can read', () => {
    expect(failingActionsRuns([run('106')], 'u')).toEqual([]);
    expect(failingActionsRuns(undefined, PR)).toEqual([]);
  });
});

describe('prReviewComments()', () => {
  it('merges review bodies, inline comments, and conversation comments', async () => {
    mockRun
      .mockResolvedValueOnce(printed(JSON.stringify([
          { id: 9, body: 'Rename this variable', path: 'src/a.ts', line: 12, user: { login: 'bob' }, author_association: 'COLLABORATOR' },
          { id: 10, body: '', path: 'src/b.ts' },
        ]))) // pulls/N/comments
      .mockResolvedValueOnce(printed(JSON.stringify([
          { id: 5, body: 'Looks mostly good, two nits', state: 'CHANGES_REQUESTED', user: { login: 'alice' }, author_association: 'MEMBER' },
          { id: 6, body: 'wip', state: 'PENDING', user: { login: 'carol' } },
        ]))) // pulls/N/reviews
      .mockResolvedValueOnce(printed(JSON.stringify([
          { id: 21, body: 'Please also update the changelog', user: { login: 'dave' }, author_association: 'OWNER' },
          { id: 22, body: '  ' },
        ]))); // issues/N/comments

    const result = await prReviewComments('/repo', 42);
    expect(mockRun).toHaveBeenCalledWith('gh', ['api', 'repos/{owner}/{repo}/pulls/42/comments?per_page=100'], { cwd: '/repo', ...READS });
    expect(mockRun).toHaveBeenCalledWith('gh', ['api', 'repos/{owner}/{repo}/issues/42/comments?per_page=100'], { cwd: '/repo', ...READS });
    expect(result).toEqual([
      { id: 'review-5', author: 'alice', authorAssociation: 'MEMBER', body: 'Looks mostly good, two nits' },
      { id: 'comment-9', author: 'bob', authorAssociation: 'COLLABORATOR', path: 'src/a.ts', line: 12, body: 'Rename this variable' },
      { id: 'discussion-21', author: 'dave', authorAssociation: 'OWNER', body: 'Please also update the changelog' },
    ]);
  });

  it('returns conversation comments even when a review never happened', async () => {
    mockRun
      .mockResolvedValueOnce(printed('[]')) // pulls/N/comments
      .mockResolvedValueOnce(printed('[]')) // pulls/N/reviews
      .mockResolvedValueOnce(printed(JSON.stringify([
          { id: 30, body: 'Can you split this PR?', user: { login: 'erin' }, author_association: 'MEMBER' },
        ]))); // issues/N/comments

    expect(await prReviewComments('/repo', 42)).toEqual([
      { id: 'discussion-30', author: 'erin', authorAssociation: 'MEMBER', body: 'Can you split this PR?' },
    ]);
  });

  it('returns empty when all api calls fail', async () => {
    mockRun.mockRejectedValue(new Error('gh api failed'));
    expect(await prReviewComments('/repo', 42)).toEqual([]);
  });
});

describe('prCreate()', () => {
  it('creates the PR then returns its status', async () => {
    mockRun
      .mockResolvedValueOnce(printed('https://github.com/o/r/pull/7')) // pr create
      .mockResolvedValueOnce(printed(JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', isDraft: true }))); // pr view

    const result = await prCreate('/repo', 'feat/x', { title: 'T', body: 'B', base: 'main', draft: true });
    expect(mockRun).toHaveBeenNthCalledWith(
      1,
      'gh',
      ['pr', 'create', '--head', 'feat/x', '--title', 'T', '--body', 'B', '--base', 'main', '--draft'],
      { cwd: '/repo', ...WRITES },
    );
    expect(result.number).toBe(7);
    expect(result.isDraft).toBe(true);
    // Opened with the gh account, so its own: no approving it.
    expect(result.viewerIsAuthor).toBe(true);
  });

  it('omits --base and --draft when not requested', async () => {
    mockRun
      .mockResolvedValueOnce(printed(''))
      .mockResolvedValueOnce(printed(JSON.stringify({ number: 8, url: 'u' })));

    await prCreate('/repo', 'feat/x', { title: 'T', body: '', base: '' });
    expect(mockRun).toHaveBeenNthCalledWith(
      1,
      'gh',
      ['pr', 'create', '--head', 'feat/x', '--title', 'T', '--body', ''],
      { cwd: '/repo', ...WRITES },
    );
  });

  it('surfaces gh stderr on failure', async () => {
    mockRun.mockRejectedValue(Object.assign(new Error('Command failed: gh pr create ...'), {
      stderr: 'a pull request for branch "feat/x" already exists',
    }));
    await expect(prCreate('/repo', 'feat/x', { title: 'T', body: '', base: 'main' }))
      .rejects.toThrow('a pull request for branch "feat/x" already exists');
  });

  it('throws when the created PR cannot be read back', async () => {
    mockRun
      .mockResolvedValueOnce(printed(''))
      .mockRejectedValueOnce(new Error('boom'));
    await expect(prCreate('/repo', 'feat/x', { title: 'T', body: '', base: 'main' }))
      .rejects.toThrow(/could not be read back/);
  });
});

describe('parseOpenPrs()', () => {
  it('maps gh fields and skips malformed entries', () => {
    const stdout = JSON.stringify([
      { number: 7, title: 'Add login', headRefName: 'feat/API-7-login', author: { login: 'sam' }, isDraft: true, isCrossRepository: false, url: 'https://x/7' },
      { number: 8, title: 'From a fork', headRefName: 'patch-1', author: null, isCrossRepository: true },
      { number: 'nine', headRefName: 'bad' },
      { number: 10, headRefName: '' },
    ]);
    expect(parseOpenPrs(stdout)).toEqual([
      { number: 7, title: 'Add login', headRefName: 'feat/API-7-login', author: 'sam', isDraft: true, isCrossRepository: false, url: 'https://x/7' },
      { number: 8, title: 'From a fork', headRefName: 'patch-1', author: '', isDraft: false, isCrossRepository: true, url: '' },
    ]);
  });

  it('returns [] for output that is not a JSON array', () => {
    expect(parseOpenPrs('not json')).toEqual([]);
    expect(parseOpenPrs('{}')).toEqual([]);
  });
});

describe('openPrs()', () => {
  it('lists open PRs with the fields the picker needs', async () => {
    mockRun.mockResolvedValue(printed('[]'));
    expect(await openPrs('/repo')).toEqual([]);
    const [cmd, args, opts] = mockRun.mock.calls[0] as unknown as [string, string[], any];
    expect(cmd).toBe('gh');
    expect(args.slice(0, 4)).toEqual(['pr', 'list', '--state', 'open']);
    expect(args[args.indexOf('--json') + 1]).toBe('number,title,headRefName,author,isDraft,isCrossRepository,url');
    expect(opts).toMatchObject({ cwd: '/repo' });
  });

  it('still tries while the offline cooldown holds (user-initiated)', async () => {
    mockRun.mockRejectedValueOnce(Object.assign(new Error('x'), { stderr: 'error connecting to api.github.com' }));
    await expect(prStatus('/repo', 'b')).rejects.toThrow();
    expect(ghOffline()).toBe(true);
    mockRun.mockResolvedValue(printed('[]'));
    expect(await openPrs('/repo')).toEqual([]);
  });

  it('throws when gh fails', async () => {
    mockRun.mockRejectedValue(Object.assign(new Error('gh failed'), { stderr: 'not logged in' }));
    await expect(openPrs('/repo')).rejects.toThrow();
  });
});

describe('prJobLog()', () => {
  it("reads the job's log through the API, keeping only its end, and gives the readable tail", async () => {
    mockRun.mockResolvedValueOnce(printed('2026-11-01T12:00:00.0000000Z build\n2026-11-01T12:00:01.0000000Z ##[error]boom\n'));

    await expect(prJobLog('/repo', 'o/r', '456')).resolves.toEqual({ text: 'build\n##[error]boom', errorLine: 2 });
    // The host always, so GH_HOST can't send it elsewhere.
    expect(mockRun).toHaveBeenCalledWith('gh', ['api', '--hostname', 'github.com', 'repos/o/r/actions/jobs/456/logs'], {
      cwd: '/repo', timeout: GH_LOG_TIMEOUT_MS, findCommand: true, idempotent: true, keepLastChars: 2 * 1024 * 1024,
    });
  });

  it('names the host off github.com', async () => {
    mockRun.mockResolvedValueOnce(printed('ok'));
    await prJobLog('/repo', 'ghe.corp.io/t/a', '7');
    expect(mockRun.mock.calls[0][1]).toEqual(['api', '--hostname', 'ghe.corp.io', 'repos/t/a/actions/jobs/7/logs']);
  });

  it('refuses ids and repositories that are not plain', async () => {
    await expect(prJobLog('/repo', 'o/r', '45x')).rejects.toThrow('Not a GitHub Actions job');
    await expect(prJobLog('/repo', 'o/r;x', '45')).rejects.toThrow('Not a GitHub Actions job');
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('says plainly when the log is gone, refused, rate-limited or slow, and a slow one does not mark GitHub offline', async () => {
    mockRun.mockRejectedValueOnce(exited(1, 'gh: Not Found (HTTP 404)', '{"message":"Not Found"}'));
    await expect(prJobLog('/repo', 'o/r', '1')).rejects.toThrow("GitHub has no log for this job. It may have expired (logs are kept for 90 days unless the repository says otherwise), or this gh account can't see the repository.");
    mockRun.mockRejectedValueOnce(exited(1, 'gh: Resource protected by organization SAML enforcement. (HTTP 403)'));
    await expect(prJobLog('/repo', 'o/r', '1')).rejects.toThrow(/^GitHub refused to send the log: Resource protected by organization SAML enforcement\. \(HTTP 403\)$/);
    mockRun.mockRejectedValueOnce(exited(1, 'gh: API rate limit exceeded for user ID 1. (HTTP 403)'));
    await expect(prJobLog('/repo', 'o/r', '1')).rejects.toThrow("GitHub's API rate limit is reached");
    mockRun.mockRejectedValueOnce(Object.assign(new Error('Command timed out after 60000 milliseconds: gh api'), { stdout: '', stderr: '', timedOut: true }));
    await expect(prJobLog('/repo', 'o/r', '1')).rejects.toThrow('GitHub took too long to send the log');
    expect(ghOffline()).toBe(false);
  });
});

describe('prRerunFailed()', () => {
  it("asks GitHub to rerun the run's failed jobs, once (never retried)", async () => {
    mockRun.mockResolvedValueOnce(printed(''));
    await prRerunFailed('/repo', 'o/r', '123');
    // HOST/OWNER/REPO always, so GH_HOST can't send it elsewhere.
    expect(mockRun).toHaveBeenCalledWith('gh', ['run', 'rerun', '123', '--failed', '--repo', 'github.com/o/r'], { cwd: '/repo', timeout: GH_RERUN_TIMEOUT_MS, findCommand: true });
  });

  it('refuses ids and repositories that are not plain', async () => {
    await expect(prRerunFailed('/repo', 'o/r', '1 --debug')).rejects.toThrow('Not a GitHub Actions run');
    await expect(prRerunFailed('/repo', '../r', '1')).rejects.toThrow('Not a GitHub Actions run');
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('says what went wrong: no write access, no answer, or GitHub refusing', async () => {
    mockRun.mockRejectedValueOnce(exited(1, 'failed to rerun: HTTP 403: Must have admin rights to Repository. (https://api.github.com/repos/o/r/actions/runs/1/rerun-failed-jobs)'));
    await expect(prRerunFailed('/repo', 'o/r', '1')).rejects.toThrow(/^GitHub refused the rerun: HTTP 403: Must have admin rights to Repository\.$/);
    mockRun.mockRejectedValueOnce(Object.assign(new Error('Command timed out'), { stdout: '', stderr: '', timedOut: true }));
    await expect(prRerunFailed('/repo', 'o/r', '1')).rejects.toThrow('The rerun may still have started');
    mockRun.mockRejectedValueOnce(exited(1, 'run 1 cannot be rerun; This workflow is already running'));
    await expect(prRerunFailed('/repo', 'o/r', '1')).rejects.toThrow('run 1 cannot be rerun; This workflow is already running');
  });
});

describe('latestChecks()', () => {
  const job = (name: string, run: string, job: string, conclusion: string, startedAt: string, status = 'COMPLETED') =>
    ({ __typename: 'CheckRun', name, workflowName: 'CI', status, conclusion, startedAt, detailsUrl: `https://github.com/o/r/actions/runs/${run}/job/${job}` });

  it('keeps only the newest attempt of a rerun job, so a passing rerun turns the PR green', () => {
    const rollup = [
      job('test', '1', '10', 'FAILURE', '2026-11-01T10:00:00Z'),
      job('test', '1', '11', 'SUCCESS', '2026-11-01T10:30:00Z'),
    ];
    expect(latestChecks(rollup)).toEqual([rollup[1]]);
    expect(summarizeChecks(rollup)).toEqual({ total: 1, passed: 1, failed: 0, pending: 0 });
    expect(failingCheckNames(rollup)).toEqual([]);
    expect(failingActionsRuns(rollup, 'https://github.com/o/r/pull/1')).toEqual([]);
  });

  it('counts a queued rerun as the newest, though gh gives it no start time', () => {
    const rollup = [
      job('test', '1', '10', 'FAILURE', '2026-11-01T10:00:00Z'),
      job('test', '1', '11', '', '0001-01-01T00:00:00Z', 'QUEUED'),
    ];
    expect(summarizeChecks(rollup)).toEqual({ total: 1, passed: 0, failed: 0, pending: 1 });
  });

  it('keeps the newest run of a workflow started again on the same commit, so a cancelled one goes', () => {
    // Run 1 cancelled when the PR left draft; run 2, on the same commit, passed.
    const rollup = [
      job('test', '1', '10', 'CANCELLED', '2026-11-01T10:00:00Z'),
      job('test', '2', '20', 'SUCCESS', '2026-11-01T10:05:00Z'),
      { ...job('test', '3', '30', 'SUCCESS', '2026-11-01T09:00:00Z'), workflowName: 'Nightly' },
    ];
    expect(summarizeChecks(rollup)).toEqual({ total: 2, passed: 2, failed: 0, pending: 0 });
    expect(failingCheckNames(rollup)).toEqual([]);
  });

  it('keeps other apps\' checks by name, and a newer completed attempt over a stale one', () => {
    const rollup = [
      { name: 'codecov', conclusion: 'FAILURE', startedAt: '2026-11-01T09:00:00Z', detailsUrl: 'https://codecov.io/x' },
      { name: 'codecov', conclusion: 'SUCCESS', startedAt: '2026-11-01T09:30:00Z', detailsUrl: 'https://codecov.io/y' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'STALE', startedAt: '2026-10-01T09:00:00Z' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-11-01T09:00:00Z' },
    ];
    expect(summarizeChecks(rollup)).toEqual({ total: 2, passed: 1, failed: 1, pending: 0 });
    expect(failingCheckNames(rollup)).toEqual(['lint']);
  });

  it('keeps the newest of a status context, in its first place, and rows with nothing to match by', () => {
    const rollup = [
      { context: 'ci/legacy', state: 'ERROR', startedAt: '2026-11-01T08:00:00Z' },
      { conclusion: 'TIMED_OUT' },
      { context: 'ci/legacy', state: 'SUCCESS', startedAt: '2026-11-01T08:10:00Z' },
      { conclusion: 'TIMED_OUT' },
    ];
    expect(latestChecks(rollup)).toEqual([rollup[2], rollup[1], rollup[3]]);
  });
});
