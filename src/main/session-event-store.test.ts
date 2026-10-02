import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '../shared/types.js';

let userData: string;
vi.mock('electron', () => ({ app: { getPath: () => userData } }));
vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { SessionEventStore, eventLogPath, getEventsDir } from './session-event-store.js';

const text = (t: string): AgentEvent => ({ type: 'assistant_text', text: t } as AgentEvent);

function liveSession(id: string) {
  return {
    id,
    eventHistory: [] as AgentEvent[],
    eventLogPath: eventLogPath(id),
    logBuffer: [] as string[],
    logBufferBytes: 0,
    logFlushTimer: null as ReturnType<typeof setTimeout> | null,
  };
}

const logLines = (id: string) => fs.readFileSync(eventLogPath(id), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-events-'));
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(userData, { recursive: true, force: true });
});

describe('SessionEventStore', () => {
  it('batches appends and writes them on flush', () => {
    const store = new SessionEventStore();
    store.ensureDir();
    const s = liveSession('a');

    store.append(s, text('one'));
    store.append(s, text('two'));
    expect(s.eventHistory).toHaveLength(2);
    expect(fs.existsSync(s.eventLogPath)).toBe(false);

    store.flush(s);
    expect(logLines('a')).toEqual([text('one'), text('two')]);
    expect(s.logBuffer).toEqual([]);
    expect(s.logFlushTimer).toBeNull();
  });

  it('flushes on its own after a short delay', () => {
    vi.useFakeTimers();
    const store = new SessionEventStore();
    store.ensureDir();
    const s = liveSession('b');

    store.append(s, text('later'));
    vi.advanceTimersByTime(1_000);

    expect(logLines('b')).toEqual([text('later')]);
  });

  it('replace() drops queued appends and rewrites the log to match', () => {
    const store = new SessionEventStore();
    store.ensureDir();
    const s = liveSession('c');
    store.append(s, text('keep'));
    store.flush(s);
    store.append(s, text('cut'));

    store.replace(s, [text('keep')]);

    expect(s.eventHistory).toEqual([text('keep')]);
    expect(logLines('c')).toEqual([text('keep')]);
    expect(s.logBuffer).toEqual([]);

    store.replace(s, []);
    expect(fs.readFileSync(s.eventLogPath, 'utf8')).toBe('');
  });

  it('load() skips corrupt lines and serves a cached copy until the log changes', () => {
    const store = new SessionEventStore();
    store.ensureDir();
    fs.writeFileSync(eventLogPath('d'), `${JSON.stringify(text('ok'))}\n{"type":"assist\n`);

    const first = store.load('d');
    expect(first).toEqual([text('ok')]);
    expect(store.load('d')).toBe(first);

    fs.appendFileSync(eventLogPath('d'), `${JSON.stringify(text('more'))}\n`);
    expect(store.load('d')).toEqual([text('ok'), text('more')]);
  });

  it('load() gives an empty history for a conversation with no log', () => {
    expect(new SessionEventStore().load('missing')).toEqual([]);
  });

  it('clearStored() empties a stopped conversation\'s log', () => {
    const store = new SessionEventStore();
    store.ensureDir();
    fs.writeFileSync(eventLogPath('e'), `${JSON.stringify(text('old'))}\n`);
    expect(store.load('e')).toHaveLength(1);

    store.clearStored('e');

    expect(store.load('e')).toEqual([]);
  });

  it('searches a live history and a stopped conversation\'s log', () => {
    const store = new SessionEventStore();
    store.ensureDir();
    fs.writeFileSync(eventLogPath('f'), `${JSON.stringify(text('the stored needle'))}\n`);
    store.beginSearch();

    expect(store.search('f', undefined, 'needle', 10)).toHaveLength(1);
    expect(store.search('g', [text('a live needle')], 'needle', 10)).toHaveLength(1);
    expect(store.search('nothing', undefined, 'needle', 10)).toEqual([]);
  });

  it('keeps the events folder under userData', () => {
    expect(getEventsDir()).toBe(path.join(userData, 'worktrees', 'events'));
  });
});

describe('SessionEventStore.beginSearch()', () => {
  it("doesn't let a single-conversation search start a new pass during a sweep", () => {
    const store = new SessionEventStore();
    const beginPass = vi.spyOn((store as unknown as { searchIndexes: { beginPass(): void } }).searchIndexes, 'beginPass');
    const endSweep = store.beginSearch({ sweep: true });
    expect(beginPass).toHaveBeenCalledTimes(1);

    store.beginSearch(); // Ctrl+F while the sweep is paused
    expect(beginPass).toHaveBeenCalledTimes(1);

    endSweep();
    endSweep(); // ending twice is harmless
    store.beginSearch();
    expect(beginPass).toHaveBeenCalledTimes(2);
  });
});
