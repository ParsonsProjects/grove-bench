import { describe, it, expect } from 'vitest';
import { sortSessions, defaultDirFor, DEFAULT_SORT } from './session-sort.js';

const mk = (o: Partial<{ displayName: string | null; branch: string; lastActiveAt: number; createdAt: number }>) => ({
  branch: 'main',
  ...o,
});

describe('defaultDirFor', () => {
  it('name defaults to ascending (A→Z)', () => {
    expect(defaultDirFor('name')).toBe('asc');
  });
  it('age defaults to descending (newest first)', () => {
    expect(defaultDirFor('age')).toBe('desc');
  });
});

describe('DEFAULT_SORT', () => {
  it('is name / ascending (A→Z)', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'name', dir: 'asc' });
  });
});

describe('sortSessions by name', () => {
  it('sorts ascending by label, case-insensitively', () => {
    const sessions = [mk({ displayName: 'beta' }), mk({ displayName: 'Alpha' }), mk({ displayName: 'gamma' })];
    expect(sortSessions(sessions, { key: 'name', dir: 'asc' }).map((s) => s.displayName)).toEqual([
      'Alpha', 'beta', 'gamma',
    ]);
  });

  it('sorts descending by label', () => {
    const sessions = [mk({ displayName: 'beta' }), mk({ displayName: 'Alpha' }), mk({ displayName: 'gamma' })];
    expect(sortSessions(sessions, { key: 'name', dir: 'desc' }).map((s) => s.displayName)).toEqual([
      'gamma', 'beta', 'Alpha',
    ]);
  });

  it('falls back to branch when displayName is empty', () => {
    const sessions = [mk({ displayName: '', branch: 'zed' }), mk({ displayName: null, branch: 'arc' })];
    expect(sortSessions(sessions, { key: 'name', dir: 'asc' }).map((s) => s.branch)).toEqual(['arc', 'zed']);
  });
});

describe('sortSessions by age', () => {
  it('descending = newest (largest timestamp) first', () => {
    const sessions = [mk({ branch: 'a', lastActiveAt: 100 }), mk({ branch: 'b', lastActiveAt: 300 }), mk({ branch: 'c', lastActiveAt: 200 })];
    expect(sortSessions(sessions, { key: 'age', dir: 'desc' }).map((s) => s.branch)).toEqual(['b', 'c', 'a']);
  });

  it('ascending = oldest first', () => {
    const sessions = [mk({ branch: 'a', lastActiveAt: 100 }), mk({ branch: 'b', lastActiveAt: 300 }), mk({ branch: 'c', lastActiveAt: 200 })];
    expect(sortSessions(sessions, { key: 'age', dir: 'asc' }).map((s) => s.branch)).toEqual(['a', 'c', 'b']);
  });

  it('falls back to createdAt when lastActiveAt is missing', () => {
    const sessions = [mk({ branch: 'a', createdAt: 50 }), mk({ branch: 'b', lastActiveAt: 10 })];
    expect(sortSessions(sessions, { key: 'age', dir: 'asc' }).map((s) => s.branch)).toEqual(['b', 'a']);
  });
});

describe('sortSessions purity', () => {
  it('does not mutate the input array', () => {
    const sessions = [mk({ displayName: 'b' }), mk({ displayName: 'a' })];
    const before = sessions.slice();
    sortSessions(sessions, { key: 'name', dir: 'asc' });
    expect(sessions).toEqual(before);
  });
});
