import { describe, it, expect } from 'vitest';
import { candidateBranches, squashMessageFrom, describeOpResult, describeMergePlan, describeMergeResult } from './git-ops.js';

const sessions = [
  { id: 'a', branch: 'feat/a', repoPath: '/r1', displayName: 'Auth work' },
  { id: 'b', branch: 'feat/b', repoPath: '/r1', displayName: null },
  { id: 'b2', branch: 'feat/b', repoPath: '/r1' }, // attached session on the same branch
  { id: 'c', branch: 'feat/c', repoPath: '/r2' },
  { id: 'd', branch: 'main', repoPath: '/r1' },
];

describe('candidateBranches', () => {
  it('lists the base first, then same-repo sessions, one per branch, excluding itself', () => {
    expect(candidateBranches(sessions, 'a', 'main')).toEqual([
      { branch: 'main', label: 'base branch' },
      { branch: 'feat/b', label: 'feat/b', sessionId: 'b' },
    ]);
  });

  it('uses the display name as the label and skips the base when it is the own branch', () => {
    expect(candidateBranches(sessions, 'd', 'main')).toEqual([
      { branch: 'feat/a', label: 'Auth work', sessionId: 'a' },
      { branch: 'feat/b', label: 'feat/b', sessionId: 'b' },
    ]);
  });

  it('handles an unknown session', () => {
    expect(candidateBranches(sessions, 'zzz', 'main')).toEqual([{ branch: 'main', label: 'base branch' }]);
    expect(candidateBranches(sessions, 'zzz', '')).toEqual([]);
  });
});

describe('squashMessageFrom', () => {
  it('titles with the oldest subject and bullets the rest', () => {
    const commits = [
      { sha: '3', shortSha: '3', subject: 'Third' },
      { sha: '2', shortSha: '2', subject: 'Second' },
      { sha: '1', shortSha: '1', subject: 'First' },
    ];
    expect(squashMessageFrom(commits)).toBe('First\n\n- Second\n- Third');
    expect(squashMessageFrom(commits.slice(0, 1))).toBe('Third');
    expect(squashMessageFrom([])).toBe('');
  });
});

describe('describeOpResult', () => {
  it('formats success, conflicts and errors', () => {
    expect(describeOpResult({ success: true }, 'Rebase')).toEqual({ ok: true, text: 'Rebase complete.' });
    const conflict = describeOpResult({ success: false, conflicts: ['a.ts', 'b.ts'] }, 'Rebase');
    expect(conflict.ok).toBe(false);
    expect(conflict.text).toContain('conflicts in a.ts, b.ts');
    expect(conflict.text).toContain('unchanged');
    expect(describeOpResult({ success: false, error: 'boom' }, 'Squash').text).toBe('Squash failed: boom');
    expect(describeOpResult({ success: false }, 'Squash').text).toContain('unknown error');
  });

  it('caps the conflict list', () => {
    const many = Array.from({ length: 10 }, (_, i) => `f${i}.ts`);
    expect(describeOpResult({ success: false, conflicts: many }, 'Cherry-pick').text).toContain('and 2 more');
  });
});

describe('describeMergePlan', () => {
  const plan = { branch: 'feat/x', target: 'main', commits: 2, checkoutPath: '/repo', uncommitted: 0 };

  it('says where the merge runs and that nothing is pushed', () => {
    expect(describeMergePlan(plan)).toEqual({
      summary: '2 commits from feat/x will be merged into main in your project folder. Nothing is pushed.',
    });
  });

  it('explains a fast-forward when no checkout has the target', () => {
    expect(describeMergePlan({ ...plan, commits: 1, checkoutPath: null }).summary)
      .toBe('1 commit from feat/x will be added to main. No checkout has main, so it moves forward without touching any files. Nothing is pushed.');
  });

  it('warns that uncommitted files are left out', () => {
    expect(describeMergePlan({ ...plan, uncommitted: 1 }).note).toBe(
      "1 file with uncommitted changes won't be included. Commit them first if you want them in main.",
    );
  });
});

describe('describeMergeResult', () => {
  it('formats success, conflicts and errors', () => {
    expect(describeMergeResult({ success: true }, 'main')).toEqual({
      ok: true,
      text: "Merged into main. Push main when you're ready to share it.",
    });
    const conflict = describeMergeResult({ success: false, conflicts: ['a.ts'] }, 'main');
    expect(conflict.ok).toBe(false);
    expect(conflict.text).toContain('both changed a.ts');
    expect(conflict.text).toContain('Nothing was changed');
    expect(describeMergeResult({ success: false, error: 'boom' }, 'main').text).toBe('Merge failed: boom');
  });
});
