import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import {
  computeIdleSleeps, describeIdleReason, IdleLog, IDLE_SUMMARY_EVERY, startIdleManager,
  type IdleReason, type IdleSnapshotSession,
} from './idle-manager.js';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
import type { AgentEvent } from '../../shared/types.js';

function session(over: Partial<IdleSnapshotSession> & { id: string }): IdleSnapshotSession {
  return { status: 'running', isActive: false, ...over };
}

const MINUTE = 60_000;
const THRESHOLD = 30 * MINUTE;

describe('computeIdleSleeps', () => {
  it('counts idle time from the last activity, not from when the thread was left', () => {
    // Finished a turn at 0, first seen unfocused at 20m.
    const s = [session({ id: 's1', lastActiveAt: 0 })];
    const seen = new Map([['s1', 20 * MINUTE]]);
    expect(computeIdleSleeps(s, seen, THRESHOLD - 1, THRESHOLD).toSleep).toEqual([]);
    const { toSleep, reasons } = computeIdleSleeps(s, seen, THRESHOLD, THRESHOLD);
    expect(toSleep).toEqual(['s1']);
    expect(reasons.get('s1')).toEqual({ kind: 'asking', idleMs: THRESHOLD });
  });

  it('never asks on the first tick a thread is seen unfocused, however long it has been idle', () => {
    const s = [session({ id: 's1', lastActiveAt: 0 })];
    const first = computeIdleSleeps(s, new Map(), THRESHOLD * 4, THRESHOLD);
    expect(first.toSleep).toEqual([]);
    expect(first.nextUnfocusedSince.get('s1')).toBe(THRESHOLD * 4);
    expect(first.reasons.get('s1')).toEqual({ kind: 'counting', idleMs: THRESHOLD * 4, since: 'activity' });
    // The next tick it is.
    const second = computeIdleSleeps(s, first.nextUnfocusedSince, THRESHOLD * 4 + MINUTE, THRESHOLD);
    expect(second.toSleep).toEqual(['s1']);
    expect(second.nextUnfocusedSince.get('s1')).toBe(THRESHOLD * 4); // first sighting kept
  });

  it('counts from the first unfocused tick when the thread has no recorded activity', () => {
    const s = [session({ id: 's1' })];
    const first = computeIdleSleeps(s, new Map(), 1000, THRESHOLD);
    expect(first.reasons.get('s1')).toEqual({ kind: 'counting', idleMs: 0, since: 'left' });
    expect(computeIdleSleeps(s, first.nextUnfocusedSince, 1000 + THRESHOLD - 1, THRESHOLD).toSleep).toEqual([]);
    expect(computeIdleSleeps(s, first.nextUnfocusedSince, 1000 + THRESHOLD, THRESHOLD).toSleep).toEqual(['s1']);
  });

  it('counts from activity that came after the thread was left (a queued prompt sent)', () => {
    const s = [session({ id: 's1', lastActiveAt: 10 * MINUTE })];
    const seen = new Map([['s1', 0]]);
    expect(computeIdleSleeps(s, seen, 35 * MINUTE, THRESHOLD).toSleep).toEqual([]);
    expect(computeIdleSleeps(s, seen, 40 * MINUTE, THRESHOLD).toSleep).toEqual(['s1']);
  });

  it('never asks about the focused thread, but focusing it does not restart its clock', () => {
    const s = (isActive: boolean) => [session({ id: 's1', lastActiveAt: 0, isActive })];
    // Unfocused at 10m, opened at 20m (to clear its unread flag), left again.
    let seen = computeIdleSleeps(s(false), new Map(), 10 * MINUTE, THRESHOLD).nextUnfocusedSince;
    const focused = computeIdleSleeps(s(true), seen, 20 * MINUTE, THRESHOLD);
    expect(focused.toSleep).toEqual([]);
    expect(focused.reasons.get('s1')).toEqual({ kind: 'focused' });
    expect(focused.nextUnfocusedSince.has('s1')).toBe(false);
    seen = computeIdleSleeps(s(false), focused.nextUnfocusedSince, 22 * MINUTE, THRESHOLD).nextUnfocusedSince;
    // 30 minutes after the turn ended, not 30 after it was left.
    expect(computeIdleSleeps(s(false), seen, THRESHOLD, THRESHOLD).toSleep).toEqual(['s1']);
  });

  it('asks only about running threads (sleeping, stopped, starting, error are left alone)', () => {
    const statuses = ['sleeping', 'stopped', 'starting', 'error'];
    const sessions = statuses.map((status) => session({ id: status, status, lastActiveAt: 0 }));
    const seen = new Map(statuses.map((id) => [id, 0] as [string, number]));
    const { toSleep, nextUnfocusedSince, reasons } = computeIdleSleeps(sessions, seen, THRESHOLD * 2, THRESHOLD);
    expect(toSleep).toEqual([]);
    expect(nextUnfocusedSince.size).toBe(0);
    expect(reasons.get('starting')).toEqual({ kind: 'status', status: 'starting' });
  });

  it('does not ask again while an earlier ask is unanswered', () => {
    const s = [session({ id: 's1', lastActiveAt: 0 })];
    const seen = new Map([['s1', 0]]);
    const { toSleep, reasons } = computeIdleSleeps(s, seen, THRESHOLD * 2, THRESHOLD, new Set(['s1']));
    expect(toSleep).toEqual([]);
    expect(reasons.get('s1')).toEqual({ kind: 'waiting', idleMs: THRESHOLD * 2 });
  });

  it('asks once per tick about a thread listed twice', () => {
    const s = [session({ id: 's1', lastActiveAt: 0 }), session({ id: 's1', lastActiveAt: 0 })];
    expect(computeIdleSleeps(s, new Map([['s1', 0]]), THRESHOLD, THRESHOLD).toSleep).toEqual(['s1']);
  });

  it('is disabled when threshold is 0', () => {
    const s = [session({ id: 's1', lastActiveAt: 0 })];
    const { toSleep, nextUnfocusedSince, reasons } = computeIdleSleeps(s, new Map([['s1', 0]]), THRESHOLD * 10, 0);
    expect(toSleep).toEqual([]);
    expect(nextUnfocusedSince.size).toBe(0);
    expect(reasons.size).toBe(0);
  });
});

describe('IdleLog', () => {
  const reasons = (entries: Record<string, IdleReason>) => new Map(Object.entries(entries));
  const counting = (min: number): IdleReason => ({ kind: 'counting', idleMs: min * MINUTE, since: 'activity' });

  it('writes a line when a thread\'s reason changes, not each tick its idle minutes go up', () => {
    const log = new IdleLog();
    expect(log.lines(reasons({ a: { kind: 'focused' }, b: { kind: 'status', status: 'starting' } }), THRESHOLD, 2)).toEqual([
      'threshold 30m',
      'session=a focused',
      'session=b status starting',
    ]);
    expect(log.lines(reasons({ a: counting(1), b: { kind: 'status', status: 'starting' } }), THRESHOLD, 2)).toEqual([
      'session=a idle 1m of 30m since its last activity',
    ]);
    // Only the minutes moved: nothing to say.
    expect(log.lines(reasons({ a: counting(2), b: { kind: 'status', status: 'starting' } }), THRESHOLD, 2)).toEqual([]);
    expect(log.lines(reasons({ a: { kind: 'asking', idleMs: THRESHOLD }, b: counting(0) }), THRESHOLD, 2)).toEqual([
      'session=a idle 30m of 30m, asking main to sleep it',
      'session=b idle 0m of 30m since its last activity',
    ]);
    // Asked again after main refused: still the same reason.
    expect(log.lines(reasons({ a: { kind: 'asking', idleMs: THRESHOLD + MINUTE }, b: counting(1) }), THRESHOLD, 2)).toEqual([]);
    expect(log.lines(reasons({ a: { kind: 'status', status: 'sleeping' }, b: counting(2) }), THRESHOLD, 2)).toEqual([
      'session=a status sleeping',
    ]);
  });

  it('adds a short summary every 10 ticks', () => {
    const log = new IdleLog();
    const tick = () => log.lines(reasons({
      a: counting(5), b: { kind: 'focused' }, c: { kind: 'asking', idleMs: THRESHOLD }, d: { kind: 'waiting', idleMs: THRESHOLD },
      e: { kind: 'status', status: 'sleeping' }, f: { kind: 'status', status: 'stopped' }, g: { kind: 'status', status: 'stopped' },
    }), THRESHOLD, 7);
    expect(tick()).toHaveLength(8); // the setting, then each thread once
    for (let i = 2; i < IDLE_SUMMARY_EVERY; i++) expect(tick()).toEqual([]);
    expect(tick()).toEqual(['7 threads, threshold 30m: 1 counting, 1 focused, 2 asked, 1 sleeping, 2 stopped']);
    expect(tick()).toEqual([]);
  });

  it('writes no summary with no threads open', () => {
    const log = new IdleLog();
    const lines: string[] = [];
    for (let i = 0; i < IDLE_SUMMARY_EVERY * 2; i++) lines.push(...log.lines(new Map(), THRESHOLD, 0));
    expect(lines).toEqual(['threshold 30m']);
  });

  it('says once when idle sleep is turned off, and logs each thread afresh when it is back on', () => {
    const log = new IdleLog();
    expect(log.lines(reasons({ a: counting(1) }), THRESHOLD, 1)).toEqual(['threshold 30m', 'session=a idle 1m of 30m since its last activity']);
    expect(log.lines(new Map(), 0, 1)).toEqual(['idle sleep is off']);
    expect(log.lines(new Map(), 0, 1)).toEqual([]);
    expect(log.lines(reasons({ a: counting(3) }), 45 * MINUTE, 1)).toEqual(['threshold 45m', 'session=a idle 3m of 45m since its last activity']);
  });

  it('describes a thread seen unfocused for the first tick, already past the threshold', () => {
    expect(describeIdleReason({ kind: 'counting', idleMs: 125 * MINUTE + 30_000, since: 'activity' }, THRESHOLD))
      .toBe('idle 125m of 30m since its last activity, asks next tick');
    expect(describeIdleReason({ kind: 'counting', idleMs: 0, since: 'left' }, 0.5 * MINUTE))
      .toBe('idle 0m of 0.5m since it was left (no activity recorded)');
  });
});

describe('startIdleManager', () => {
  /** A thread in the list, not the open one, whose agent is up. */
  function liveThread(id: string, over: { lastActiveAt?: number; displayName?: string } = {}) {
    store.addSession({ id, branch: 'b', repoPath: '/repo', status: 'running', createdAt: 0, ...over }, false);
  }

  /** A turn that ran a command as a task, as Claude Code reports it. */
  function turnWithTask(id: string, taskId: string, events: AgentEvent[]) {
    messageStore.addUserMessage(id, 'run the tests');
    messageStore.ingestEvent(id, { type: 'system_init', sessionId: 'p', model: 'm', tools: [] } as AgentEvent);
    messageStore.ingestEvent(id, { type: 'assistant_tool_use', toolName: 'Bash', toolInput: {}, toolUseId: `tu-${taskId}`, uuid: `u-${taskId}` });
    messageStore.ingestEvent(id, { type: 'task_started', taskId, toolUseId: `tu-${taskId}`, description: 'npm test' });
    for (const event of events) messageStore.ingestEvent(id, event);
    messageStore.ingestEvent(id, { type: 'tool_result', toolUseId: `tu-${taskId}`, content: 'ok', isError: false } as AgentEvent);
    messageStore.ingestEvent(id, { type: 'result', subtype: 'success', isError: false } as AgentEvent);
  }

  // The bridge's mocks are typed without arguments.
  const sleepSession = mockGroveBench.sleepSession as unknown as Mock<(id: string) => Promise<boolean>>;
  /** How many times main was asked to put `id` to sleep. */
  const asks = (id: string) => sleepSession.mock.calls.filter(([x]) => x === id).length;
  const logged = () => (mockGroveBench.logIdle as unknown as Mock<(line: string) => void>).mock.calls.map(([line]) => line);
  /** Main puts it to sleep, as SESSION_SLEEP and the status it sends do. */
  const mainSleepsIt = () => sleepSession.mockImplementation(async (id: string) => {
    store.updateStatus(id, 'sleeping');
    return true;
  });

  let stop: (() => void) | null = null;
  const savedSettings = settingsStore.current;

  beforeEach(() => {
    vi.useFakeTimers();
    store.sessions = [];
    store.activeSessionId = null;
    mockGroveBench.sleepSession.mockClear();
    mockGroveBench.logIdle.mockClear();
    settingsStore.current = { ...savedSettings, idleSleepMinutes: 30 };
  });

  afterEach(() => {
    stop?.();
    stop = null;
    messageStore.destroyAllSessions();
    store.sessions = [];
    store.activeSessionId = null;
    settingsStore.current = savedSettings;
    // Reset, not clear: an unused once-answer must not leak into the next test.
    mockGroveBench.sleepSession.mockReset();
    mockGroveBench.sleepSession.mockImplementation(() => Promise.resolve(true));
    vi.useRealTimers();
  });

  it('asks main to put a thread to sleep once it has been idle past the threshold', () => {
    liveThread('t1');
    turnWithTask('t1', 'task-1', [
      { type: 'task_notification', taskId: 'task-1', taskStatus: 'completed', summary: '', outputFile: '' },
    ]);
    // The finished turn is the thread's last activity.
    expect(store.sessions[0].lastActiveAt).toBe(Date.now());
    stop = startIdleManager();

    vi.advanceTimersByTime(29 * MINUTE);
    expect(mockGroveBench.sleepSession).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3 * MINUTE);
    expect(mockGroveBench.sleepSession).toHaveBeenCalledWith('t1');
  });

  // The thread's task list pairs task_started with task_notification. A
  // missed notification (the SDK warns these can go missing; a task of an
  // agent that has since been restarted never gets one) leaves the task
  // listed as running for good, and the thread was then never put to sleep.
  it('is not kept awake by a task the agent never reported ending', () => {
    liveThread('t1');
    turnWithTask('t1', 'task-1', []);
    expect(backgroundTaskStore.get('t1').some((t) => t.status === 'running')).toBe(true);
    stop = startIdleManager();

    vi.advanceTimersByTime(32 * MINUTE);
    expect(mockGroveBench.sleepSession).toHaveBeenCalledWith('t1');
  });

  // A progress update that comes after the task's notification, once the
  // finished task has left the list, puts it back as running.
  it('is not kept awake by a progress update that arrives after the task ended', () => {
    liveThread('t1');
    turnWithTask('t1', 'task-1', [
      { type: 'task_notification', taskId: 'task-1', taskStatus: 'completed', summary: '', outputFile: '' },
    ]);
    vi.advanceTimersByTime(5_000);
    messageStore.ingestEvent('t1', {
      type: 'task_progress', taskId: 'task-1', description: 'npm test', totalTokens: 0, toolUses: 1, durationMs: 9_000,
    });
    expect(backgroundTaskStore.get('t1').some((t) => t.status === 'running')).toBe(true);
    stop = startIdleManager();

    vi.advanceTimersByTime(32 * MINUTE);
    expect(mockGroveBench.sleepSession).toHaveBeenCalledWith('t1');
  });

  it('never asks about the open thread', () => {
    liveThread('open', { lastActiveAt: Date.now() - 3 * 60 * MINUTE });
    store.activeSessionId = 'open';
    stop = startIdleManager();

    vi.advanceTimersByTime(90 * MINUTE);
    expect(mockGroveBench.sleepSession).not.toHaveBeenCalled();
    expect(logged()).toContain('session=open focused');
  });

  // Opening a thread to read it, or to clear its unread flag, used to start
  // its 30 minutes again from when it was left.
  it('counts from the last activity, so opening a thread does not restart the clock', async () => {
    liveThread('t1');
    liveThread('t2');
    messageStore.ingestEvent('t1', { type: 'result', subtype: 'success', isError: false } as AgentEvent);
    mainSleepsIt();
    stop = startIdleManager();

    await vi.advanceTimersByTimeAsync(20 * MINUTE);
    store.activeSessionId = 't1';
    await vi.advanceTimersByTimeAsync(1 * MINUTE);
    store.activeSessionId = 't2';
    await vi.advanceTimersByTimeAsync(8 * MINUTE);
    expect(asks('t1')).toBe(0);
    await vi.advanceTimersByTimeAsync(1 * MINUTE);
    // 30 minutes after its turn ended, not 30 after it was left.
    expect(asks('t1')).toBe(1);
    expect(store.sessions.find((s) => s.id === 't1')?.status).toBe('sleeping');
  });

  it('puts a thread idle for long to sleep on the tick after it is left, not the moment it is left', async () => {
    liveThread('old', { lastActiveAt: Date.now() - 2 * 60 * MINUTE });
    liveThread('other');
    store.activeSessionId = 'old';
    mainSleepsIt();
    stop = startIdleManager();

    await vi.advanceTimersByTimeAsync(MINUTE);
    store.activeSessionId = 'other';
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(asks('old')).toBe(0);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(asks('old')).toBe(1);
    expect(logged().filter((l) => l.startsWith('session=old'))).toEqual([
      'session=old focused',
      'session=old idle 122m of 30m since its last activity, asks next tick',
      'session=old idle 123m of 30m, asking main to sleep it',
    ]);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(logged()).toContain('session=old status sleeping');
  });

  // Main refuses mid-turn and open prompts itself. The renderer's view can
  // be stuck: a thread resumed from a history that ends mid-turn reads as
  // running for good, and one that ends on an unanswered prompt as waiting.
  it('asks about threads mid-turn or waiting on a permission, and leaves them awake when main refuses', async () => {
    liveThread('busy');
    liveThread('perm');
    messageStore.addUserMessage('busy', 'keep going');
    messageStore.ingestEvent('perm', {
      type: 'permission_request', toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 'tu-1', requestId: 'req-1',
    } as AgentEvent);
    expect(messageStore.getIsRunning('busy')).toBe(true);
    expect(messageStore.hasPendingPermission('perm')).toBe(true);
    mockGroveBench.sleepSession.mockResolvedValue(false);
    stop = startIdleManager();

    // No recorded activity: counted from the first tick they were seen.
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(mockGroveBench.sleepSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(asks('busy')).toBe(1);
    expect(asks('perm')).toBe(1);
    // Refused: still awake, and asked again on each later tick.
    expect(store.sessions.map((s) => s.status)).toEqual(['running', 'running']);
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(asks('busy')).toBe(3);
    expect(asks('perm')).toBe(3);
    // Logged once, when it was first asked.
    expect(logged().filter((l) => l.includes('asking main'))).toEqual([
      'session=busy idle 30m of 30m, asking main to sleep it',
      'session=perm idle 30m of 30m, asking main to sleep it',
    ]);
  });

  it('asks again after a refusal, but not while main has yet to answer the last ask', async () => {
    liveThread('t1', { lastActiveAt: Date.now() - 60 * MINUTE });
    let answer: (slept: boolean) => void = () => {};
    mockGroveBench.sleepSession.mockImplementationOnce(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    mockGroveBench.sleepSession.mockResolvedValue(false);
    stop = startIdleManager();

    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(asks('t1')).toBe(1);
    // Main is slow to answer: no second call stacked on the first.
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(asks('t1')).toBe(1);
    expect(logged()).toContain('session=t1 idle 63m of 30m, still waiting on main\'s answer to the last ask');
    answer(false);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(asks('t1')).toBe(2);
    // Refused at once from now on: once a tick.
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(asks('t1')).toBe(5);
  });

  it('keeps going, and logs it, when the ask itself fails', async () => {
    liveThread('t1', { lastActiveAt: Date.now() - 60 * MINUTE });
    mockGroveBench.sleepSession.mockRejectedValueOnce(new Error('no handler'));
    mainSleepsIt();
    stop = startIdleManager();

    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(logged()).toContain('session=t1 sleep request failed: no handler');
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(asks('t1')).toBe(2);
    expect(store.sessions[0].status).toBe('sleeping');
  });

  it('is off when the setting is 0', () => {
    settingsStore.current = { ...savedSettings, idleSleepMinutes: 0 };
    liveThread('t1', { lastActiveAt: Date.now() - 3 * 60 * MINUTE });
    stop = startIdleManager();

    vi.advanceTimersByTime(90 * MINUTE);
    expect(mockGroveBench.sleepSession).not.toHaveBeenCalled();
    expect(logged().filter((l) => !l.endsWith('idle sleep off'))).toEqual(['idle sleep is off']);
  });

  it('logs each thread\'s reason when it changes, a summary every 10 ticks, and nothing in between', () => {
    liveThread('t1', { lastActiveAt: Date.now() });
    store.addSession({ id: 't2', branch: 'b', repoPath: '/repo', status: 'stopped', createdAt: 0 }, false);
    stop = startIdleManager();

    vi.advanceTimersByTime(MINUTE);
    expect(logged()).toEqual([
      'threshold 30m',
      'session=t1 idle 1m of 30m since its last activity',
      'session=t2 status stopped',
    ]);
    mockGroveBench.logIdle.mockClear();
    vi.advanceTimersByTime(8 * MINUTE);
    expect(logged()).toEqual([]);
    vi.advanceTimersByTime(MINUTE);
    expect(logged()).toEqual(['2 threads, threshold 30m: 1 counting, 0 focused, 0 asked, 1 stopped']);
    mockGroveBench.logIdle.mockClear();
    store.activeSessionId = 't1';
    vi.advanceTimersByTime(MINUTE);
    expect(logged()).toEqual(['session=t1 focused']);
  });

  it('names threads by id only, never by name or prompt', () => {
    liveThread('t1', { displayName: 'Rotate the secret keys' });
    messageStore.addUserMessage('t1', 'the secret prompt');
    mockGroveBench.sleepSession.mockResolvedValue(false);
    stop = startIdleManager();

    vi.advanceTimersByTime(40 * MINUTE);
    expect(logged().length).toBeGreaterThan(0);
    expect(logged().filter((l) => /secret|Rotate/.test(l))).toEqual([]);
  });
});
