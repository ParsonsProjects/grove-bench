import { describe, it, expect } from 'vitest';
import { computeIdleStops, type IdleSnapshotSession } from './idle-manager.js';

function session(over: Partial<IdleSnapshotSession> & { id: string }): IdleSnapshotSession {
  return { status: 'running', isActive: false, isRunning: false, hasPending: false, ...over };
}

const THRESHOLD = 30 * 60_000; // 30 min

describe('computeIdleStops', () => {
  it('records idleSince on first eligibility without stopping', () => {
    const sessions = [session({ id: 's1' })];
    const { toStop, nextIdleSince } = computeIdleStops(sessions, new Map(), 1000, THRESHOLD);
    expect(toStop).toEqual([]);
    expect(nextIdleSince.get('s1')).toBe(1000);
  });

  it('stops a session once idle past the threshold', () => {
    const sessions = [session({ id: 's1' })];
    const idleSince = new Map([['s1', 0]]);
    const { toStop } = computeIdleStops(sessions, idleSince, THRESHOLD, THRESHOLD);
    expect(toStop).toEqual(['s1']);
  });

  it('does not stop just below the threshold', () => {
    const sessions = [session({ id: 's1' })];
    const idleSince = new Map([['s1', 0]]);
    const { toStop, nextIdleSince } = computeIdleStops(sessions, idleSince, THRESHOLD - 1, THRESHOLD);
    expect(toStop).toEqual([]);
    expect(nextIdleSince.get('s1')).toBe(0); // clock carried forward
  });

  it('never stops the focused session', () => {
    const sessions = [session({ id: 's1', isActive: true })];
    const idleSince = new Map([['s1', 0]]);
    const { toStop, nextIdleSince } = computeIdleStops(sessions, idleSince, THRESHOLD * 2, THRESHOLD);
    expect(toStop).toEqual([]);
    expect(nextIdleSince.has('s1')).toBe(false); // ineligible → clock reset
  });

  it('never stops a session running a turn', () => {
    const sessions = [session({ id: 's1', isRunning: true })];
    const { toStop } = computeIdleStops(sessions, new Map([['s1', 0]]), THRESHOLD * 2, THRESHOLD);
    expect(toStop).toEqual([]);
  });

  it('never stops a session awaiting a permission', () => {
    const sessions = [session({ id: 's1', hasPending: true })];
    const { toStop } = computeIdleStops(sessions, new Map([['s1', 0]]), THRESHOLD * 2, THRESHOLD);
    expect(toStop).toEqual([]);
  });

  it('ignores non-running statuses (stopped, starting, error)', () => {
    const sessions = [
      session({ id: 'stopped', status: 'stopped' }),
      session({ id: 'starting', status: 'starting' }),
      session({ id: 'error', status: 'error' }),
    ];
    const idleSince = new Map(sessions.map((s) => [s.id, 0] as [string, number]));
    const { toStop } = computeIdleStops(sessions, idleSince, THRESHOLD * 2, THRESHOLD);
    expect(toStop).toEqual([]);
  });

  it('is disabled when threshold is 0', () => {
    const sessions = [session({ id: 's1' })];
    const idleSince = new Map([['s1', 0]]);
    const { toStop, nextIdleSince } = computeIdleStops(sessions, idleSince, THRESHOLD * 10, 0);
    expect(toStop).toEqual([]);
    expect(nextIdleSince.size).toBe(0);
  });

  it('resets the idle clock when a session becomes ineligible then idle again', () => {
    const sessions = [session({ id: 's1', isRunning: true })];
    // Was idle since 0, but now running → dropped from nextIdleSince
    const first = computeIdleStops(sessions, new Map([['s1', 0]]), 1_000_000, THRESHOLD);
    expect(first.nextIdleSince.has('s1')).toBe(false);
    // Next tick it's idle again → clock starts fresh at `now`, not the old 0
    const second = computeIdleStops([session({ id: 's1' })], first.nextIdleSince, 2_000_000, THRESHOLD);
    expect(second.toStop).toEqual([]);
    expect(second.nextIdleSince.get('s1')).toBe(2_000_000);
  });
});
