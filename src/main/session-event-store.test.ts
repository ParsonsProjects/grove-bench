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
import { freezeLog } from './freeze-log.js';

const text = (t: string): AgentEvent => ({ type: 'assistant_text', text: t } as AgentEvent);

/** Write a one-event log of exactly `bytes` bytes. */
function writeLog(id: string, bytes: number): number {
  const empty = JSON.stringify(text('')).length + 1;
  fs.writeFileSync(eventLogPath(id), `${JSON.stringify(text('x'.repeat(bytes - empty)))}\n`);
  expect(fs.statSync(eventLogPath(id)).size).toBe(bytes);
  return bytes;
}

/** Counts the event logs parsed from now on. */
function countParses(): () => number {
  const timeWork = vi.spyOn(freezeLog, 'timeWork');
  return () => timeWork.mock.calls.filter(([name]) => name.startsWith('event log read')).length;
}

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

describe('SessionEventStore history cache', () => {
  beforeEach(() => new SessionEventStore().ensureDir());

  it('parses each log once across the startup reads, with more threads open than the old cap of 12', () => {
    const ids = Array.from({ length: 27 }, (_, i) => `t${i}`);
    const total = ids.reduce((sum, id) => sum + writeLog(id, 300), 0);
    const store = new SessionEventStore(total);
    const parses = countParses();

    for (const id of ids) store.load(id); // the sidebar's previews
    for (const id of ids) store.load(id); // each pane's first page
    for (const id of ids) store.startLive(id); // each thread's resume

    expect(parses()).toBe(27);
  });

  it('drops the least recently used logs, by size, to stay within its budget', () => {
    const small = writeLog('a', 300);
    writeLog('b', 300);
    writeLog('c', 300);
    writeLog('big', 500);
    const store = new SessionEventStore(3 * small);
    const parses = countParses();

    store.load('a');
    store.load('b');
    store.load('c');
    store.load('a'); // now the most recently used: b is the oldest
    expect(parses()).toBe(3);

    // 500 more bytes: b, then c, go; a and big (800) fit.
    store.load('big');
    store.load('a');
    store.load('big');
    expect(parses()).toBe(4);

    store.load('b'); // a, the oldest, goes
    store.load('big'); // a hit, so b is the oldest now
    expect(parses()).toBe(5);
    store.load('c'); // b goes
    store.load('big');
    expect(parses()).toBe(6);
  });

  it('parses a log bigger than the whole budget each time, without pushing out the others', () => {
    const small = writeLog('a', 300);
    writeLog('huge', 5_000);
    const store = new SessionEventStore(2 * small);
    const parses = countParses();

    store.load('a');
    expect(store.load('huge')).toHaveLength(1);
    expect(store.load('huge')).toHaveLength(1);
    expect(parses()).toBe(3);

    store.load('a');
    expect(parses()).toBe(3);
  });

  it('frees the budget a log held once it grows past it', () => {
    const small = writeLog('a', 300);
    writeLog('b', 300);
    writeLog('c', 300);
    const store = new SessionEventStore(2 * small);
    const parses = countParses();

    store.load('a');
    fs.appendFileSync(eventLogPath('a'), `${JSON.stringify(text('y'.repeat(1_000)))}\n`);
    expect(store.load('a')).toHaveLength(2);

    store.load('b');
    store.load('c');
    store.load('b');
    store.load('c');
    expect(parses()).toBe(4);
  });

  it('startLive() hands the session a copy and keeps nothing for the thread', () => {
    const small = writeLog('a', 300);
    writeLog('b', 300);
    writeLog('c', 300);
    const store = new SessionEventStore(2 * small);
    const searchIndexes = (store as unknown as { searchIndexes: { size: number } }).searchIndexes;
    const parses = countParses();

    const page = store.load('a'); // the pane's first page
    store.load('b');
    store.beginSearch();
    store.search('a', undefined, 'xxx', 10);
    expect(searchIndexes.size).toBeGreaterThan(0);

    const history = store.startLive('a'); // the resume reuses that parse
    expect(parses()).toBe(2);
    expect(history).toEqual(page);
    expect(history).not.toBe(page);
    expect(searchIndexes.size).toBe(0);

    // a's bytes are free: c fits beside b without pushing it out.
    store.load('c');
    store.load('b');
    expect(parses()).toBe(3);
  });

  it("startLive() on a log that wasn't cached doesn't push out the others", () => {
    const small = writeLog('a', 300);
    writeLog('b', 300);
    writeLog('c', 300);
    const store = new SessionEventStore(2 * small);
    const parses = countParses();

    store.load('a');
    store.load('b');
    expect(store.startLive('c')).toHaveLength(1);
    store.load('a');
    store.load('b');

    expect(parses()).toBe(3);
  });

  it('requests for one thread that arrive together share one parse', async () => {
    writeLog('a', 300);
    const store = new SessionEventStore();
    const parses = countParses();

    // A pane's first page, its thread items and its usage, as IPC calls ask.
    const [page, items, usage] = await Promise.all([0, 1, 2].map(async () => store.load('a')));

    expect(parses()).toBe(1);
    expect(items).toBe(page);
    expect(usage).toBe(page);
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
