import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./git.js', () => ({
  git: vi.fn(),
  gitPatch: vi.fn(),
}));

import { git, gitPatch } from './git.js';
import {
  buildCommitPrompt,
  cleanCommitMessage,
  fitDiff,
  generateCommitMessage,
  COMMIT_MESSAGE_SYSTEM_PROMPT,
} from './commit-message.js';
import type { AgentAdapter } from './adapters/types.js';

const mockGit = vi.mocked(git);
const mockGitPatch = vi.mocked(gitPatch);

function makeAdapter(generateText?: (sys: string, user: string, opts?: any) => Promise<string>): AgentAdapter {
  return {
    id: 'test',
    displayName: 'Test Agent',
    authErrorMessage: 'auth',
    capabilities: {} as any,
    getModels: () => [],
    checkPrerequisites: async () => ({ available: true }),
    start: async () => { throw new Error('not needed'); },
    ...(generateText ? { generateText } : {}),
  } as unknown as AgentAdapter;
}

beforeEach(() => {
  // Resets queued answers too, which clearAllMocks would keep for the next test.
  vi.resetAllMocks();
});

describe('cleanCommitMessage()', () => {
  it('passes a clean message through', () => {
    expect(cleanCommitMessage('feat: add thing\n\nBody line')).toBe('feat: add thing\n\nBody line');
  });

  it('strips markdown fences', () => {
    expect(cleanCommitMessage('```\nfeat: add thing\n```')).toBe('feat: add thing');
    expect(cleanCommitMessage('```text\nfeat: add thing\n\nBody\n```')).toBe('feat: add thing\n\nBody');
  });

  it('strips a "Commit message:" label', () => {
    expect(cleanCommitMessage('Commit message:\nfeat: add thing')).toBe('feat: add thing');
  });

  it('unquotes a fully quoted single line', () => {
    expect(cleanCommitMessage('"feat: add thing"')).toBe('feat: add thing');
  });
});

describe('buildCommitPrompt()', () => {
  const shown = (diff: string, left: string[] = []) => ({ diff, left });

  it('includes recent subjects, stat, and diff', () => {
    const prompt = buildCommitPrompt('1 file changed', shown('diff --git a/x b/x'), ['feat: one', 'fix: two']);
    expect(prompt).toContain('- feat: one');
    expect(prompt).toContain('1 file changed');
    expect(prompt).toContain('diff --git a/x b/x');
  });

  it('omits the subjects section when there are none', () => {
    const prompt = buildCommitPrompt('stat', shown('diff'), []);
    expect(prompt).not.toContain('Recent commit subjects');
  });

  it('names the files left out of the diff, up to 20', () => {
    const left = Array.from({ length: 25 }, (_, i) => `gen/${i}.json`);
    const prompt = buildCommitPrompt('stat summary', shown('diff', left), []);
    expect(prompt).toContain('Left out of the diff below to keep it short: gen/0.json, gen/1.json');
    expect(prompt).toContain('gen/19.json and 5 more');
    expect(prompt).not.toContain('gen/20.json');
    expect(prompt).toContain('stat summary');
    expect(buildCommitPrompt('stat', shown('diff'), [])).not.toContain('Left out');
  });

  it('says to go by the summary when the diff was too large to read', () => {
    const prompt = buildCommitPrompt('stat summary', { diff: '', left: [], overLimit: true }, []);
    expect(prompt).toContain('too large to include, so describe the change from the summary above');
    expect(prompt).not.toContain('Staged diff:');
  });
});

describe('fitDiff()', () => {
  const file = (name: string, body: string) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${body}\n`;

  it('gives a diff that fits as it is', () => {
    const patch = file('a.ts', '+x');
    expect(fitDiff(patch)).toEqual({ diff: patch, left: [] });
  });

  it('keeps short files whole and cuts a file with long lines, wherever it sorts', () => {
    const minified = file('dist/app.min.js', `+${'x'.repeat(200_000)}`);
    const a = file('src/a.ts', Array.from({ length: 30 }, (_, i) => `+line ${i}`).join('\n'));
    const c = file('src/c.ts', '+c');
    const { diff, left } = fitDiff(minified + a + c);
    expect(left).toEqual([]);
    expect(diff).toContain(a);
    expect(diff).toContain(c);
    expect(diff).toContain('... (cut short)');
    // Git's order: the cut file stays first.
    expect(diff.indexOf('dist/app.min.js')).toBeLessThan(diff.indexOf('src/a.ts'));
    expect(diff.length).toBeLessThanOrEqual(40_000);
  });

  it('shows how a change that is one large file starts', () => {
    const big = file('src/big.ts', Array.from({ length: 2000 }, (_, i) => `+export const v${i} = ${i};`).join('\n'));
    const { diff, left } = fitDiff(big);
    expect(left).toEqual([]);
    expect(diff.startsWith(big.slice(0, 1000))).toBe(true);
    expect(diff.endsWith('... (cut short)\n')).toBe(true);
    expect(diff.length).toBeLessThanOrEqual(40_000);
  });

  it('leaves out, by name, what has no room left', () => {
    const sized = (name: string, n: number) => file(name, `+${'x'.repeat(n)}`);
    const { diff, left } = fitDiff(sized('a.ts', 1000) + sized('b.ts', 3500) + sized('c.ts', 10_000) + sized('d.ts', 20_000), 5000);
    expect(diff).toContain('+++ b/a.ts');
    expect(diff).toContain('+++ b/b.ts');
    // Under 2,000 characters left: too little to show part of c.ts.
    expect(left).toEqual(['c.ts', 'd.ts']);
  });

  it('names a renamed file by both its paths', () => {
    const renamed = 'diff --git a/src/my old.ts b/lib/my new.ts\nsimilarity index 90%\nrename from src/my old.ts\nrename to lib/my new.ts\n' + `+${'x'.repeat(50_000)}\n`;
    const { left } = fitDiff(file('a.ts', '+x') + renamed, 1000);
    expect(left).toEqual(['src/my old.ts → lib/my new.ts']);
  });

  it("splits files only at a line's start, not after a lone carriage return", () => {
    // A CR-ended line holding "diff --git": split there, its tail would be a file of its own.
    const crEnded = file('a.ts', `+foo\rdiff --git a/fake b/fake\n+${'z'.repeat(3000)}`);
    const { diff, left } = fitDiff(crEnded + file('b.ts', '+b'), 1000);
    expect(left).toEqual(['a.ts']);
    expect(diff).toBe(file('b.ts', '+b'));
  });
});

describe('generateCommitMessage()', () => {
  const PLAIN = ['diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames', '--src-prefix=a/', '--dst-prefix=b/'];

  it("asks for the agent's background model", async () => {
    mockGit.mockResolvedValueOnce(' x | 1 +').mockResolvedValueOnce('');
    mockGitPatch.mockResolvedValueOnce('diff --git a/x b/x\n+new line');
    const generateText = vi.fn(async () => 'feat: x');
    const adapter = { ...makeAdapter(generateText), backgroundModel: 'cheap-model' } as AgentAdapter;

    await generateCommitMessage('/wt', adapter);

    expect(generateText).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ model: 'cheap-model' }));
  });

  it('feeds the staged diff to the adapter and cleans the result', async () => {
    mockGit
      .mockResolvedValueOnce(' x | 1 +\n 1 file changed')      // diff --cached --stat
      .mockResolvedValueOnce('feat: earlier\nfix: older');     // log -10
    mockGitPatch.mockResolvedValueOnce('diff --git a/x b/x\n+new line');
    const generateText = vi.fn().mockResolvedValue('```\nfeat: add new line\n```');

    const result = await generateCommitMessage('/wt', makeAdapter(generateText));

    expect(result).toBe('feat: add new line');
    expect(mockGit).toHaveBeenNthCalledWith(1, ['diff', '--cached', '--no-color', '--stat', '--stat-count=500'], '/wt');
    // Read once, with git stopped past gitPatch's limit, as plain as git can give it.
    expect(mockGitPatch).toHaveBeenCalledWith(PLAIN, '/wt');
    const [sys, user, opts] = generateText.mock.calls[0];
    expect(sys).toBe(COMMIT_MESSAGE_SYSTEM_PROMPT);
    expect(user).toContain('+new line');
    expect(user).toContain('- feat: earlier');
    expect(user).not.toContain('Left out');
    expect(opts.cwd).toBe('/wt');
    expect(opts.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('reads a diff over the limit again without the files with the most changed lines', async () => {
    mockGit
      .mockResolvedValueOnce(' app/x.ts | 22 ++-\n package-lock.json | 30000 +++') // --stat
      .mockResolvedValueOnce('') // log
      .mockResolvedValueOnce('30000\t0\tpackage-lock.json\x0020\t2\tapp/x.ts\x00'); // --numstat -z
    mockGitPatch.mockResolvedValueOnce(null).mockResolvedValueOnce('diff --git a/app/x.ts b/app/x.ts\n+fix\n');
    const generateText = vi.fn().mockResolvedValue('fix: x');

    await generateCommitMessage('/wt', makeAdapter(generateText));

    expect(mockGitPatch).toHaveBeenLastCalledWith([...PLAIN, '--', ':(top,exclude,literal)package-lock.json'], '/wt');
    const user = generateText.mock.calls[0][1];
    expect(user).toContain('+fix');
    expect(user).toContain('Left out of the diff below to keep it short: package-lock.json');
  });

  it('goes by the summary when the staged diff is too large to read', async () => {
    mockGit
      .mockResolvedValueOnce(' huge.bin | Bin')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('-\t-\thuge.bin\x00');
    mockGitPatch.mockResolvedValueOnce(null);
    const generateText = vi.fn().mockResolvedValue('chore: add data');
    expect(await generateCommitMessage('/wt', makeAdapter(generateText))).toBe('chore: add data');
    expect(generateText.mock.calls[0][1]).toContain('describe the change from the summary above');
  });

  it('rejects when nothing is staged', async () => {
    mockGit.mockResolvedValueOnce('  ').mockResolvedValueOnce('');
    mockGitPatch.mockResolvedValueOnce('');
    await expect(generateCommitMessage('/wt', makeAdapter(vi.fn())))
      .rejects.toThrow('No staged changes');
  });

  it('rejects when the adapter lacks generateText', async () => {
    await expect(generateCommitMessage('/wt', makeAdapter()))
      .rejects.toThrow('does not support text generation');
  });

  it('tolerates a repo with no commit history', async () => {
    mockGit
      .mockResolvedValueOnce('stat')
      .mockRejectedValueOnce(new Error('no HEAD'));
    mockGitPatch.mockResolvedValueOnce('diff content');
    const generateText = vi.fn().mockResolvedValue('Initial commit');
    expect(await generateCommitMessage('/wt', makeAdapter(generateText))).toBe('Initial commit');
    expect(generateText.mock.calls[0][1]).not.toContain('Recent commit subjects');
  });

  it('rejects when the agent returns an empty message', async () => {
    mockGit
      .mockResolvedValueOnce('stat')
      .mockResolvedValueOnce('');
    mockGitPatch.mockResolvedValueOnce('diff content');
    const generateText = vi.fn().mockResolvedValue('```\n\n```');
    await expect(generateCommitMessage('/wt', makeAdapter(generateText)))
      .rejects.toThrow('empty commit message');
  });
});
