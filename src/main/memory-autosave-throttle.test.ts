import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentEvent } from '../shared/types.js';

/**
 * Per-turn auto-save throttling and tolerant JSON parsing.
 *
 * Every extraction boots a full agent subprocess, so the per-turn trigger
 * must not fire on every turn, and a response with trailing prose must not
 * throw away the whole run.
 */

const adapter = vi.hoisted(() => ({
  id: 'mock',
  generateText: vi.fn<(...args: unknown[]) => Promise<string>>(),
}));

const mockMemory = vi.hoisted(() => ({
  listMemoryFiles: vi.fn(() => []),
  readMemoryFile: vi.fn<(...args: unknown[]) => string | null>(() => null),
  writeMemoryFile: vi.fn(),
}));

vi.mock('./settings.js', () => ({
  getSettings: () => ({ memoryAutoSave: true, memoryAutoCompact: false, memoryModel: '' }),
}));
vi.mock('./memory.js', () => mockMemory);
vi.mock('./memory-compact.js', () => ({ maybeCompact: vi.fn() }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./adapters/index.js', () => ({
  adapterRegistry: { get: () => adapter, getDefault: () => adapter },
}));

import {
  extractJsonObject,
  planTurnAutoSave,
  triggerAutoSaveImmediate,
  _resetForTests,
  MIN_SAVE_INTERVAL_MS,
  MIN_NEW_EVENTS,
} from './memory-autosave.js';

const EMPTY_RESULT = '{"files":[],"sessionNote":{"shouldSave":false,"content":""}}';

function makeEvents(userTurns: number, extra = 0): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (let i = 0; i < userTurns; i++) {
    events.push({ type: 'user_message', text: `msg ${i}` } as unknown as AgentEvent);
    events.push({ type: 'assistant_text', text: `reply ${i}` } as unknown as AgentEvent);
  }
  for (let i = 0; i < extra; i++) {
    events.push({ type: 'assistant_text', text: `more ${i}` } as unknown as AgentEvent);
  }
  return events;
}

function opts(events: AgentEvent[], sessionId = 's1') {
  const statuses: string[] = [];
  return {
    o: { sessionId, repoPath: '/repo', cwd: '/repo/wt', events, branchName: 'feat', onStatus: (s: string) => statuses.push(s) },
    statuses,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTests();
  adapter.generateText.mockResolvedValue(EMPTY_RESULT);
  mockMemory.readMemoryFile.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('extractJsonObject', () => {
  it('returns the object when the text is exactly JSON', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('strips markdown fences and trailing commentary', () => {
    const text = '```json\n{"files":[],"sessionNote":{"shouldSave":false,"content":""}}\n```\n\nI found nothing worth saving.';
    expect(extractJsonObject(text)).toBe(EMPTY_RESULT);
  });

  it('ignores braces inside strings', () => {
    const text = '{"content":"see {this} and \\"that}\\""} trailing';
    expect(extractJsonObject(text)).toBe('{"content":"see {this} and \\"that}\\""}');
  });

  it('returns null when there is no balanced object', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{"unterminated": 1')).toBeNull();
  });
});

describe('planTurnAutoSave', () => {
  it('runs the first save for a session', () => {
    expect(planTurnAutoSave('new', 10)).toEqual({ action: 'run' });
  });

  it('starts over when the history shrank (e.g. after /clear)', async () => {
    await triggerAutoSaveImmediate(opts(makeEvents(10)).o); // baseline: 20 events
    expect(planTurnAutoSave('s1', 6)).toEqual({ action: 'run' });
  });
});

describe('triggerAutoSaveImmediate throttling', () => {
  it('runs extraction on the first completed turn', async () => {
    const { o, statuses } = opts(makeEvents(3));
    await triggerAutoSaveImmediate(o);

    expect(adapter.generateText).toHaveBeenCalledTimes(1);
    expect(statuses[0]).toBe('started');
  });

  it('skips a following turn that added too little activity', async () => {
    const events = makeEvents(3);
    await triggerAutoSaveImmediate(opts(events).o);

    events.push(...makeEvents(1)); // 2 new events < MIN_NEW_EVENTS
    const { o, statuses } = opts(events);
    await triggerAutoSaveImmediate(o);

    expect(adapter.generateText).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['skipped']);
  });

  it('defers a busy follow-up turn until the interval has elapsed', async () => {
    vi.useFakeTimers();
    const events = makeEvents(3);
    await triggerAutoSaveImmediate(opts(events).o);
    expect(adapter.generateText).toHaveBeenCalledTimes(1);

    events.push(...makeEvents(0, MIN_NEW_EVENTS));
    await triggerAutoSaveImmediate(opts(events).o);
    // Not yet: the interval hasn't passed
    expect(adapter.generateText).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MIN_SAVE_INTERVAL_MS);
    expect(adapter.generateText).toHaveBeenCalledTimes(2);
  });

  it('runs immediately once the interval has passed', async () => {
    vi.useFakeTimers();
    const events = makeEvents(3);
    await triggerAutoSaveImmediate(opts(events).o);

    vi.setSystemTime(Date.now() + MIN_SAVE_INTERVAL_MS + 1);
    events.push(...makeEvents(0, MIN_NEW_EVENTS));
    await triggerAutoSaveImmediate(opts(events).o);

    expect(adapter.generateText).toHaveBeenCalledTimes(2);
  });

  it('throttles per session, not globally', async () => {
    await triggerAutoSaveImmediate(opts(makeEvents(3), 'a').o);
    await triggerAutoSaveImmediate(opts(makeEvents(3), 'b').o);
    expect(adapter.generateText).toHaveBeenCalledTimes(2);
  });
});

describe('extraction response handling', () => {
  it('accepts JSON followed by prose without writing a fallback note', async () => {
    adapter.generateText.mockResolvedValue(`${EMPTY_RESULT}\n\nThat's everything.`);
    const { o, statuses } = opts(makeEvents(3));
    await triggerAutoSaveImmediate(o);

    expect(mockMemory.writeMemoryFile).not.toHaveBeenCalled();
    expect(statuses).toEqual(['started', 'skipped']);
  });

  it('writes the model\'s files when the JSON is fenced', async () => {
    adapter.generateText.mockResolvedValue(
      '```json\n{"files":[{"action":"create","path":"repo/overview.md","content":"# Overview","reason":"new"}],"sessionNote":{"shouldSave":false,"content":""}}\n```',
    );
    const { o, statuses } = opts(makeEvents(3));
    await triggerAutoSaveImmediate(o);

    expect(mockMemory.writeMemoryFile).toHaveBeenCalledWith('/repo', 'repo/overview.md', '# Overview');
    expect(statuses).toEqual(['started', 'completed']);
  });

  it('falls back to a heuristic session note when the response is not JSON', async () => {
    adapter.generateText.mockResolvedValue('Sorry, I cannot help with that.');
    await triggerAutoSaveImmediate(opts(makeEvents(3)).o);

    expect(mockMemory.writeMemoryFile).toHaveBeenCalledTimes(1);
    const [, relPath, content] = mockMemory.writeMemoryFile.mock.calls[0];
    expect(relPath).toBe('sessions/feat.md');
    expect(content).toContain('First message');
  });

  it('does not overwrite an existing session note with the fallback', async () => {
    adapter.generateText.mockResolvedValue('garbage');
    mockMemory.readMemoryFile.mockReturnValue('---\ntitle: rich note\n---\n');
    await triggerAutoSaveImmediate(opts(makeEvents(3)).o);

    expect(mockMemory.writeMemoryFile).not.toHaveBeenCalled();
  });
});
