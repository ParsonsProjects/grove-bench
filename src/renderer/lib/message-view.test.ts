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

describe('isMessageVisible', () => {
  it('hides tool_call awaiting permission in both modes', () => {
    const m = tool({ id: '1', toolName: 'Edit', awaitingPermission: true });
    expect(isMessageVisible(m, true)).toBe(false);
    expect(isMessageVisible(m, false)).toBe(false);
  });

  it('shows everything except awaiting-permission tools in detailed mode', () => {
    expect(isMessageVisible({ kind: 'thinking', id: '1', thinking: 'x' }, true)).toBe(true);
    expect(isMessageVisible(tool({ id: '2', toolName: 'Glob' }), true)).toBe(true);
  });

  it('hides thinking in summary mode', () => {
    expect(isMessageVisible({ kind: 'thinking', id: '1', thinking: 'x' }, false)).toBe(false);
  });

  it('in summary mode only shows Edit/Write/Bash tool calls', () => {
    expect(isMessageVisible(tool({ id: '1', toolName: 'Edit' }), false)).toBe(true);
    expect(isMessageVisible(tool({ id: '2', toolName: 'Write' }), false)).toBe(true);
    expect(isMessageVisible(tool({ id: '3', toolName: 'Bash' }), false)).toBe(true);
    expect(isMessageVisible(tool({ id: '4', toolName: 'Read' }), false)).toBe(false);
    expect(isMessageVisible(tool({ id: '5', toolName: 'Grep' }), false)).toBe(false);
  });

  it('shows user/text/system messages in summary mode', () => {
    expect(isMessageVisible({ kind: 'user', id: '1', text: 'hi' }, false)).toBe(true);
    expect(isMessageVisible({ kind: 'text', id: '2', text: 'hi', uuid: '' }, false)).toBe(true);
    expect(isMessageVisible({ kind: 'system', id: '3', text: 'hi' }, false)).toBe(true);
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
    const visible = filterVisibleMessages(msgs, false).map((m) => m.id);
    expect(visible).toEqual(['1', '4']);
  });

  it('detailed mode keeps all except awaiting-permission tool', () => {
    const visible = filterVisibleMessages(msgs, true).map((m) => m.id);
    expect(visible).toEqual(['1', '2', '3', '4']);
  });
});
