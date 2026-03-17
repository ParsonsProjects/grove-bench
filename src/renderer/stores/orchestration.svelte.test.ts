import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockGroveBench } from '../__mocks__/setup.js';

import { orchStore } from './orchestration.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';
import type { OrchJob, OrchTask, OrchEvent, OrchOverlapWarning } from '../../shared/types.js';

function makeTask(overrides: Partial<OrchTask> = {}): OrchTask {
  return {
    id: 'task_1',
    jobId: 'job-1',
    description: 'Test task',
    branchName: 'orch/abc/task-1',
    baseBranch: 'main',
    scope: [],
    priority: 1,
    parallelizable: true,
    dependsOn: [],
    sessionId: null,
    status: 'pending',
    instruction: 'Do the thing',
    createdAt: Date.now(),
    completedAt: null,
    error: null,
    costUsd: null,
    startedAt: null,
    durationMs: null,
    timeoutMs: null,
    mergeStatus: null,
    mergeError: null,
    progressSummary: null,
    ...overrides,
  };
}

function makeJob(overrides: Partial<OrchJob> = {}): OrchJob {
  return {
    id: 'job-1',
    repoPath: '/repo/test',
    goal: 'Implement feature',
    baseBranch: 'main',
    tasks: [makeTask({ id: 'task_1' }), makeTask({ id: 'task_2' })],
    status: 'planning',
    createdAt: Date.now(),
    completedAt: null,
    planDurationMs: null,
    totalCostUsd: null,
    planSessionId: 'plan_1',
    overlapWarnings: [],
    mergeResults: [],
    mergeWorktreeId: null,
    defaultTimeoutMs: 600000,
    circuitBreakerThreshold: 50,
    destroyedSessionIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  orchStore.jobs = [];
  orchStore.activeJobId = null;
  orchStore.planning = false;
  sessionStore.sessions = [];
  sessionStore.activeSessionId = null;
});

describe('addJob / removeJob', () => {
  it('adds a job and subscribes to events', () => {
    const job = makeJob();
    orchStore.addJob(job);
    expect(orchStore.jobs).toHaveLength(1);
    expect(mockGroveBench.onOrchEvent).toHaveBeenCalledWith('job-1', expect.any(Function));
  });

  it('removes a job and clears activeJobId', () => {
    orchStore.addJob(makeJob());
    orchStore.activeJobId = 'job-1';

    orchStore.removeJob('job-1');
    expect(orchStore.jobs).toHaveLength(0);
    expect(orchStore.activeJobId).toBeNull();
    expect(mockGroveBench.offOrchEvent).toHaveBeenCalledWith('job-1');
  });
});

describe('activeJob', () => {
  it('returns null when no active job', () => {
    expect(orchStore.activeJob).toBeNull();
  });

  it('returns the active job', () => {
    orchStore.addJob(makeJob({ id: 'j1' }));
    orchStore.activeJobId = 'j1';
    expect(orchStore.activeJob!.id).toBe('j1');
  });
});

describe('jobsForRepo', () => {
  it('filters jobs by repo', () => {
    orchStore.addJob(makeJob({ id: 'j1', repoPath: '/repo/a' }));
    orchStore.addJob(makeJob({ id: 'j2', repoPath: '/repo/b' }));
    orchStore.addJob(makeJob({ id: 'j3', repoPath: '/repo/a' }));

    expect(orchStore.jobsForRepo('/repo/a')).toHaveLength(2);
    expect(orchStore.jobsForRepo('/repo/b')).toHaveLength(1);
    expect(orchStore.jobsForRepo('/repo/c')).toHaveLength(0);
  });
});

describe('jobForSession', () => {
  it('finds job by planSessionId', () => {
    orchStore.addJob(makeJob({ id: 'j1', planSessionId: 'plan-abc' }));
    expect(orchStore.jobForSession('plan-abc')!.id).toBe('j1');
  });

  it('returns undefined for unknown session', () => {
    expect(orchStore.jobForSession('unknown')).toBeUndefined();
  });
});

describe('updateJob', () => {
  it('merges partial updates', () => {
    orchStore.addJob(makeJob({ id: 'j1', status: 'planning' }));
    orchStore.updateJob('j1', { status: 'planned' });
    expect(orchStore.jobs[0].status).toBe('planned');
  });
});

describe('updateTaskStatus', () => {
  it('updates task status', () => {
    orchStore.addJob(makeJob());
    orchStore.updateTaskStatus('job-1', 'task_1', 'running');
    const task = orchStore.jobs[0].tasks.find(t => t.id === 'task_1')!;
    expect(task.status).toBe('running');
  });

  it('sets completedAt on terminal status', () => {
    orchStore.addJob(makeJob());
    orchStore.updateTaskStatus('job-1', 'task_1', 'completed');
    const task = orchStore.jobs[0].tasks.find(t => t.id === 'task_1')!;
    expect(task.completedAt).toBeGreaterThan(0);
  });

  it('clears progressSummary on terminal status', () => {
    orchStore.addJob(makeJob({
      tasks: [makeTask({ id: 'task_1', progressSummary: 'Editing files...' })],
    }));
    orchStore.updateTaskStatus('job-1', 'task_1', 'failed', 'timeout');
    const task = orchStore.jobs[0].tasks.find(t => t.id === 'task_1')!;
    expect(task.progressSummary).toBeNull();
    expect(task.error).toBe('timeout');
  });

  it('does not set completedAt for non-terminal status', () => {
    orchStore.addJob(makeJob());
    orchStore.updateTaskStatus('job-1', 'task_1', 'running');
    const task = orchStore.jobs[0].tasks.find(t => t.id === 'task_1')!;
    expect(task.completedAt).toBeNull();
  });
});

describe('ingestEvent', () => {
  beforeEach(() => {
    orchStore.addJob(makeJob());
  });

  it('orch_plan_complete updates tasks and status', () => {
    const newTasks = [makeTask({ id: 't1', description: 'New task' })];
    orchStore.ingestEvent({ type: 'orch_plan_complete', jobId: 'job-1', tasks: newTasks });

    expect(orchStore.jobs[0].tasks).toEqual(newTasks);
    expect(orchStore.jobs[0].status).toBe('planned');
  });

  it('orch_plan_error marks job as failed', () => {
    orchStore.ingestEvent({ type: 'orch_plan_error', jobId: 'job-1', error: 'SDK error' });
    expect(orchStore.jobs[0].status).toBe('failed');
  });

  it('orch_task_status updates task', () => {
    orchStore.ingestEvent({ type: 'orch_task_status', jobId: 'job-1', taskId: 'task_1', status: 'running' });
    expect(orchStore.jobs[0].tasks[0].status).toBe('running');
  });

  it('orch_job_status updates job status', () => {
    orchStore.ingestEvent({ type: 'orch_job_status', jobId: 'job-1', status: 'running' });
    expect(orchStore.jobs[0].status).toBe('running');
  });

  it('orch_task_session creates child session', () => {
    orchStore.ingestEvent({
      type: 'orch_task_session',
      jobId: 'job-1',
      taskId: 'task_1',
      sessionId: 'child-1',
      branch: 'orch/abc/task-1',
      repoPath: '/repo/test',
      parentSessionId: 'plan_1',
    });

    const childSession = sessionStore.sessions.find(s => s.id === 'child-1');
    expect(childSession).toBeDefined();
    expect(childSession!.parentSessionId).toBe('plan_1');
    expect(childSession!.status).toBe('running');
  });

  it('orch_task_session does not duplicate existing session', () => {
    sessionStore.addSession({
      id: 'child-1',
      branch: 'orch/abc/task-1',
      repoPath: '/repo/test',
      status: 'running',
    }, false);

    orchStore.ingestEvent({
      type: 'orch_task_session',
      jobId: 'job-1',
      taskId: 'task_1',
      sessionId: 'child-1',
      branch: 'orch/abc/task-1',
      repoPath: '/repo/test',
      parentSessionId: 'plan_1',
    });

    const matches = sessionStore.sessions.filter(s => s.id === 'child-1');
    expect(matches).toHaveLength(1);
  });

  it('orch_overlap_warning stores warnings', () => {
    const warnings: OrchOverlapWarning[] = [
      { taskA: 'task_1', taskB: 'task_2', files: ['src/shared.ts'] },
    ];
    orchStore.ingestEvent({ type: 'orch_overlap_warning', jobId: 'job-1', warnings });
    expect(orchStore.jobs[0].overlapWarnings).toEqual(warnings);
  });

  it('orch_merge_start sets status to merging', () => {
    orchStore.ingestEvent({ type: 'orch_merge_start', jobId: 'job-1' });
    expect(orchStore.jobs[0].status).toBe('merging');
  });

  it('orch_merge_task updates task merge status and appends result', () => {
    orchStore.ingestEvent({
      type: 'orch_merge_task',
      jobId: 'job-1',
      taskId: 'task_1',
      status: 'merged',
    });

    const task = orchStore.jobs[0].tasks[0];
    expect(task.mergeStatus).toBe('merged');
    expect(orchStore.jobs[0].mergeResults).toHaveLength(1);
    expect(orchStore.jobs[0].mergeResults[0].status).toBe('merged');
  });

  it('orch_merge_task records conflict error', () => {
    orchStore.ingestEvent({
      type: 'orch_merge_task',
      jobId: 'job-1',
      taskId: 'task_1',
      status: 'conflict',
      error: 'src/file.ts has conflicts',
    });

    const task = orchStore.jobs[0].tasks[0];
    expect(task.mergeStatus).toBe('conflict');
    expect(task.mergeError).toBe('src/file.ts has conflicts');
  });

  it('orch_task_progress updates progressSummary', () => {
    orchStore.ingestEvent({
      type: 'orch_task_progress',
      jobId: 'job-1',
      taskId: 'task_1',
      summary: 'Writing tests...',
    });

    expect(orchStore.jobs[0].tasks[0].progressSummary).toBe('Writing tests...');
  });

  it('orch_task_timeout marks task as failed with timeout message', () => {
    orchStore.ingestEvent({
      type: 'orch_task_timeout',
      jobId: 'job-1',
      taskId: 'task_1',
    });

    const task = orchStore.jobs[0].tasks[0];
    expect(task.status).toBe('failed');
    expect(task.error).toBe('Task timed out');
  });

  it('orch_circuit_breaker is handled without error', () => {
    // Circuit breaker events are informational — individual task cancellations
    // arrive as separate orch_task_status events
    expect(() => {
      orchStore.ingestEvent({
        type: 'orch_circuit_breaker',
        jobId: 'job-1',
        failedCount: 3,
        totalCount: 5,
      });
    }).not.toThrow();
  });

  it('orch_merge_complete is handled without error', () => {
    expect(() => {
      orchStore.ingestEvent({
        type: 'orch_merge_complete',
        jobId: 'job-1',
        allMerged: true,
      });
    }).not.toThrow();
  });
});

describe('loadPersistedJobs', () => {
  it('loads jobs from API', async () => {
    const runningJob = makeJob({ id: 'j1', status: 'running' });
    const completedJob = makeJob({ id: 'j2', status: 'completed' });
    mockGroveBench.listOrchJobs.mockResolvedValue([runningJob, completedJob]);

    await orchStore.loadPersistedJobs();

    expect(orchStore.jobs).toHaveLength(2);
    expect(orchStore.jobs.map(j => j.id)).toContain('j1');
    expect(orchStore.jobs.map(j => j.id)).toContain('j2');
  });

  it('does not duplicate already-loaded jobs', async () => {
    orchStore.addJob(makeJob({ id: 'j1' }));
    mockGroveBench.listOrchJobs.mockResolvedValue([makeJob({ id: 'j1' })]);

    await orchStore.loadPersistedJobs();
    expect(orchStore.jobs).toHaveLength(1);
  });

  it('handles API failure gracefully', async () => {
    mockGroveBench.listOrchJobs.mockRejectedValue(new Error('network error'));
    await expect(orchStore.loadPersistedJobs()).resolves.toBeUndefined();
  });
});
