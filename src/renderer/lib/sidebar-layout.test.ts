import { describe, it, expect, afterEach } from 'vitest';
import { cachedSidebarLayout, cacheSidebarLayout } from './sidebar-layout.js';

const KEY = 'grove-bench:sidebar-layout';

afterEach(() => localStorage.removeItem(KEY));

describe('sidebar layout cache', () => {
  it('keeps each part as it is saved, for the next first frame', () => {
    cacheSidebarLayout({ width: 360 });
    cacheSidebarLayout({ sort: { key: 'age', dir: 'desc' } });
    cacheSidebarLayout({ collapsedRepos: { '/a': false } });
    expect(cachedSidebarLayout()).toEqual({ width: 360, sort: { key: 'age', dir: 'desc' }, collapsedRepos: { '/a': false } });
  });

  it("drops any part that doesn't read right, and copes with none or junk", () => {
    expect(cachedSidebarLayout()).toEqual({});
    localStorage.setItem(KEY, '{not json');
    expect(cachedSidebarLayout()).toEqual({});
    localStorage.setItem(KEY, JSON.stringify({ width: 'wide', sort: { key: 'size', dir: 'asc' }, collapsedRepos: { '/a': true, '/b': 'yes' } }));
    expect(cachedSidebarLayout()).toEqual({ collapsedRepos: { '/a': true } });
  });
});
