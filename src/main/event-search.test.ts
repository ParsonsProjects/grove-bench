import { describe, it, expect, vi } from 'vitest';
import { searchEvents, searchableEventText, eventKind, findEventIndexByUuid, extractSessionPreview, firstUserPrompt, EventSearchIndex, SearchIndexCache } from './event-search.js';
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

  it('matches across line breaks and whitespace runs, in text and query', () => {
    const multiline: AgentEvent[] = [{ type: 'assistant_text', text: 'fixed the\n\n   parser bug', uuid: '' }];
    expect(searchEvents(multiline, 'the parser')[0]?.snippet).toBe('fixed the parser bug');
    expect(searchEvents(multiline, 'the   parser')).toHaveLength(1);
  });

  it('treats regex characters in the query literally', () => {
    const code: AgentEvent[] = [{ type: 'tool_result', toolUseId: 't', content: 'call foo(bar) in a.ts' }];
    expect(searchEvents(code, 'foo(bar)')).toHaveLength(1);
    expect(searchEvents(code, 'a.ts')).toHaveLength(1);
    expect(searchEvents(code, 'a*ts')).toHaveLength(0);
  });
});

describe('EventSearchIndex', () => {
  const events: AgentEvent[] = [
    { type: 'user_message', text: 'investigate the parser bug' },
    { type: 'partial_text', text: 'parser streaming noise' },
    { type: 'thinking', thinking: 'the Parser is\n\trecursive', uuid: '' },
    { type: 'assistant_tool_use', toolName: 'Edit', toolUseId: 't1', uuid: '', toolInput: { file_path: '/src/parser.ts' } },
    { type: 'assistant_text', text: 'unrelated answer', uuid: '' },
    { type: 'tool_result', toolUseId: 't1', content: 'x'.repeat(200) + ' PARSER ' + 'y'.repeat(200) },
  ];

  it('returns the same hits as searchEvents', () => {
    const index = new EventSearchIndex();
    index.append(events);
    for (const q of ['parser', 'PARSER', 'is recursive', 'parser.ts', 'answer', 'nothing', '', 'x']) {
      for (const limit of [1, 2, 100]) {
        expect(index.search(q, limit)).toEqual(searchEvents(events, q, limit));
      }
    }
  });

  it('indexes only events appended since the last call, keeping absolute indices', () => {
    const index = new EventSearchIndex();
    index.append(events.slice(0, 2));
    expect(index.indexedCount).toBe(2);
    const grown = [...events.slice(0, 2), { type: 'user_message', text: 'parser again' } as AgentEvent];
    index.append(grown);
    expect(index.indexedCount).toBe(3);
    expect(index.search('parser').map((h) => h.eventIndex)).toEqual([2, 0]);
  });
});

describe('SearchIndexCache', () => {
  const history = (text: string): AgentEvent[] => [{ type: 'user_message', text }];

  it('builds a snapshot once per version', () => {
    const cache = new SearchIndexCache(1000);
    const load = vi.fn(() => history('parser'));
    cache.beginPass();
    cache.snapshot('a', 'v1', load);
    cache.snapshot('a', 'v1', load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.snapshot('a', 'v2', load)?.search('parser')).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches nothing when a snapshot cannot be read', () => {
    const cache = new SearchIndexCache(1000);
    expect(cache.snapshot('a', 'v1', () => null)).toBeNull();
    const load = vi.fn(() => history('parser'));
    expect(cache.snapshot('a', 'v1', load)?.search('parser')).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('extends a live index in place and rebuilds when the array is replaced', () => {
    const cache = new SearchIndexCache(1000);
    const events = history('first parser');
    const index = cache.live('a', events);
    events.push({ type: 'user_message', text: 'second parser' });
    expect(cache.live('a', events)).toBe(index);
    expect(index.search('parser').map((h) => h.eventIndex)).toEqual([1, 0]);

    const rewound = events.slice(0, 1);
    const rebuilt = cache.live('a', rewound);
    expect(rebuilt).not.toBe(index);
    expect(rebuilt.search('parser').map((h) => h.eventIndex)).toEqual([0]);
  });

  it('keeps what fits when a pass sweeps more than the budget', () => {
    // Each history is 10 chars; the budget fits two of three. Plain LRU would
    // evict on every lookup of a repeated sweep; this rebuilds only the overflow.
    const cache = new SearchIndexCache(25);
    const loads = { a: 0, b: 0, c: 0 };
    const sweep = () => {
      cache.beginPass();
      for (const id of ['a', 'b', 'c'] as const) {
        cache.snapshot(id, 'v1', () => { loads[id]++; return history(`${id}-parser-1`); });
      }
    };
    sweep();
    sweep();
    sweep();
    expect(loads).toEqual({ a: 1, b: 1, c: 3 });
    expect(cache.size).toBeLessThanOrEqual(25);
  });

  it('evicts entries from earlier passes to make room', () => {
    const cache = new SearchIndexCache(25);
    const load = (id: string) => () => history(`${id}-parser-1`);
    cache.beginPass();
    cache.snapshot('a', 'v1', load('a'));
    cache.snapshot('b', 'v1', load('b'));
    cache.beginPass();
    cache.snapshot('c', 'v1', load('c'));
    expect(cache.size).toBe(20);
    // 'a' was the least recently used, so it went; 'b' is still cached.
    const reload = vi.fn(load('b'));
    cache.snapshot('b', 'v1', reload);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('findEventIndexByUuid', () => {
  const events: AgentEvent[] = [
    { type: 'user_message', text: 'hi' }, // 0 — no uuid
    { type: 'assistant_text', text: 'a', uuid: 'u1' }, // 1
    { type: 'assistant_tool_use', toolName: 'Edit', toolUseId: 't', uuid: 'u2', toolInput: {} }, // 2
    { type: 'assistant_text', text: 'b', uuid: '' }, // 3 — empty uuid
  ];

  it('returns the index of the event with the matching uuid', () => {
    expect(findEventIndexByUuid(events, 'u1')).toBe(1);
    expect(findEventIndexByUuid(events, 'u2')).toBe(2);
  });

  it('returns -1 when no event has the uuid', () => {
    expect(findEventIndexByUuid(events, 'nope')).toBe(-1);
  });

  it('never matches an empty/blank uuid', () => {
    expect(findEventIndexByUuid(events, '')).toBe(-1);
  });

  it('returns the first occurrence when a uuid spans multiple events', () => {
    const dup: AgentEvent[] = [
      { type: 'assistant_text', text: 'x', uuid: 'dup' },
      { type: 'assistant_tool_use', toolName: 'E', toolUseId: 't', uuid: 'dup', toolInput: {} },
    ];
    expect(findEventIndexByUuid(dup, 'dup')).toBe(0);
  });
});

describe('extractSessionPreview', () => {
  it('lists attached images with the prompt, as the thread labels it', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: 'fix it', images: [{ file: `${'a'.repeat(32)}.png`, name: 'shot.png' }] },
    ];
    expect(extractSessionPreview(events).firstPrompt).toBe('[shot.png] fix it');
    expect(searchableEventText(events[0])).toBe('[shot.png] fix it');
  });

  it('returns the first real user prompt and the latest text', () => {
    const events: AgentEvent[] = [
      { type: 'status', message: 'creating worktree' },
      { type: 'user_message', text: '/clear' }, // slash command — skipped
      { type: 'user_message', text: 'refactor   the\n\nsidebar layout' },
      { type: 'assistant_text', text: 'Working on it', uuid: '' },
      { type: 'user_message', text: 'also add tests' },
      { type: 'assistant_text', text: 'Done — added tests for the sidebar', uuid: '' },
    ];
    const preview = extractSessionPreview(events);
    expect(preview.firstPrompt).toBe('refactor the sidebar layout');
    expect(preview.lastText).toBe('Done — added tests for the sidebar');
  });

  it('falls back to the latest user message when the assistant has not replied', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: 'first prompt' },
      { type: 'assistant_tool_use', toolName: 'Edit', toolUseId: 't', uuid: '', toolInput: {} },
    ];
    const preview = extractSessionPreview(events);
    expect(preview.firstPrompt).toBe('first prompt');
    expect(preview.lastText).toBe('first prompt');
  });

  it('shows messages as plain text, without markdown syntax', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: '## Plan\n\n- fix **the** parser' },
      { type: 'assistant_text', text: '## Investigation summary\n\n| Test | Rate |\n| --- | --- |\n| e2e | 18% |', uuid: '' },
    ];
    expect(extractSessionPreview(events)).toEqual({ firstPrompt: 'Plan fix the parser', lastText: 'Investigation summary Test · Rate e2e · 18%' });
  });

  it('skips a message that is only markdown syntax', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: '---' },
      { type: 'user_message', text: 'real prompt' },
      { type: 'assistant_text', text: 'real answer', uuid: '' },
      { type: 'assistant_text', text: '|---|---|', uuid: '' },
    ];
    expect(extractSessionPreview(events)).toEqual({ firstPrompt: 'real prompt', lastText: 'real answer' });
  });

  it('uses tool_use_summary text when it is the latest', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: 'do the thing' },
      { type: 'tool_use_summary', summary: 'Edited 3 files', toolUseIds: [] },
    ];
    expect(extractSessionPreview(events).lastText).toBe('Edited 3 files');
  });

  it('returns empty strings for a history with no text events', () => {
    const events: AgentEvent[] = [
      { type: 'status', message: 'installing' },
      { type: 'user_message', text: '/compact' },
    ];
    expect(extractSessionPreview(events)).toEqual({ firstPrompt: '', lastText: '' });
  });

  it('truncates long prompts with an ellipsis', () => {
    const long = 'a'.repeat(300);
    const preview = extractSessionPreview([{ type: 'user_message', text: long }]);
    expect(preview.firstPrompt.length).toBeLessThanOrEqual(161);
    expect(preview.firstPrompt.endsWith('…')).toBe(true);
  });

  it('shows user messages as the chat does, not attached file content', () => {
    const events: AgentEvent[] = [
      { type: 'user_message', text: '<file path="a.ts">\nconst secret = 1;\n</file>\n\nexplain @a.ts' },
      { type: 'assistant_text', text: 'It declares a constant', uuid: '' },
      { type: 'user_message', text: '<file path="notes.md">\nlong notes\n</file>\n\nfollow these' },
    ];
    expect(extractSessionPreview(events)).toEqual({ firstPrompt: 'explain @a.ts', lastText: '[notes.md] follow these' });
  });
});

describe('searchableEventText for user messages', () => {
  it('indexes the displayed text, not attached file content', () => {
    const event: AgentEvent = { type: 'user_message', text: '<file path="a.ts">\nconst secret = 1;\n</file>\n\nfix it' };
    expect(searchableEventText(event)).toBe('[a.ts] fix it');
    expect(searchEvents([event], 'secret')).toEqual([]);
  });
});

describe('firstUserPrompt', () => {
  it('returns the first real prompt as sent, file blocks included', () => {
    const sent = '<file path="a.ts">\nx\n</file>\n\nexplain @a.ts';
    expect(firstUserPrompt([{ type: 'user_message', text: '/clear' }, { type: 'user_message', text: `  ${sent}  ` }])).toBe(sent);
  });

  it('returns null when there is no real prompt', () => {
    expect(firstUserPrompt([{ type: 'user_message', text: '<file path="a.ts">\nx\n</file>\n\n' }])).toBeNull();
    expect(firstUserPrompt([])).toBeNull();
  });
});
