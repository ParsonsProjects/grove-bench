import { describe, it, expect } from 'vitest';
import { applyFollowUpsChange, type FollowUp } from './follow-ups.js';

const fu = (id: string, extra: Partial<FollowUp> = {}): FollowUp => ({ id, repoPath: '/r', title: id, details: '', createdAt: 0, ...extra });

describe('applyFollowUpsChange', () => {
  it('replaces changed ones where they are, adds new ones at the end and drops removed ones', () => {
    const list = [fu('a'), fu('b'), fu('c')];
    const next = applyFollowUpsChange(list, { upserted: [fu('b', { doneAt: 1 }), fu('d')], removed: ['a'] });
    expect(next.map((f) => [f.id, f.doneAt])).toEqual([['b', 1], ['c', undefined], ['d', undefined]]);
    expect(list.map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('gives the same list when a change is applied twice', () => {
    const change = { upserted: [fu('d')], removed: ['a'] };
    const once = applyFollowUpsChange([fu('a'), fu('b')], change);
    expect(applyFollowUpsChange(once, change)).toEqual(once);
  });
});
