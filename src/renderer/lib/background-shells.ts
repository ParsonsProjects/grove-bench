import type { SessionStatus } from '../../shared/types.js';
import { oneLine } from '../../shared/plain-text.js';
import { backgroundTaskStore, type LiveBackgroundTask } from '../stores/backgroundTask.svelte.js';

/** How much of a task's description (often its command line) a tooltip line shows. */
const LINE_LEN = 80;

/** The commands a thread's agent left running in the background: shells (a
 *  dev server, a watcher) and monitors. They don't make the thread working
 *  (a dev server never ends), so the sidebar marks them apart. Only while
 *  its agent is up: closing the thread or letting it sleep shuts the agent
 *  down and them with it, though they stay listed until it starts again. */
export function backgroundShells(thread: { id: string; status: SessionStatus }): LiveBackgroundTask[] {
  return thread.status === 'running' ? backgroundTaskStore.runningShells(thread.id) : [];
}

function isMonitor(task: LiveBackgroundTask): boolean {
  return task.taskType === 'monitor_mcp' || task.taskType === 'monitor_ws' || task.shellKind === 'monitor';
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "2 shells running", "1 monitor running", "1 shell and 1 monitor running". */
export function shellsSummary(tasks: LiveBackgroundTask[]): string {
  const monitors = tasks.filter(isMonitor).length;
  const shells = tasks.length - monitors;
  const parts = [shells > 0 ? count(shells, 'shell') : '', monitors > 0 ? count(monitors, 'monitor') : ''].filter(Boolean);
  return `${parts.join(' and ')} running`;
}

/** The summary, then what each one is running, a line each. */
export function shellsTooltip(tasks: LiveBackgroundTask[]): string {
  return [shellsSummary(tasks), ...tasks.map((t) => oneLine(t.description || t.taskId, LINE_LEN))].join('\n');
}
