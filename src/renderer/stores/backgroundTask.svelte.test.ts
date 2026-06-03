import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { backgroundTaskStore } from './backgroundTask.svelte.js';
import type { AgentEvent } from '../../shared/types.js';

const SID = 'test-session';

beforeEach(() => {
  vi.useFakeTimers();
  backgroundTaskStore.tasksBySession = {};
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
