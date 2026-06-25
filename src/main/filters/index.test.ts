import { describe, it, expect } from 'vitest';
import { matchFilter, applyFilter } from './index.js';

describe('matchFilter', () => {
  it('matches git status command', () => {
    const rule = matchFilter('git status');
    expect(rule).not.toBeNull();
    expect(rule!.name).toBe('git-status');
  });

  it('matches git status with flags', () => {
    expect(matchFilter('git status -s')).not.toBeNull();
    expect(matchFilter('git status --short')).not.toBeNull();
  });

  it('matches git log', () => {
    const rule = matchFilter('git log');
    expect(rule).not.toBeNull();
    expect(rule!.name).toBe('git-log');
  });

  it('matches git diff', () => {
    expect(matchFilter('git diff')).not.toBeNull();
    expect(matchFilter('git diff HEAD~1')).not.toBeNull();
    expect(matchFilter('git diff --staged')).not.toBeNull();
  });

  it('matches git push/pull/fetch', () => {
    expect(matchFilter('git push')).not.toBeNull();
    expect(matchFilter('git pull')).not.toBeNull();
    expect(matchFilter('git fetch')).not.toBeNull();
    expect(matchFilter('git push origin main')).not.toBeNull();
  });

  it('matches git branch', () => {
    expect(matchFilter('git branch')).not.toBeNull();
    expect(matchFilter('git branch -a')).not.toBeNull();
  });

  it('matches npm test / vitest / jest', () => {
    expect(matchFilter('npm test')).not.toBeNull();
    expect(matchFilter('npx vitest')).not.toBeNull();
    expect(matchFilter('npx vitest run')).not.toBeNull();
    expect(matchFilter('npx jest')).not.toBeNull();
    expect(matchFilter('vitest run')).not.toBeNull();
    expect(matchFilter('jest --coverage')).not.toBeNull();
  });

  it('matches tsc', () => {
    expect(matchFilter('tsc')).not.toBeNull();
    expect(matchFilter('npx tsc')).not.toBeNull();
    expect(matchFilter('npx tsc --noEmit')).not.toBeNull();
  });

  it('matches eslint', () => {
    expect(matchFilter('eslint .')).not.toBeNull();
    expect(matchFilter('npx eslint src/')).not.toBeNull();
  });

  it('matches ls', () => {
    expect(matchFilter('ls')).not.toBeNull();
    expect(matchFilter('ls -la')).not.toBeNull();
    expect(matchFilter('ls -la src/')).not.toBeNull();
  });

  it('matches find', () => {
    expect(matchFilter('find . -name "*.ts"')).not.toBeNull();
    expect(matchFilter('find src -type f')).not.toBeNull();
  });

  it('returns null for unknown commands', () => {
    expect(matchFilter('echo hello')).toBeNull();
    expect(matchFilter('curl https://example.com')).toBeNull();
    expect(matchFilter('node script.js')).toBeNull();
  });

  it('does not match git commands that should pass through', () => {
    // git add, commit, checkout etc. should not be filtered
    expect(matchFilter('git add .')).toBeNull();
    expect(matchFilter('git commit -m "msg"')).toBeNull();
    expect(matchFilter('git checkout main')).toBeNull();
  });
});

describe('applyFilter', () => {
  it('applies matched filter to output', () => {
    const rule = matchFilter('git status');
    expect(rule).not.toBeNull();
    const result = applyFilter(rule!, ' M src/app.ts\n', '', 0);
    expect(result).toContain('src/app.ts');
  });

  it('returns stderr when command fails and stdout is empty', () => {
    const rule = matchFilter('git status');
    expect(rule).not.toBeNull();
    const result = applyFilter(rule!, '', 'fatal: not a git repository', 128);
    expect(result).toContain('fatal: not a git repository');
  });
});
