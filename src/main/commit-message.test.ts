import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./git.js', () => ({
  git: vi.fn(),
  gitPatch: vi.fn(),
}));

import { git, gitPatch } from './git.js';
import {
  buildCommitPrompt,
  cleanCommitMessage,
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
  vi.clearAllMocks();
  // clearAllMocks keeps queued answers a test didn't use.
  mockGit.mockReset();
  mockGitPatch.mockReset();
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
  it('includes recent subjects, stat, and diff', () => {
    const prompt = buildCommitPrompt('1 file changed', 'diff --git a/x b/x', ['feat: one', 'fix: two']);
    expect(prompt).toContain('- feat: one');
    expect(prompt).toContain('1 file changed');
    expect(prompt).toContain('diff --git a/x b/x');
  });

  it('omits the subjects section when there are none', () => {
    const prompt = buildCommitPrompt('stat', 'diff', []);
    expect(prompt).not.toContain('Recent commit subjects');
  });

  it('names the files left out of the diff, up to 20', () => {
    const left = Array.from({ length: 25 }, (_, i) => `gen/${i}.json`);
    const prompt = buildCommitPrompt('stat summary', 'diff', [], left);
    expect(prompt).toContain('Left out of the diff below, too large to include');
    expect(prompt).toContain('gen/19.json and 5 more');
    expect(prompt).not.toContain('gen/20.json');
    expect(prompt).toContain('stat summary');
    expect(buildCommitPrompt('stat', 'diff', [])).not.toContain('Left out');
  });
});

describe('generateCommitMessage()', () => {
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
    // Git is stopped at the prompt's limit, rather than read whole.
    expect(mockGitPatch).toHaveBeenCalledWith(['diff', '--cached'], '/wt', 40_000);
    const [sys, user, opts] = generateText.mock.calls[0];
    expect(sys).toBe(COMMIT_MESSAGE_SYSTEM_PROMPT);
    expect(user).toContain('+new line');
    expect(user).toContain('- feat: earlier');
    expect(user).not.toContain('Left out');
    expect(opts.cwd).toBe('/wt');
    expect(opts.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('leaves out a file too large for the prompt and names it, rather than letting it fill the prompt', async () => {
    mockGit
      .mockResolvedValueOnce(' package-lock.json | 12000 +\n src/a.ts | 4 +-') // --stat
      .mockResolvedValueOnce('12000\t0\tpackage-lock.json\x003\t1\tsrc/a.ts\x00') // --numstat -z
      .mockResolvedValueOnce(''); // log
    mockGitPatch
      .mockResolvedValueOnce(null) // the whole diff, over the limit
      // Its 12,000 lines could, at two characters each, still fit; at a lockfile's length they don't.
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('diff --git a/src/a.ts b/src/a.ts\n+fix');
    const generateText = vi.fn().mockResolvedValue('fix: a');

    await generateCommitMessage('/wt', makeAdapter(generateText));

    expect(mockGitPatch).toHaveBeenLastCalledWith(['diff', '--cached', '--no-renames', '--', ':(literal)src/a.ts'], '/wt', 40_000);
    const user = generateText.mock.calls[0][1];
    expect(user).toContain('+fix');
    expect(user).toContain('too large to include (the summary above counts their lines): package-lock.json');
  });

  it('searches for the most files whose diff fits', async () => {
    const numstat = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((f) => `1\t1\t${f}\x00`).join('');
    mockGit.mockResolvedValueOnce('stat').mockResolvedValueOnce(numstat).mockResolvedValueOnce('');
    mockGitPatch
      .mockResolvedValueOnce(null) // whole
      .mockResolvedValueOnce(null) // all four
      .mockResolvedValueOnce('diff of a and b') // two
      .mockResolvedValueOnce(null); // three
    const generateText = vi.fn().mockResolvedValue('feat: a and b');

    await generateCommitMessage('/wt', makeAdapter(generateText));

    const tried = mockGitPatch.mock.calls.slice(1).map(([args]) => args.slice(4));
    expect(tried).toEqual([
      [':(literal)a.ts', ':(literal)b.ts', ':(literal)c.ts', ':(literal)d.ts'],
      [':(literal)a.ts', ':(literal)b.ts'],
      [':(literal)a.ts', ':(literal)b.ts', ':(literal)c.ts'],
    ]);
    const user = generateText.mock.calls[0][1];
    expect(user).toContain('diff of a and b');
    expect(user).toContain('too large to include (the summary above counts their lines): c.ts, d.ts');
  });

  it('names at most 200 files on one git command line', async () => {
    const numstat = Array.from({ length: 250 }, (_, i) => `1\t0\tf${i}.ts\x00`).join('');
    mockGit.mockResolvedValueOnce('stat').mockResolvedValueOnce(numstat).mockResolvedValueOnce('');
    mockGitPatch.mockResolvedValueOnce(null).mockResolvedValueOnce('diff of 200');
    await generateCommitMessage('/wt', makeAdapter(vi.fn().mockResolvedValue('chore: many')));
    expect(mockGitPatch.mock.calls[1][0].slice(4)).toHaveLength(200);
  });

  it('rejects when nothing is staged', async () => {
    mockGit.mockResolvedValueOnce('  ');
    await expect(generateCommitMessage('/wt', makeAdapter(vi.fn())))
      .rejects.toThrow('No staged changes');
    expect(mockGitPatch).not.toHaveBeenCalled();
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
