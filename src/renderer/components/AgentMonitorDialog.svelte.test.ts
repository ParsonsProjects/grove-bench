import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';

import AgentMonitorDialog from './AgentMonitorDialog.svelte';
import AgentMonitorTrigger from './AgentMonitorTrigger.svelte';
import { agentMonitorStore } from '../stores/agentMonitor.svelte.js';
import { store } from '../stores/sessions.svelte.js';
import { messageStore, type ChatMessage, type ChatToolCallMessage } from '../stores/messages.svelte.js';
import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';

function call(toolUseId: string, toolName: string, toolInput: unknown, extra: Partial<ChatToolCallMessage> = {}): ChatToolCallMessage {
  return { kind: 'tool_call', id: toolUseId, uuid: toolUseId, toolUseId, toolName, toolInput, pending: false, ...extra };
}

const permission: ChatMessage = { kind: 'permission', id: 'p1', requestId: 'r1', toolName: 'Edit', toolInput: { file_path: '/repo/a.ts' }, toolUseId: 'tp', resolved: false };

/** A working thread with a subagent in the turn, one in the background and a
 *  dev server; one waiting on you; one idle. */
function seed() {
  store.sessions = [
    { id: 'work', branch: 'feat-work', repoPath: 'C:/dev/grove-bench', status: 'running', displayName: 'Sidebar revamp' },
    { id: 'wait', branch: 'feat-wait', repoPath: 'C:/dev/api', status: 'running', displayName: 'Fix OAuth refresh' },
    { id: 'idle', branch: 'feat-idle', repoPath: 'C:/dev/api', status: 'running', displayName: 'Flaky e2e retries' },
  ];
  messageStore.messagesBySession = {
    work: [
      call('fg', 'Agent', { subagent_type: 'Explore', description: 'Find the callers', prompt: 'Find every caller of setActiveTab.' }, { pending: true }),
      call('fg-grep', 'Grep', { pattern: 'setActiveTab' }, { pending: true, parentToolUseId: 'fg' }),
      call('bg', 'Agent', { subagent_type: 'general-purpose', description: 'Check the light theme', prompt: 'Run light-theme.test.ts.' }),
    ],
    wait: [permission],
  };
  messageStore.setIsRunning('work', true);
  messageStore.setIsRunning('wait', true);
  messageStore.activityBySession = { work: { activity: 'tool_starting', toolName: 'Bash', toolSummary: 'npm test' } };
  backgroundTaskStore.start('work', { type: 'task_started', taskId: 'task-bg', toolUseId: 'bg', description: 'Check the light theme', taskType: 'local_agent' });
  backgroundTaskStore.setLive('work', [{ taskId: 'sh1', taskType: 'local_bash', description: 'npm start' }]);
}

async function openMonitor() {
  agentMonitorStore.open = true;
  render(AgentMonitorDialog);
  await tick();
  return screen.findByRole('dialog', { name: 'Agent monitor' });
}

beforeEach(seed);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  store.sessions = [];
  store.activeSessionId = null;
  messageStore.messagesBySession = {};
  messageStore.isRunning = {};
  messageStore.activityBySession = {};
  backgroundTaskStore.tasksBySession = {};
  backgroundTaskStore.shellsBySession = {};
  agentMonitorStore.open = false;
  agentMonitorStore.show = 'running';
  agentMonitorStore.query = '';
  agentMonitorStore.selection = null;
  agentMonitorStore.threads = [];
});

describe('AgentMonitorDialog', () => {
  it('lists the running threads with what each is doing, their subagents and shells', async () => {
    const dialog = await openMonitor();
    const threads = within(dialog).getAllByTestId('monitor-thread');
    expect(threads.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Sidebar revamp'),
      expect.stringContaining('Fix OAuth refresh'),
    ]);
    expect(threads[0]).toHaveTextContent('Bash npm test');
    expect(threads[1]).toHaveTextContent('Needs you');
    const subagents = within(dialog).getAllByTestId('monitor-subagent');
    expect(subagents).toHaveLength(2);
    expect(subagents[0]).toHaveTextContent('Explore');
    expect(subagents[0]).toHaveTextContent('Grep');
    expect(within(dialog).getByTestId('monitor-shell')).toHaveTextContent('npm start');
    expect(within(dialog).getByTestId('monitor-totals')).toHaveTextContent('1 working 1 waiting on you 2 subagents 1 in the background');
  });

  it('shows idle threads under All threads, and filters by what is typed', async () => {
    const dialog = await openMonitor();
    expect(within(dialog).queryByText('Flaky e2e retries')).toBeNull();
    await fireEvent.click(within(dialog).getByRole('radio', { name: 'All threads' }));
    expect(within(dialog).getByText('Flaky e2e retries')).toBeInTheDocument();

    await fireEvent.input(within(dialog).getByRole('textbox', { name: 'Filter' }), { target: { value: 'npm start' } });
    const rows = within(dialog).getAllByTestId('monitor-thread');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Sidebar revamp');
  });

  it('stops a background subagent, but only the turn stops one it waits on', async () => {
    const dialog = await openMonitor();
    expect(within(dialog).getByRole('button', { name: "Can't stop Find the callers on its own" })).toBeDisabled();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Stop Check the light theme' }));
    expect(mockGroveBench.stopBackgroundTask).toHaveBeenCalledWith('work', 'task-bg');
  });

  it('stops a shell and interrupts a turn', async () => {
    const dialog = await openMonitor();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Stop npm start' }));
    expect(mockGroveBench.stopBackgroundTask).toHaveBeenCalledWith('work', 'sh1');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Interrupt the turn in Sidebar revamp' }));
    expect(mockGroveBench.stopSession).toHaveBeenCalledWith('work');
  });

  it("shows a subagent's ask, and opens the thread it is in", async () => {
    const dialog = await openMonitor();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Show Find the callers' }));
    const details = within(dialog).getByRole('complementary', { name: 'Details' });
    expect(within(details).getByText('Find every caller of setActiveTab.')).toBeInTheDocument();
    expect(within(details).getByText('in the turn')).toBeInTheDocument();

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Show Fix OAuth refresh' }));
    await fireEvent.click(within(details).getByRole('button', { name: 'Open thread' }));
    expect(store.activeSessionId).toBe('wait');
    expect(agentMonitorStore.open).toBe(false);
  });

  it('says when nothing is running', async () => {
    messageStore.messagesBySession = {};
    messageStore.isRunning = {};
    backgroundTaskStore.tasksBySession = {};
    backgroundTaskStore.shellsBySession = {};
    const dialog = await openMonitor();
    expect(within(dialog).getByText('Nothing running')).toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Show all threads' }));
    expect(within(dialog).getAllByTestId('monitor-thread')).toHaveLength(3);
  });
});

describe('AgentMonitorTrigger', () => {
  it('counts the threads that need you and are working, as the chips do, and opens the monitor', async () => {
    render(AgentMonitorTrigger);
    const trigger = screen.getByTestId('agent-monitor-trigger');
    expect(trigger).toHaveAttribute('title', 'Agent monitor (Ctrl+Shift+A): 1 needs you, 1 working');
    expect(within(trigger).getByTitle('1 needs you')).toBeInTheDocument();
    expect(within(trigger).getByTitle('1 working')).toBeInTheDocument();
    await fireEvent.click(trigger);
    expect(agentMonitorStore.open).toBe(true);
  });

  it('says when nothing is running', () => {
    messageStore.messagesBySession = {};
    messageStore.isRunning = {};
    // A background subagent still running keeps its thread working, as in the sidebar.
    backgroundTaskStore.tasksBySession = {};
    render(AgentMonitorTrigger);
    expect(screen.getByTestId('agent-monitor-trigger')).toHaveAttribute('title', 'Agent monitor (Ctrl+Shift+A): nothing running');
  });
});
