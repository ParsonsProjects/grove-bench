import { describe, it, expect } from 'vitest';
import { searchEvents, searchableEventText, eventKind } from './event-search.js';
import type { AgentEvent } from '../shared/types.js';

describe('searchableEventText', () => {
  it('extracts content-bearing text per event kind', () => {
    expect(searchableEventText({ type: 'user_message', text: 'fix the parser' })).toContain('fix the parser');
    expect(searchableEventText({ type: 'assistant_text', text: 'done', uuid: '' })).toContain('done');
    expect(searchableEventText({ type: 'thinking', thinking: 'let me reason', uuid: '' })).toContain('let me reason');
    expect(searchableEventText({ type: 'tool_result', toolUseId: 't', content: 'file1.ts' })).toContain('file1.ts');
    expect(searchableEventText({ type: 'result', subtype: 'success', isError: false, result: 'all done' })).toContain('all done');
  });

  it('includes tool name and input args for tool_use', () => {
    const text = searchableEventText({
      type: 'assistant_tool_use', toolName: 'Edit', toolUseId: 't', uuid: '',
      toolInput: { file_path: '/src/widget.ts', old_string: 'a', new_string: 'b' },
    });
    expect(text).toContain('Edit');
    expect(text).toContain('/src/widget.ts');
  });

  it('includes plan text for permission requests', () => {
    const text = searchableEventText({
      type: 'permission_request', toolName: 'Bash', toolUseId: 't', requestId: 'r',
      toolInput: { command: 'rm -rf node_modules' }, planText: 'delete the cache',
    });
    expect(text).toContain('rm -rf node_modules');
    expect(text).toContain('delete the cache');
  });

  it('returns empty string for transient/noise events', () => {
    expect(searchableEventText({ type: 'partial_text', text: 'streaming' })).toBe('');
    expect(searchableEventText({ type: 'activity', activity: 'thinking' })).toBe('');
    expect(searchableEventText({ type: 'usage', inputTokens: 1, outputTokens: 2 })).toBe('');
    expect(searchableEventText({ type: 'tool_progress', toolName: 'Bash', toolUseId: 't', elapsedSeconds: 1 })).toBe('');
  });
});

describe('eventKind', () => {
  it('labels events for display', () => {
    expect(eventKind({ type: 'user_message', text: 'x' })).toBe('user');
    expect(eventKind({ type: 'assistant_text', text: 'x', uuid: '' })).toBe('assistant');
    expect(eventKind({ type: 'thinking', thinking: 'x', uuid: '' })).toBe('thinking');
    expect(eventKind({ type: 'assistant_tool_use', toolName: 'Edit', toolInput: {}, toolUseId: 't', uuid: '' })).toBe('tool');
    expect(eventKind({ type: 'tool_result', toolUseId: 't', content: 'x' })).toBe('tool');
    expect(eventKind({ type: 'permission_request', toolName: 'Bash', toolInput: {}, toolUseId: 't', requestId: 'r' })).toBe('permission');
    expect(eventKind({ type: 'result', subtype: 'success', isError: false })).toBe('result');
    expect(eventKind({ type: 'status', message: 'x' })).toBe('system');
  });
});

describe('searchEvents', () => {
  const events: AgentEvent[] = [
    { type: 'user_message', text: 'investigate the parser bug' },
    { type: 'partial_text', text: 'parser streaming noise' }, // transient — never matched
    { type: 'thinking', thinking: 'the parser is recursive', uuid: '' },
    { type: 'assistant_tool_use', toolName: 'Edit', toolUseId: 't1', uuid: '', toolInput: { file_path: '/src/parser.ts' } },
    { type: 'assistant_text', text: 'unrelated answer', uuid: '' },
  ];

  it('returns empty for a blank query', () => {
    expect(searchEvents(events, '')).toEqual([]);
    expect(searchEvents(events, '   ')).toEqual([]);
  });

  it('is case-insensitive and matches across event kinds, skipping transient', () => {
    const hits = searchEvents(events, 'PARSER');
    // newest-first: tool_use(3), thinking(2), user(0); partial_text(1) skipped
    expect(hits.map((h) => h.eventIndex)).toEqual([3, 2, 0]);
  });

  it('reports the absolute event index and kind', () => {
    const hits = searchEvents(events, 'parser.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].eventIndex).toBe(3);
    expect(hits[0].kind).toBe('tool');
  });

  it('produces a snippet containing the match', () => {
    const hits = searchEvents(events, 'recursive');
    expect(hits[0].snippet).toContain('recursive');
  });

  it('truncates long text with an ellipsis around the match', () => {
    const long = 'x'.repeat(200) + ' NEEDLE ' + 'y'.repeat(200);
    const hits = searchEvents([{ type: 'user_message', text: long }], 'needle');
    expect(hits[0].snippet).toContain('NEEDLE');
    expect(hits[0].snippet.length).toBeLessThan(120);
    expect(hits[0].snippet.startsWith('…')).toBe(true);
    expect(hits[0].snippet.endsWith('…')).toBe(true);
  });

  it('caps results at the limit, keeping the most recent matches', () => {
    const many: AgentEvent[] = Array.from({ length: 10 }, (_, i) => ({ type: 'user_message', text: `match ${i}` }));
    const hits = searchEvents(many, 'match', 3);
    expect(hits).toHaveLength(3);
    // newest-first → indices 9, 8, 7
    expect(hits.map((h) => h.eventIndex)).toEqual([9, 8, 7]);
  });
});
