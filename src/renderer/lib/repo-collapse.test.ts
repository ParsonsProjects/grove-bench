import { describe, it, expect } from 'vitest';
import { isRepoCollapsed } from './repo-collapse.js';

describe('isRepoCollapsed', () => {
  it('collapses repos by default', () => {
    expect(isRepoCollapsed({}, 'C:/a')).toBe(true);
  });

  it('honours an explicit collapsed=false', () => {
    expect(isRepoCollapsed({ 'C:/a': false }, 'C:/a')).toBe(false);
  });

  it('honours an explicit collapsed=true', () => {
    expect(isRepoCollapsed({ 'C:/a': true }, 'C:/a')).toBe(true);
  });

  it('only consults the entry for the given repo', () => {
    expect(isRepoCollapsed({ 'C:/other': false }, 'C:/a')).toBe(true);
  });
});
