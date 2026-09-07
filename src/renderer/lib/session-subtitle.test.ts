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
    expect(s).toEqual({ text: 'Waiting for approval — Bash', tone: 'waiting' });
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
