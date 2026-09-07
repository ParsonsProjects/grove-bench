import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./git.js', () => ({
  git: vi.fn(),
}));

import { git } from './git.js';
import {
  buildCommitPrompt,
  cleanCommitMessage,
  generateCommitMessage,
  COMMIT_MESSAGE_SYSTEM_PROMPT,
} from './commit-message.js';
import type { AgentAdapter } from './adapters/types.js';

const mockGit = vi.mocked(git);

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

  it('truncates an oversized diff but keeps the stat', () => {
    const bigDiff = 'x'.repeat(50_000);
    const prompt = buildCommitPrompt('stat summary', bigDiff, []);
    expect(prompt).toContain('(diff truncated)');
    expect(prompt).toContain('stat summary');
    expect(prompt.length).toBeLessThan(45_000);
  });
});

describe('generateCommitMessage()', () => {
  it('feeds the staged diff to the adapter and cleans the result', async () => {
    mockGit
      .mockResolvedValueOnce('diff --git a/x b/x\n+new line')  // diff --cached
      .mockResolvedValueOnce(' x | 1 +\n 1 file changed')      // diff --cached --stat
      .mockResolvedValueOnce('feat: earlier\nfix: older');     // log -10
    const generateText = vi.fn().mockResolvedValue('```\nfeat: add new line\n```');

    const result = await generateCommitMessage('/wt', makeAdapter(generateText));

    expect(result).toBe('feat: add new line');
    expect(mockGit).toHaveBeenNthCalledWith(1, ['diff', '--cached'], '/wt');
    const [sys, user, opts] = generateText.mock.calls[0];
    expect(sys).toBe(COMMIT_MESSAGE_SYSTEM_PROMPT);
    expect(user).toContain('+new line');
    expect(user).toContain('- feat: earlier');
    expect(opts.cwd).toBe('/wt');
    expect(opts.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('rejects when nothing is staged', async () => {
    mockGit.mockResolvedValueOnce('  ');
    await expect(generateCommitMessage('/wt', makeAdapter(vi.fn())))
      .rejects.toThrow('No staged changes');
  });

  it('rejects when the adapter lacks generateText', async () => {
    await expect(generateCommitMessage('/wt', makeAdapter()))
      .rejects.toThrow('does not support text generation');
  });

  it('tolerates a repo with no commit history', async () => {
    mockGit
      .mockResolvedValueOnce('diff content')
      .mockResolvedValueOnce('stat')
      .mockRejectedValueOnce(new Error('no HEAD'));
    const generateText = vi.fn().mockResolvedValue('Initial commit');
    expect(await generateCommitMessage('/wt', makeAdapter(generateText))).toBe('Initial commit');
    expect(generateText.mock.calls[0][1]).not.toContain('Recent commit subjects');
  });

  it('rejects when the agent returns an empty message', async () => {
    mockGit
      .mockResolvedValueOnce('diff content')
      .mockResolvedValueOnce('stat')
      .mockResolvedValueOnce('');
    const generateText = vi.fn().mockResolvedValue('```\n\n```');
    await expect(generateCommitMessage('/wt', makeAdapter(generateText)))
      .rejects.toThrow('empty commit message');
  });
});
