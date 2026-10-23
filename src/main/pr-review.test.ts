import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// git runs through execa here (the git host isn't started in tests); gh
// runs in the agent host (runInAgentHost).
vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('./process-host-run.js', () => ({ runInAgentHost: vi.fn() }));

import { execa } from 'execa';
import { runInAgentHost } from './process-host-run.js';
import { commentableLines, inlineComment, buildReviewBody, parsePrReviewSubmit, submitPrReview } from './pr-review.js';
import { resetGhOfflineCooldownForTests } from './gh.js';
import type { PrReviewLineComment } from '../shared/types.js';

const mockExeca = vi.mocked(execa);
const mockGh = vi.mocked(runInAgentHost);

beforeEach(() => {
  vi.clearAllMocks();
  mockExeca.mockReset();
  mockGh.mockReset();
  resetGhOfflineCooldownForTests();
});

afterEach(() => {
  // gh never goes to the git host, nor git to the agent host.
  expect(mockExeca.mock.calls.filter(([file]) => file === 'gh')).toEqual([]);
  expect(mockGh.mock.calls.filter(([file]) => file !== 'gh')).toEqual([]);
});

// Old side: 1 one, 2 two, 3 four. New side: 1 one, 2 TWO, 3 three, 4 four.
// A second hunk further down: old 20-21, new 21-23.
const PATCH = [
  '@@ -1,3 +1,4 @@',
  ' one',
  '-two',
  '+TWO',
  '+three',
  ' four',
  '@@ -20,2 +21,3 @@ function x() {',
  ' twenty',
  '+added',
  ' twenty-one',
  '\\ No newline at end of file',
].join('\n');

function comment(over: Partial<PrReviewLineComment> = {}): PrReviewLineComment {
  return { filePath: 'src/a.ts', side: 'new', startLine: 2, endLine: 2, snippet: 'TWO', body: 'Why upper case?', ...over };
}

describe('commentableLines()', () => {
  it('maps each side\'s lines to their hunk and text, context lines on both sides', () => {
    const lines = commentableLines(PATCH);
    expect([...lines.old.entries()].map(([n, l]) => [n, l.hunk, l.text])).toEqual([
      [1, 0, 'one'], [2, 0, 'two'], [3, 0, 'four'], [20, 1, 'twenty'], [21, 1, 'twenty-one'],
    ]);
    expect([...lines.new.entries()].map(([n, l]) => [n, l.hunk, l.text])).toEqual([
      [1, 0, 'one'], [2, 0, 'TWO'], [3, 0, 'three'], [4, 0, 'four'], [21, 1, 'twenty'], [22, 1, 'added'], [23, 1, 'twenty-one'],
    ]);
  });

  it('has nothing for an empty patch, and reads CRLF lines without the carriage return', () => {
    const lines = commentableLines('');
    expect(lines.old.size + lines.new.size).toBe(0);
    expect(commentableLines('@@ -1 +1 @@\r\n-a\r\n+b\r\n').new.get(1)?.text).toBe('b');
  });
});

describe('inlineComment()', () => {
  const lines = commentableLines(PATCH);

  it('places a one-line comment on the right side', () => {
    expect(inlineComment(comment(), lines)).toEqual({ path: 'src/a.ts', body: 'Why upper case?', line: 2, side: 'RIGHT' });
  });

  it('places a range inside one hunk, and a base-side line on the left', () => {
    expect(inlineComment(comment({ startLine: 2, endLine: 4, snippet: 'TWO\nthree\nfour' }), lines))
      .toMatchObject({ line: 4, side: 'RIGHT', start_line: 2, start_side: 'RIGHT' });
    expect(inlineComment(comment({ side: 'old', snippet: 'two' }), lines))
      .toMatchObject({ line: 2, side: 'LEFT' });
  });

  it('refuses lines outside the diff, and a range that crosses hunks', () => {
    expect(inlineComment(comment({ startLine: 10, endLine: 10 }), lines)).toBeNull();
    expect(inlineComment(comment({ startLine: 4, endLine: 21, snippet: 'four' }), lines)).toBeNull();
    // Line 4 only exists on the new side.
    expect(inlineComment(comment({ side: 'old', startLine: 4, endLine: 4, snippet: 'four' }), lines)).toBeNull();
  });

  it('refuses lines that read differently than when the comment was written', () => {
    // Written on line 2 before the code moved down: line 2 is now other code.
    expect(inlineComment(comment({ snippet: 'const x = 1;' }), lines)).toBeNull();
    // A snippet missing lines of its range (some were hidden) can't be checked.
    expect(inlineComment(comment({ startLine: 2, endLine: 3, snippet: 'TWO' }), lines)).toBeNull();
  });
});

describe('buildReviewBody()', () => {
  it('is the summary alone when every comment went on its line', () => {
    expect(buildReviewBody('  Looks good  ', [])).toBe('Looks good');
  });

  it('quotes the comments that could not be placed, with their lines', () => {
    const body = buildReviewBody('Summary', [
      comment({ startLine: 40, endLine: 42, snippet: 'a\nb\nc', body: 'Split this up' }),
      comment({ side: 'old', startLine: 3, endLine: 3, snippet: 'four', body: 'Keep this' }),
    ]);
    expect(body).toContain('Summary\n\n---\n\n');
    expect(body).toContain('**`src/a.ts` lines 40-42**\n\n```\na\nb\nc\n```\n\nSplit this up');
    expect(body).toContain('**`src/a.ts` line 3 (before the change)**');
  });

  it('fences code with backticks in it so the code cannot close the fence', () => {
    const body = buildReviewBody('', [comment({ snippet: 'const s = ```x```;' })]);
    expect(body).toContain('````\nconst s = ```x```;\n````');
  });
});

describe('parsePrReviewSubmit()', () => {
  const valid = { prNumber: 7, event: 'APPROVE', body: '', comments: [comment()] };

  it('accepts a well-formed review', () => {
    expect(parsePrReviewSubmit(valid)).toMatchObject({ prNumber: 7, event: 'APPROVE' });
  });

  it('rejects an unknown event, paths outside the checkout, and empty comments', () => {
    expect(() => parsePrReviewSubmit({ ...valid, event: 'MERGE' })).toThrow(/Invalid review/);
    expect(() => parsePrReviewSubmit({ ...valid, comments: [comment({ filePath: '../secret' })] })).toThrow(/Invalid review/);
    expect(() => parsePrReviewSubmit({ ...valid, comments: [comment({ filePath: 'C:\\x.ts' })] })).toThrow(/Invalid review/);
    expect(() => parsePrReviewSubmit({ ...valid, comments: [comment({ body: '  ' })] })).toThrow(/Invalid review/);
  });
});

describe('submitPrReview()', () => {
  /** A fake gh and git: the PR's head is HEAD1, its files are src/a.ts
   *  (PATCH) and a binary with no patch, and the checkout is at `localHead`. */
  function fakeTools(opts: { localHead?: string } = {}) {
    const fake = (async (file: string, args: string[]) => {
      const cmd = args.join(' ');
      if (file === 'gh' && cmd === 'pr view 7 --json headRefOid') return { stdout: JSON.stringify({ headRefOid: 'HEAD1aaaaaaa' }) };
      if (file === 'gh' && cmd.includes('/pulls/7/files')) {
        return { stdout: JSON.stringify([{ filename: 'src/a.ts', patch: PATCH }, { filename: 'logo.png' }]) };
      }
      if (file === 'gh' && cmd.includes('/pulls/7/reviews')) return { stdout: JSON.stringify({ html_url: 'https://github.com/o/r/pull/7#pullrequestreview-1' }) };
      if (file === 'git' && cmd === 'rev-parse HEAD') return { stdout: `${opts.localHead ?? 'HEAD1aaaaaaa'}\n` };
      throw Object.assign(new Error(`unexpected: ${file} ${cmd}`), { stderr: 'fatal' });
    }) as never;
    mockGh.mockImplementation(fake);
    mockExeca.mockImplementation(fake);
  }

  function postedPayload() {
    const calls = mockGh.mock.calls as unknown as Array<[string, string[], { input?: string }]>;
    const call = calls.find(([file, args]) => file === 'gh' && args.includes('POST'));
    expect(call).toBeDefined();
    expect(call![1]).toEqual(['api', '-X', 'POST', 'repos/{owner}/{repo}/pulls/7/reviews', '--input', '-']);
    // A post may have reached GitHub, so it never runs twice.
    expect(call![2]).not.toHaveProperty('idempotent');
    return JSON.parse(call![2].input ?? '');
  }

  it('posts comments on lines that still read the same in the PR, and quotes the rest', async () => {
    fakeTools();
    const result = await submitPrReview('/wt', '/repo', {
      prNumber: 7,
      event: 'REQUEST_CHANGES',
      body: 'A few things',
      comments: [
        comment(),
        comment({ side: 'old', snippet: 'two', body: 'Was this used?' }),
        comment({ startLine: 10, endLine: 10, snippet: 'far away', body: 'Not in the diff' }),
        comment({ snippet: 'moved since', body: 'Lines moved' }),
        comment({ filePath: 'logo.png', startLine: 1, endLine: 1, snippet: '', body: 'Binary' }),
      ],
    });

    expect(result).toEqual({ url: 'https://github.com/o/r/pull/7#pullrequestreview-1', inline: 2, quoted: 3 });
    const payload = postedPayload();
    expect(payload.event).toBe('REQUEST_CHANGES');
    expect(payload.commit_id).toBe('HEAD1aaaaaaa');
    expect(payload.comments).toEqual([
      { path: 'src/a.ts', body: 'Why upper case?', line: 2, side: 'RIGHT' },
      { path: 'src/a.ts', body: 'Was this used?', line: 2, side: 'LEFT' },
    ]);
    expect(payload.body).toMatch(/^A few things\n\n---\n\nLine comments that couldn't go on their lines:/);
    for (const text of ['Not in the diff', 'Lines moved', 'Binary']) expect(payload.body).toContain(text);
    // Nothing local is read unless approving.
    expect(mockExeca.mock.calls.some(([file]) => file === 'git')).toBe(false);
  });

  it('approves when the checkout is at the PR\'s head, pinned to that commit', async () => {
    fakeTools();
    await submitPrReview('/wt', '/repo', { prNumber: 7, event: 'APPROVE', body: '', comments: [] });
    expect(postedPayload()).toEqual({ event: 'APPROVE', commit_id: 'HEAD1aaaaaaa' });
    expect(mockGh.mock.calls.some(([file, args]) => file === 'gh' && (args as string[]).some((a) => a.includes('/files')))).toBe(false);
  });

  it('refuses to approve a head the checkout doesn\'t have', async () => {
    fakeTools({ localHead: 'LOCAL2bbbbbb' });
    await expect(submitPrReview('/wt', '/repo', { prNumber: 7, event: 'APPROVE', body: '', comments: [] }))
      .rejects.toThrow('This checkout is at LOCAL2b but PR #7 is at HEAD1aa');
    expect(mockGh.mock.calls.some(([file, args]) => file === 'gh' && (args as string[]).includes('POST'))).toBe(false);
  });

  it('needs a summary to comment or request changes', async () => {
    fakeTools();
    await expect(submitPrReview('/wt', '/repo', { prNumber: 7, event: 'COMMENT', body: ' ', comments: [comment()] }))
      .rejects.toThrow('Write a summary to comment or request changes');
    expect(mockExeca).not.toHaveBeenCalled();
    expect(mockGh).not.toHaveBeenCalled();
  });

  it('passes on GitHub\'s reason when it refuses', async () => {
    fakeTools();
    const refuse = Object.assign(new Error('Command failed: gh api'), {
      stderr: 'gh: Unprocessable Entity (HTTP 422)',
      stdout: JSON.stringify({ message: 'Unprocessable Entity', errors: ['Can not approve your own pull request'] }),
    });
    const fake = mockGh.getMockImplementation() as unknown as (...a: unknown[]) => Promise<unknown>;
    mockGh.mockImplementation(((file: string, args: string[], o: unknown) =>
      args.includes('POST') ? Promise.reject(refuse) : fake(file, args, o)) as never);
    await expect(submitPrReview('/wt', '/repo', { prNumber: 7, event: 'APPROVE', body: '', comments: [] }))
      .rejects.toThrow('Can not approve your own pull request');
  });

  it('says a timed-out post may have gone through, so it isn\'t posted twice', async () => {
    fakeTools();
    const fake = mockGh.getMockImplementation() as unknown as (...a: unknown[]) => Promise<unknown>;
    mockGh.mockImplementation(((file: string, args: string[], o: unknown) =>
      args.includes('POST')
        ? Promise.reject(Object.assign(new Error('Command timed out'), { timedOut: true }))
        : fake(file, args, o)) as never);
    await expect(submitPrReview('/wt', '/repo', { prNumber: 7, event: 'COMMENT', body: 'Notes', comments: [] }))
      .rejects.toThrow(/may still have been posted/);
  });

  it('says which PR it could not read', async () => {
    mockGh.mockRejectedValue(Object.assign(new Error('Command failed'), { stderr: 'no pull requests found' }));
    await expect(submitPrReview('/wt', '/repo', { prNumber: 7, event: 'COMMENT', body: 'Notes', comments: [] }))
      .rejects.toThrow('Could not read PR #7: no pull requests found');
  });
});
