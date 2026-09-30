import { describe, it, expect } from 'vitest';
import { triageForSprite, matchesTriageFilter, triageCounts, TRIAGE_FILTERS } from './session-triage.js';
import { agentSpriteState } from './agent-sprite.js';

describe('triageForSprite', () => {
  const triage = (s: Partial<Parameters<typeof agentSpriteState>[0]>) =>
    triageForSprite(agentSpriteState({ destroying: false, status: 'running', hasPending: false, isRunning: false, needsAttention: false, ...s }));

  it('prioritises needs-you over working over unread, as the status colour does', () => {
    expect(triage({ hasPending: true, isRunning: true, needsAttention: true })).toBe('needs-you');
    expect(triage({ isRunning: true, needsAttention: true })).toBe('working');
    expect(triage({ needsAttention: true })).toBe('unread');
    expect(triage({})).toBe('idle');
  });

  it('counts starting up as working', () => {
    expect(triage({ status: 'starting' })).toBe('working');
    expect(triage({ status: 'installing' })).toBe('working');
  });

  it('puts an errored conversation under no chip, even when it is also unread', () => {
    expect(triage({ status: 'error', needsAttention: true })).toBe('idle');
  });

  it('puts quiet states under no chip', () => {
    for (const status of ['stopped', 'sleeping']) expect(triage({ status })).toBe('idle');
    expect(triage({ destroying: true, needsAttention: true })).toBe('idle');
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
