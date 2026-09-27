import { deriveSessionName, legacySessionName, stripFileContext } from '../shared/session-name.js';

/** Who set a conversation's display name. Auto names follow the provider's
 *  title (or the heuristic); user names are never replaced. */
export type DisplayNameSource = 'user' | 'auto';

export interface DisplayNameState {
  displayName: string | null;
  /** Absent on manifest entries saved before the source was tracked. */
  source?: DisplayNameSource;
}

/** A name to persist: a new auto name, or an existing one marked as the user's. */
export interface AutoNameDecision {
  displayName: string;
  source: DisplayNameSource;
}

export interface AutoNameSources {
  /** The provider's own conversation title, or null when it has none (yet). */
  providerTitle(): Promise<string | null>;
  /** First real user prompt as sent. Can mean reading the event log from
   *  disk, so it is only called when needed. */
  firstPrompt(): string | null;
}

/** Guard against a runaway provider title; generated ones are a few words. */
const MAX_TITLE_LEN = 80;

/** Whether `name` is what older builds derived from the first prompt. They
 *  used the displayed text, or the sent text when the first turn ended after
 *  a reload, so both forms count. */
function isLegacyAutoName(name: string, firstPrompt: string | null): boolean {
  if (!firstPrompt) return false;
  return name === legacySessionName(firstPrompt) || name === legacySessionName(stripFileContext(firstPrompt));
}

/**
 * Work out a conversation's auto name. Returns the state to persist, or null
 * when nothing should change. A user-set name always stays; otherwise the
 * provider's title wins, then the heuristic name from the first prompt.
 *
 * Entries saved before the source was tracked are classified once: a name
 * matching what older builds derived was auto-generated (and is replaced),
 * anything else was typed by the user (and is kept).
 */
export async function decideAutoName(
  state: DisplayNameState,
  sources: AutoNameSources,
): Promise<AutoNameDecision | null> {
  if (state.source === 'user') return null;
  const current = state.displayName || null;
  if (state.source === undefined && current && !isLegacyAutoName(current, sources.firstPrompt())) {
    return { displayName: current, source: 'user' };
  }

  let next = (await sources.providerTitle().catch(() => null))?.trim() || null;
  if (next && next.length > MAX_TITLE_LEN) next = `${next.slice(0, MAX_TITLE_LEN).trimEnd()}…`;
  if (!next) {
    // A heuristic name never goes stale (the first prompt doesn't change), so
    // only derive one when there is no name yet or it's an old-style one.
    if (current && state.source === 'auto') return null;
    next = deriveSessionName(sources.firstPrompt() ?? '');
  }
  if (!next || (next === current && state.source === 'auto')) return null;
  return { displayName: next, source: 'auto' };
}
