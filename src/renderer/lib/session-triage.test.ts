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
    expect(triage({ status: 'error', needsAttention: true })).toBe('none');
  });

  it('counts an open, quiet conversation as idle: ready or asleep', () => {
    expect(triage({ status: 'running' })).toBe('idle');
    expect(triage({ status: 'sleeping' })).toBe('idle');
  });

  it('puts closed and removing conversations under no chip', () => {
    expect(triage({ status: 'stopped' })).toBe('none');
    expect(triage({ destroying: true, needsAttention: true })).toBe('none');
  });
});

describe('matchesTriageFilter', () => {
  it('"all" matches every state and the others match only themselves', () => {
    for (const state of ['needs-you', 'working', 'unread', 'idle', 'none'] as const) {
      expect(matchesTriageFilter('all', state)).toBe(true);
    }
    expect(matchesTriageFilter('working', 'working')).toBe(true);
    expect(matchesTriageFilter('working', 'unread')).toBe(false);
    expect(matchesTriageFilter('unread', 'idle')).toBe(false);
    expect(matchesTriageFilter('idle', 'idle')).toBe(true);
    expect(matchesTriageFilter('idle', 'none')).toBe(false);
  });
});

describe('triageCounts', () => {
  it('counts each state once and no-chip states only in the total', () => {
    const counts = triageCounts(['needs-you', 'working', 'working', 'unread', 'idle', 'idle', 'none']);
    expect(counts).toEqual({ all: 7, 'needs-you': 1, working: 2, unread: 1, idle: 2 });
  });

  it('exposes filters in the sidebar order', () => {
    expect(TRIAGE_FILTERS).toEqual(['all', 'needs-you', 'working', 'unread', 'idle']);
  });
});
