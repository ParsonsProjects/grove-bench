import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { backgroundTaskStore } from './backgroundTask.svelte.js';
import type { AgentEvent } from '../../shared/types.js';
import { mockGroveBench } from '../__mocks__/setup.js';

const SID = 'test-session';

beforeEach(() => {
  vi.useFakeTimers();
  backgroundTaskStore.tasksBySession = {};
  mockGroveBench.stopBackgroundTask.mockClear();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('backgroundTaskStore', () => {
  it('start adds a running task', () => {
    backgroundTaskStore.start(SID, { type: 'task_started', taskId: 't1', description: 'Research', taskType: 'explore' } as Extract<AgentEvent, { type: 'task_started' }>);
    const tasks = backgroundTaskStore.get(SID);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('running');
    expect(tasks[0].description).toBe('Research');
  });

  it('progress merges into an existing task', () => {
    backgroundTaskStore.start(SID, { type: 'task_started', taskId: 't1', description: 'Research' } as any);
    backgroundTaskStore.progress(SID, { type: 'task_progress', taskId: 't1', description: 'Research', summary: 'Reading docs', totalTokens: 500, toolUses: 2, durationMs: 1000 } as any);
    const t = backgroundTaskStore.get(SID)[0];
    expect(t.summary).toBe('Reading docs');
    expect(t.totalTokens).toBe(500);
    expect(t.status).toBe('running');
  });

  it('notify sets terminal status and returns the message label/text', () => {
    backgroundTaskStore.start(SID, { type: 'task_started', taskId: 't1', description: 'Research' } as any);
    const info = backgroundTaskStore.notify(SID, { type: 'task_notification', taskId: 't1', taskStatus: 'completed', summary: 'Found 3 endpoints' } as any);
    expect(info).toEqual({ label: 'completed', text: 'Found 3 endpoints' });
    expect(backgroundTaskStore.get(SID)[0].status).toBe('completed');
  });

  it('notify falls back to prior description when summary is absent', () => {
    backgroundTaskStore.start(SID, { type: 'task_started', taskId: 't1', description: 'Research API' } as any);
    const info = backgroundTaskStore.notify(SID, { type: 'task_notification', taskId: 't1', taskStatus: 'failed' } as any);
    expect(info).toEqual({ label: 'failed', text: 'Research API' });
  });

  it('notify auto-removes the finished task after the delay', () => {
    backgroundTaskStore.start(SID, { type: 'task_started', taskId: 't1', description: 'Research' } as any);
    backgroundTaskStore.notify(SID, { type: 'task_notification', taskId: 't1', taskStatus: 'completed', summary: 'done' } as any);
    expect(backgroundTaskStore.get(SID)).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(backgroundTaskStore.get(SID)).toHaveLength(0);
  });

  it('resolveStale drops running tasks once idle, keeps finished ones', () => {
    backgroundTaskStore.tasksBySession[SID] = {
      t1: { taskId: 't1', description: 'a', status: 'running', totalTokens: 0, toolUses: 0, durationMs: 0 },
      t2: { taskId: 't2', description: 'b', status: 'completed', totalTokens: 10, toolUses: 1, durationMs: 5 },
    };
    backgroundTaskStore.resolveStale(SID, false);
    const tasks = backgroundTaskStore.get(SID);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].taskId).toBe('t2');
  });

  it('resolveStale is a no-op while the session is running', () => {
    backgroundTaskStore.tasksBySession[SID] = {
      t1: { taskId: 't1', description: 'a', status: 'running', totalTokens: 0, toolUses: 0, durationMs: 0 },
    };
    backgroundTaskStore.resolveStale(SID, true);
    expect(backgroundTaskStore.get(SID)).toHaveLength(1);
  });

  it('reconcile drops running tasks the SDK no longer lists and adds unknown ones', () => {
    backgroundTaskStore.tasksBySession[SID] = {
      gone: { taskId: 'gone', description: 'killed', status: 'running', totalTokens: 0, toolUses: 0, durationMs: 0 },
      kept: { taskId: 'kept', description: 'still going', status: 'running', totalTokens: 3, toolUses: 1, durationMs: 9 },
      done: { taskId: 'done', description: 'finished', status: 'completed', totalTokens: 10, toolUses: 1, durationMs: 5 },
    };
    backgroundTaskStore.reconcile(SID, {
      type: 'background_tasks_changed',
      tasks: [
        { taskId: 'kept', description: 'still going', taskType: 'subagent' },
        { taskId: 'new', description: 'started elsewhere', taskType: 'shell' },
      ],
    });
    const ids = backgroundTaskStore.get(SID).map((t) => t.taskId).sort();
    expect(ids).toEqual(['done', 'kept', 'new']);
    const kept = backgroundTaskStore.get(SID).find((t) => t.taskId === 'kept')!;
    expect(kept.totalTokens).toBe(3); // existing progress preserved
    const added = backgroundTaskStore.get(SID).find((t) => t.taskId === 'new')!;
    expect(added.status).toBe('running');
    expect(added.taskType).toBe('shell');
  });

  it('reconcile with an empty list clears every running task', () => {
    backgroundTaskStore.start(SID, { type: 'task_started', taskId: 't1', description: 'a' } as any);
    backgroundTaskStore.reconcile(SID, { type: 'background_tasks_changed', tasks: [] });
    expect(backgroundTaskStore.get(SID)).toHaveLength(0);
  });

  it('stop calls the bridge and marks the task as stopping until the notification lands', async () => {
    backgroundTaskStore.start(SID, { type: 'task_started', taskId: 't1', description: 'a' } as any);
    await backgroundTaskStore.stop(SID, 't1');
    expect(mockGroveBench.stopBackgroundTask).toHaveBeenCalledWith(SID, 't1');
    let t = backgroundTaskStore.get(SID)[0];
    expect(t.status).toBe('running');
    expect(t.stopping).toBe(true);

    // A second click while stopping is a no-op.
    await backgroundTaskStore.stop(SID, 't1');
    expect(mockGroveBench.stopBackgroundTask).toHaveBeenCalledTimes(1);

    backgroundTaskStore.notify(SID, { type: 'task_notification', taskId: 't1', taskStatus: 'stopped', summary: '', outputFile: '' } as any);
    t = backgroundTaskStore.get(SID)[0];
    expect(t.status).toBe('stopped');
    expect(t.stopping).toBe(false);
  });

  it('stop ignores tasks that are not running', async () => {
    backgroundTaskStore.tasksBySession[SID] = {
      t1: { taskId: 't1', description: 'a', status: 'completed', totalTokens: 0, toolUses: 0, durationMs: 0 },
    };
    await backgroundTaskStore.stop(SID, 't1');
    await backgroundTaskStore.stop(SID, 'missing');
    expect(mockGroveBench.stopBackgroundTask).not.toHaveBeenCalled();
  });

  it('stop clears the stopping flag and rethrows when the bridge fails', async () => {
    backgroundTaskStore.start(SID, { type: 'task_started', taskId: 't1', description: 'a' } as any);
    mockGroveBench.stopBackgroundTask.mockRejectedValueOnce(new Error('no handle'));
    await expect(backgroundTaskStore.stop(SID, 't1')).rejects.toThrow('no handle');
    const t = backgroundTaskStore.get(SID)[0];
    expect(t.status).toBe('running');
    expect(t.stopping).toBe(false);
  });

  it('remove deletes a single task', () => {
    backgroundTaskStore.start(SID, { type: 'task_started', taskId: 't1', description: 'a' } as any);
    backgroundTaskStore.start(SID, { type: 'task_started', taskId: 't2', description: 'b' } as any);
    backgroundTaskStore.remove(SID, 't1');
    expect(backgroundTaskStore.get(SID).map((t) => t.taskId)).toEqual(['t2']);
  });

  it('destroy cancels pending auto-remove timers and clears state', () => {
    backgroundTaskStore.start(SID, { type: 'task_started', taskId: 't1', description: 'a' } as any);
    backgroundTaskStore.notify(SID, { type: 'task_notification', taskId: 't1', taskStatus: 'completed', summary: 'done' } as any);
    backgroundTaskStore.destroy(SID);
    expect(backgroundTaskStore.get(SID)).toEqual([]);
    expect(backgroundTaskStore.tasksBySession[SID]).toBeUndefined();
    // Advancing time must not throw or resurrect state via a leaked timer.
    vi.advanceTimersByTime(3000);
    expect(backgroundTaskStore.tasksBySession[SID]).toBeUndefined();
  });
});
