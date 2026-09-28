import { describe, it, expect } from 'vitest';
import { computeIdleSleeps, type IdleSnapshotSession } from './idle-manager.js';

function session(over: Partial<IdleSnapshotSession> & { id: string }): IdleSnapshotSession {
  return { status: 'running', isActive: false, isRunning: false, hasPending: false, hasRunningTasks: false, ...over };
}

const THRESHOLD = 30 * 60_000; // 30 min

describe('computeIdleSleeps', () => {
  it('records idleSince on first eligibility without sleeping', () => {
    const sessions = [session({ id: 's1' })];
    const { toSleep, nextIdleSince } = computeIdleSleeps(sessions, new Map(), 1000, THRESHOLD);
    expect(toSleep).toEqual([]);
    expect(nextIdleSince.get('s1')).toBe(1000);
  });

  it('puts a session to sleep once idle past the threshold', () => {
    const sessions = [session({ id: 's1' })];
    const idleSince = new Map([['s1', 0]]);
    const { toSleep } = computeIdleSleeps(sessions, idleSince, THRESHOLD, THRESHOLD);
    expect(toSleep).toEqual(['s1']);
  });

  it('does not sleep just below the threshold', () => {
    const sessions = [session({ id: 's1' })];
    const idleSince = new Map([['s1', 0]]);
    const { toSleep, nextIdleSince } = computeIdleSleeps(sessions, idleSince, THRESHOLD - 1, THRESHOLD);
    expect(toSleep).toEqual([]);
    expect(nextIdleSince.get('s1')).toBe(0); // clock carried forward
  });

  it('never sleeps the focused session', () => {
    const sessions = [session({ id: 's1', isActive: true })];
    const idleSince = new Map([['s1', 0]]);
    const { toSleep, nextIdleSince } = computeIdleSleeps(sessions, idleSince, THRESHOLD * 2, THRESHOLD);
    expect(toSleep).toEqual([]);
    expect(nextIdleSince.has('s1')).toBe(false); // ineligible → clock reset
  });

  it('never sleeps a session running a turn', () => {
    const sessions = [session({ id: 's1', isRunning: true })];
    const { toSleep } = computeIdleSleeps(sessions, new Map([['s1', 0]]), THRESHOLD * 2, THRESHOLD);
    expect(toSleep).toEqual([]);
  });

  it('never sleeps a session awaiting a permission', () => {
    const sessions = [session({ id: 's1', hasPending: true })];
    const { toSleep } = computeIdleSleeps(sessions, new Map([['s1', 0]]), THRESHOLD * 2, THRESHOLD);
    expect(toSleep).toEqual([]);
  });

  it('never sleeps a session with a background task running', () => {
    const sessions = [session({ id: 's1', hasRunningTasks: true })];
    const { toSleep, nextIdleSince } = computeIdleSleeps(sessions, new Map([['s1', 0]]), THRESHOLD * 2, THRESHOLD);
    expect(toSleep).toEqual([]);
    expect(nextIdleSince.has('s1')).toBe(false);
  });

  it('ignores non-running statuses (sleeping, stopped, starting, error)', () => {
    const sessions = [
      session({ id: 'sleeping', status: 'sleeping' }),
      session({ id: 'stopped', status: 'stopped' }),
      session({ id: 'starting', status: 'starting' }),
      session({ id: 'error', status: 'error' }),
    ];
    const idleSince = new Map(sessions.map((s) => [s.id, 0] as [string, number]));
    const { toSleep } = computeIdleSleeps(sessions, idleSince, THRESHOLD * 2, THRESHOLD);
    expect(toSleep).toEqual([]);
  });

  it('is disabled when threshold is 0', () => {
    const sessions = [session({ id: 's1' })];
    const idleSince = new Map([['s1', 0]]);
    const { toSleep, nextIdleSince } = computeIdleSleeps(sessions, idleSince, THRESHOLD * 10, 0);
    expect(toSleep).toEqual([]);
    expect(nextIdleSince.size).toBe(0);
  });

  it('resets the idle clock when a session becomes ineligible then idle again', () => {
    const sessions = [session({ id: 's1', isRunning: true })];
    // Was idle since 0, but now running → dropped from nextIdleSince
    const first = computeIdleSleeps(sessions, new Map([['s1', 0]]), 1_000_000, THRESHOLD);
    expect(first.nextIdleSince.has('s1')).toBe(false);
    // Next tick it's idle again → clock starts fresh at `now`, not the old 0
    const second = computeIdleSleeps([session({ id: 's1' })], first.nextIdleSince, 2_000_000, THRESHOLD);
    expect(second.toSleep).toEqual([]);
    expect(second.nextIdleSince.get('s1')).toBe(2_000_000);
  });
});
