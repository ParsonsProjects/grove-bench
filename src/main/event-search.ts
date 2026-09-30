import type { AgentEvent, EventSearchHit, SessionPreview } from '../shared/types.js';
import { displayTextFromSent, stripFileContext } from '../shared/prompt-text.js';

export type { EventSearchHit };

/** Collect string/number leaves from a tool-input object (bounded, for search indexing). */
function flattenInput(input: unknown, depth = 0): string {
  if (depth > 4 || input == null) return '';
  if (typeof input === 'string' || typeof input === 'number') return String(input);
  if (Array.isArray(input)) return input.map((v) => flattenInput(v, depth + 1)).join(' ');
  if (typeof input === 'object') {
    return Object.values(input as Record<string, unknown>)
      .map((v) => flattenInput(v, depth + 1))
      .join(' ');
  }
  return '';
}

/** Display label for a matched event, mirroring how the renderer categorises messages. */
export function eventKind(event: AgentEvent): string {
  switch (event.type) {
    case 'user_message':
      return 'user';
    case 'assistant_text':
    case 'tool_use_summary':
      return 'assistant';
    case 'thinking':
      return 'thinking';
    case 'assistant_tool_use':
    case 'tool_result':
      return 'tool';
    case 'permission_request':
      return 'permission';
    case 'result':
      return 'result';
    default:
      return 'system';
  }
}

/**
 * Extract searchable text from a raw AgentEvent — the event-level analogue of the
 * renderer's message-level searchableText. Transient/noise events (streaming
 * deltas, activity, usage, progress, …) return '' so they're never matched.
 */
export function searchableEventText(event: AgentEvent): string {
  switch (event.type) {
    case 'user_message':
      // As the chat shows it, so a hit never lands in attached file content.
      return displayTextFromSent(event.text, event.images);
    case 'assistant_text':
    case 'tool_use_summary':
      return 'text' in event ? event.text : event.summary;
    case 'thinking':
      return event.thinking;
    case 'assistant_tool_use':
      return `${event.toolName} ${flattenInput(event.toolInput)}`;
    case 'tool_result':
      return event.content;
    case 'permission_request':
      return `${event.toolName} ${flattenInput(event.toolInput)} ${event.planText ?? ''}`;
    case 'result':
      return [event.result ?? '', ...(event.errors ?? [])].join(' ');
    case 'status':
    case 'error':
      return event.message;
    case 'compact_boundary':
      return `Context compacted (${event.trigger})`;
    default:
      return '';
  }
}

/**
 * Find the index of the first event carrying the given SDK uuid, or -1. Used to
 * re-anchor a bookmark to its source message when runtime ids / cached event
 * indices have shifted across reloads. Empty/blank uuids never match.
 */
export function findEventIndexByUuid(events: AgentEvent[], uuid: string): number {
  if (!uuid) return -1;
  return events.findIndex((e) => 'uuid' in e && e.uuid === uuid);
}

const SNIPPET_RADIUS = 40;

/** Build a whitespace-collapsed window around the match, with ellipses when cut. */
function makeSnippet(normalized: string, matchIndex: number, queryLen: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(normalized.length, matchIndex + queryLen + SNIPPET_RADIUS);
  let snippet = normalized.slice(start, end);
  if (start > 0) snippet = `…${snippet}`;
  if (end < normalized.length) snippet = `${snippet}…`;
  return snippet;
}

const PREVIEW_MAX_LEN = 160;

function collapse(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > PREVIEW_MAX_LEN ? `${normalized.slice(0, PREVIEW_MAX_LEN)}…` : normalized;
}

/** Text of the first real user prompt (slash commands and attachment-only
 *  messages skipped), trimmed but otherwise as sent, or null when the history
 *  has none. */
export function firstUserPrompt(events: AgentEvent[]): string | null {
  for (const e of events) {
    if (e.type !== 'user_message') continue;
    const typed = stripFileContext(e.text).trim();
    if (typed && !typed.startsWith('/')) return e.text.trim();
  }
  return null;
}

/**
 * Derive a lightweight conversation preview from a session's event history:
 * the first real user prompt (slash commands skipped) and the most recent
 * user/assistant text. User messages read as the chat shows them, not with
 * attached file content. Both empty when the history has no such events.
 */
export function extractSessionPreview(events: AgentEvent[]): SessionPreview {
  let firstPrompt = '';
  for (const e of events) {
    if (e.type !== 'user_message') continue;
    const text = displayTextFromSent(e.text, e.images).trim();
    if (!text || text.startsWith('/')) continue;
    firstPrompt = collapse(text);
    break;
  }

  let lastText = '';
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'assistant_text' || e.type === 'user_message') {
      const text = (e.type === 'user_message' ? displayTextFromSent(e.text, e.images) : e.text).trim();
      if (!text || (e.type === 'user_message' && text.startsWith('/'))) continue;
      lastText = collapse(text);
      break;
    }
    if (e.type === 'tool_use_summary' && e.summary.trim()) {
      lastText = collapse(e.summary);
      break;
    }
  }

  return { firstPrompt, lastText };
}

/** Escape a string for literal use in a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A query compiled for case-insensitive matching against event text. */
interface CompiledQuery {
  /** Tests raw event text: any whitespace run matches a space in the query,
   *  so events don't need normalising until one actually matches. */
  raw: RegExp;
  /** Locates the match in whitespace-collapsed text, for the snippet. */
  normalized: RegExp;
}

function compileQuery(query: string): CompiledQuery | null {
  const q = query.replace(/\s+/g, ' ').trim();
  if (!q) return null;
  const literal = escapeRegExp(q);
  return { raw: new RegExp(literal.replace(/ /g, '\\s+'), 'i'), normalized: new RegExp(literal, 'i') };
}

/** Build the hit for an event whose raw text matched. */
function makeHit(text: string, query: CompiledQuery, eventIndex: number, kind: string): EventSearchHit | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const match = query.normalized.exec(normalized);
  if (!match) return null;
  return { eventIndex, kind, snippet: makeSnippet(normalized, match.index, match[0].length) };
}

/**
 * Search a session's event history for a query, newest match first. Returns up to
 * `limit` hits, each with the absolute event index (so the renderer can page in
 * exactly that depth) and a snippet for the results dropdown.
 */
export function searchEvents(events: readonly AgentEvent[], query: string, limit = 100): EventSearchHit[] {
  const compiled = compileQuery(query);
  if (!compiled) return [];

  const hits: EventSearchHit[] = [];
  // Iterate newest-first so the limit keeps the most recent matches.
  for (let i = events.length - 1; i >= 0 && hits.length < limit; i--) {
    const text = searchableEventText(events[i]);
    if (!text || !compiled.raw.test(text)) continue;
    const hit = makeHit(text, compiled, i, eventKind(events[i]));
    if (hit) hits.push(hit);
  }
  return hits;
}

/**
 * Search text for one conversation, built once and reused across keystrokes:
 * each event's searchable text, so a query no longer re-parses the log or
 * re-extracts every event. Append-only, like the histories it mirrors.
 * Returns the same hits as searchEvents.
 */
export class EventSearchIndex {
  /** Source events consumed so far; the next append starts here. */
  indexedCount = 0;
  /** Per indexed event, oldest first. */
  private texts: string[] = [];
  private eventIndices: number[] = [];
  private kinds: string[] = [];
  private chars = 0;

  /** Retained text size in chars. */
  get size(): number {
    return this.chars;
  }

  /** Index events[indexedCount..]. */
  append(events: readonly AgentEvent[]): void {
    for (let i = this.indexedCount; i < events.length; i++) {
      const text = searchableEventText(events[i]);
      if (!text) continue;
      this.texts.push(text);
      this.eventIndices.push(i);
      this.kinds.push(eventKind(events[i]));
      this.chars += text.length;
    }
    this.indexedCount = events.length;
  }

  /** Newest-first hits, at most one per event. */
  search(query: string, limit = 100): EventSearchHit[] {
    const compiled = compileQuery(query);
    const hits: EventSearchHit[] = [];
    if (!compiled) return hits;
    for (let k = this.texts.length - 1; k >= 0 && hits.length < limit; k--) {
      if (!compiled.raw.test(this.texts[k])) continue;
      const hit = makeHit(this.texts[k], compiled, this.eventIndices[k], this.kinds[k]);
      if (hit) hits.push(hit);
    }
    return hits;
  }
}

interface SearchIndexEntry {
  /** What the index was built from: a live history array (grows in place) or
   *  a version string for an immutable snapshot (an on-disk log). */
  source: readonly AgentEvent[] | string;
  index: EventSearchIndex;
  /** Last search pass that used this entry. */
  pass: number;
}

/**
 * Size-bounded cache of per-conversation search indexes. Cross-conversation
 * search walks every conversation in the same order on each keystroke, which
 * defeats plain LRU once they don't all fit (every lookup misses). So entries
 * used by the current pass are never evicted to make room in that pass: an
 * index that doesn't fit is used once and dropped, and the rest stay cached.
 */
export class SearchIndexCache {
  private entries = new Map<string, SearchIndexEntry>();
  private total = 0;
  private pass = 0;

  constructor(private readonly budget: number) {}

  /** Retained text size in chars across all cached indexes. */
  get size(): number {
    return this.total;
  }

  /** Start a search request; entries it touches are protected from eviction until the next one. */
  beginPass(): void {
    this.pass++;
  }

  /** Index for a history that only grows in place (a live session's event array). */
  live(id: string, events: readonly AgentEvent[]): EventSearchIndex {
    const entry = this.lookup(id, events);
    // Histories only grow in place; a shorter array was edited, so rebuild.
    if (!entry || events.length < entry.index.indexedCount) return this.add(id, events, events);
    if (events.length > entry.index.indexedCount) {
      this.total -= entry.index.size;
      entry.index.append(events);
      this.total += entry.index.size;
      this.fit(id);
    }
    return entry.index;
  }

  /** Index for an immutable snapshot identified by `version`. `load` runs only
   *  on a miss; when it returns null (unreadable), nothing is cached. */
  snapshot(id: string, version: string, load: () => readonly AgentEvent[] | null): EventSearchIndex | null {
    const cached = this.lookup(id, version);
    if (cached) return cached.index;
    const events = load();
    return events ? this.add(id, version, events) : null;
  }

  delete(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.total -= entry.index.size;
    this.entries.delete(id);
  }

  private lookup(id: string, source: SearchIndexEntry['source']): SearchIndexEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.source !== source) {
      this.delete(id);
      return undefined;
    }
    // Refresh recency (Map keeps insertion order; oldest is evicted first).
    this.entries.delete(id);
    this.entries.set(id, entry);
    entry.pass = this.pass;
    return entry;
  }

  private add(id: string, source: SearchIndexEntry['source'], events: readonly AgentEvent[]): EventSearchIndex {
    this.delete(id);
    const index = new EventSearchIndex();
    index.append(events);
    this.entries.set(id, { source, index, pass: this.pass });
    this.total += index.size;
    this.fit(id);
    return index;
  }

  /** Evict older entries until within budget; drop `id` itself if it still doesn't fit. */
  private fit(id: string): void {
    for (const [key, entry] of this.entries) {
      if (this.total <= this.budget) return;
      if (key !== id && entry.pass < this.pass) this.delete(key);
    }
    if (this.total > this.budget) this.delete(id);
  }
}
