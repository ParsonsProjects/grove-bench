import { describe, it, expect } from 'vitest';
import { ghRepoArg, parseActionsLink, parsePrUrl, sameRepo } from './github-links.js';

describe('parsePrUrl()', () => {
  it('reads the repository of a PR URL', () => {
    expect(parsePrUrl('https://github.com/o/r/pull/59')).toEqual({ host: 'github.com', owner: 'o', name: 'r' });
    expect(parsePrUrl('https://github.com/o/r/pull/59/files')).toEqual({ host: 'github.com', owner: 'o', name: 'r' });
  });

  it('accepts names GitHub allows: a leading dot, and underscores in managed users', () => {
    expect(parsePrUrl('https://github.com/acme/.github/pull/1')?.name).toBe('.github');
    expect(parsePrUrl('https://github.com/jo_acme/my.repo_x/pull/1')).toEqual({ host: 'github.com', owner: 'jo_acme', name: 'my.repo_x' });
  });

  it('refuses anything that is not a plain PR URL', () => {
    for (const url of [
      'u',
      'http://github.com/o/r/pull/1',
      'https://github.com/o/r/issues/1',
      'https://github.com/o/../pull/1',
      'https://github.com/o/./pull/1',
      'https://github.com/o/r;rm -rf/pull/1',
      'https://github.com/-o/r/pull/1',
    ]) expect(parsePrUrl(url)).toBeNull();
  });
});

describe('parseActionsLink()', () => {
  it('reads the run, and the job when there is one', () => {
    expect(parseActionsLink('https://github.com/o/r/actions/runs/123/job/456')).toEqual({ host: 'github.com', owner: 'o', name: 'r', runId: '123', jobId: '456' });
    expect(parseActionsLink('https://github.com/o/r/actions/runs/123')).toEqual({ host: 'github.com', owner: 'o', name: 'r', runId: '123' });
    expect(parseActionsLink('https://github.com/o/r/actions/runs/123?check_suite_focus=true')?.runId).toBe('123');
  });

  it('refuses other links', () => {
    expect(parseActionsLink('https://github.com/o/r/runs/123')).toBeNull();
    expect(parseActionsLink('https://github.com/o/r/actions/runs/12x')).toBeNull();
    expect(parseActionsLink('https://github.com/o/r/actions/runs/1/job/2x')).toBeNull();
  });
});

describe('ghRepoArg() and sameRepo()', () => {
  it('gives the host only off github.com', () => {
    expect(ghRepoArg({ host: 'github.com', owner: 'o', name: 'r' })).toBe('o/r');
    expect(ghRepoArg({ host: 'GitHub.com', owner: 'o', name: 'r' })).toBe('o/r');
    expect(ghRepoArg({ host: 'ghe.corp.io', owner: 'o', name: 'r' })).toBe('ghe.corp.io/o/r');
  });

  it('compares without letter case', () => {
    expect(sameRepo({ host: 'github.com', owner: 'O', name: 'R' }, { host: 'GITHUB.com', owner: 'o', name: 'r' })).toBe(true);
    expect(sameRepo({ host: 'github.com', owner: 'o', name: 'r' }, { host: 'github.com', owner: 'o', name: 'r2' })).toBe(false);
  });
});
