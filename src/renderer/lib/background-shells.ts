import type { LiveBackgroundTask, SessionStatus } from '../../shared/types.js';
import { oneLine } from '../../shared/plain-text.js';
import { backgroundTaskStore, NO_SHELLS } from '../stores/backgroundTask.svelte.js';
import { plural } from './ship-track.js';
import { agentUp } from './thread-working.js';

/** How much of a task's description (often its command line) a tooltip line shows. */
const LINE_LEN = 80;

/** The commands a thread's agent left running in the background: shells (a
 *  dev server, a watcher) and monitors. They don't make the thread working
 *  (a dev server never ends), so the sidebar marks them apart. Only while
 *  its agent is up (agentUp). */
export function backgroundShells(thread: { id: string; status: SessionStatus }): readonly LiveBackgroundTask[] {
  return agentUp(thread) ? backgroundTaskStore.runningShells(thread.id) : NO_SHELLS;
}

function isMonitor(task: LiveBackgroundTask): boolean {
  return task.taskType === 'monitor_mcp' || task.taskType === 'monitor_ws' || task.shellKind === 'monitor';
}

/** What to say about a thread's background shells: how many, `summary`
 *  ("2 shells running", "1 shell and 1 monitor running") for its label,
 *  `tooltip` the summary then what each one runs, a line each. Null when
 *  there are none. */
export function describeShells(tasks: readonly LiveBackgroundTask[]): { count: number; summary: string; tooltip: string } | null {
  if (tasks.length === 0) return null;
  const monitors = tasks.filter(isMonitor).length;
  const shells = tasks.length - monitors;
  const parts = [shells > 0 ? plural(shells, 'shell') : '', monitors > 0 ? plural(monitors, 'monitor') : ''].filter(Boolean);
  const summary = `${parts.join(' and ')} running`;
  const tooltip = [summary, ...tasks.map((t) => oneLine(t.description || t.taskId, LINE_LEN))].join('\n');
  return { count: tasks.length, summary, tooltip };
}
