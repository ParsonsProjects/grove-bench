import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { execa } from 'execa';
import { commentableLines, inlineComment, buildReviewBody, parsePrReviewSubmit, submitPrReview } from './pr-review.js';
import { resetGhOfflineCooldownForTests } from './gh.js';
import type { PrReviewLineComment } from '../shared/types.js';

const mockExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
  resetGhOfflineCooldownForTests();
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
  it('maps each side\'s lines to their hunk, context lines on both sides', () => {
    const lines = commentableLines(PATCH);
    expect([...lines.old.entries()]).toEqual([[1, 0], [2, 0], [3, 0], [20, 1], [21, 1]]);
    expect([...lines.new.entries()]).toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [21, 1], [22, 1], [23, 1]]);
  });

  it('has nothing for an empty patch', () => {
    const lines = commentableLines('');
    expect(lines.old.size + lines.new.size).toBe(0);
  });
});

describe('inlineComment()', () => {
  const lines = commentableLines(PATCH);

  it('places a one-line comment on the right side', () => {
    expect(inlineComment(comment(), lines)).toEqual({ path: 'src/a.ts', body: 'Why upper case?', line: 2, side: 'RIGHT' });
  });

  it('places a range inside one hunk, and a base-side line on the left', () => {
    expect(inlineComment(comment({ startLine: 2, endLine: 4 }), lines))
      .toMatchObject({ line: 4, side: 'RIGHT', start_line: 2, start_side: 'RIGHT' });
    expect(inlineComment(comment({ side: 'old', startLine: 2, endLine: 2 }), lines))
      .toMatchObject({ line: 2, side: 'LEFT' });
  });

  it('refuses lines outside the diff, and a range that crosses hunks', () => {
    expect(inlineComment(comment({ startLine: 10, endLine: 10 }), lines)).toBeNull();
    expect(inlineComment(comment({ startLine: 4, endLine: 21 }), lines)).toBeNull();
    // Line 4 only exists on the new side.
    expect(inlineComment(comment({ side: 'old', startLine: 4, endLine: 4 }), lines)).toBeNull();
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
   *  (PATCH) and a binary with no patch, and both merge bases are MB. */
  function fakeTools(opts: { localBlob?: string } = {}) {
    mockExeca.mockImplementation((async (file: string, args: string[]) => {
      const cmd = args.join(' ');
      if (file === 'gh' && cmd.startsWith('pr view 7')) return { stdout: JSON.stringify({ headRefOid: 'HEAD1', baseRefOid: 'BASE1' }) };
      if (file === 'gh' && cmd.includes('/pulls/7/files')) {
        return { stdout: JSON.stringify([{ filename: 'src/a.ts', patch: PATCH }, { filename: 'logo.png' }]) };
      }
      if (file === 'gh' && cmd.includes('/pulls/7/reviews')) return { stdout: JSON.stringify({ html_url: 'https://github.com/o/r/pull/7#pullrequestreview-1' }) };
      if (file === 'git' && cmd === 'rev-parse --verify --quiet HEAD1:src/a.ts') return { stdout: 'blobA\n' };
      if (file === 'git' && cmd === 'hash-object -- src/a.ts') return { stdout: `${opts.localBlob ?? 'blobA'}\n`, exitCode: 0 };
      if (file === 'git' && (cmd === 'merge-base main HEAD' || cmd === 'merge-base BASE1 HEAD1')) return { stdout: 'MB\n' };
      throw Object.assign(new Error(`unexpected: ${file} ${cmd}`), { stderr: 'fatal' });
    }) as never);
  }

  function postedPayload() {
    const calls = mockExeca.mock.calls as unknown as Array<[string, string[], { input?: string }]>;
    const call = calls.find(([file, args]) => file === 'gh' && args.includes('POST'));
    expect(call).toBeDefined();
    expect(call![1]).toEqual(['api', '-X', 'POST', 'repos/{owner}/{repo}/pulls/7/reviews', '--input', '-']);
    return JSON.parse(call![2].input ?? '');
  }

  it('posts comments in the PR diff on their lines and quotes the rest', async () => {
    fakeTools();
    const result = await submitPrReview('/wt', '/repo', {
      prNumber: 7,
      event: 'REQUEST_CHANGES',
      body: 'A few things',
      base: 'main',
      comments: [
        comment(),
        comment({ side: 'old', startLine: 2, endLine: 2, snippet: 'two', body: 'Was this used?' }),
        comment({ startLine: 10, endLine: 10, snippet: 'far away', body: 'Not in the diff' }),
        comment({ filePath: 'logo.png', startLine: 1, endLine: 1, snippet: '', body: 'Binary' }),
      ],
    });

    expect(result).toEqual({ url: 'https://github.com/o/r/pull/7#pullrequestreview-1', inline: 2, quoted: 2 });
    const payload = postedPayload();
    expect(payload.event).toBe('REQUEST_CHANGES');
    expect(payload.commit_id).toBe('HEAD1');
    expect(payload.comments).toEqual([
      { path: 'src/a.ts', body: 'Why upper case?', line: 2, side: 'RIGHT' },
      { path: 'src/a.ts', body: 'Was this used?', line: 2, side: 'LEFT' },
    ]);
    expect(payload.body).toMatch(/^A few things\n\n---\n\nLine comments that couldn't go on their lines:/);
    expect(payload.body).toContain('Not in the diff');
    expect(payload.body).toContain('Binary');
  });

  it('quotes comments on a file that differs from the PR\'s latest push', async () => {
    fakeTools({ localBlob: 'blobLocal' });
    const result = await submitPrReview('/wt', '/repo', { prNumber: 7, event: 'COMMENT', body: 'Notes', base: 'main', comments: [comment()] });
    expect(result).toMatchObject({ inline: 0, quoted: 1 });
    expect(postedPayload().comments).toBeUndefined();
  });

  it('approves without reading the PR when there are no line comments', async () => {
    fakeTools();
    await submitPrReview('/wt', '/repo', { prNumber: 7, event: 'APPROVE', body: '', comments: [] });
    expect(mockExeca).toHaveBeenCalledTimes(1);
    expect(postedPayload()).toEqual({ event: 'APPROVE' });
  });

  it('needs a summary to comment or request changes', async () => {
    fakeTools();
    await expect(submitPrReview('/wt', '/repo', { prNumber: 7, event: 'COMMENT', body: '', comments: [] }))
      .rejects.toThrow('Write a summary to comment or request changes');
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('passes on GitHub\'s reason when it refuses', async () => {
    mockExeca.mockRejectedValue(Object.assign(new Error('Command failed: gh api'), {
      stderr: 'gh: Unprocessable Entity (HTTP 422)',
      stdout: JSON.stringify({ message: 'Unprocessable Entity', errors: ['Can not approve your own pull request'] }),
    }));
    await expect(submitPrReview('/wt', '/repo', { prNumber: 7, event: 'APPROVE', body: '', comments: [] }))
      .rejects.toThrow('Can not approve your own pull request');
  });
});
