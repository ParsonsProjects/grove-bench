import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./git.js', () => ({
  git: vi.fn(),
  validateBranchName: vi.fn(async () => true),
  branchExistsAnywhere: vi.fn(async () => false),
}));
vi.mock('./background-tasks.js', () => ({ backgroundModelFor: () => 'small-model' }));

import { git, validateBranchName, branchExistsAnywhere } from './git.js';
import {
  tempBranchName,
  isTempBranch,
  buildBranchNamePrompt,
  cleanBranchName,
  conventionBranches,
  uniqueBranchName,
  generateBranchName,
  BRANCH_NAME_SYSTEM_PROMPT,
} from './branch-name.js';
import type { AgentAdapter } from './adapters/types.js';

const mockGit = vi.mocked(git);
const mockValidate = vi.mocked(validateBranchName);
const mockExists = vi.mocked(branchExistsAnywhere);

function makeAdapter(generateText?: (sys: string, user: string, opts?: any) => Promise<string>): AgentAdapter {
  return {
    id: 'test',
    displayName: 'Test Agent',
    ...(generateText ? { generateText } : {}),
  } as unknown as AgentAdapter;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValidate.mockResolvedValue(true);
  mockExists.mockResolvedValue(false);
  mockGit.mockResolvedValue('');
});

describe('placeholder branches', () => {
  it('names the placeholder after the session id', () => {
    expect(tempBranchName('a1b2c3d4')).toBe('grove/a1b2c3d4');
  });

  it('recognises only placeholder names', () => {
    expect(isTempBranch('grove/a1b2c3d4')).toBe(true);
    expect(isTempBranch('grove/add-login')).toBe(false);
    expect(isTempBranch('feat/a1b2c3d4')).toBe(false);
    expect(isTempBranch('grove/a1b2c3d4/x')).toBe(false);
  });
});

describe('cleanBranchName()', () => {
  it('passes a clean name through, keeping ticket case', () => {
    expect(cleanBranchName('feat/API-1388-add-login')).toBe('feat/API-1388-add-login');
  });

  it('strips fences, quotes and a label', () => {
    expect(cleanBranchName('```\nfix/null-check\n```')).toBe('fix/null-check');
    expect(cleanBranchName('"fix/null-check"')).toBe('fix/null-check');
    expect(cleanBranchName('Branch name: `fix/null-check`')).toBe('fix/null-check');
    expect(cleanBranchName('Branch name:\nfix/null-check')).toBe('fix/null-check');
  });

  it('keeps only the first line', () => {
    expect(cleanBranchName('feat/x\n\nThis name follows the repo pattern.')).toBe('feat/x');
  });

  it('turns spaces into hyphens and drops characters git rejects', () => {
    expect(cleanBranchName('feat/add login page!')).toBe('feat/add-login-page');
    expect(cleanBranchName('feat/a~b^c:d?e*f[g]')).toBe('feat/abcdefg');
  });

  it('removes dot runs, doubled separators and .lock endings', () => {
    expect(cleanBranchName('feat//x..y--z')).toBe('feat/x.y-z');
    expect(cleanBranchName('feat/thing.lock')).toBe('feat/thing');
  });

  it('trims separators from each segment', () => {
    expect(cleanBranchName('/-feat-/.x-')).toBe('feat/x');
  });

  it('caps the length at a word boundary', () => {
    const long = `feat/${'word-'.repeat(30)}end`;
    const cleaned = cleanBranchName(long);
    expect(cleaned.length).toBeLessThanOrEqual(80);
    expect(cleaned.endsWith('-')).toBe(false);
  });

  it('returns an empty string when nothing is left', () => {
    expect(cleanBranchName('   ')).toBe('');
    expect(cleanBranchName('"!!!"')).toBe('');
  });
});

describe('conventionBranches()', () => {
  it('strips ref prefixes, drops defaults, placeholders and duplicates', () => {
    expect(conventionBranches([
      'refs/heads/feat/API-1-a',
      'refs/remotes/origin/feat/API-1-a',
      'refs/remotes/origin/HEAD',
      'refs/heads/main',
      'refs/remotes/origin/master',
      'refs/heads/grove/a1b2c3d4',
      'refs/remotes/upstream/fix/API-2-b',
      '',
    ])).toEqual(['feat/API-1-a', 'fix/API-2-b']);
  });

  it('keeps at most 20 names', () => {
    const refs = Array.from({ length: 30 }, (_, i) => `refs/heads/feat/n${i}`);
    expect(conventionBranches(refs)).toHaveLength(20);
  });
});

describe('buildBranchNamePrompt()', () => {
  it('includes the rule, recent branches, title and task in that order', () => {
    const prompt = buildBranchNamePrompt({
      task: 'Fix API-12 login crash',
      title: 'Login crash fix',
      recentBranches: ['feat/API-1-a'],
      rule: '<type>/<ticket>-<slug>',
    });
    const order = ['Naming rule:', 'Recent branch names', 'Conversation title: Login crash fix', 'Task:\nFix API-12 login crash'];
    const positions = order.map((s) => prompt.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('leaves out empty parts', () => {
    const prompt = buildBranchNamePrompt({ task: 'Do it', title: null, recentBranches: [], rule: '  ' });
    expect(prompt).not.toContain('Naming rule');
    expect(prompt).not.toContain('Recent branch names');
    expect(prompt).not.toContain('Conversation title');
  });

  it('truncates a very long task', () => {
    const prompt = buildBranchNamePrompt({ task: 'x'.repeat(10_000), recentBranches: [] });
    expect(prompt).toContain('(truncated)');
    expect(prompt.length).toBeLessThan(5_000);
  });
});

describe('uniqueBranchName()', () => {
  it('returns the name when it is free', async () => {
    expect(await uniqueBranchName('/repo', 'feat/x')).toBe('feat/x');
  });

  it('adds a number when the name is taken', async () => {
    mockExists.mockImplementation(async (_cwd, b) => b === 'feat/x' || b === 'feat/x-2');
    expect(await uniqueBranchName('/repo', 'feat/x')).toBe('feat/x-3');
  });

  it('gives up after nine tries', async () => {
    mockExists.mockResolvedValue(true);
    expect(await uniqueBranchName('/repo', 'feat/x')).toBeNull();
  });
});

describe('generateBranchName()', () => {
  it('asks the adapter with the recent branches and cleans the answer', async () => {
    mockGit.mockResolvedValue('refs/heads/feat/API-1-a\nrefs/heads/main\n');
    const generate = vi.fn(async () => '"feat/API-12-login-crash"');
    const name = await generateBranchName(
      { repoPath: '/repo', cwd: '/wt', task: 'Fix API-12 login crash' },
      makeAdapter(generate),
    );
    expect(name).toBe('feat/API-12-login-crash');
    const [system, user, opts] = generate.mock.calls[0] as unknown as [string, string, any];
    expect(system).toBe(BRANCH_NAME_SYSTEM_PROMPT);
    expect(user).toContain('- feat/API-1-a');
    expect(user).not.toContain('- main');
    expect(opts).toMatchObject({ cwd: '/wt', model: 'small-model' });
  });

  it('throws when the adapter cannot generate text', async () => {
    await expect(generateBranchName({ repoPath: '/r', cwd: '/w', task: 't' }, makeAdapter()))
      .rejects.toThrow('does not support text generation');
  });

  it('throws on an empty or placeholder answer', async () => {
    await expect(generateBranchName({ repoPath: '/r', cwd: '/w', task: 't' }, makeAdapter(async () => '  ')))
      .rejects.toThrow('empty branch name');
    await expect(generateBranchName({ repoPath: '/r', cwd: '/w', task: 't' }, makeAdapter(async () => 'grove/a1b2c3d4')))
      .rejects.toThrow('placeholder');
  });

  it('throws when git rejects the name', async () => {
    mockValidate.mockResolvedValue(false);
    await expect(generateBranchName({ repoPath: '/r', cwd: '/w', task: 't' }, makeAdapter(async () => 'feat/x')))
      .rejects.toThrow('Invalid branch name');
  });

  it('numbers the name when it already exists', async () => {
    mockExists.mockImplementation(async (_cwd, b) => b === 'feat/x');
    expect(await generateBranchName({ repoPath: '/r', cwd: '/w', task: 't' }, makeAdapter(async () => 'feat/x')))
      .toBe('feat/x-2');
  });
});
