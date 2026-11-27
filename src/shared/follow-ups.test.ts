import { describe, it, expect } from 'vitest';
import { applyFollowUpsChange, followUpEndedAt, followUpPrompt, isFollowUpOpen, projectName, type FollowUp } from './follow-ups.js';

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

describe('isFollowUpOpen and followUpEndedAt', () => {
  it('counts one open until it is done or closed, and gives when that was', () => {
    expect(isFollowUpOpen(fu('a'))).toBe(true);
    expect(isFollowUpOpen(fu('a', { doneAt: 3 }))).toBe(false);
    expect(isFollowUpOpen(fu('a', { closedAt: 4 }))).toBe(false);
    expect(followUpEndedAt(fu('a'))).toBeUndefined();
    expect(followUpEndedAt(fu('a', { doneAt: 3 }))).toBe(3);
    expect(followUpEndedAt(fu('a', { closedAt: 4 }))).toBe(4);
  });
});

describe('projectName', () => {
  it("is the folder's name, whichever slashes the path uses", () => {
    expect(projectName('C:\\Code\\grove-bench')).toBe('grove-bench');
    expect(projectName('/home/me/api/')).toBe('api');
  });
});

describe('followUpPrompt', () => {
  it("names the other project the thread that added it was in", () => {
    const text = followUpPrompt(fu('a1b2c3', { title: 'Fix it', fromLabel: 'Web work', fromBranch: 'feat/x', fromRepoPath: 'C:\\Code\\web' }));
    expect(text).toContain('It was added in the thread "Web work" (branch feat/x in project web).');
    expect(followUpPrompt(fu('a1b2c3', { fromLabel: 'Web work', fromRepoPath: '/web' }))).toContain('"Web work" (in project web).');
    expect(followUpPrompt(fu('a1b2c3', { fromRepoPath: '/web' }))).toContain('(This is follow-up a1b2c3. It was added from project web.');
  });

  it('tells the agent how to finish it, or close it if it is not needed', () => {
    const text = followUpPrompt(fu('a1b2c3', { title: 'Fix it' }));
    expect(text).toContain('mark it done with followup_done');
    expect(text).toContain('close it with followup_close and say why');
  });
});
