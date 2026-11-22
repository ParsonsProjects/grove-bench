/**
 * The agent monitor (AgentMonitorDialog.svelte, opened from the title bar or
 * Ctrl+Shift+A): every open thread, what its agent and subagents are doing,
 * and the shells it left running.
 *
 * Its rows are a snapshot, read again every MONITOR_REFRESH_MS while it is
 * open (and after each of its actions) rather than derived. A derivation would
 * walk every thread's messages again on every streamed word in any of them;
 * the status bar avoids that for hidden threads the same way (whileShown).
 */
import { store } from './sessions.svelte.js';
import { messageStore } from './messages.svelte.js';
import { backgroundTaskStore } from './backgroundTask.svelte.js';
import { agentsStore } from './agents.svelte.js';
import { subagentPanelStore } from './subagentPanel.svelte.js';
import { sessionSpriteState } from '../lib/session-sprite-state.js';
import { pendingPermissionTool, pendingPermissionView, sessionSubtitle } from '../lib/session-subtitle.js';
import { sessionLabel } from '../lib/os-notify.js';
import { interruptTurn } from '../lib/interrupt-turn.js';
import { monitorThread, type MonitorThread } from '../lib/agent-monitor.js';

export type MonitorSelection =
  | { kind: 'thread'; threadId: string }
  | { kind: 'subagent'; threadId: string; toolUseId: string }
  | { kind: 'shell'; threadId: string; taskId: string };

/** How often the open monitor reads the threads again. */
export const MONITOR_REFRESH_MS = 1000;

/** Every open thread as the monitor shows it, read from the stores now.
 *  Closed threads are left out: their agents are gone. (A thread being
 *  removed is closed first, Sidebar's destroySessionById.) */
export function readMonitorThreads(): MonitorThread[] {
  const threads: MonitorThread[] = [];
  for (const session of store.sessions) {
    const state = sessionSpriteState(session);
    if (state === 'stopped') continue;
    const messages = messageStore.getMessages(session.id);
    const isRunning = messageStore.getIsRunning(session.id);
    const activity = messageStore.getActivity(session.id);
    // What it waits for you on, as the sidebar's line says it.
    const needsYou = messageStore.needsInput(session.id);
    const pendingTool = needsYou ? pendingPermissionTool(messages) : null;
    const waiting = !needsYou ? null
      : (pendingTool && sessionSubtitle({ isRunning, activity, pendingTool, pendingToolView: pendingPermissionView(messages), lastText: null, firstPrompt: null })?.text) || 'Waiting for you';
    threads.push(monitorThread({
      id: session.id,
      title: sessionLabel(session.id),
      repoPath: session.repoPath,
      project: store.repoDisplayName(session.repoPath),
      branch: session.branch,
      agent: agentsStore.get(session.agentType)?.displayName ?? session.agentType ?? '',
      state,
      isRunning,
      activity,
      waiting,
      messages,
      progress: messageStore.toolProgressBySession[session.id] ?? {},
      tasks: backgroundTaskStore.get(session.id),
      shells: backgroundTaskStore.runningShells(session.id),
    }));
  }
  return threads;
}

class AgentMonitorStore {
  open = $state(false);
  /** Running: threads with something running or waiting on you. All: every open thread. */
  show = $state<'running' | 'all'>('running');
  query = $state('');
  selection = $state<MonitorSelection | null>(null);
  /** The snapshot the dialog draws (see the top of this file). */
  threads = $state.raw<MonitorThread[]>([]);
  /** Why the last Stop failed, shown with its row until the next action. */
  error = $state('');

  /** Opens fresh: no filter left from last time, which could hide what is
   *  running now, nor an old error; the first row selected. Running or All
   *  stays as it was. */
  toggle(): void {
    if (!this.open) {
      this.query = '';
      this.error = '';
      this.selection = null;
    }
    this.open = !this.open;
  }

  refresh(): void {
    this.threads = readMonitorThreads();
  }

  select(selection: MonitorSelection): void {
    this.selection = selection;
    this.error = '';
  }

  /** Brings the thread up in the window, on its Thread tab, and closes the monitor. */
  openThread(threadId: string): void {
    store.activeSessionId = threadId;
    messageStore.setActiveTab(threadId, 'activity');
    this.open = false;
  }

  /** Opens the thread with the subagent's own thread docked beside it. */
  openSubagent(threadId: string, toolUseId: string): void {
    this.openThread(threadId);
    subagentPanelStore.show(threadId, toolUseId);
  }

  /** Stops the turn, as the composer's Stop does. Background subagents and
   *  shells keep running. */
  interrupt(threadId: string): void {
    this.error = '';
    interruptTurn(threadId);
    this.refresh();
  }

  /** Stops a background subagent, shell or monitor. A shell the agent's
   *  list holds but the task store hasn't seen start (its event was before the
   *  history page a reload replayed) is stopped straight through main. */
  async stopTask(threadId: string, taskId: string): Promise<void> {
    this.error = '';
    const known = backgroundTaskStore.get(threadId).some((t) => t.taskId === taskId);
    const stopping = known ? backgroundTaskStore.stop(threadId, taskId) : window.groveBench.stopBackgroundTask(threadId, taskId);
    this.refresh();
    try {
      await stopping;
    } catch (err) {
      // Show it with the row that failed, which a row's own Stop doesn't select.
      const t = this.threads.find((x) => x.id === threadId);
      const sub = t?.subagents.find((a) => a.taskId === taskId);
      this.select(sub ? { kind: 'subagent', threadId, toolUseId: sub.toolUseId } : { kind: 'shell', threadId, taskId });
      this.error = `Couldn't stop it: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.refresh();
  }
}

export const agentMonitorStore = new AgentMonitorStore();
