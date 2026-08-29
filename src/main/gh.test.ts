import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock execa before importing the gh module
vi.mock('execa', () => ({ execa: vi.fn() }));

import { execa } from 'execa';
import { ghVersion, ghAuthenticated, summarizeChecks, failingCheckNames, commentSignature, prStatus, prCreate, prReviewComments } from './gh.js';

const mockExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ghVersion()', () => {
  it('parses the version from gh --version output', async () => {
    mockExeca.mockResolvedValue({ stdout: 'gh version 2.40.1 (2023-12-13)\nhttps://github.com/cli/cli/releases/tag/v2.40.1' } as any);
    expect(await ghVersion()).toBe('2.40.1');
    expect(mockExeca).toHaveBeenCalledWith('gh', ['--version'], {});
  });

  it('returns null when gh is not installed', async () => {
    mockExeca.mockRejectedValue(new Error('not found'));
    expect(await ghVersion()).toBeNull();
  });
});

describe('ghAuthenticated()', () => {
  it('returns true when gh auth status exits cleanly', async () => {
    mockExeca.mockResolvedValue({ stdout: '' } as any);
    expect(await ghAuthenticated()).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('gh', ['auth', 'status'], {});
  });

  it('returns false when gh auth status fails', async () => {
    mockExeca.mockRejectedValue(new Error('not logged in'));
    expect(await ghAuthenticated()).toBe(false);
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
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({
        number: 42,
        url: 'https://github.com/o/r/pull/42',
        state: 'OPEN',
        isDraft: false,
        title: 'Add feature',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [{ conclusion: 'SUCCESS' }],
      }),
    } as any);

    const result = await prStatus('/repo', 'feat/x');
    expect(mockExeca).toHaveBeenCalledWith(
      'gh',
      ['pr', 'view', 'feat/x', '--json', 'number,url,state,isDraft,title,reviewDecision,statusCheckRollup,headRefOid,comments,reviews'],
      { cwd: '/repo' },
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
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({
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
      }),
    } as any);

    const result = await prStatus('/repo', 'feat/x');
    expect(result?.headSha).toBe('abc123');
    expect(result?.failingChecks).toEqual(['test']);
    expect(result?.commentSignature).toEqual(['c:C1', 'r:R1']);
  });

  it('returns null when no PR exists for the branch', async () => {
    mockExeca.mockRejectedValue(new Error('no pull requests found'));
    expect(await prStatus('/repo', 'feat/x')).toBeNull();
  });

  it('returns null on malformed output', async () => {
    mockExeca.mockResolvedValue({ stdout: 'not json' } as any);
    expect(await prStatus('/repo', 'feat/x')).toBeNull();
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

describe('prReviewComments()', () => {
  it('merges review bodies and inline comments', async () => {
    mockExeca
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          { id: 9, body: 'Rename this variable', path: 'src/a.ts', line: 12, user: { login: 'bob' }, author_association: 'COLLABORATOR' },
          { id: 10, body: '', path: 'src/b.ts' },
        ]),
      } as any) // pulls/N/comments
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          { id: 5, body: 'Looks mostly good, two nits', state: 'CHANGES_REQUESTED', user: { login: 'alice' }, author_association: 'MEMBER' },
          { id: 6, body: 'wip', state: 'PENDING', user: { login: 'carol' } },
        ]),
      } as any); // pulls/N/reviews

    const result = await prReviewComments('/repo', 42);
    expect(mockExeca).toHaveBeenCalledWith('gh', ['api', 'repos/{owner}/{repo}/pulls/42/comments?per_page=100'], { cwd: '/repo' });
    expect(result).toEqual([
      { id: 'review-5', author: 'alice', authorAssociation: 'MEMBER', body: 'Looks mostly good, two nits' },
      { id: 'comment-9', author: 'bob', authorAssociation: 'COLLABORATOR', path: 'src/a.ts', line: 12, body: 'Rename this variable' },
    ]);
  });

  it('returns empty when both api calls fail', async () => {
    mockExeca.mockRejectedValue(new Error('gh api failed'));
    expect(await prReviewComments('/repo', 42)).toEqual([]);
  });
});

describe('prCreate()', () => {
  it('creates the PR then returns its status', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: 'https://github.com/o/r/pull/7' } as any) // pr create
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', isDraft: true }),
      } as any); // pr view

    const result = await prCreate('/repo', 'feat/x', { title: 'T', body: 'B', base: 'main', draft: true });
    expect(mockExeca).toHaveBeenNthCalledWith(
      1,
      'gh',
      ['pr', 'create', '--head', 'feat/x', '--title', 'T', '--body', 'B', '--base', 'main', '--draft'],
      { cwd: '/repo' },
    );
    expect(result.number).toBe(7);
    expect(result.isDraft).toBe(true);
  });

  it('omits --base and --draft when not requested', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: '' } as any)
      .mockResolvedValueOnce({ stdout: JSON.stringify({ number: 8, url: 'u' }) } as any);

    await prCreate('/repo', 'feat/x', { title: 'T', body: '', base: '' });
    expect(mockExeca).toHaveBeenNthCalledWith(
      1,
      'gh',
      ['pr', 'create', '--head', 'feat/x', '--title', 'T', '--body', ''],
      { cwd: '/repo' },
    );
  });

  it('surfaces gh stderr on failure', async () => {
    mockExeca.mockRejectedValue(Object.assign(new Error('Command failed: gh pr create ...'), {
      stderr: 'a pull request for branch "feat/x" already exists',
    }));
    await expect(prCreate('/repo', 'feat/x', { title: 'T', body: '', base: 'main' }))
      .rejects.toThrow('a pull request for branch "feat/x" already exists');
  });

  it('throws when the created PR cannot be read back', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: '' } as any)
      .mockRejectedValueOnce(new Error('boom'));
    await expect(prCreate('/repo', 'feat/x', { title: 'T', body: '', base: 'main' }))
      .rejects.toThrow(/could not be read back/);
  });
});
