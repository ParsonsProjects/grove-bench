import { describe, it, expect } from 'vitest';
import { validateTasks, detectOverlaps, type RawTask } from './decomposer.js';
import type { OrchTask } from '../shared/types.js';

function makeRawTask(overrides: Partial<RawTask> = {}): RawTask {
  return {
    description: 'Test task',
    branchName: 'feat/test',
    scope: ['src/foo.ts'],
    priority: 1,
    parallelizable: true,
    dependsOn: [],
    instruction: 'Do the thing',
    ...overrides,
  };
}

describe('validateTasks', () => {
  const prefix = 'orch/abc123';

  it('converts raw tasks to OrchTasks with correct IDs', () => {
    const raw = [makeRawTask(), makeRawTask({ description: 'Second' })];
    const tasks = validateTasks(raw, prefix);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe('task_1');
    expect(tasks[1].id).toBe('task_2');
  });

  it('throws on empty array', () => {
    expect(() => validateTasks([], prefix)).toThrow('empty or invalid');
  });

  it('throws on non-array input', () => {
    expect(() => validateTasks(null as any, prefix)).toThrow('empty or invalid');
  });

  it('throws when more than 10 tasks', () => {
    const raw = Array.from({ length: 11 }, () => makeRawTask());
    expect(() => validateTasks(raw, prefix)).toThrow('Too many tasks (11)');
  });

  it('throws when description is missing', () => {
    const raw = [makeRawTask({ description: '' })];
    expect(() => validateTasks(raw, prefix)).toThrow('missing description or instruction');
  });

  it('throws when instruction is missing', () => {
    const raw = [makeRawTask({ instruction: '' })];
    expect(() => validateTasks(raw, prefix)).toThrow('missing description or instruction');
  });

  // Branch name sanitization
  it('sanitizes special characters in branch names', () => {
    const raw = [makeRawTask({ branchName: 'feat/hello world!@#$' })];
    const tasks = validateTasks(raw, prefix);
    expect(tasks[0].branchName).not.toMatch(/[^a-zA-Z0-9._/-]/);
  });

  it('collapses consecutive hyphens', () => {
    const raw = [makeRawTask({ branchName: 'feat/a--b---c' })];
    const tasks = validateTasks(raw, prefix);
    expect(tasks[0].branchName).not.toContain('--');
  });

  it('prepends branchPrefix when missing', () => {
    const raw = [makeRawTask({ branchName: 'my-feature' })];
    const tasks = validateTasks(raw, prefix);
    expect(tasks[0].branchName).toBe(`${prefix}/my-feature`);
  });

  it('does not double-prepend branchPrefix', () => {
    const raw = [makeRawTask({ branchName: `${prefix}/my-feature` })];
    const tasks = validateTasks(raw, prefix);
    expect(tasks[0].branchName).toBe(`${prefix}/my-feature`);
  });

  it('generates a fallback branch name when empty', () => {
    const raw = [makeRawTask({ branchName: '' })];
    const tasks = validateTasks(raw, prefix);
    expect(tasks[0].branchName).toBe(`${prefix}/task-1`);
  });

  // Dependency validation
  it('filters out invalid dependency references', () => {
    const raw = [
      makeRawTask({ dependsOn: ['task_2', 'task_99'] }),
      makeRawTask(),
    ];
    const tasks = validateTasks(raw, prefix);
    expect(tasks[0].dependsOn).toEqual(['task_2']);
  });

  it('preserves valid dependencies', () => {
    const raw = [
      makeRawTask(),
      makeRawTask({ dependsOn: ['task_1'] }),
    ];
    const tasks = validateTasks(raw, prefix);
    expect(tasks[1].dependsOn).toEqual(['task_1']);
  });

  // Circular dependency detection
  it('throws on direct circular dependency', () => {
    // task_1 depends on task_2, task_2 depends on task_1
    const raw = [
      makeRawTask({ dependsOn: ['task_2'] }),
      makeRawTask({ dependsOn: ['task_1'] }),
    ];
    expect(() => validateTasks(raw, prefix)).toThrow('Circular dependency');
  });

  it('throws on indirect circular dependency', () => {
    // task_1 -> task_2 -> task_3 -> task_1
    const raw = [
      makeRawTask({ dependsOn: ['task_3'] }),
      makeRawTask({ dependsOn: ['task_1'] }),
      makeRawTask({ dependsOn: ['task_2'] }),
    ];
    expect(() => validateTasks(raw, prefix)).toThrow('Circular dependency');
  });

  it('allows acyclic dependencies', () => {
    // task_1 (no deps), task_2 -> task_1, task_3 -> task_1, task_2
    const raw = [
      makeRawTask(),
      makeRawTask({ dependsOn: ['task_1'] }),
      makeRawTask({ dependsOn: ['task_1', 'task_2'] }),
    ];
    const tasks = validateTasks(raw, prefix);
    expect(tasks).toHaveLength(3);
    expect(tasks[2].dependsOn).toEqual(['task_1', 'task_2']);
  });

  // Default values
  it('defaults priority to index+1 when not a number', () => {
    const raw = [makeRawTask({ priority: undefined as any })];
    const tasks = validateTasks(raw, prefix);
    expect(tasks[0].priority).toBe(1);
  });

  it('defaults parallelizable to true when not explicitly false', () => {
    const raw = [makeRawTask({ parallelizable: undefined as any })];
    const tasks = validateTasks(raw, prefix);
    expect(tasks[0].parallelizable).toBe(true);
  });

  it('sets parallelizable false when explicitly false', () => {
    const raw = [makeRawTask({ parallelizable: false })];
    const tasks = validateTasks(raw, prefix);
    expect(tasks[0].parallelizable).toBe(false);
  });

  it('defaults scope to empty array when not an array', () => {
    const raw = [makeRawTask({ scope: 'not-an-array' as any })];
    const tasks = validateTasks(raw, prefix);
    expect(tasks[0].scope).toEqual([]);
  });

  it('sets initial status fields correctly', () => {
    const raw = [makeRawTask()];
    const tasks = validateTasks(raw, prefix);
    expect(tasks[0].status).toBe('pending');
    expect(tasks[0].jobId).toBe('');
    expect(tasks[0].baseBranch).toBe('');
    expect(tasks[0].sessionId).toBeNull();
    expect(tasks[0].completedAt).toBeNull();
    expect(tasks[0].error).toBeNull();
  });
});

describe('detectOverlaps', () => {
  function makeOrchTask(id: string, scope: string[]): OrchTask {
    return {
      id,
      jobId: 'job1',
      description: 'test',
      branchName: `branch-${id}`,
      baseBranch: 'main',
      scope,
      priority: 1,
      parallelizable: true,
      dependsOn: [],
      sessionId: null,
      status: 'pending',
      instruction: 'do it',
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
    };
  }

  it('returns empty array when no overlaps', () => {
    const tasks = [
      makeOrchTask('t1', ['src/a.ts']),
      makeOrchTask('t2', ['src/b.ts']),
    ];
    expect(detectOverlaps(tasks)).toEqual([]);
  });

  it('detects exact file overlap', () => {
    const tasks = [
      makeOrchTask('t1', ['src/shared.ts']),
      makeOrchTask('t2', ['src/shared.ts']),
    ];
    const warnings = detectOverlaps(tasks);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({ taskA: 't1', taskB: 't2', files: ['src/shared.ts'] });
  });

  it('detects directory prefix overlap (dir listed first)', () => {
    const tasks = [
      makeOrchTask('t1', ['src/components']),
      makeOrchTask('t2', ['src/components/Button.svelte']),
    ];
    const warnings = detectOverlaps(tasks);
    expect(warnings).toHaveLength(1);
    // The overlap filter returns items from tasks[i].scope that match, so it's the directory
    expect(warnings[0].files).toContain('src/components');
  });

  it('detects directory prefix overlap (file listed first)', () => {
    const tasks = [
      makeOrchTask('t1', ['src/lib/utils.ts']),
      makeOrchTask('t2', ['src/lib']),
    ];
    const warnings = detectOverlaps(tasks);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].files).toContain('src/lib/utils.ts');
  });

  it('reports multiple overlapping files', () => {
    const tasks = [
      makeOrchTask('t1', ['src/a.ts', 'src/shared.ts', 'src/b.ts']),
      makeOrchTask('t2', ['src/shared.ts', 'src/b.ts']),
    ];
    const warnings = detectOverlaps(tasks);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].files).toHaveLength(2);
    expect(warnings[0].files).toContain('src/shared.ts');
    expect(warnings[0].files).toContain('src/b.ts');
  });

  it('handles three-way overlaps with separate warnings', () => {
    const tasks = [
      makeOrchTask('t1', ['src/shared.ts']),
      makeOrchTask('t2', ['src/shared.ts']),
      makeOrchTask('t3', ['src/shared.ts']),
    ];
    const warnings = detectOverlaps(tasks);
    // t1-t2, t1-t3, t2-t3
    expect(warnings).toHaveLength(3);
  });

  it('returns empty for single task', () => {
    const tasks = [makeOrchTask('t1', ['src/a.ts'])];
    expect(detectOverlaps(tasks)).toEqual([]);
  });

  it('returns empty for tasks with empty scopes', () => {
    const tasks = [
      makeOrchTask('t1', []),
      makeOrchTask('t2', []),
    ];
    expect(detectOverlaps(tasks)).toEqual([]);
  });
});
