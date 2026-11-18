import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentMonitorStore, readMonitorThreads } from './agentMonitor.svelte.js';
import { store } from './sessions.svelte.js';
import { messageStore, type ChatMessage } from './messages.svelte.js';
import { backgroundTaskStore } from './backgroundTask.svelte.js';
import { agentsStore } from './agents.svelte.js';
import { subagentPanelStore } from './subagentPanel.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';

const permission = (toolName: string, toolInput: unknown): ChatMessage => ({
  kind: 'permission', id: 'p1', requestId: 'r1', toolName, toolInput, toolUseId: 'tp1', resolved: false,
});

beforeEach(() => {
  store.sessions = [
    { id: 'a', branch: 'feat-a', repoPath: 'C:/dev/grove-bench', status: 'running', agentType: 'claude-code', displayName: 'Sidebar revamp' },
    { id: 'b', branch: 'feat-b', repoPath: 'C:/dev/api', status: 'running', agentType: 'claude-code' },
    { id: 'closed', branch: 'feat-c', repoPath: 'C:/dev/api', status: 'stopped' },
  ];
  agentsStore.list = [{ id: 'claude-code', displayName: 'Claude Agent', capabilities: {} }] as never;
});

afterEach(() => {
  vi.restoreAllMocks();
  store.sessions = [];
  store.activeSessionId = null;
  // Every per-thread entry, the task store's included: an interrupt leaves a
  // stop in progress and a paused queue behind.
  messageStore.destroyAllSessions();
  agentMonitorStore.open = false;
  agentMonitorStore.query = '';
  agentMonitorStore.error = '';
  agentMonitorStore.selection = null;
  agentMonitorStore.threads = [];
  agentsStore.list = [];
  subagentPanelStore.open = false;
});

describe('readMonitorThreads', () => {
  it('reads every open thread with its name, project and agent, and leaves closed ones out', () => {
    messageStore.setIsRunning('a', true);
    const threads = readMonitorThreads();
    expect(threads.map((t) => t.id)).toEqual(['a', 'b']);
    expect(threads[0]).toMatchObject({ title: 'Sidebar revamp', project: 'grove-bench', repoPath: 'C:/dev/grove-bench', agent: 'Claude Agent', turnRunning: true, state: 'working' });
    expect(threads[1]).toMatchObject({ title: 'feat-b', project: 'api', turnRunning: false });
  });

  it("says what a thread waits for you on, as the sidebar's line does", () => {
    messageStore.messagesBySession = { a: [permission('Bash', { command: 'git push' })] };
    const [a] = readMonitorThreads();
    expect(a.state).toBe('permission');
    expect(a.doing).toEqual({ kind: 'waiting', text: expect.stringMatching(/^Wants to run/) });
  });

  it('reads the shells the agent says are running', () => {
    backgroundTaskStore.setLive('a', [{ taskId: 'sh1', taskType: 'local_bash', description: 'npm start' }]);
    expect(readMonitorThreads()[0].shells).toEqual([{ taskId: 'sh1', kind: 'shell', description: 'npm start', stopping: false }]);
  });
});

describe('agentMonitorStore actions', () => {
  it('Open thread brings the thread up on its Thread tab and closes the monitor', () => {
    agentMonitorStore.open = true;
    messageStore.setActiveTab('b', 'changes');
    agentMonitorStore.openThread('b');
    expect(store.activeSessionId).toBe('b');
    expect(messageStore.getActiveTab('b')).toBe('activity');
    expect(agentMonitorStore.open).toBe(false);
  });

  it("opening a subagent docks its own thread beside the thread's", () => {
    agentMonitorStore.openSubagent('a', 'agent-1');
    expect(store.activeSessionId).toBe('a');
    expect(subagentPanelStore.open).toBe(true);
    expect(subagentPanelStore.sessionId).toBe('a');
    expect(subagentPanelStore.toolUseId).toBe('agent-1');
  });

  it('Interrupt stops the turn the way the Stop button does', () => {
    messageStore.setIsRunning('a', true);
    agentMonitorStore.interrupt('a');
    expect(mockGroveBench.stopSession).toHaveBeenCalledWith('a');
    expect(messageStore.getIsRunning('a')).toBe(false);
  });

  it('stops a task it knows through the task store, which marks it stopping', async () => {
    backgroundTaskStore.start('a', { type: 'task_started', taskId: 't1', toolUseId: 'agent-1', description: 'Check', taskType: 'local_agent' });
    const stop = vi.spyOn(backgroundTaskStore, 'stop');
    await agentMonitorStore.stopTask('a', 't1');
    expect(stop).toHaveBeenCalledWith('a', 't1');
    expect(mockGroveBench.stopBackgroundTask).toHaveBeenCalledWith('a', 't1');
  });

  it("stops a shell the task store hasn't seen straight through main", async () => {
    const stop = vi.spyOn(backgroundTaskStore, 'stop');
    await agentMonitorStore.stopTask('a', 'sh-from-before-the-reload');
    expect(stop).not.toHaveBeenCalled();
    expect(mockGroveBench.stopBackgroundTask).toHaveBeenCalledWith('a', 'sh-from-before-the-reload');
  });

  it('says why a stop failed, with the row that failed selected', async () => {
    backgroundTaskStore.setLive('a', [{ taskId: 'sh1', taskType: 'local_bash', description: 'npm start' }]);
    agentMonitorStore.refresh();
    agentMonitorStore.select({ kind: 'thread', threadId: 'b' });
    mockGroveBench.stopBackgroundTask.mockRejectedValueOnce(new Error('no such task'));
    await agentMonitorStore.stopTask('a', 'sh1');
    expect(agentMonitorStore.error).toBe("Couldn't stop it: no such task");
    expect(agentMonitorStore.selection).toEqual({ kind: 'shell', threadId: 'a', taskId: 'sh1' });
  });

  it('opens fresh: no filter or error from last time, the first row selected', () => {
    agentMonitorStore.query = 'oauth';
    agentMonitorStore.error = "Couldn't stop it: gone";
    agentMonitorStore.selection = { kind: 'thread', threadId: 'b' };
    agentMonitorStore.show = 'all';
    agentMonitorStore.toggle();
    expect(agentMonitorStore.open).toBe(true);
    expect(agentMonitorStore.query).toBe('');
    expect(agentMonitorStore.error).toBe('');
    expect(agentMonitorStore.selection).toBeNull();
    // Running or All is a choice, kept.
    expect(agentMonitorStore.show).toBe('all');
    agentMonitorStore.show = 'running';
  });
});
