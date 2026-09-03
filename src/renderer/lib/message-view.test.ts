import { describe, it, expect } from 'vitest';
import {
  isMessageVisible,
  filterVisibleMessages,
} from './message-view.js';
import type { ChatMessage } from '../stores/messages.svelte.js';

function tool(partial: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    kind: 'tool_call',
    toolName: 'Read',
    toolInput: {},
    toolUseId: 'tu',
    uuid: 'u',
    pending: false,
    ...partial,
  } as ChatMessage;
}

function text(id: string): ChatMessage {
  return { kind: 'text', id, text: `t${id}`, uuid: '' };
}

function permission(id: string, resolved: boolean): ChatMessage {
  return {
    kind: 'permission',
    id,
    requestId: 'r',
    toolName: 'Bash',
    toolInput: {},
    toolUseId: 'tu',
    resolved,
  };
}

function question(id: string, resolved: boolean): ChatMessage {
  return {
    kind: 'question',
    id,
    requestId: 'r',
    toolUseId: 'tu',
    questions: [],
    resolved,
  };
}

describe('isMessageVisible', () => {
  it('hides tool_call awaiting permission in all modes', () => {
    const m = tool({ id: '1', toolName: 'Edit', awaitingPermission: true });
    expect(isMessageVisible(m, 'detailed')).toBe(false);
    expect(isMessageVisible(m, 'summary')).toBe(false);
    expect(isMessageVisible(m, 'focus')).toBe(false);
  });

  it('shows everything except awaiting-permission tools in detailed mode', () => {
    expect(isMessageVisible({ kind: 'thinking', id: '1', thinking: 'x' }, 'detailed')).toBe(true);
    expect(isMessageVisible(tool({ id: '2', toolName: 'Glob' }), 'detailed')).toBe(true);
  });

  it('hides thinking in summary and focus modes', () => {
    expect(isMessageVisible({ kind: 'thinking', id: '1', thinking: 'x' }, 'summary')).toBe(false);
    expect(isMessageVisible({ kind: 'thinking', id: '1', thinking: 'x' }, 'focus')).toBe(false);
  });

  it('in summary mode only shows Edit/Write/Bash tool calls', () => {
    expect(isMessageVisible(tool({ id: '1', toolName: 'Edit' }), 'summary')).toBe(true);
    expect(isMessageVisible(tool({ id: '2', toolName: 'Write' }), 'summary')).toBe(true);
    expect(isMessageVisible(tool({ id: '3', toolName: 'Bash' }), 'summary')).toBe(true);
    expect(isMessageVisible(tool({ id: '4', toolName: 'Read' }), 'summary')).toBe(false);
    expect(isMessageVisible(tool({ id: '5', toolName: 'Grep' }), 'summary')).toBe(false);
  });

  it('shows user/text/system messages in summary mode', () => {
    expect(isMessageVisible({ kind: 'user', id: '1', text: 'hi' }, 'summary')).toBe(true);
    expect(isMessageVisible(text('2'), 'summary')).toBe(true);
    expect(isMessageVisible({ kind: 'system', id: '3', text: 'hi' }, 'summary')).toBe(true);
  });

  it('in focus mode hides all tool calls and system messages', () => {
    expect(isMessageVisible(tool({ id: '1', toolName: 'Edit' }), 'focus')).toBe(false);
    expect(isMessageVisible(tool({ id: '2', toolName: 'Bash' }), 'focus')).toBe(false);
    expect(isMessageVisible({ kind: 'system', id: '3', text: 'hi' }, 'focus')).toBe(false);
  });

  it('in focus mode shows only unresolved permissions and questions', () => {
    expect(isMessageVisible(permission('1', false), 'focus')).toBe(true);
    expect(isMessageVisible(permission('2', true), 'focus')).toBe(false);
    expect(isMessageVisible(question('3', false), 'focus')).toBe(true);
    expect(isMessageVisible(question('4', true), 'focus')).toBe(false);
    // ...but summary mode keeps resolved ones visible
    expect(isMessageVisible(permission('5', true), 'summary')).toBe(true);
  });

  it('in focus mode keeps user prompts, errors, and turn results', () => {
    expect(isMessageVisible({ kind: 'user', id: '1', text: 'hi' }, 'focus')).toBe(true);
    expect(isMessageVisible({ kind: 'error', id: '2', text: 'boom' }, 'focus')).toBe(true);
    expect(isMessageVisible({ kind: 'result', id: '3', subtype: 'success', isError: false }, 'focus')).toBe(true);
  });
});

describe('filterVisibleMessages', () => {
  const msgs: ChatMessage[] = [
    { kind: 'user', id: '1', text: 'hi' },
    { kind: 'thinking', id: '2', thinking: 'pondering' },
    tool({ id: '3', toolName: 'Read', toolInput: { file_path: '/a.ts' } }),
    tool({ id: '4', toolName: 'Edit', toolInput: { file_path: '/b.ts' } }),
    tool({ id: '5', toolName: 'Bash', awaitingPermission: true }),
  ];

  it('summary mode keeps user + Edit, drops thinking/Read/awaiting', () => {
    const visible = filterVisibleMessages(msgs, 'summary').map((m) => m.id);
    expect(visible).toEqual(['1', '4']);
  });

  it('detailed mode keeps all except awaiting-permission tool', () => {
    const visible = filterVisibleMessages(msgs, 'detailed').map((m) => m.id);
    expect(visible).toEqual(['1', '2', '3', '4']);
  });

  it('focus mode keeps only the final text of each turn', () => {
    const turn: ChatMessage[] = [
      { kind: 'user', id: 'u1', text: 'do stuff' },
      text('t1'), // interim status note
      tool({ id: 'tc1', toolName: 'Edit' }),
      text('t2'), // final text of turn 1
      { kind: 'result', id: 'r1', subtype: 'success', isError: false },
      { kind: 'user', id: 'u2', text: 'more' },
      text('t3'), // final so far — turn 2 still running
    ];
    const visible = filterVisibleMessages(turn, 'focus').map((m) => m.id);
    expect(visible).toEqual(['u1', 't2', 'r1', 'u2', 't3']);
  });

  it('focus mode treats the next user message as a turn boundary when no result exists', () => {
    const turn: ChatMessage[] = [
      { kind: 'user', id: 'u1', text: 'do stuff' },
      text('t1'),
      text('t2'), // final text before next user prompt
      { kind: 'user', id: 'u2', text: 'more' },
      text('t3'),
    ];
    const visible = filterVisibleMessages(turn, 'focus').map((m) => m.id);
    expect(visible).toEqual(['u1', 't2', 'u2', 't3']);
  });

  it('focus mode keeps unresolved permission/question blocks and drops resolved ones', () => {
    const turn: ChatMessage[] = [
      { kind: 'user', id: 'u1', text: 'go' },
      permission('p1', true),
      tool({ id: 'tc1', toolName: 'Bash' }),
      permission('p2', false),
      question('q1', false),
      text('t1'),
    ];
    const visible = filterVisibleMessages(turn, 'focus').map((m) => m.id);
    expect(visible).toEqual(['u1', 'p2', 'q1', 't1']);
  });
});
