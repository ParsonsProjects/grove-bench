import { describe, it, expect, beforeEach } from 'vitest';

describe('generateSessionFilename', () => {
  // Import the function under test
  let generateSessionFilename: (sessionId: string, branchName?: string) => string;

  beforeEach(async () => {
    const mod = await import('./memory-autosave.js');
    generateSessionFilename = mod.generateSessionFilename;
  });

  it('uses branch name slug when branch is provided', () => {
    const result = generateSessionFilename('abc12345', 'feature/fix-scrollbar');
    expect(result).toBe('sessions/fix-scrollbar.md');
  });

  it('strips common branch prefixes (feature/, bug/, fix/, hotfix/)', () => {
    expect(generateSessionFilename('aaa', 'feature/add-login')).toBe('sessions/add-login.md');
    expect(generateSessionFilename('bbb', 'bug/crash-on-start')).toBe('sessions/crash-on-start.md');
    expect(generateSessionFilename('ccc', 'fix/typo-readme')).toBe('sessions/typo-readme.md');
    expect(generateSessionFilename('ddd', 'hotfix/urgent-patch')).toBe('sessions/urgent-patch.md');
  });

  it('keeps branch names without a prefix as-is', () => {
    expect(generateSessionFilename('eee', 'my-cool-branch')).toBe('sessions/my-cool-branch.md');
  });

  it('falls back to session ID when no branch is provided', () => {
    expect(generateSessionFilename('abc12345')).toBe('sessions/abc12345.md');
    expect(generateSessionFilename('abc12345', '')).toBe('sessions/abc12345.md');
  });

  it('sanitizes special characters in branch names', () => {
    expect(generateSessionFilename('fff', 'feature/add @login!')).toBe('sessions/add-login.md');
    expect(generateSessionFilename('ggg', 'feature/UPPER_Case')).toBe('sessions/upper-case.md');
  });

  it('truncates long branch names', () => {
    const longBranch = 'feature/' + 'a'.repeat(100);
    const result = generateSessionFilename('hhh', longBranch);
    expect(result.length).toBeLessThanOrEqual('sessions/'.length + 60 + '.md'.length);
  });

  it('handles nested prefixes (e.g. feature/JIRA-123/description)', () => {
    expect(generateSessionFilename('iii', 'feature/JIRA-123/add-button'))
      .toBe('sessions/jira-123-add-button.md');
  });

  it('collapses multiple dashes', () => {
    expect(generateSessionFilename('jjj', 'feature/foo--bar---baz'))
      .toBe('sessions/foo-bar-baz.md');
  });

  it('strips leading/trailing dashes after sanitization', () => {
    expect(generateSessionFilename('kkk', 'feature/-leading-'))
      .toBe('sessions/leading.md');
  });

  it('falls back to session ID when branch sanitizes to empty', () => {
    expect(generateSessionFilename('abc12345', 'feature/---'))
      .toBe('sessions/abc12345.md');
  });
});
