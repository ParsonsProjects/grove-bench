import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REPO_COLORS,
  getRepoColor,
  getRepoColorStyle,
  getTabPendingClass,
} from './repo-colors.js';

describe('DEFAULT_REPO_COLORS', () => {
  it('has at least 8 distinct colors', () => {
    expect(DEFAULT_REPO_COLORS.length).toBeGreaterThanOrEqual(8);
    const unique = new Set(DEFAULT_REPO_COLORS);
    expect(unique.size).toBe(DEFAULT_REPO_COLORS.length);
  });
});

describe('getRepoColor', () => {
  const repos = ['/path/to/repo-a', '/path/to/repo-b', '/path/to/repo-c'];

  it('returns a color from the default palette based on repo index', () => {
    const color = getRepoColor(repos, '/path/to/repo-a');
    expect(color).toBe(DEFAULT_REPO_COLORS[0]);
  });

  it('returns different colors for different repos', () => {
    const colorA = getRepoColor(repos, '/path/to/repo-a');
    const colorB = getRepoColor(repos, '/path/to/repo-b');
    const colorC = getRepoColor(repos, '/path/to/repo-c');
    expect(colorA).not.toBe(colorB);
    expect(colorB).not.toBe(colorC);
  });

  it('wraps around when repos exceed palette size', () => {
    const manyRepos = Array.from({ length: DEFAULT_REPO_COLORS.length + 2 }, (_, i) => `/repo/${i}`);
    const wrapped = getRepoColor(manyRepos, `/repo/${DEFAULT_REPO_COLORS.length}`);
    expect(wrapped).toBe(DEFAULT_REPO_COLORS[0]);
  });

  it('returns first color for unknown repo path', () => {
    const color = getRepoColor(repos, '/unknown/path');
    expect(color).toBe(DEFAULT_REPO_COLORS[0]);
  });

  it('uses custom color when provided', () => {
    const custom = { '/path/to/repo-b': '#ff00ff' };
    const color = getRepoColor(repos, '/path/to/repo-b', custom);
    expect(color).toBe('#ff00ff');
  });

  it('falls back to palette when repo has no custom color', () => {
    const custom = { '/path/to/repo-b': '#ff00ff' };
    const color = getRepoColor(repos, '/path/to/repo-a', custom);
    expect(color).toBe(DEFAULT_REPO_COLORS[0]);
  });

  it('returns null when only one repo and no custom color', () => {
    const color = getRepoColor(['/only-repo'], '/only-repo');
    expect(color).toBeNull();
  });

  it('returns custom color even with single repo', () => {
    const custom = { '/only-repo': '#abcdef' };
    const color = getRepoColor(['/only-repo'], '/only-repo', custom);
    expect(color).toBe('#abcdef');
  });
});

describe('getRepoColorStyle', () => {
  const repos = ['/repo/a', '/repo/b'];

  it('returns a CSS border-color style string', () => {
    const style = getRepoColorStyle(repos, '/repo/a');
    expect(style).toContain('border-color:');
    expect(style).toContain(DEFAULT_REPO_COLORS[0]);
  });

  it('returns empty string when color is null (single repo)', () => {
    const style = getRepoColorStyle(['/only'], '/only');
    expect(style).toBe('');
  });

  it('uses custom colors in style output', () => {
    const style = getRepoColorStyle(repos, '/repo/a', { '/repo/a': '#123456' });
    expect(style).toContain('#123456');
  });
});

describe('getTabPendingClass', () => {
  it('returns tab-action-required when not active and pending', () => {
    expect(getTabPendingClass(false, true)).toBe('tab-action-required');
  });

  it('returns tab-action-required-active when active and pending', () => {
    expect(getTabPendingClass(true, true)).toBe('tab-action-required-active');
  });

  it('returns empty string when not pending', () => {
    expect(getTabPendingClass(false, false)).toBe('');
    expect(getTabPendingClass(true, false)).toBe('');
  });
});
