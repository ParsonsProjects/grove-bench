import { describe, it, expect, beforeEach } from 'vitest';
import { PipelineDb } from './pipeline-db.js';
import type { PipelineDoc, TaskDoc, PipelineRoleId } from '../shared/types.js';

function makePipelineDoc(overrides: Partial<Omit<PipelineDoc, '_id'>> = {}): Omit<PipelineDoc, '_id'> {
  return {
    repoPath: '/test/repo',
    branch: 'feature/test',
    worktreeId: 'wt-1234',
    worktreePath: '/test/worktree',
    templateId: 'full',
    status: 'running',
    createdAt: '2026-04-04T10:00:00Z',
    updatedAt: '2026-04-04T10:00:00Z',
    currentStageIndex: 0,
    totalCost: 0,
    context: 'Build a login page',
    stages: [
      { role: 'planner', status: 'running', sessionId: 's1', taskId: null, startedAt: '2026-04-04T10:00:00Z', completedAt: null, cost: 0, gate: true },
      { role: 'engineer', status: 'pending', sessionId: null, taskId: null, startedAt: null, completedAt: null, cost: 0, gate: false },
    ],
    ...overrides,
  };
}

function makeTaskDoc(overrides: Partial<Omit<TaskDoc, '_id'>> = {}): Omit<TaskDoc, '_id'> {
  return {
    pipelineId: 'pipe-1',
    title: 'Implement login page',
    body: 'Build the login page with email/password.',
    status: 'planned',
    assignedRole: 'engineer' as PipelineRoleId,
    priority: 2,
    branch: null,
    labels: [],
    createdAt: '2026-04-04T10:00:00Z',
    updatedAt: '2026-04-04T10:00:00Z',
    ...overrides,
  };
}

describe('PipelineDb', () => {
  let db: PipelineDb;

  beforeEach(() => {
    db = PipelineDb.inMemory();
  });

  describe('pipelines', () => {
    it('creates and retrieves a pipeline', async () => {
      const doc = makePipelineDoc();
      const created = await db.createPipeline(doc);

      expect(created._id).toBeDefined();
      expect(created.branch).toBe('feature/test');
      expect(created.stages).toHaveLength(2);

      const fetched = await db.getPipeline(created._id);
      expect(fetched).not.toBeNull();
      expect(fetched!._id).toBe(created._id);
      expect(fetched!.context).toBe('Build a login page');
    });

    it('returns null for non-existent pipeline', async () => {
      const result = await db.getPipeline('nonexistent');
      expect(result).toBeNull();
    });

    it('updates pipeline fields', async () => {
      const created = await db.createPipeline(makePipelineDoc());
      await db.updatePipeline(created._id, { status: 'completed', totalCost: 1.5 });

      const fetched = await db.getPipeline(created._id);
      expect(fetched!.status).toBe('completed');
      expect(fetched!.totalCost).toBe(1.5);
    });

    it('updates a specific pipeline stage', async () => {
      const created = await db.createPipeline(makePipelineDoc());
      await db.updatePipelineStage(created._id, 0, {
        status: 'completed',
        completedAt: '2026-04-04T10:15:00Z',
        cost: 0.25,
      });

      const fetched = await db.getPipeline(created._id);
      expect(fetched!.stages[0].status).toBe('completed');
      expect(fetched!.stages[0].completedAt).toBe('2026-04-04T10:15:00Z');
      expect(fetched!.stages[0].cost).toBe(0.25);
      // Other stage should be unchanged
      expect(fetched!.stages[1].status).toBe('pending');
    });

    it('lists pipelines sorted by createdAt descending', async () => {
      await db.createPipeline(makePipelineDoc({ createdAt: '2026-04-01T00:00:00Z', context: 'first' }));
      await db.createPipeline(makePipelineDoc({ createdAt: '2026-04-03T00:00:00Z', context: 'third' }));
      await db.createPipeline(makePipelineDoc({ createdAt: '2026-04-02T00:00:00Z', context: 'second' }));

      const list = await db.listPipelines();
      expect(list).toHaveLength(3);
      expect(list[0].context).toBe('third');
      expect(list[1].context).toBe('second');
      expect(list[2].context).toBe('first');
    });
  });

  describe('tasks', () => {
    it('creates and retrieves a task', async () => {
      const doc = makeTaskDoc();
      const created = await db.createTask(doc);

      expect(created._id).toBeDefined();
      expect(created.title).toBe('Implement login page');

      const fetched = await db.getTask(created._id);
      expect(fetched).not.toBeNull();
      expect(fetched!.assignedRole).toBe('engineer');
    });

    it('returns null for non-existent task', async () => {
      const result = await db.getTask('nonexistent');
      expect(result).toBeNull();
    });

    it('updates task fields and sets updatedAt', async () => {
      const created = await db.createTask(makeTaskDoc());
      const beforeUpdate = created.updatedAt;

      // Small delay so updatedAt differs
      await new Promise((r) => setTimeout(r, 10));
      await db.updateTask(created._id, { status: 'in-progress', body: 'Updated body' });

      const fetched = await db.getTask(created._id);
      expect(fetched!.status).toBe('in-progress');
      expect(fetched!.body).toBe('Updated body');
      expect(fetched!.updatedAt).not.toBe(beforeUpdate);
    });

    it('lists tasks for a specific pipeline', async () => {
      await db.createTask(makeTaskDoc({ pipelineId: 'pipe-1', title: 'Task A' }));
      await db.createTask(makeTaskDoc({ pipelineId: 'pipe-1', title: 'Task B' }));
      await db.createTask(makeTaskDoc({ pipelineId: 'pipe-2', title: 'Other task' }));

      const tasks = await db.listTasksForPipeline('pipe-1');
      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.title)).toContain('Task A');
      expect(tasks.map((t) => t.title)).toContain('Task B');
    });

    it('finds tasks by query', async () => {
      await db.createTask(makeTaskDoc({ status: 'planned', assignedRole: 'engineer' }));
      await db.createTask(makeTaskDoc({ status: 'in-progress', assignedRole: 'engineer' }));
      await db.createTask(makeTaskDoc({ status: 'planned', assignedRole: 'qa' }));

      const planned = await db.findTasks({ status: 'planned' });
      expect(planned).toHaveLength(2);

      const engineerPlanned = await db.findTasks({ status: 'planned', assignedRole: 'engineer' });
      expect(engineerPlanned).toHaveLength(1);
    });

    it('sorts tasks by priority then createdAt', async () => {
      await db.createTask(makeTaskDoc({ priority: 3, title: 'Low', createdAt: '2026-04-01T00:00:00Z' }));
      await db.createTask(makeTaskDoc({ priority: 1, title: 'High', createdAt: '2026-04-02T00:00:00Z' }));
      await db.createTask(makeTaskDoc({ priority: 2, title: 'Medium', createdAt: '2026-04-01T00:00:00Z' }));

      const tasks = await db.findTasks({});
      expect(tasks[0].title).toBe('High');
      expect(tasks[1].title).toBe('Medium');
      expect(tasks[2].title).toBe('Low');
    });
  });
});
