import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';
import { computeIdleSleeps, startIdleManager, type IdleSnapshotSession } from './idle-manager.js';
import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
import type { AgentEvent } from '../../shared/types.js';

function session(over: Partial<IdleSnapshotSession> & { id: string }): IdleSnapshotSession {
  return { status: 'running', isActive: false, isRunning: false, hasPending: false, ...over };
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

describe('startIdleManager', () => {
  const MINUTE = 60_000;

  /** A thread in the list, not the open one, whose agent is up. */
  function liveThread(id: string) {
    store.addSession({ id, branch: 'b', repoPath: '/repo', status: 'running', createdAt: 0 }, false);
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

  let stop: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    store.sessions = [];
    store.activeSessionId = null;
    mockGroveBench.sleepSession.mockClear();
  });

  afterEach(() => {
    stop?.();
    stop = null;
    messageStore.destroyAllSessions();
    store.sessions = [];
    vi.useRealTimers();
  });

  it('asks main to put a thread to sleep once it has been idle past the threshold', () => {
    liveThread('t1');
    turnWithTask('t1', 'task-1', [
      { type: 'task_notification', taskId: 'task-1', taskStatus: 'completed', summary: '', outputFile: '' },
    ]);
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

  it('leaves the open thread and one mid-turn awake', () => {
    liveThread('open');
    liveThread('busy');
    store.activeSessionId = 'open';
    messageStore.addUserMessage('busy', 'keep going');
    stop = startIdleManager();

    vi.advanceTimersByTime(90 * MINUTE);
    expect(mockGroveBench.sleepSession).not.toHaveBeenCalled();
  });
});
