import { describe, it, expect } from 'vitest';
import { sortSessions, rowAge, defaultDirFor, DEFAULT_SORT } from './session-sort.js';

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

describe('sortSessions by a given age', () => {
  it('orders by the age function when one is given', () => {
    const sessions = [mk({ branch: 'a', lastActiveAt: 100 }), mk({ branch: 'b', lastActiveAt: 300 })];
    const readAt: Record<string, number> = { a: 500 };
    const ageOf = (s: { branch: string; lastActiveAt?: number }) => readAt[s.branch] ?? s.lastActiveAt ?? 0;
    expect(sortSessions(sessions, { key: 'age', dir: 'desc' }, ageOf).map((s) => s.branch)).toEqual(['a', 'b']);
    expect(sortSessions(sessions, { key: 'age', dir: 'asc' }, ageOf).map((s) => s.branch)).toEqual(['b', 'a']);
  });
});

describe('rowAge', () => {
  it('counts an unread thread from when it was last read', () => {
    expect(rowAge(mk({ lastActiveAt: 100, createdAt: 50 }), true, 200)).toEqual({ at: 200, kind: 'read' });
  });

  it('counts a read thread from its last activity, even with a read time', () => {
    expect(rowAge(mk({ lastActiveAt: 100, createdAt: 50 }), false, 200)).toEqual({ at: 100, kind: 'active' });
  });

  it('falls back to last activity when an unread thread was never read', () => {
    expect(rowAge(mk({ lastActiveAt: 100 }), true, undefined)).toEqual({ at: 100, kind: 'active' });
  });

  it('falls back to creation, then 0', () => {
    expect(rowAge(mk({ createdAt: 50 }))).toEqual({ at: 50, kind: 'created' });
    expect(rowAge(mk({}))).toEqual({ at: 0, kind: 'created' });
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
