/**
 * Conversation event history: the in-memory list a live session keeps, its
 * append-only JSONL log on disk, the parsed-log cache for stopped
 * conversations, and the search indexes built over both.
 */
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentEvent } from '../shared/types.js';
import { freezeLog } from './freeze-log.js';
import { logger } from './logger.js';
import { perfLine } from './perf-log.js';
import { SearchIndexCache, type EventSearchIndex, type EventSearchHit } from './event-search.js';
import type { ManagedSession } from './session-types.js';

// Shared with the renderer, which reconciles live events with replayed ones.
export { TRANSIENT_EVENT_TYPES } from '../shared/live-events.js';

/** Event-log batching: flush after this delay or once this many bytes queue. */
const EVENT_LOG_FLUSH_MS = 250;
const EVENT_LOG_FLUSH_BYTES = 64 * 1024;

/** A log write this slow is noted in the performance log. Writes used to
 *  run on the main process, where some of a few KB took up to 28 s on a PC
 *  running an antivirus, with the window frozen all that time. */
export const SLOW_EVENT_LOG_WRITE_MS = 1_000;

/**
 * Bytes of event log (size on disk) whose parsed histories are kept for
 * threads that are not running, least recently used dropped first. A thread
 * is read several times in a row: its sidebar preview, its pane's first page,
 * its items and usage, then its resume. Each read that misses parses the
 * whole log on the main process, about 10 ms per MB with the window frozen.
 *
 * Parsed events take about 1 to 1.3 times their log's size in the heap (up to
 * twice that for text outside Latin-1). 48 MB holds every open thread's log
 * for someone with 18 to 27 open (15 to 30 MB in all, one of them 18 MB, in
 * one user's performance logs), so those reads parse each log once, and it
 * caps what the cache can pin: the count cap it replaces (12) thrashed with
 * more threads open than that, yet let a dozen big logs pin hundreds of MB.
 * The last log read that is bigger than the whole budget is kept outside it,
 * on its own (see cacheHistory). Search doesn't rely on this cache: see
 * SEARCH_INDEX_BUDGET.
 */
const HISTORY_CACHE_BUDGET = 48 * 1024 * 1024;

/** Chars of searchable event text kept across all conversations (about one
 *  byte each for ASCII text), so the session finder's search doesn't re-parse
 *  every log and re-extract every event per keystroke. */
const SEARCH_INDEX_BUDGET = 128 * 1024 * 1024;

export const getEventsDir = () => path.join(app.getPath('userData'), 'worktrees', 'events');

export const eventLogPath = (id: string) => path.join(getEventsDir(), `${id}.jsonl`);

/** A thread id that is a plain name (thread ids are short ids), so a file or
 *  folder named after it can't reach outside its folder. */
export const isThreadId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]+$/.test(id);

/** A size for the freeze log, which names event-log reads and writes. */
const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

/** The parts of a live session the store reads and writes. */
type LoggedSession = Pick<ManagedSession, 'id' | 'eventHistory' | 'eventLogPath' | 'logBuffer' | 'logBufferBytes' | 'logFlushTimer'>;

/** A stopped thread's parsed log, valid while the file's mtime and size match. */
interface CachedHistory {
  mtimeMs: number;
  size: number;
  events: AgentEvent[];
}

export class SessionEventStore {
  /** Least recently used first (a Map keeps insertion order). */
  private historyCache = new Map<string, CachedHistory>();
  /** Log bytes the cached histories were parsed from (see HISTORY_CACHE_BUDGET). */
  private historyBytes = 0;
  /** The last log read that is bigger than the whole budget (see cacheHistory). */
  private bigHistory: { id: string; entry: CachedHistory } | null = null;
  /** The last write queued for each log file. Writes to a file run one after
   *  another, so a rewrite never lands under an earlier append. */
  private writes = new Map<string, Promise<void>>();
  private searchIndexes = new SearchIndexCache(SEARCH_INDEX_BUDGET);
  /** Cross-conversation search sweeps in progress (see beginSearch). */
  private searchSweeps = 0;

  /** `historyBudget`: bytes of log kept parsed (HISTORY_CACHE_BUDGET; tests pass less). */
  constructor(private readonly historyBudget = HISTORY_CACHE_BUDGET) {}

  /** Create the folder the logs live in, if it is missing. */
  ensureDir(): void {
    try { fs.mkdirSync(getEventsDir(), { recursive: true }); } catch { /* already exists */ }
  }

  /** Add an event to a live session's history and queue it for its log. */
  append(session: LoggedSession, event: AgentEvent): void {
    session.eventHistory.push(event);
    this.queue(session, event);
  }

  /** Queue an event line for the on-disk JSONL log. Lines are appended in
   *  batches (every EVENT_LOG_FLUSH_MS or EVENT_LOG_FLUSH_BYTES) instead of
   *  one open/write/close per event. flush() must be called, and waited for,
   *  before the session is dropped. */
  private queue(session: LoggedSession, event: AgentEvent): void {
    const line = JSON.stringify(event) + '\n';
    session.logBuffer.push(line);
    session.logBufferBytes += line.length;
    if (session.logBufferBytes >= EVENT_LOG_FLUSH_BYTES) {
      void this.flush(session);
    } else if (!session.logFlushTimer) {
      const timer = setTimeout(() => void this.flush(session), EVENT_LOG_FLUSH_MS);
      (timer as { unref?: () => void }).unref?.();
      session.logFlushTimer = timer;
    }
  }

  /** Write any queued log lines, after the writes already under way. Settles
   *  (never rejects) once everything queued for the log so far is written. */
  flush(session: LoggedSession): Promise<void> {
    this.stopFlushTimer(session);
    if (session.logBuffer.length === 0) return this.writes.get(session.eventLogPath) ?? Promise.resolve();
    const data = session.logBuffer.join('');
    session.logBuffer = [];
    session.logBufferBytes = 0;
    return this.write(session.eventLogPath, `event log write, ${kb(Buffer.byteLength(data))}`, () =>
      fs.promises.appendFile(session.eventLogPath, data));
  }

  /** Replace a live session's history (rewind, /clear) and rewrite its log
   *  to match. Queued appends are dropped: they are part of what is cut. */
  replace(session: LoggedSession, events: AgentEvent[]): Promise<void> {
    session.eventHistory = events;
    this.searchIndexes.delete(session.id);
    this.stopFlushTimer(session);
    session.logBuffer = [];
    session.logBufferBytes = 0;
    const data = events.length > 0 ? events.map((e) => JSON.stringify(e)).join('\n') + '\n' : '';
    return this.write(session.eventLogPath, `event log rewrite, ${events.length} events`, () =>
      fs.promises.writeFile(session.eventLogPath, data));
  }

  private stopFlushTimer(session: LoggedSession): void {
    if (session.logFlushTimer) {
      clearTimeout(session.logFlushTimer);
      session.logFlushTimer = null;
    }
  }

  /**
   * Run `write` on `file` once the writes queued before it are done. Writes
   * are off the main process, so a slow disk or an antivirus scan delays the
   * log, not the window; one that took SLOW_EVENT_LOG_WRITE_MS or more is
   * noted. A failed write is skipped, as before.
   */
  private write(file: string, label: string, write: () => Promise<void>): Promise<void> {
    const run = async () => {
      const start = performance.now();
      try {
        await write();
      } catch { /* non-fatal */ }
      const ms = performance.now() - start;
      if (ms >= SLOW_EVENT_LOG_WRITE_MS) perfLine('events', `${label} took ${Math.round(ms)} ms (the window kept responding)`);
    };
    const next = (this.writes.get(file) ?? Promise.resolve()).then(run);
    this.writes.set(file, next);
    void next.then(() => {
      if (this.writes.get(file) === next) this.writes.delete(file);
    });
    return next;
  }

  /** Empty a stopped conversation's log on disk. */
  clearStored(id: string): void {
    try { fs.writeFileSync(eventLogPath(id), ''); } catch { /* non-fatal */ }
    this.forget(id);
  }

  /** Drop what is cached for a conversation: its parsed log and search index. */
  forget(id: string): void {
    this.dropHistory(id);
    this.searchIndexes.delete(id);
  }

  /**
   * The history a thread starts running with: its log as load() reads it,
   * copied for the session to add to. What is cached for the thread is
   * dropped: from now on the session keeps its history in memory (which
   * getEventHistory and search read while it runs) and appends to the log,
   * so the parse and the log's search index could never be read again, and
   * would hold memory and cache budget until the thread closed.
   */
  startLive(id: string): AgentEvent[] {
    // A log that wasn't cached isn't cached now, so it can't push out others.
    const events = [...this.read(id, false)];
    this.forget(id);
    return events;
  }

  /** Load event history from the disk JSONL log for a session.
   *  Parses each line individually so a single corrupt line (e.g. from a
   *  crash mid-write) doesn't discard the entire history. The result is
   *  cached: callers must copy it before changing it.
   *
   *  Reads are synchronous, so the requests a thread gets together (a pane's
   *  page, items and usage) run one after another and the later ones find the
   *  first one's parse here: no parse is ever in flight to share. */
  load(id: string): AgentEvent[] {
    return this.read(id, true);
  }

  /** A log's events, from the cache when it still matches the file; a log
   *  parsed now is cached when `keep` is set. */
  private read(id: string, keep: boolean): AgentEvent[] {
    const logPath = eventLogPath(id);
    let stat: { mtimeMs: number; size: number };
    try {
      stat = fs.statSync(logPath);
    } catch {
      this.dropHistory(id);
      return [];
    }
    const cached = this.cachedHistory(id);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      // Now the most recently used (a big log has its own slot).
      if (this.historyCache.delete(id)) this.historyCache.set(id, cached);
      return cached.events;
    }
    const events = this.readLog(id, logPath, stat.size);
    if (!events || !keep) {
      this.dropHistory(id);
      return events ?? [];
    }
    this.cacheHistory(id, { mtimeMs: stat.mtimeMs, size: stat.size, events });
    return events;
  }

  /** What is kept for a thread, in the cache or the big log's slot. */
  private cachedHistory(id: string): CachedHistory | undefined {
    return this.historyCache.get(id) ?? (this.bigHistory?.id === id ? this.bigHistory.entry : undefined);
  }

  /**
   * Keep a parsed log as the most recently used, dropping the least recently
   * used ones until the cache is within its budget.
   *
   * A log bigger than the whole budget takes a slot of its own instead,
   * replacing the one there. Not kept, each read of its thread (preview,
   * history count, every page scrolled, usage, resume) would parse all of it
   * again, about 0.6 s for 60 MB. Kept in the cache, letting the newest
   * entry run over the budget alone, it would push out every other thread,
   * which would then all parse again once the user moves on. With the slot,
   * the others stay, and memory is at most the budget plus one big log.
   */
  private cacheHistory(id: string, entry: CachedHistory): void {
    this.dropHistory(id);
    if (entry.size > this.historyBudget) {
      this.bigHistory = { id, entry };
      return;
    }
    this.historyCache.set(id, entry);
    this.historyBytes += entry.size;
    // The new entry is last and fits, so this stops before reaching it.
    for (const oldest of this.historyCache.keys()) {
      if (this.historyBytes <= this.historyBudget) break;
      this.dropHistory(oldest);
    }
  }

  private dropHistory(id: string): void {
    if (this.bigHistory?.id === id) this.bigHistory = null;
    const cached = this.historyCache.get(id);
    if (!cached) return;
    this.historyCache.delete(id);
    this.historyBytes -= cached.size;
  }

  /** Parse a JSONL event log, or null if it can't be read (so callers don't
   *  cache an empty history over a transient failure). */
  private readLog(id: string, logPath: string, size: number): AgentEvent[] | null {
    return freezeLog.timeWork(`event log read, ${kb(size)}`, () => this.parseLog(id, logPath));
  }

  private parseLog(id: string, logPath: string): AgentEvent[] | null {
    try {
      const data = fs.readFileSync(logPath, 'utf-8');
      const events: AgentEvent[] = [];
      for (const line of data.split('\n')) {
        if (!line) continue;
        try {
          events.push(JSON.parse(line));
        } catch {
          logger.warn(`[loadEventHistory] skipping corrupt line in ${id}.jsonl`);
        }
      }
      return events;
    } catch {
      return null;
    }
  }

  /** Search index for a conversation's history, cached across searches. A
   *  live session's in-memory history (`live`) is indexed incrementally; a
   *  stopped one's log is keyed by mtime/size and parsed without displacing
   *  the history cache. */
  private searchIndex(id: string, live: AgentEvent[] | undefined): EventSearchIndex | null {
    if (live) return this.searchIndexes.live(id, live);
    const logPath = eventLogPath(id);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(logPath);
    } catch {
      this.searchIndexes.delete(id);
      return null;
    }
    return this.searchIndexes.snapshot(id, `${stat.mtimeMs}:${stat.size}`, () => {
      const cached = this.cachedHistory(id);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.events;
      return this.readLog(id, logPath, stat.size);
    });
  }

  /** Search a conversation's history, newest match first (see searchEvents).
   *  `live` is the session's history when it is running. */
  search(id: string, live: AgentEvent[] | undefined, query: string, limit: number): EventSearchHit[] {
    return this.searchIndex(id, live)?.search(query, limit) ?? [];
  }

  /**
   * Start a search request. Indexes it touches stay cached for the whole
   * request, so a sweep over every conversation can't evict its own work.
   * A single-conversation search that runs while a sweep is paused between
   * slices joins the sweep's pass: a new pass would make the indexes the
   * sweep already built evictable. Returns a function that ends the request.
   */
  beginSearch(opts: { sweep?: boolean } = {}): () => void {
    if (opts.sweep || this.searchSweeps === 0) this.searchIndexes.beginPass();
    if (!opts.sweep) return () => {};
    this.searchSweeps++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.searchSweeps--;
    };
  }
}
