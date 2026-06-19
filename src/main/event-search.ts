import type { AgentEvent, EventSearchHit } from '../shared/types.js';

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

/**
 * Search a session's event history for a query, newest match first. Returns up to
 * `limit` hits, each with the absolute event index (so the renderer can page in
 * exactly that depth) and a snippet for the results dropdown.
 */
export function searchEvents(events: AgentEvent[], query: string, limit = 100): EventSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: EventSearchHit[] = [];
  // Iterate newest-first so the limit keeps the most recent matches.
  for (let i = events.length - 1; i >= 0; i--) {
    const text = searchableEventText(events[i]);
    if (!text) continue;
    const normalized = text.replace(/\s+/g, ' ').trim();
    const idx = normalized.toLowerCase().indexOf(q);
    if (idx < 0) continue;
    hits.push({
      eventIndex: i,
      kind: eventKind(events[i]),
      snippet: makeSnippet(normalized, idx, q.length),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
