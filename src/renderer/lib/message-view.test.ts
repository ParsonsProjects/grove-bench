import { describe, it, expect } from 'vitest';
import {
  isMessageVisible,
  filterVisibleMessages,
  hasAgentReply,
  NEXT_VIEW_MODE,
  VIEW_MODE_LABELS,
  VIEW_MODE_DESCRIPTIONS,
  VIEW_MODE_HINTS,
} from './message-view.js';
import { ACTIVITY_VIEW_MODES } from '../../shared/types.js';
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

  it('in summary mode shows edits and commands, and hides reads and searches', () => {
    expect(isMessageVisible(tool({ id: '1', toolName: 'Edit' }), 'summary')).toBe(true);
    expect(isMessageVisible(tool({ id: '2', toolName: 'Write' }), 'summary')).toBe(true);
    expect(isMessageVisible(tool({ id: '3', toolName: 'Bash' }), 'summary')).toBe(true);
    expect(isMessageVisible(tool({ id: '6', toolName: 'NotebookEdit' }), 'summary')).toBe(true);
    expect(isMessageVisible(tool({ id: '4', toolName: 'Read' }), 'summary')).toBe(false);
    expect(isMessageVisible(tool({ id: '5', toolName: 'Grep' }), 'summary')).toBe(false);
  });

  it('in summary mode shows MCP tools, which can act outside the project, but not Grove\'s own', () => {
    expect(isMessageVisible(tool({ id: '1', toolName: 'mcp__linear__create_issue' }), 'summary')).toBe(true);
    expect(isMessageVisible(tool({ id: '2', toolName: 'mcp__grove-preview__navigate' }), 'summary')).toBe(false);
    expect(isMessageVisible(tool({ id: '3', toolName: 'mcp__grove-memory__save_memory' }), 'summary')).toBe(false);
  });

  it('in summary mode shows tools that returned images, so the images stay in view', () => {
    const images = [{ file: `${'a'.repeat(32)}.png` }];
    expect(isMessageVisible(tool({ id: '1', toolName: 'mcp__grove-preview__screenshot', images }), 'summary')).toBe(true);
    expect(isMessageVisible(tool({ id: '2', toolName: 'Read', images }), 'summary')).toBe(true);
    expect(isMessageVisible(tool({ id: '3', toolName: 'Read', images }), 'focus')).toBe(false);
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
    // Unlike other system notes, the missing git identity notice needs action.
    expect(isMessageVisible({ kind: 'git_identity_missing', id: '4' }, 'focus')).toBe(true);
  });

  it('in focus mode shows only unresolved permissions', () => {
    expect(isMessageVisible(permission('1', false), 'focus')).toBe(true);
    expect(isMessageVisible(permission('2', true), 'focus')).toBe(false);
    // ...but summary mode keeps resolved ones visible
    expect(isMessageVisible(permission('5', true), 'summary')).toBe(true);
  });

  it('in focus mode keeps questions whether or not they have been answered', () => {
    expect(isMessageVisible(question('3', false), 'focus')).toBe(true);
    // An answered question block renders the user's reply, so it stays.
    expect(isMessageVisible(question('4', true), 'focus')).toBe(true);
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

  it('focus mode keeps every assistant text block, not just the last per turn', () => {
    const turn: ChatMessage[] = [
      { kind: 'user', id: 'u1', text: 'review this' },
      text('t1'), // status note before a tool call
      tool({ id: 'tc1', toolName: 'Read' }),
      text('t2'), // findings
      text('t3'), // next steps, split into a separate block by the agent
      { kind: 'result', id: 'r1', subtype: 'success', isError: false },
      { kind: 'user', id: 'u2', text: 'more' },
      text('t4'),
    ];
    const visible = filterVisibleMessages(turn, 'focus').map((m) => m.id);
    expect(visible).toEqual(['u1', 't1', 't2', 't3', 'r1', 'u2', 't4']);
  });

  it('focus mode keeps every question, unresolved permissions, and drops resolved permissions', () => {
    const turn: ChatMessage[] = [
      { kind: 'user', id: 'u1', text: 'go' },
      permission('p1', true),
      tool({ id: 'tc1', toolName: 'Bash' }),
      question('q0', true),
      permission('p2', false),
      question('q1', false),
      text('t1'),
    ];
    const visible = filterVisibleMessages(turn, 'focus').map((m) => m.id);
    expect(visible).toEqual(['u1', 'q0', 'p2', 'q1', 't1']);
  });
});

describe('view mode tables', () => {
  it('cycles through every mode exactly once', () => {
    const seen = new Set<string>();
    let mode = NEXT_VIEW_MODE.summary;
    for (let i = 0; i < ACTIVITY_VIEW_MODES.length; i++) {
      seen.add(mode);
      mode = NEXT_VIEW_MODE[mode];
    }
    expect([...seen].sort()).toEqual([...ACTIVITY_VIEW_MODES].sort());
    expect(mode).toBe(NEXT_VIEW_MODE.summary);
  });

  it('has a label, description and hint for every mode', () => {
    for (const mode of ACTIVITY_VIEW_MODES) {
      expect(VIEW_MODE_LABELS[mode]).toBeTruthy();
      expect(VIEW_MODE_DESCRIPTIONS[mode]).toBeTruthy();
      expect(VIEW_MODE_HINTS[mode]).toBeTruthy();
    }
  });
});

describe('hasAgentReply', () => {
  it('ignores the user\'s own messages and the app\'s notes', () => {
    expect(hasAgentReply([])).toBe(false);
    expect(hasAgentReply([
      { kind: 'system', id: 's1', text: 'Connected to a model' },
      { kind: 'user', id: 'u1', text: 'Fix the login crash' },
      { kind: 'git_identity_missing', id: 'g1' },
    ] as ChatMessage[])).toBe(false);
  });

  it('counts the agent\'s output and the end of a turn', () => {
    const user = { kind: 'user', id: 'u1', text: 'Fix it' } as ChatMessage;
    for (const reply of [
      { kind: 'text', id: 'm', text: 'On it' },
      { kind: 'tool_call', id: 'm', toolName: 'Edit', toolInput: {} },
      { kind: 'result', id: 'm', isError: false },
      { kind: 'error', id: 'm', text: 'Agent crashed' },
    ]) {
      expect(hasAgentReply([user, reply as ChatMessage]), reply.kind).toBe(true);
    }
  });
});
