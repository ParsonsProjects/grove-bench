import { describe, it, expect, afterEach } from 'vitest';
import { backgroundShells, shellsSummary, shellsTooltip } from './background-shells.js';
import { backgroundTaskStore, type LiveBackgroundTask } from '../stores/backgroundTask.svelte.js';

const shell = (taskId: string, description: string): LiveBackgroundTask => ({ taskId, taskType: 'local_bash', description });
const monitor = (taskId: string, description: string): LiveBackgroundTask => ({ taskId, taskType: 'local_bash', description, shellKind: 'monitor' });

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
});

describe('shellsSummary', () => {
  it('counts shells and monitors apart', () => {
    expect(shellsSummary([shell('b1', 'a')])).toBe('1 shell running');
    expect(shellsSummary([shell('b1', 'a'), shell('b2', 'b')])).toBe('2 shells running');
    expect(shellsSummary([monitor('m1', 'a')])).toBe('1 monitor running');
    expect(shellsSummary([{ taskId: 'm2', taskType: 'monitor_mcp', description: 'x' }, { taskId: 'm3', taskType: 'monitor_ws', description: 'y' }])).toBe('2 monitors running');
    expect(shellsSummary([shell('b1', 'a'), monitor('m1', 'b')])).toBe('1 shell and 1 monitor running');
  });
});

describe('shellsTooltip', () => {
  it('puts each command on its own line, cut short when long', () => {
    const long = `npx vitest --watch ${'x'.repeat(100)}`;
    const lines = shellsTooltip([shell('b1', 'npm run dev'), shell('b2', long), shell('b3', '')]).split('\n');
    expect(lines[0]).toBe('3 shells running');
    expect(lines[1]).toBe('npm run dev');
    expect(lines[2]).toHaveLength(81);
    expect(lines[2].endsWith('…')).toBe(true);
    // No description: its id, so the line isn't blank.
    expect(lines[3]).toBe('b3');
  });
});
