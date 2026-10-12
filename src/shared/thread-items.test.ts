import { describe, it, expect } from 'vitest';
import { taskListOf, taskProgress, threadItems, touchesThreadItems } from './thread-items.js';
import { buildContentBlock } from './prompt-text.js';
import type { AgentEvent } from './types.js';

let n = 0;
const use = (toolName: string, toolInput: unknown, extra: Partial<Extract<AgentEvent, { type: 'assistant_tool_use' }>> = {}): AgentEvent =>
  ({ type: 'assistant_tool_use', toolName, toolInput, toolUseId: `t${++n}`, uuid: `u${n}`, ...extra });
const result = (toolUseId: string, content: string, extra: Partial<Extract<AgentEvent, { type: 'tool_result' }>> = {}): AgentEvent =>
  ({ type: 'tool_result', toolUseId, content, ...extra });
const idOf = (e: AgentEvent) => (e as { toolUseId: string }).toolUseId;

describe('taskListOf', () => {
  it('reads TodoWrite and todowrite lists', () => {
    const todos = [
      { content: 'Write tests', status: 'completed', activeForm: 'Writing tests' },
      { content: 'Fix bug', status: 'in_progress', activeForm: 'Fixing bug' },
      { content: 'Ship', status: 'pending', activeForm: 'Shipping' },
    ];
    expect(taskListOf('TodoWrite', { todos })).toEqual([
      { id: '0', content: 'Write tests', activeForm: 'Writing tests', status: 'completed' },
      { id: '1', content: 'Fix bug', activeForm: 'Fixing bug', status: 'in_progress' },
      { id: '2', content: 'Ship', activeForm: 'Shipping', status: 'pending' },
    ]);
    expect(taskListOf('todowrite', { todos: [{ id: 'a', content: 'x', status: 'cancelled', priority: 'high' }] }))
      .toEqual([{ id: 'a', content: 'x', status: 'cancelled' }]);
  });

  it('reads an ACP plan', () => {
    expect(taskListOf('plan', { entries: [{ content: 'Step', status: 'in_progress', priority: 'high' }] }))
      .toEqual([{ id: '0', content: 'Step', status: 'in_progress' }]);
  });

  it('takes an empty list as cleared, and skips items without text', () => {
    expect(taskListOf('TodoWrite', { todos: [] })).toEqual([]);
    expect(taskListOf('TodoWrite', { todos: [{ status: 'pending' }, 'junk', { content: 'ok' }] }))
      .toEqual([{ id: '2', content: 'ok', status: 'pending' }]);
  });

  it('ignores other tools and inputs', () => {
    expect(taskListOf('Bash', { todos: [{ content: 'x' }] })).toBeNull();
    expect(taskListOf('TodoWrite', { todo: [] })).toBeNull();
    expect(taskListOf('ExitPlanMode', { entries: [{ content: 'x' }] })).toBeNull();
    expect(taskListOf('TodoRead', {})).toBeNull();
  });
});

describe('threadItems tasks', () => {
  it('keeps the latest TodoWrite list and where it changed', () => {
    const events: AgentEvent[] = [
      use('TodoWrite', { todos: [{ content: 'a', status: 'in_progress' }] }),
      { type: 'assistant_text', text: 'working', uuid: 'x' },
      use('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] }),
    ];
    const items = threadItems(events);
    expect(items.tasks.map((t) => [t.content, t.status])).toEqual([['a', 'completed'], ['b', 'pending']]);
    expect(items.tasksEventIndex).toBe(2);
  });

  it("leaves out a subagent's own TodoWrite list", () => {
    const events: AgentEvent[] = [
      use('TodoWrite', { todos: [{ content: 'mine', status: 'pending' }] }),
      use('TodoWrite', { todos: [{ content: 'theirs', status: 'pending' }] }, { parentToolUseId: 'agent-1' }),
    ];
    expect(threadItems(events).tasks.map((t) => t.content)).toEqual(['mine']);
  });

  it('builds the list from TaskCreate and TaskUpdate results', () => {
    const create1 = use('TaskCreate', { subject: 'Plan', description: 'd', activeForm: 'Planning' });
    const create2 = use('TaskCreate', { subject: 'Build', description: 'd' });
    const start = use('TaskUpdate', { taskId: '1', status: 'in_progress' });
    const rename = use('TaskUpdate', { taskId: '2', subject: 'Build it' });
    const events: AgentEvent[] = [
      create1, result(idOf(create1), 'Task #1 created successfully: Plan'),
      create2, result(idOf(create2), 'Task #2 created successfully: Build'),
      start, result(idOf(start), 'Updated task #1 status'),
      rename, result(idOf(rename), 'Updated task #2 subject'),
    ];
    const items = threadItems(events);
    expect(items.tasks).toEqual([
      { id: '1', content: 'Plan', activeForm: 'Planning', status: 'in_progress' },
      { id: '2', content: 'Build it', status: 'pending' },
    ]);
    expect(items.tasksEventIndex).toBe(7);
  });

  it('drops a deleted task and ignores failed or unknown updates', () => {
    const create = use('TaskCreate', { subject: 'A', description: '' });
    const failed = use('TaskUpdate', { taskId: '1', status: 'completed' });
    const unknown = use('TaskUpdate', { taskId: '9', status: 'completed' });
    const del = use('TaskUpdate', { taskId: '1', status: 'deleted' });
    const base: AgentEvent[] = [
      create, result(idOf(create), 'Task #1 created successfully: A'),
      failed, result(idOf(failed), 'Task not found', { isError: true }),
      unknown, result(idOf(unknown), 'Updated task #9 status'),
    ];
    expect(threadItems(base).tasks).toEqual([{ id: '1', content: 'A', status: 'pending' }]);
    expect(threadItems(base).tasksEventIndex).toBe(1);
    expect(threadItems([...base, del, result(idOf(del), 'Updated task #1 deleted')]).tasks).toEqual([]);
  });

  it('counts tasks a subagent creates and updates on the shared list', () => {
    const create = use('TaskCreate', { subject: 'Shared', description: '' }, { parentToolUseId: 'agent-1' });
    const done = use('TaskUpdate', { taskId: '4', status: 'completed' }, { parentToolUseId: 'agent-1' });
    const events: AgentEvent[] = [
      create, result(idOf(create), 'Task #4 created successfully: Shared', { parentToolUseId: 'agent-1' }),
      done, result(idOf(done), 'Updated task #4 status', { parentToolUseId: 'agent-1' }),
    ];
    expect(threadItems(events).tasks).toEqual([{ id: '4', content: 'Shared', status: 'completed' }]);
  });

  it('follows an ACP plan as tool_update fills it in, and a todowrite input that arrives late', () => {
    const plan = use('plan', { entries: [{ content: 'one', status: 'in_progress' }] });
    const todo = use('todowrite', {});
    const events: AgentEvent[] = [
      plan,
      { type: 'tool_update', toolUseId: idOf(plan), toolInput: { entries: [{ content: 'one', status: 'completed' }, { content: 'two' }] } },
      todo,
      { type: 'tool_update', toolUseId: idOf(todo), toolInput: { todos: [{ content: 'later', status: 'pending' }] } },
    ];
    expect(threadItems(events.slice(0, 2)).tasks.map((t) => [t.content, t.status])).toEqual([['one', 'completed'], ['two', 'pending']]);
    expect(threadItems(events).tasks.map((t) => t.content)).toEqual(['later']);
    expect(threadItems(events).tasksEventIndex).toBe(3);
  });

  it('has no list when the agent kept none', () => {
    expect(threadItems([use('Bash', { command: 'ls' })])).toEqual({ tasks: [], tasksEventIndex: null, files: [] });
  });
});

describe('threadItems files', () => {
  it('lists attached text files, images and files, newest first', () => {
    const text = `${buildContentBlock('file', 'notes.md', 'héllo')}\n\nRead this`;
    const events: AgentEvent[] = [
      { type: 'user_message', text, uuid: 'm1', images: [{ file: 'aa.png', name: 'shot.png' }] },
      { type: 'user_message', text: 'and this', uuid: 'm2', files: [{ file: 'bb.pdf', name: 'spec.pdf', mediaType: 'application/pdf', size: 10 }] },
    ];
    expect(threadItems(events).files).toEqual([
      { kind: 'file', file: { file: 'bb.pdf', name: 'spec.pdf', mediaType: 'application/pdf', size: 10 }, eventIndex: 1 },
      { kind: 'image', from: 'user', image: { file: 'aa.png', name: 'shot.png' }, eventIndex: 0 },
      { kind: 'text', name: 'notes.md', size: 6, eventIndex: 0 },
    ]);
  });

  it('leaves @-references out of the attached text files', () => {
    const text = `${buildContentBlock('file', 'src/a.ts', 'x')}\n\nLook at @src/a.ts`;
    expect(threadItems([{ type: 'user_message', text }]).files).toEqual([]);
  });

  it('lists images tools returned with the tool, and files made', () => {
    const shot = use('mcp__grove-preview__screenshot', {});
    const events: AgentEvent[] = [
      shot,
      result(idOf(shot), '', { images: [{ file: 'cc.png' }] }),
      { type: 'files_made', files: [{ path: 'out/report.pdf', kind: 'pdf', size: 99 }] },
    ];
    expect(threadItems(events).files).toEqual([
      { kind: 'made', made: { path: 'out/report.pdf', kind: 'pdf', size: 99 }, eventIndex: 2 },
      { kind: 'image', from: 'tool', image: { file: 'cc.png' }, toolName: 'mcp__grove-preview__screenshot', eventIndex: 1 },
    ]);
  });

  it('lists a file once, at the last time it came in', () => {
    const events: AgentEvent[] = [
      { type: 'files_made', files: [{ path: 'chart.png', kind: 'image', size: 1 }] },
      { type: 'user_message', text: 'hi', images: [{ file: 'aa.png' }] },
      { type: 'files_made', files: [{ path: 'chart.png', kind: 'image', size: 2, image: { file: 'dd.png' } }] },
      { type: 'user_message', text: 'again', images: [{ file: 'aa.png' }] },
    ];
    expect(threadItems(events).files).toEqual([
      { kind: 'image', from: 'user', image: { file: 'aa.png' }, eventIndex: 3 },
      { kind: 'made', made: { path: 'chart.png', kind: 'image', size: 2, image: { file: 'dd.png' } }, eventIndex: 2 },
    ]);
  });

  it("leaves out a subagent's tool images", () => {
    const shot = use('screenshot', {}, { parentToolUseId: 'agent-1' });
    const events: AgentEvent[] = [shot, result(idOf(shot), '', { images: [{ file: 'ee.png' }], parentToolUseId: 'agent-1' })];
    expect(threadItems(events).files).toEqual([]);
  });
});

describe('touchesThreadItems', () => {
  it('picks out events that can change the lists', () => {
    expect(touchesThreadItems(use('TodoWrite', { todos: [] }))).toBe(true);
    expect(touchesThreadItems({ type: 'tool_update', toolUseId: 'p', toolInput: { entries: [] } })).toBe(true);
    expect(touchesThreadItems(result('t', 'Task #3 created successfully: x'))).toBe(true);
    expect(touchesThreadItems(result('t', 'Updated task #3 status'))).toBe(true);
    expect(touchesThreadItems(result('t', '', { images: [{ file: 'a.png' }] }))).toBe(true);
    expect(touchesThreadItems({ type: 'user_message', text: 'hi' })).toBe(true);
    expect(touchesThreadItems({ type: 'files_made', files: [] })).toBe(true);
    expect(touchesThreadItems({ type: 'rewind', toMessageId: 'm' })).toBe(true);
  });

  it('skips the rest', () => {
    expect(touchesThreadItems(use('Bash', { command: 'ls' }))).toBe(false);
    expect(touchesThreadItems(use('TaskCreate', { subject: 'x' }))).toBe(false);
    expect(touchesThreadItems(result('t', 'file contents'))).toBe(false);
    expect(touchesThreadItems({ type: 'tool_update', toolUseId: 'x', toolInput: { command: 'ls' } })).toBe(false);
    expect(touchesThreadItems({ type: 'partial_text', text: 'x' })).toBe(false);
  });
});

describe('taskProgress', () => {
  it('counts done tasks, leaving cancelled ones out of the total', () => {
    expect(taskProgress([
      { id: '0', content: 'a', status: 'completed' },
      { id: '1', content: 'b', status: 'in_progress' },
      { id: '2', content: 'c', status: 'cancelled' },
    ])).toEqual({ done: 1, total: 2 });
  });
});
