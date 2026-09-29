import { describe, it, expect } from 'vitest';
import { candidateBranches, squashMessageFrom, describeOpResult } from './git-ops.js';

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
