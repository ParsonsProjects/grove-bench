import { describe, it, expect, afterEach } from 'vitest';
import { backgroundShells, describeShells } from './background-shells.js';
import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
import type { LiveBackgroundTask } from '../../shared/types.js';

const shell = (taskId: string, description: string): LiveBackgroundTask => ({ taskId, taskType: 'local_bash', description });
const monitor = (taskId: string, description: string): LiveBackgroundTask => ({ taskId, taskType: 'local_bash', description, shellKind: 'monitor' });
const summary = (tasks: LiveBackgroundTask[]) => describeShells(tasks)?.summary;

afterEach(() => {
  backgroundTaskStore.destroy('t1');
});

describe('backgroundShells', () => {
  it('lists them only while the thread is running', () => {
    backgroundTaskStore.reconcile('t1', { type: 'background_tasks_changed', tasks: [shell('b1', 'npm run dev')] });
    expect(backgroundShells({ id: 't1', status: 'running' })).toHaveLength(1);
    // Closed, asleep or failed: its agent, and its shells with it, are gone.
    for (const status of ['stopped', 'sleeping', 'error', 'starting', 'installing'] as const) {
      expect(backgroundShells({ id: 't1', status }), status).toEqual([]);
    }
  });

  it('gives the same list each time until the agent sends a new one', () => {
    backgroundTaskStore.reconcile('t1', { type: 'background_tasks_changed', tasks: [shell('b1', 'npm run dev')] });
    const thread = { id: 't1', status: 'running' } as const;
    expect(backgroundShells(thread)).toBe(backgroundShells(thread));
    expect(backgroundShells({ id: 'none', status: 'running' })).toBe(backgroundShells({ id: 't1', status: 'stopped' }));
  });
});

describe('describeShells', () => {
  it('is null with nothing running', () => {
    expect(describeShells([])).toBeNull();
  });

  it('counts shells and monitors apart', () => {
    expect(summary([shell('b1', 'a')])).toBe('1 shell running');
    expect(summary([shell('b1', 'a'), shell('b2', 'b')])).toBe('2 shells running');
    expect(summary([monitor('m1', 'a')])).toBe('1 monitor running');
    expect(summary([{ taskId: 'm2', taskType: 'monitor_mcp', description: 'x' }, { taskId: 'm3', taskType: 'monitor_ws', description: 'y' }])).toBe('2 monitors running');
    expect(summary([shell('b1', 'a'), monitor('m1', 'b')])).toBe('1 shell and 1 monitor running');
    expect(describeShells([shell('b1', 'a'), monitor('m1', 'b')])?.count).toBe(2);
  });

  it('puts each command on its own line in the tooltip, cut short when long', () => {
    const long = `npx vitest --watch ${'x'.repeat(100)}`;
    const lines = describeShells([shell('b1', 'npm run dev'), shell('b2', long), shell('b3', '')])!.tooltip.split('\n');
    expect(lines[0]).toBe('3 shells running');
    expect(lines[1]).toBe('npm run dev');
    expect(lines[2]).toHaveLength(81);
    expect(lines[2].endsWith('…')).toBe(true);
    // No description: its id, so the line isn't blank.
    expect(lines[3]).toBe('b3');
  });
});
