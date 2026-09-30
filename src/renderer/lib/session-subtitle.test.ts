import { describe, it, expect } from 'vitest';
import { sessionSubtitle, pendingPermissionTool, lastTextSnippet, firstPromptSnippet } from './session-subtitle.js';
import type { ChatMessage } from '../stores/messages.svelte.js';

const IDLE = { activity: 'idle' as const };

describe('sessionSubtitle', () => {
  it('prioritizes a pending permission over everything else', () => {
    const s = sessionSubtitle({
      isRunning: true,
      activity: { activity: 'tool_starting', toolName: 'Bash', toolSummary: 'npm test' },
      pendingTool: 'Bash',
      lastText: 'previous answer',
      firstPrompt: 'do things',
    });
    expect(s).toEqual({ text: 'Wants to run a command', tone: 'waiting' });
  });

  it('phrases a pending question as waiting for an answer', () => {
    const s = sessionSubtitle({ isRunning: true, activity: IDLE, pendingTool: 'question', lastText: null, firstPrompt: null });
    expect(s).toEqual({ text: 'Waiting for your answer', tone: 'waiting' });
  });

  it('shows the running tool with its summary while working', () => {
    const s = sessionSubtitle({
      isRunning: true,
      activity: { activity: 'tool_starting', toolName: 'Bash', toolSummary: 'npm run build' },
      pendingTool: null,
      lastText: null,
      firstPrompt: null,
    });
    expect(s).toEqual({ text: 'Bash: npm run build', tone: 'working' });
  });

  it('names the plan and MCP tools in plain words', () => {
    const plan = sessionSubtitle({ isRunning: true, activity: IDLE, pendingTool: 'ExitPlanMode', lastText: null, firstPrompt: null });
    expect(plan).toEqual({ text: 'Has a plan for you to approve', tone: 'waiting' });
    const mcp = sessionSubtitle({
      isRunning: true,
      activity: { activity: 'tool_starting', toolName: 'mcp__linear__create_issue' },
      pendingTool: null, lastText: null, firstPrompt: null,
    });
    expect(mcp).toEqual({ text: 'Running create issue (linear)…', tone: 'working' });
  });

  it('shows a generic running label without a tool summary', () => {
    const s = sessionSubtitle({
      isRunning: true,
      activity: { activity: 'tool_starting', toolName: 'Read' },
      pendingTool: null, lastText: null, firstPrompt: null,
    });
    expect(s).toEqual({ text: 'Running Read…', tone: 'working' });
  });

  it('shows thinking / generic working states', () => {
    expect(sessionSubtitle({ isRunning: true, activity: { activity: 'thinking' }, pendingTool: null, lastText: null, firstPrompt: null }))
      .toEqual({ text: 'Thinking…', tone: 'working' });
    expect(sessionSubtitle({ isRunning: true, activity: { activity: 'generating' }, pendingTool: null, lastText: null, firstPrompt: null }))
      .toEqual({ text: 'Working…', tone: 'working' });
  });

  it('falls back to last text, then first prompt, when idle', () => {
    expect(sessionSubtitle({ isRunning: false, activity: IDLE, pendingTool: null, lastText: 'the answer', firstPrompt: 'the ask' }))
      .toEqual({ text: 'the answer', tone: 'context' });
    expect(sessionSubtitle({ isRunning: false, activity: IDLE, pendingTool: null, lastText: null, firstPrompt: 'the ask' }))
      .toEqual({ text: 'the ask', tone: 'context' });
  });

  it('returns null when there is nothing to show', () => {
    expect(sessionSubtitle({ isRunning: false, activity: IDLE, pendingTool: null, lastText: null, firstPrompt: null })).toBeNull();
  });

  it('collapses whitespace and truncates long text', () => {
    const s = sessionSubtitle({
      isRunning: false, activity: IDLE, pendingTool: null,
      lastText: `line one\n\n   ${'x'.repeat(200)}`, firstPrompt: null,
    });
    expect(s!.text.startsWith('line one x')).toBe(true);
    expect(s!.text.endsWith('…')).toBe(true);
    expect(s!.text.length).toBeLessThanOrEqual(91);
  });
});

describe('message helpers', () => {
  const messages: ChatMessage[] = [
    { kind: 'user', id: 'u0', text: '/clear' },
    { kind: 'user', id: 'u1', text: 'fix the sidebar' },
    { kind: 'text', id: 'a1', text: 'On it', uuid: '' },
    { kind: 'permission', id: 'p1', requestId: 'r1', toolName: 'Bash', toolInput: {}, toolUseId: 't1', resolved: true },
    { kind: 'text', id: 'a2', text: 'Done — sidebar fixed', uuid: '' },
  ];

  it('firstPromptSnippet skips slash commands', () => {
    expect(firstPromptSnippet(messages)).toBe('fix the sidebar');
  });

  it('lastTextSnippet returns the most recent text', () => {
    expect(lastTextSnippet(messages)).toBe('Done — sidebar fixed');
  });

  it('lastTextSnippet drops markdown syntax', () => {
    const md: ChatMessage[] = [{ kind: 'text', id: 'm1', text: '## Investigation summary\n\nThe **flakiness** came from `retry-helper.ts`', uuid: '' }];
    expect(lastTextSnippet(md)).toBe('Investigation summary The flakiness came from retry-helper.ts');
  });

  it('skips a message that is only markdown syntax', () => {
    const md: ChatMessage[] = [
      { kind: 'user', id: 'u1', text: '***' },
      { kind: 'user', id: 'u2', text: 'the real prompt' },
      { kind: 'text', id: 'm1', text: 'the real answer', uuid: '' },
      { kind: 'text', id: 'm2', text: '---', uuid: '' },
    ];
    expect(lastTextSnippet(md)).toBe('the real answer');
    expect(firstPromptSnippet(md)).toBe('the real prompt');
  });

  it('firstPromptSnippet drops markdown syntax', () => {
    const md: ChatMessage[] = [{ kind: 'user', id: 'u1', text: '# Task\n1. fix [the bug](https://x.test)' }];
    expect(firstPromptSnippet(md)).toBe('Task fix the bug');
  });

  it('pendingPermissionTool ignores resolved permissions', () => {
    expect(pendingPermissionTool(messages)).toBeNull();
  });

  it('pendingPermissionTool finds the latest unresolved permission', () => {
    const withPending: ChatMessage[] = [
      ...messages,
      { kind: 'permission', id: 'p2', requestId: 'r2', toolName: 'Write', toolInput: {}, toolUseId: 't2', resolved: false },
    ];
    expect(pendingPermissionTool(withPending)).toBe('Write');
  });

  it('pendingPermissionTool reports unresolved questions', () => {
    const withQuestion: ChatMessage[] = [
      ...messages,
      { kind: 'question', id: 'q1', requestId: 'r3', toolUseId: 't3', questions: [], resolved: false },
    ];
    expect(pendingPermissionTool(withQuestion)).toBe('question');
  });
});
