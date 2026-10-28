import { describe, it, expect } from 'vitest';
import { triageForSprite, matchesTriageFilter, triageCounts, TRIAGE_FILTERS, type TriageState } from './session-triage.js';
import { agentSpriteState } from './agent-sprite.js';

describe('triageForSprite', () => {
  const triage = (s: Partial<Parameters<typeof agentSpriteState>[0]>) =>
    triageForSprite(agentSpriteState({ destroying: false, status: 'running', hasPending: false, isRunning: false, backgroundAgent: false, needsAttention: false, ...s }));

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
  const entry = (state: TriageState, todo = false) => ({ state, todo });

  it('"all" matches every state and the others match only themselves', () => {
    for (const state of ['needs-you', 'working', 'unread', 'idle', 'none'] as const) {
      expect(matchesTriageFilter('all', entry(state))).toBe(true);
    }
    expect(matchesTriageFilter('working', entry('working'))).toBe(true);
    expect(matchesTriageFilter('working', entry('unread'))).toBe(false);
    expect(matchesTriageFilter('unread', entry('idle'))).toBe(false);
    expect(matchesTriageFilter('idle', entry('idle'))).toBe(true);
    expect(matchesTriageFilter('idle', entry('none'))).toBe(false);
  });

  it('"todo" matches flagged threads in any state, closed ones too', () => {
    for (const state of ['needs-you', 'working', 'unread', 'idle', 'none'] as const) {
      expect(matchesTriageFilter('todo', entry(state, true))).toBe(true);
      expect(matchesTriageFilter('todo', entry(state, false))).toBe(false);
    }
    // The flag doesn't change which state chip a thread is under.
    expect(matchesTriageFilter('working', entry('working', true))).toBe(true);
    expect(matchesTriageFilter('idle', entry('working', true))).toBe(false);
  });
});

describe('triageCounts', () => {
  it('counts each state once and no-chip states only in the total', () => {
    const states: TriageState[] = ['needs-you', 'working', 'working', 'unread', 'idle', 'idle', 'none'];
    const counts = triageCounts(states.map((state) => ({ state, todo: false })));
    expect(counts).toEqual({ all: 7, 'needs-you': 1, working: 2, unread: 1, idle: 2, todo: 0 });
  });

  it('counts To do on top of the states, so it overlaps them', () => {
    const counts = triageCounts([
      { state: 'working', todo: true },
      { state: 'none', todo: true },
      { state: 'idle', todo: false },
    ]);
    expect(counts).toEqual({ all: 3, 'needs-you': 0, working: 1, unread: 0, idle: 1, todo: 2 });
  });

  it('exposes filters in the sidebar order', () => {
    expect(TRIAGE_FILTERS).toEqual(['all', 'needs-you', 'working', 'unread', 'idle', 'todo']);
  });
});
