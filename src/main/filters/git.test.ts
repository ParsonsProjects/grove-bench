import { describe, it, expect } from 'vitest';
import { filterGitStatus, filterGitLog, filterGitDiff, filterGitPush, filterGitBranch } from './git.js';

describe('filterGitStatus', () => {
  it('compresses porcelain-style status to summary + truncated list', () => {
    const input = [
      ' M src/app.ts',
      ' M src/index.ts',
      ' M src/utils.ts',
      'A  new-file.ts',
      '?? untracked.txt',
      '?? temp.log',
    ].join('\n');
    const result = filterGitStatus(input);
    expect(result).toContain('M 3');
    expect(result).toContain('A 1');
    expect(result).toContain('?? 2');
  });

  it('handles empty status (clean tree)', () => {
    expect(filterGitStatus('')).toBe('clean');
  });

  it('preserves file names in output', () => {
    const input = ' M src/important.ts\n';
    const result = filterGitStatus(input);
    expect(result).toContain('src/important.ts');
  });

  it('handles deleted files', () => {
    const input = ' D removed.ts\nD  staged-delete.ts\n';
    const result = filterGitStatus(input);
    expect(result).toContain('D');
  });
});

describe('filterGitLog', () => {
  it('returns compact hash + subject lines', () => {
    const input = [
      'commit abc1234567890',
      'Author: Test User <test@example.com>',
      'Date:   Mon Apr 13 10:00:00 2026 +0000',
      '',
      '    First commit message',
      '',
      'commit def4567890123',
      'Author: Test User <test@example.com>',
      'Date:   Mon Apr 12 10:00:00 2026 +0000',
      '',
      '    Second commit message',
    ].join('\n');
    const result = filterGitLog(input);
    expect(result).toContain('abc1234');
    expect(result).toContain('First commit message');
    expect(result).toContain('def4567');
    expect(result).toContain('Second commit message');
    // Should NOT contain full author/date lines
    expect(result).not.toContain('Author:');
    expect(result).not.toContain('Date:');
  });

  it('caps output at 20 entries', () => {
    const commits = Array.from({ length: 30 }, (_, i) => [
      `commit ${String(i).padStart(40, '0')}`,
      `Author: Test <t@t.com>`,
      `Date:   Mon Apr 13 10:00:00 2026 +0000`,
      '',
      `    Commit message ${i}`,
      '',
    ].join('\n')).join('\n');
    const result = filterGitLog(commits);
    const lines = result.trim().split('\n');
    // Should have at most 20 commit lines + possible truncation notice
    const commitLines = lines.filter(l => l.match(/^[0-9a-f]/));
    expect(commitLines.length).toBeLessThanOrEqual(20);
  });

  it('handles empty log', () => {
    expect(filterGitLog('')).toBe('');
  });

  it('handles --oneline format (already compact)', () => {
    const input = 'abc1234 First commit\ndef5678 Second commit\n';
    const result = filterGitLog(input);
    expect(result).toContain('abc1234');
    expect(result).toContain('First commit');
  });
});

describe('filterGitDiff', () => {
  it('shows stat summary and truncates hunks', () => {
    const input = [
      'diff --git a/file.ts b/file.ts',
      'index 1234567..abcdefg 100644',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,5 +1,6 @@',
      ' line 1',
      '-old line',
      '+new line',
      '+added line',
      ' line 3',
    ].join('\n');
    const result = filterGitDiff(input);
    expect(result).toContain('file.ts');
    // Should contain diff content
    expect(result).toContain('-old line');
    expect(result).toContain('+new line');
  });

  it('truncates very long diffs', () => {
    const hunks = Array.from({ length: 200 }, (_, i) => `+added line ${i}`);
    const input = [
      'diff --git a/big.ts b/big.ts',
      '--- a/big.ts',
      '+++ b/big.ts',
      '@@ -1,1 +1,200 @@',
      ...hunks,
    ].join('\n');
    const result = filterGitDiff(input);
    expect(result).toContain('[... truncated');
  });

  it('handles empty diff', () => {
    expect(filterGitDiff('')).toBe('');
  });
});

describe('filterGitPush', () => {
  it('extracts success summary from push output', () => {
    const input = [
      'Enumerating objects: 5, done.',
      'Counting objects: 100% (5/5), done.',
      'Delta compression using up to 8 threads',
      'Compressing objects: 100% (3/3), done.',
      'Writing objects: 100% (3/3), 1.23 KiB | 1.23 MiB/s, done.',
      'Total 3 (delta 2), reused 0 (delta 0), pack-reused 0',
      'remote: Resolving deltas: 100% (2/2), completed with 2 local objects.',
      'To github.com:user/repo.git',
      '   abc1234..def5678  main -> main',
    ].join('\n');
    const result = filterGitPush(input);
    expect(result).toContain('main -> main');
    // Should strip progress lines
    expect(result).not.toContain('Enumerating');
    expect(result).not.toContain('Compressing');
  });

  it('preserves error output', () => {
    const input = 'error: failed to push some refs\nhint: Updates were rejected';
    const result = filterGitPush(input);
    expect(result).toContain('error');
    expect(result).toContain('rejected');
  });

  it('handles empty output', () => {
    expect(filterGitPush('')).toBe('');
  });
});

describe('filterGitBranch', () => {
  it('returns branch names with current marked', () => {
    const input = [
      '  feature/auth',
      '* main',
      '  feature/ui',
    ].join('\n');
    const result = filterGitBranch(input);
    expect(result).toContain('* main');
    expect(result).toContain('feature/auth');
    expect(result).toContain('feature/ui');
  });

  it('handles empty branch list', () => {
    expect(filterGitBranch('')).toBe('');
  });
});
