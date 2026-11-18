import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatToolCallMessage } from '../stores/messages.svelte.js';
import type { BackgroundTask } from '../stores/backgroundTask.svelte.js';
import { isActive, monitorThread, RECENT_CALLS, searchText, type MonitorSource } from './agent-monitor.js';

let n = 0;
function call(toolName: string, toolInput: unknown, extra: Partial<ChatToolCallMessage> = {}): ChatToolCallMessage {
  n++;
  return { kind: 'tool_call', id: `m${n}`, uuid: `u${n}`, toolUseId: `t${n}`, toolName, toolInput, pending: false, ...extra };
}

function agentCall(toolUseId: string, pending: boolean, input = { subagent_type: 'Explore', description: 'Find the callers', prompt: 'Find every caller of setActiveTab.' }) {
  return call('Agent', input, { toolUseId, pending });
}

function task(extra: Partial<BackgroundTask>): BackgroundTask {
  return { taskId: 'task-1', description: '', status: 'running', totalTokens: 0, toolUses: 0, durationMs: 0, ...extra };
}

function source(extra: Partial<MonitorSource> = {}): MonitorSource {
  return {
    id: 's1', title: 'Sidebar revamp', repoPath: 'C:/dev/grove-bench', project: 'grove-bench', branch: 'claude/sidebar', agent: 'Claude Agent',
    state: 'working', isRunning: true, activity: { activity: 'idle' }, waiting: null,
    messages: [], progress: {}, tasks: [], shells: [],
    ...extra,
  };
}

describe('monitorThread: what the thread is doing', () => {
  it('names the running tool, its target and how long it has run', () => {
    const t = monitorThread(source({ activity: { activity: 'tool_starting', toolName: 'Bash', toolSummary: 'npm test', elapsedSeconds: 14 } }));
    expect(t.doing).toEqual({ kind: 'tool', name: 'Bash', summary: 'npm test', seconds: 14 });
  });

  it('says what it waits for you on before anything else', () => {
    const t = monitorThread(source({ waiting: 'Wants to run a command', activity: { activity: 'thinking' } }));
    expect(t.doing).toEqual({ kind: 'waiting', text: 'Wants to run a command' });
  });

  it('is thinking, writing or working while the turn runs, idle once it ends', () => {
    expect(monitorThread(source({ activity: { activity: 'thinking' } })).doing.kind).toBe('thinking');
    expect(monitorThread(source({ activity: { activity: 'generating' } })).doing.kind).toBe('writing');
    expect(monitorThread(source({ activity: { activity: 'idle' } })).doing.kind).toBe('working');
    expect(monitorThread(source({ isRunning: false, state: 'ready' })).doing.kind).toBe('idle');
  });

  it("keeps the thread's own finished calls, newest first, not its subagents'", () => {
    const own = Array.from({ length: RECENT_CALLS + 2 }, (_, i) => call('Read', { file_path: `/repo/f${i}.ts` }));
    const sub = call('Grep', { pattern: 'x' }, { parentToolUseId: 'agent-1' });
    const running = call('Bash', { command: 'npm test' }, { pending: true });
    const t = monitorThread(source({ messages: [...own, sub, running] }));
    expect(t.recent).toHaveLength(RECENT_CALLS);
    expect(t.recent[0].toolUseId).toBe(own.at(-1)!.toolUseId);
    expect(t.recent.map((c) => c.toolUseId)).not.toContain(sub.toolUseId);
    expect(t.recent.map((c) => c.toolUseId)).not.toContain(running.toolUseId);
  });
});

describe('monitorThread: subagents', () => {
  it('lists a subagent the turn waits on, with the tool it is running', () => {
    const agent = agentCall('agent-1', true);
    const done = call('Glob', { pattern: '**/*.svelte' }, { parentToolUseId: 'agent-1' });
    const grep = call('Grep', { pattern: 'setActiveTab' }, { parentToolUseId: 'agent-1', pending: true });
    const t = monitorThread(source({ messages: [agent, done, grep], progress: { [grep.toolUseId]: { elapsedSeconds: 3 } } }));
    expect(t.subagents).toHaveLength(1);
    const [a] = t.subagents;
    expect(a).toMatchObject({ toolUseId: 'agent-1', hasCall: true, type: 'Explore', description: 'Find the callers', background: false, toolUses: 2 });
    expect(a.prompt).toBe('Find every caller of setActiveTab.');
    expect(a.taskId).toBeUndefined();
    expect(a.doing).toEqual({ kind: 'tool', name: 'Grep', summary: expect.stringContaining('setActiveTab'), seconds: 3 });
    expect(a.recent.map((c) => c.toolUseId)).toEqual([done.toolUseId]);
  });

  it('marks one whose call returned while its task runs as background, with the task to stop', () => {
    const agent = agentCall('agent-2', false);
    const t = monitorThread(source({
      messages: [agent],
      tasks: [task({ taskId: 'bg-1', taskType: 'local_agent', toolUseId: 'agent-2', toolUses: 4, totalTokens: 9100, durationMs: 120_000 })],
    }));
    // Once, from its call: the task is the same subagent.
    expect(t.subagents).toHaveLength(1);
    expect(t.subagents[0]).toMatchObject({ background: true, hasCall: true, taskId: 'bg-1', toolUses: 4, tokens: 9100, durationMs: 120_000, stopping: false });
  });

  it('treats a pending call with a task as in the turn: Stop would not reach it', () => {
    const agent = agentCall('agent-3', true);
    const t = monitorThread(source({ messages: [agent], tasks: [task({ toolUseId: 'agent-3' })] }));
    expect(t.subagents[0].background).toBe(false);
    expect(t.subagents[0].taskId).toBeUndefined();
  });

  it('leaves out finished subagents', () => {
    const agent = agentCall('agent-4', false);
    const t = monitorThread(source({ messages: [agent], tasks: [task({ toolUseId: 'agent-4', status: 'completed' })] }));
    expect(t.subagents).toEqual([]);
  });

  it('lists a running workflow or remote agent from its task, with no thread of its own to open', () => {
    const t = monitorThread(source({
      isRunning: false,
      tasks: [
        task({ taskId: 'wf', taskType: 'local_workflow', description: 'Release checklist', lastToolName: 'Bash', toolUses: 3 }),
        task({ taskId: 'ra', taskType: 'remote_agent', description: 'Remote review' }),
        task({ taskId: 'sh', taskType: 'local_bash', description: 'npm start' }),
        task({ taskId: 'done', taskType: 'local_workflow', description: 'Finished', status: 'completed' }),
      ],
    }));
    expect(t.subagents.map((a) => [a.type, a.description, a.hasCall, a.taskId, a.background])).toEqual([
      ['workflow', 'Release checklist', false, 'wf', true],
      ['remote agent', 'Remote review', false, 'ra', true],
    ]);
    expect(t.subagents[0].doing).toEqual({ kind: 'tool', name: 'Bash', summary: '' });
    expect(isActive(t)).toBe(true);
  });

  it('lists a background subagent whose Agent call is older than the loaded history from its task', () => {
    const t = monitorThread(source({ tasks: [task({ taskId: 'old', taskType: 'local_agent', toolUseId: 'not-loaded', description: 'An older ask' })] }));
    expect(t.subagents).toHaveLength(1);
    expect(t.subagents[0]).toMatchObject({ toolUseId: 'not-loaded', hasCall: false, type: 'subagent', description: 'An older ask', taskId: 'old' });
  });

  it('lists an Agent call seen twice once', () => {
    const t = monitorThread(source({ messages: [agentCall('dup', true), agentCall('dup', true)] }));
    expect(t.subagents).toHaveLength(1);
  });

  it('shows a stop in flight', () => {
    const agent = agentCall('agent-5', false);
    const t = monitorThread(source({ messages: [agent], tasks: [task({ toolUseId: 'agent-5', stopping: true })] }));
    expect(t.subagents[0].stopping).toBe(true);
  });
});

describe('monitorThread: shells and monitors', () => {
  it("tells the Monitor tool's watch from a background shell", () => {
    const t = monitorThread(source({
      shells: [
        { taskId: 'b1', taskType: 'local_bash', description: 'npm start' },
        { taskId: 'b2', taskType: 'local_bash', shellKind: 'monitor', description: 'Watch CI' },
        { taskId: 'b3', taskType: 'monitor_ws', description: 'Watch the socket' },
      ],
      tasks: [task({ taskId: 'b1', stopping: true })],
    }));
    expect(t.shells).toEqual([
      { taskId: 'b1', kind: 'shell', description: 'npm start', stopping: true },
      { taskId: 'b2', kind: 'monitor', description: 'Watch CI', stopping: false },
      { taskId: 'b3', kind: 'monitor', description: 'Watch the socket', stopping: false },
    ]);
  });
});

describe('isActive and searchText', () => {
  it('counts a thread as active whenever the title bar counts it: starting up and installing too', () => {
    for (const state of ['starting', 'installing', 'working', 'permission'] as const) {
      expect(isActive(monitorThread(source({ isRunning: false, state })))).toBe(true);
    }
    for (const state of ['ready', 'sleeping', 'unread', 'error'] as const) {
      expect(isActive(monitorThread(source({ isRunning: false, state })))).toBe(false);
    }
  });

  it('counts a thread as active while its turn runs, it waits on you, or anything runs in it', () => {
    const idle = source({ isRunning: false, state: 'ready' });
    expect(isActive(monitorThread(idle))).toBe(false);
    expect(isActive(monitorThread(source()))).toBe(true);
    expect(isActive(monitorThread({ ...idle, waiting: 'Waiting for your answer' }))).toBe(true);
    expect(isActive(monitorThread({ ...idle, shells: [{ taskId: 'b1', description: 'npm start' }] }))).toBe(true);
    const bg = agentCall('agent-6', false);
    expect(isActive(monitorThread({ ...idle, messages: [bg], tasks: [task({ toolUseId: 'agent-6' })] }))).toBe(true);
  });

  it('searches names, the running tool, subagents and shells', () => {
    const agent = agentCall('agent-7', true);
    const text = searchText(monitorThread(source({
      messages: [agent] as ChatMessage[],
      activity: { activity: 'tool_starting', toolName: 'Bash', toolSummary: 'npm test' },
      shells: [{ taskId: 'b1', description: 'npm start' }],
    })));
    for (const word of ['sidebar revamp', 'grove-bench', 'claude agent', 'npm test', 'explore', 'find the callers', 'npm start']) {
      expect(text).toContain(word);
    }
  });
});
