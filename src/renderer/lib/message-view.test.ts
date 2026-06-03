import { describe, it, expect } from 'vitest';
import {
  isMessageVisible,
  filterVisibleMessages,
  searchableText,
  findMatchIds,
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

describe('searchableText', () => {
  it('indexes plain text / user / system / error', () => {
    expect(searchableText({ kind: 'text', id: '1', text: 'hello world', uuid: '' })).toContain('hello world');
    expect(searchableText({ kind: 'user', id: '2', text: 'fix the bug' })).toContain('fix the bug');
    expect(searchableText({ kind: 'system', id: '3', text: 'connected' })).toContain('connected');
    expect(searchableText({ kind: 'error', id: '4', text: 'boom' })).toContain('boom');
  });

  it('indexes thinking', () => {
    expect(searchableText({ kind: 'thinking', id: '1', thinking: 'let me reason' })).toContain('let me reason');
  });

  it('indexes tool name, input args, and result', () => {
    const m = tool({
      id: '1',
      toolName: 'Edit',
      toolInput: { file_path: '/src/widget.ts', old_string: 'foo', new_string: 'bar' },
      result: 'edited successfully',
    });
    const text = searchableText(m);
    expect(text).toContain('Edit');
    expect(text).toContain('/src/widget.ts');
    expect(text).toContain('edited successfully');
  });

  it('indexes permission tool name and plan text', () => {
    const m: ChatMessage = {
      kind: 'permission',
      id: '1',
      requestId: 'r',
      toolName: 'Bash',
      toolInput: { command: 'rm -rf node_modules' },
      toolUseId: 't',
      resolved: false,
      planText: 'delete the cache',
    };
    const text = searchableText(m);
    expect(text).toContain('Bash');
    expect(text).toContain('rm -rf node_modules');
    expect(text).toContain('delete the cache');
  });

  it('indexes question text, headers, and option labels', () => {
    const m: ChatMessage = {
      kind: 'question',
      id: '1',
      requestId: 'r',
      toolUseId: 't',
      resolved: false,
      questions: [
        {
          question: 'Which database?',
          header: 'DB',
          multiSelect: false,
          options: [
            { label: 'Postgres', description: 'relational' },
            { label: 'Mongo', description: 'document' },
          ],
        },
      ],
    };
    const text = searchableText(m);
    expect(text).toContain('Which database?');
    expect(text).toContain('Postgres');
  });

  it('indexes result message text and errors', () => {
    const m: ChatMessage = {
      kind: 'result',
      id: '1',
      subtype: 'success',
      isError: true,
      result: 'all done',
      errors: ['timeout', 'oom'],
    };
    const text = searchableText(m);
    expect(text).toContain('all done');
    expect(text).toContain('timeout');
  });
});

describe('findMatchIds', () => {
  const msgs: ChatMessage[] = [
    { kind: 'user', id: '1', text: 'investigate the parser' },
    { kind: 'thinking', id: '2', thinking: 'the parser is recursive' },
    tool({ id: '3', toolName: 'Edit', toolInput: { file_path: '/src/parser.ts' } }),
    { kind: 'text', id: '4', text: 'unrelated answer', uuid: '' },
  ];

  it('returns empty for blank query', () => {
    expect(findMatchIds(msgs, '')).toEqual([]);
    expect(findMatchIds(msgs, '   ')).toEqual([]);
  });

  it('is case-insensitive and matches across message kinds', () => {
    expect(findMatchIds(msgs, 'PARSER')).toEqual(['1', '2', '3']);
  });

  it('matches tool input filename', () => {
    expect(findMatchIds(msgs, 'parser.ts')).toEqual(['3']);
  });

  it('returns ids in message order', () => {
    expect(findMatchIds(msgs, 'the')).toEqual(['1', '2']);
  });
});
