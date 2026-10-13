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
const perf = vi.hoisted(() => ({ perfLine: vi.fn() }));
vi.mock('./perf-log.js', () => perf);

import { SessionEventStore, SLOW_EVENT_LOG_WRITE_MS, eventLogPath, getEventsDir } from './session-event-store.js';

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
  vi.restoreAllMocks();
  perf.perfLine.mockClear();
  fs.rmSync(userData, { recursive: true, force: true });
});

describe('SessionEventStore', () => {
  it('batches appends and writes them on flush', async () => {
    const store = new SessionEventStore();
    store.ensureDir();
    const s = liveSession('a');

    store.append(s, text('one'));
    store.append(s, text('two'));
    expect(s.eventHistory).toHaveLength(2);
    expect(fs.existsSync(s.eventLogPath)).toBe(false);

    await store.flush(s);
    expect(logLines('a')).toEqual([text('one'), text('two')]);
    expect(s.logBuffer).toEqual([]);
    expect(s.logFlushTimer).toBeNull();
  });

  it('writes off the main process: flush() returns before the lines are on disk', async () => {
    const store = new SessionEventStore();
    store.ensureDir();
    const s = liveSession('async');
    store.append(s, text('one'));

    const written = store.flush(s);
    expect(fs.existsSync(s.eventLogPath)).toBe(false);

    await written;
    expect(logLines('async')).toEqual([text('one')]);
  });

  it('flushes on its own after a short delay', async () => {
    vi.useFakeTimers();
    const store = new SessionEventStore();
    store.ensureDir();
    const s = liveSession('b');

    store.append(s, text('later'));
    vi.advanceTimersByTime(1_000);
    vi.useRealTimers();
    // Nothing is queued any more: this waits for the write the timer started.
    await store.flush(s);

    expect(logLines('b')).toEqual([text('later')]);
  });

  it('replace() drops queued appends and rewrites the log to match', async () => {
    const store = new SessionEventStore();
    store.ensureDir();
    const s = liveSession('c');
    store.append(s, text('keep'));
    await store.flush(s);
    store.append(s, text('cut'));

    await store.replace(s, [text('keep')]);

    expect(s.eventHistory).toEqual([text('keep')]);
    expect(logLines('c')).toEqual([text('keep')]);
    expect(s.logBuffer).toEqual([]);

    await store.replace(s, []);
    expect(fs.readFileSync(s.eventLogPath, 'utf8')).toBe('');
  });

  it('writes to one log in the order they were asked for', async () => {
    const store = new SessionEventStore();
    store.ensureDir();
    const s = liveSession('order');

    store.append(s, text('cut'));
    void store.flush(s);
    void store.replace(s, [text('kept')]);
    store.append(s, text('after'));
    await store.flush(s);

    expect(logLines('order')).toEqual([text('kept'), text('after')]);
  });

  it('flush() with nothing queued still waits for the write under way', async () => {
    const store = new SessionEventStore();
    store.ensureDir();
    const s = liveSession('wait');
    let release!: () => void;
    const real = fs.promises.appendFile;
    vi.spyOn(fs.promises, 'appendFile').mockImplementationOnce(async (...args: Parameters<typeof real>) => {
      await new Promise<void>((r) => { release = r; });
      return real(...args);
    });

    store.append(s, text('slow'));
    void store.flush(s);
    let settled = false;
    const waiting = store.flush(s).then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);

    release();
    await waiting;
    expect(logLines('wait')).toEqual([text('slow')]);
  });

  it('a failed write is skipped and the next one still runs', async () => {
    const store = new SessionEventStore();
    const s = liveSession('fail');

    // No events folder yet: the append fails, quietly.
    store.append(s, text('lost'));
    await expect(store.flush(s)).resolves.toBeUndefined();

    store.ensureDir();
    store.append(s, text('kept'));
    await store.flush(s);
    expect(logLines('fail')).toEqual([text('kept')]);
  });

  it('notes a slow write in the performance log', async () => {
    const store = new SessionEventStore();
    store.ensureDir();
    const s = liveSession('slow');
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const real = fs.promises.appendFile;
    vi.spyOn(fs.promises, 'appendFile').mockImplementation(async (...args: Parameters<typeof real>) => {
      t += SLOW_EVENT_LOG_WRITE_MS + 500;
      return real(...args);
    });

    store.append(s, text('x'));
    await store.flush(s);

    expect(perf.perfLine).toHaveBeenCalledWith('events', expect.stringMatching(/^event log write, 0 KB took 1500 ms/));
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
