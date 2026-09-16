import { describe, it, expect } from 'vitest';
import { triageState, matchesTriageFilter, triageCounts, TRIAGE_FILTERS } from './session-triage.js';

describe('triageState', () => {
  it('prioritises needs-you over working over unread', () => {
    expect(triageState({ needsInput: true, running: true, unread: true })).toBe('needs-you');
    expect(triageState({ needsInput: false, running: true, unread: true })).toBe('working');
    expect(triageState({ needsInput: false, running: false, unread: true })).toBe('unread');
    expect(triageState({ needsInput: false, running: false, unread: false })).toBe('idle');
  });
});

describe('matchesTriageFilter', () => {
  it('"all" matches every state and the others match only themselves', () => {
    for (const state of ['needs-you', 'working', 'unread', 'idle'] as const) {
      expect(matchesTriageFilter('all', state)).toBe(true);
    }
    expect(matchesTriageFilter('working', 'working')).toBe(true);
    expect(matchesTriageFilter('working', 'unread')).toBe(false);
    expect(matchesTriageFilter('unread', 'idle')).toBe(false);
  });
});

describe('triageCounts', () => {
  it('counts each state once and idle only in the total', () => {
    const counts = triageCounts(['needs-you', 'working', 'working', 'unread', 'idle']);
    expect(counts).toEqual({ all: 5, 'needs-you': 1, working: 2, unread: 1 });
  });

  it('exposes filters in the sidebar order', () => {
    expect(TRIAGE_FILTERS).toEqual(['all', 'needs-you', 'working', 'unread']);
  });
});
