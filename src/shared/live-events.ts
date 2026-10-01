import type { AgentEvent } from './types.js';

/** Event types that are never persisted or replayed: live UI feedback only. */
export const TRANSIENT_EVENT_TYPES: ReadonlySet<AgentEvent['type']> = new Set<AgentEvent['type']>([
  'partial_text', 'partial_thinking', 'activity', 'tool_progress', 'usage',
]);

/**
 * The live events, out of those that arrived while a conversation's history
 * page was loading, that the page doesn't already hold. The main process logs
 * an event before sending it, so one logged before it answered the page
 * request is in the page: at its end, in the order it arrived. Ones that came
 * later aren't. Transient events are never logged and are stale by now, so
 * they are dropped.
 */
export function liveEventsMissingFrom(page: readonly AgentEvent[], held: readonly AgentEvent[]): AgentEvent[] {
  const live = held.filter((e) => !TRANSIENT_EVENT_TYPES.has(e.type));
  const pageKeys = page.filter((e) => !TRANSIENT_EVENT_TYPES.has(e.type)).map((e) => JSON.stringify(e));
  const liveKeys = live.map((e) => JSON.stringify(e));
  // The longest run at the start of `live` that ends the page.
  for (let k = Math.min(live.length, pageKeys.length); k > 0; k--) {
    const offset = pageKeys.length - k;
    let match = true;
    for (let i = 0; i < k; i++) {
      if (liveKeys[i] !== pageKeys[offset + i]) {
        match = false;
        break;
      }
    }
    if (match) return live.slice(k);
  }
  return live;
}
