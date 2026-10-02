/**
 * Conversation event history: the in-memory list a live session keeps, its
 * append-only JSONL log on disk, the parsed-log cache for stopped
 * conversations, and the search indexes built over both.
 */
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentEvent } from '../shared/types.js';
import { logger } from './logger.js';
import { SearchIndexCache, type EventSearchIndex, type EventSearchHit } from './event-search.js';
import type { ManagedSession } from './session-types.js';

// Shared with the renderer, which reconciles live events with replayed ones.
export { TRANSIENT_EVENT_TYPES } from '../shared/live-events.js';

/** Event-log batching: flush after this delay or once this many bytes queue. */
const EVENT_LOG_FLUSH_MS = 250;
const EVENT_LOG_FLUSH_BYTES = 64 * 1024;

/** Parsed on-disk histories for sessions that are not running, keyed by id.
 *  Bounded so old sessions don't pin memory forever. Search doesn't rely on
 *  it: see SEARCH_INDEX_BUDGET. */
const HISTORY_CACHE_MAX = 12;

/** Chars of searchable event text kept across all conversations (about one
 *  byte each for ASCII text), so the session finder's search doesn't re-parse
 *  every log and re-extract every event per keystroke. */
const SEARCH_INDEX_BUDGET = 128 * 1024 * 1024;

export const getEventsDir = () => path.join(app.getPath('userData'), 'worktrees', 'events');

export const eventLogPath = (id: string) => path.join(getEventsDir(), `${id}.jsonl`);

/** The parts of a live session the store reads and writes. */
type LoggedSession = Pick<ManagedSession, 'id' | 'eventHistory' | 'eventLogPath' | 'logBuffer' | 'logBufferBytes' | 'logFlushTimer'>;

export class SessionEventStore {
  private historyCache = new Map<string, { mtimeMs: number; size: number; events: AgentEvent[] }>();
  private searchIndexes = new SearchIndexCache(SEARCH_INDEX_BUDGET);
  /** Cross-conversation search sweeps in progress (see beginSearch). */
  private searchSweeps = 0;

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
   *  one synchronous open/write/close per event. flush() must be called
   *  before the log file is rewritten or the session is dropped. */
  private queue(session: LoggedSession, event: AgentEvent): void {
    const line = JSON.stringify(event) + '\n';
    session.logBuffer.push(line);
    session.logBufferBytes += line.length;
    if (session.logBufferBytes >= EVENT_LOG_FLUSH_BYTES) {
      this.flush(session);
    } else if (!session.logFlushTimer) {
      const timer = setTimeout(() => this.flush(session), EVENT_LOG_FLUSH_MS);
      (timer as { unref?: () => void }).unref?.();
      session.logFlushTimer = timer;
    }
  }

  /** Synchronously write any queued log lines. */
  flush(session: LoggedSession): void {
    if (session.logFlushTimer) {
      clearTimeout(session.logFlushTimer);
      session.logFlushTimer = null;
    }
    if (session.logBuffer.length === 0) return;
    const data = session.logBuffer.join('');
    session.logBuffer = [];
    session.logBufferBytes = 0;
    try {
      fs.appendFileSync(session.eventLogPath, data);
    } catch { /* non-fatal */ }
  }

  /** Replace a live session's history (rewind, /clear) and rewrite its log
   *  to match. Queued appends are dropped: they are part of what is cut. */
  replace(session: LoggedSession, events: AgentEvent[]): void {
    session.eventHistory = events;
    this.searchIndexes.delete(session.id);
    session.logBuffer = [];
    session.logBufferBytes = 0;
    this.flush(session);
    try {
      fs.writeFileSync(session.eventLogPath, events.length > 0 ? events.map((e) => JSON.stringify(e)).join('\n') + '\n' : '');
    } catch { /* non-fatal */ }
  }

  /** Empty a stopped conversation's log on disk. */
  clearStored(id: string): void {
    try { fs.writeFileSync(eventLogPath(id), ''); } catch { /* non-fatal */ }
    this.forget(id);
  }

  /** Drop what is cached for a conversation: its parsed log and search index. */
  forget(id: string): void {
    this.historyCache.delete(id);
    this.searchIndexes.delete(id);
  }

  /** Load event history from the disk JSONL log for a session.
   *  Parses each line individually so a single corrupt line (e.g. from a
   *  crash mid-write) doesn't discard the entire history. The result is
   *  cached: callers must copy it before changing it. */
  load(id: string): AgentEvent[] {
    const logPath = eventLogPath(id);
    let stat: { mtimeMs: number; size: number };
    try {
      stat = fs.statSync(logPath);
    } catch {
      this.historyCache.delete(id);
      return [];
    }
    const cached = this.historyCache.get(id);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      // Refresh recency (Map preserves insertion order; oldest is evicted first).
      this.historyCache.delete(id);
      this.historyCache.set(id, cached);
      return cached.events;
    }
    const events = this.readLog(id, logPath);
    if (!events) return [];
    this.historyCache.delete(id);
    this.historyCache.set(id, { mtimeMs: stat.mtimeMs, size: stat.size, events });
    while (this.historyCache.size > HISTORY_CACHE_MAX) {
      const oldest = this.historyCache.keys().next().value;
      if (oldest === undefined) break;
      this.historyCache.delete(oldest);
    }
    return events;
  }

  /** Parse a JSONL event log, or null if it can't be read (so callers don't
   *  cache an empty history over a transient failure). */
  private readLog(id: string, logPath: string): AgentEvent[] | null {
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
      const cached = this.historyCache.get(id);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.events;
      return this.readLog(id, logPath);
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
