import { logger } from './logger.js';
import * as memory from './memory.js';
import * as memoryCompact from './memory-compact.js';
import * as settings from './settings.js';
import { subagentParent, type AgentEvent, type MemoryEntry } from '../shared/types.js';
import { adapterRegistry } from './adapters/index.js';
import { backgroundModelFor } from './background-tasks.js';
import { eventsSinceAgentChange } from './agent-handoff.js';

// ─── Types ───

interface ExtractionFile {
  action: 'create' | 'update' | 'append' | 'skip';
  path: string;
  content: string;
  reason: string;
}

interface ExtractionResult {
  files: ExtractionFile[];
  sessionNote: {
    shouldSave: boolean;
    content: string;
  };
}

// ─── Constants ───

const MIN_TURNS_FOR_AUTOSAVE = 3;
const MAX_SESSION_SLUG_LENGTH = 60;
const BRANCH_PREFIXES = /^(?:feature|bug|fix|hotfix)\//;
const MAX_EVENTS_FOR_EXTRACTION = 60;
const DEBOUNCE_MS = 5_000;
/** Full text of existing memory files the extraction is shown, at most. The
 *  others are listed by path, title and description, so a large memory
 *  doesn't go out in full with every save. */
export const EXTRACTION_FULL_BYTES = 24 * 1024;
/** Index lines the extraction is shown, at most. */
const EXTRACTION_INDEX_BYTES = 16 * 1024;
/** Longest section an "append" may add to a file. */
const MAX_APPEND_CHARS = 4000;
/** Minimum gap between per-turn extractions for one session. Each extraction
 *  boots a full agent subprocess, so running it after every turn is the
 *  single largest source of background process churn. */
export const MIN_SAVE_INTERVAL_MS = 3 * 60_000;
/** Skip a per-turn extraction unless at least this many new events arrived. */
export const MIN_NEW_EVENTS = 8;

// ─── Tracking state ───

/** Sessions currently running an auto-save extraction. */
const inProgress = new Set<string>();

/** Debounce timers keyed by session ID. */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** When each session last ran an extraction and how many events it had. */
const lastSave = new Map<string, { at: number; eventCount: number }>();

/** Test hook: clear all tracking state. */
export function _resetForTests(): void {
  inProgress.clear();
  for (const t of debounceTimers.values()) clearTimeout(t);
  debounceTimers.clear();
  lastSave.clear();
}

// ─── Helpers ───

/**
 * Pull the first complete JSON object out of a model response. Models often
 * wrap the JSON in fences or append a sentence after it; `JSON.parse` on the
 * raw text then fails with "Unexpected non-whitespace character after JSON".
 * Walks the text tracking string/escape state so braces inside strings don't
 * confuse the match. Returns null when no balanced object is found.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Memory files the agent read or wrote with Grove's memory tools in these
 * events, most recently used first. ACP agents may fill a call's input in
 * later (tool_update), so the last input seen for a call counts.
 */
export function memoryFilesTouched(events: AgentEvent[]): string[] {
  const calls = new Map<string, { name: string; input: unknown }>();
  for (const e of events) {
    if (e.type === 'assistant_tool_use') {
      calls.set(e.toolUseId, { name: e.toolName, input: e.toolInput });
    } else if (e.type === 'tool_update') {
      const call = calls.get(e.toolUseId);
      if (call) calls.set(e.toolUseId, { name: e.toolName ?? call.name, input: e.toolInput ?? call.input });
    }
  }

  const paths: string[] = [];
  for (const { name, input } of [...calls.values()].reverse()) {
    if (!/memory_(?:read|write)\b/.test(name)) continue;
    const raw = (input as { path?: unknown } | null)?.path;
    if (typeof raw !== 'string') continue;
    const p = raw.replace(/\\/g, '/');
    if (!paths.includes(p)) paths.push(p);
  }
  return paths;
}

/** Folder names and common words that say nothing about a file's topic. */
const IGNORED_WORDS = new Set([
  'repo', 'conventions', 'architecture', 'sessions', 'memory', 'note', 'notes', 'file', 'files',
  'this', 'that', 'with', 'from', 'have', 'will', 'into', 'when', 'what', 'which', 'there', 'their',
  'about', 'should', 'would', 'could', 'been', 'were', 'they', 'them', 'then', 'than', 'also', 'only',
  'some', 'more', 'other', 'each', 'does', 'used', 'uses', 'using', 'make', 'need', 'like', 'just',
]);

/** Distinct words of four letters or more, camelCase split, lower case. */
function topicWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const w of text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 4 && !IGNORED_WORDS.has(w)) words.add(w);
  }
  return words;
}

export interface ExtractionContext {
  /** Files shown in full, path → content: the extraction may rewrite these. */
  full: Record<string, string>;
  /** Index lines for the other files outside sessions/. */
  indexLines: string[];
  /** Files past the index budget, not shown at all. */
  unlisted: number;
}

/**
 * Pick what the extraction sees of existing memory. In full, up to
 * EXTRACTION_FULL_BYTES, in this order: files the thread read or wrote, the
 * thread's own note, conventions/ (up to what reaches the agent), then files
 * whose title, description or path share words with the conversation. Every
 * other file outside sessions/ is an index line.
 */
export function selectExtractionContext(
  repoPath: string,
  conversation: string,
  touched: string[],
  sessionNotePath: string,
): ExtractionContext {
  const entries = memory.listMemoryFiles(repoPath);
  const byPath = new Map(entries.map(e => [e.relativePath, e]));
  const lasting = entries.filter(e => !e.folder.startsWith('sessions')).sort(memory.byIndexOrder);

  const full: Record<string, string> = {};
  let used = 0;
  const take = (list: Array<MemoryEntry | undefined>, cap = EXTRACTION_FULL_BYTES) => {
    let taken = 0;
    for (const entry of list) {
      if (!entry || entry.relativePath in full) continue;
      const content = memory.readMemoryFile(repoPath, entry.relativePath);
      if (!content) continue;
      const size = Buffer.byteLength(content, 'utf-8');
      if (used + size > EXTRACTION_FULL_BYTES || taken + size > cap) continue;
      full[entry.relativePath] = content;
      used += size;
      taken += size;
    }
  };

  take(touched.map(p => byPath.get(p)));
  take([byPath.get(sessionNotePath)]);
  take(lasting.filter(e => e.folder === 'conventions'), memory.FULL_CONVENTIONS_BYTES);

  const said = topicWords(conversation);
  const matches = lasting
    .map(entry => {
      let score = 0;
      for (const w of topicWords(`${entry.title} ${entry.description ?? ''} ${entry.relativePath}`)) {
        if (said.has(w)) score++;
      }
      return { entry, score };
    })
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score || memory.byIndexOrder(a.entry, b.entry));
  take(matches.map(m => m.entry));

  const indexLines: string[] = [];
  let unlisted = 0;
  let indexBytes = 0;
  for (const entry of lasting) {
    if (entry.relativePath in full) continue;
    const line = memory.indexLine(entry);
    const size = Buffer.byteLength(line, 'utf-8') + 1;
    if (unlisted === 0 && indexBytes + size <= EXTRACTION_INDEX_BYTES) {
      indexLines.push(line);
      indexBytes += size;
    } else {
      unlisted++;
    }
  }

  return { full, indexLines, unlisted };
}

/**
 * Add a section to the end of a memory file without rewriting it, under a
 * dated heading, and move its frontmatter updatedAt to now. Any frontmatter
 * in the addition is dropped and it is cut to MAX_APPEND_CHARS.
 */
export function appendSection(existing: string, addition: string, now = new Date()): string {
  const body = addition.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '').trim().slice(0, MAX_APPEND_CHARS);
  // Only inside the frontmatter: the body may have its own "updatedAt:" text.
  const frontmatter = existing.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0];
  const stamped = frontmatter
    ? frontmatter.replace(
        /^(updatedAt:[ \t]*)("?)[^"\r\n]*\2(?=[ \t]*\r?$)/m,
        (_m, head: string, quote: string) => `${head}${quote}${now.toISOString()}${quote}`,
      ) + existing.slice(frontmatter.length)
    : existing;
  return `${stamped.trimEnd()}\n\n## Added ${now.toISOString().slice(0, 10)}\n\n${body}\n`;
}

/**
 * Condense the event history into a text summary suitable for the extraction prompt.
 * Only includes user messages, assistant text, tool calls/results, and errors.
 * Subagents' work is left out: the main agent reports what they found.
 */
function summarizeEvents(events: AgentEvent[], maxEvents: number): string {
  const relevant = events.filter((e) => !subagentParent(e)).slice(-maxEvents);
  const lines: string[] = [];

  for (const ev of relevant) {
    switch (ev.type) {
      case 'user_message':
        lines.push(`[User]: ${ev.text}`);
        break;
      case 'assistant_text':
        lines.push(`[Assistant]: ${ev.text.slice(0, 2000)}`);
        break;
      case 'assistant_tool_use':
        lines.push(`[Tool Call]: ${ev.toolName}(${JSON.stringify(ev.toolInput).slice(0, 500)})`);
        break;
      case 'tool_result':
        lines.push(`[Tool Result]: ${ev.content.slice(0, 1000)}`);
        break;
      case 'error':
        lines.push(`[Error]: ${ev.message}`);
        break;
      case 'result':
        lines.push(`[Result]: turns=${ev.numTurns ?? '?'}, cost=$${ev.totalCostUsd?.toFixed(4) ?? '?'}, error=${ev.isError}`);
        break;
    }
  }

  return lines.join('\n');
}

/**
 * Count the number of user turns in the event history.
 */
function countUserTurns(events: AgentEvent[]): number {
  return events.filter(e => e.type === 'user_message').length;
}

/**
 * Generate a descriptive session filename from the branch name.
 * Falls back to session ID when no branch is available.
 */
export function generateSessionFilename(sessionId: string, branchName?: string): string {
  if (!branchName) return `sessions/${sessionId}.md`;

  // Strip common branch prefixes
  let slug = branchName.replace(BRANCH_PREFIXES, '');

  // Lowercase, replace non-alphanumeric with dashes, collapse multiples, trim edges
  slug = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!slug) return `sessions/${sessionId}.md`;

  // Truncate
  if (slug.length > MAX_SESSION_SLUG_LENGTH) {
    slug = slug.slice(0, MAX_SESSION_SLUG_LENGTH).replace(/-$/, '');
  }

  return `sessions/${slug}.md`;
}

// ─── Extraction prompt ───

function buildExtractionPrompt(conversationSummary: string, context: ExtractionContext, sessionNotePath: string): string {
  const shown = Object.entries(context.full);
  const fullSection = shown.length > 0
    ? shown.map(([p, c]) => `### ${p}\n${c}`).join('\n\n')
    : '(none)';
  let indexSection = context.indexLines.length > 0 ? context.indexLines.join('\n') : '(none)';
  if (context.unlisted > 0) indexSection += `\n(${context.unlisted} more not listed)`;
  const noteState = sessionNotePath in context.full
    ? `Its current text is shown above: keep what still matters, since the session note you return replaces it.`
    : 'It does not exist yet.';

  return `You are a memory extraction assistant. Your job is to analyze a conversation and decide what project knowledge should be saved to persistent memory.

## Existing Memory Files (full text)
${fullSection}

## Other Memory Files (index only)
Only the path, title and description of these files are shown, not their text.
${indexSection}

## Conversation
${conversationSummary}

## Session Note
This thread's session note is ${sessionNotePath}. ${noteState}

## Instructions
Analyze the conversation above and extract information worth persisting. Consider:
- Project structure, tech stack, or architecture discoveries
- Conventions, patterns, or important decisions
- User corrections or clarifications about how things work
- Important context about ongoing work

Rules:
- Use "update" if a file shown in full covers the same topic — merge new info into it. Never "update" a file you were only shown in the index: you would erase what you can't see.
- Use "append" to add new info to a file listed only in the index: content is a few lines of markdown to add at its end, with no frontmatter and no heading. It is added under a dated heading.
- Use "create" only for genuinely new topics not covered by any existing file, in either list.
- Use "skip" if a file exists and needs no changes.
- When updating a file, rewrite it as a coherent whole: remove statements the new information contradicts or supersedes rather than appending both. If the user corrected something, the correction replaces the old claim.
- Do NOT save ephemeral information (debugging steps, temporary state, conversation pleasantries).
- Do NOT duplicate information already in existing memory files — merge instead.
- Memory files use markdown with YAML frontmatter: title, description (one line, under 100 characters, saying what the file covers; agents see only the title and description until they read the file) and updatedAt.
- Organize into folders: repo/ (overview, tech stack), conventions/ (naming, patterns, user corrections; loaded in full into every thread, so keep it short), architecture/ (data flow, modules and decisions that span features).
- Only knowledge that stays true beyond this piece of work goes in those folders. Details of one feature, task, bug or investigation go in the session note instead: session notes are archived after ${memory.SESSION_NOTE_MAX_AGE_DAYS} days.
- For the session note: only save if the conversation involved substantial work (multi-step implementation, important decisions, debugging sessions). Skip for simple Q&A.
- Keep memory files concise and factual.

Respond with ONLY valid JSON matching this schema (no markdown fences):
{
  "files": [
    {
      "action": "create" | "update" | "append" | "skip",
      "path": "folder/filename.md",
      "content": "full markdown content including YAML frontmatter (for append: only the lines to add)",
      "reason": "why this is worth saving"
    }
  ],
  "sessionNote": {
    "shouldSave": true | false,
    "content": "full markdown content for sessions/<id>.md including frontmatter, or empty string if shouldSave is false"
  }
}`;
}

// ─── Core extraction ───

/** What the model returned, and which existing files it was shown in full. */
interface Extraction {
  result: ExtractionResult;
  shown: Set<string>;
}

async function runExtraction(
  repoPath: string,
  cwd: string,
  events: AgentEvent[],
  sessionId: string,
  adapterType?: string,
  branchName?: string,
): Promise<Extraction | null> {
  const adapter = adapterType ? (adapterRegistry.get(adapterType) ?? adapterRegistry.getDefault()) : adapterRegistry.getDefault();

  // If the adapter doesn't support text generation, skip extraction
  if (!adapter.generateText) {
    logger.info(`[memory-autosave] Adapter "${adapter.id}" does not support generateText — skipping extraction`);
    return null;
  }

  // Only what the agent doing the extraction took part in (agent-handoff.ts).
  const ownEvents = eventsSinceAgentChange(events);
  const summary = summarizeEvents(ownEvents, MAX_EVENTS_FOR_EXTRACTION);
  const sessionNotePath = generateSessionFilename(sessionId, branchName);
  const context = selectExtractionContext(repoPath, summary, memoryFilesTouched(ownEvents), sessionNotePath);
  const systemPrompt = buildExtractionPrompt(summary, context, sessionNotePath);

  logger.info(`[memory-autosave] Running extraction for session ${sessionId} (${events.length} events)`);

  const abortController = new AbortController();
  // Safety timeout: 60 seconds
  const timeout = setTimeout(() => abortController.abort(), 60_000);
  try {
    const model = backgroundModelFor(adapter);
    const resultText = await adapter.generateText(
      systemPrompt,
      'Extract memories from the conversation above. Respond with JSON only.',
      { cwd, abortSignal: abortController.signal, model },
    );

    // Parse the JSON response. Take the first balanced object so fences or
    // trailing commentary from the model don't waste the whole extraction.
    const jsonText = extractJsonObject(resultText);
    if (!jsonText) {
      logger.warn(`[memory-autosave] No JSON object in extraction response (${resultText.length} chars)`);
      return null;
    }

    const parsed = JSON.parse(jsonText) as ExtractionResult;

    if (!parsed.files || !parsed.sessionNote) {
      logger.warn('[memory-autosave] Invalid extraction result structure');
      return null;
    }

    return { result: parsed, shown: new Set(Object.keys(context.full)) };
  } catch (err) {
    logger.error(`[memory-autosave] Extraction failed: ${err}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Apply extraction results by writing/updating memory files.
 */
function applyExtraction(repoPath: string, { result: extraction, shown }: Extraction, sessionId: string, branchName?: string): string[] {
  const written: string[] = [];

  for (const file of extraction.files) {
    if (file.action === 'skip') continue;
    if (!file.path || !file.content) continue;

    try {
      const existing = memory.readMemoryFile(repoPath, file.path);
      if (file.action === 'append') {
        if (existing === null) {
          logger.warn(`[memory-autosave] Skipped append to ${file.path}: no such file`);
          continue;
        }
        memory.writeMemoryFile(repoPath, file.path, appendSection(existing, file.content));
      } else {
        // A file the model only saw in the index would lose what it couldn't see.
        if (existing !== null && !shown.has(file.path)) {
          logger.warn(`[memory-autosave] Skipped ${file.action} of ${file.path}: its text was not shown to the model`);
          continue;
        }
        memory.writeMemoryFile(repoPath, file.path, file.content);
      }
      written.push(file.path);
      logger.info(`[memory-autosave] ${file.action}: ${file.path} — ${file.reason}`);
    } catch (err) {
      logger.warn(`[memory-autosave] Failed to write ${file.path}: ${err}`);
    }
  }

  if (extraction.sessionNote.shouldSave && extraction.sessionNote.content) {
    const sessionPath = generateSessionFilename(sessionId, branchName);
    try {
      memory.writeMemoryFile(repoPath, sessionPath, extraction.sessionNote.content);
      written.push(sessionPath);
      logger.info(`[memory-autosave] Saved session note: ${sessionPath}`);
    } catch (err) {
      logger.warn(`[memory-autosave] Failed to write session note: ${err}`);
    }
  }

  return written;
}

// ─── Heuristic fallback (no API call) ───

/**
 * Save minimal session metadata from event history without making an API call.
 * Used when a session is destroyed or crashes.
 */
export function saveSessionMetadata(repoPath: string, sessionId: string, events: AgentEvent[], branchName?: string): void {
  const userMessages = events.filter(e => e.type === 'user_message');
  const resultEvents = events.filter(e => e.type === 'result');

  if (userMessages.length === 0) return;

  const lastResult = resultEvents[resultEvents.length - 1];
  const cost = lastResult && 'totalCostUsd' in lastResult ? lastResult.totalCostUsd : undefined;
  const turns = lastResult && 'numTurns' in lastResult ? lastResult.numTurns : userMessages.length;

  const firstMessage = userMessages[0] && 'text' in userMessages[0]
    ? (userMessages[0] as any).text.slice(0, 200)
    : 'unknown';

  const sessionPath = generateSessionFilename(sessionId, branchName);
  const title = branchName ? `Session: ${branchName}` : `Session ${sessionId.slice(0, 8)}`;

  const content = `---
title: "${title}"
updatedAt: "${new Date().toISOString()}"
---

- **First message**: ${firstMessage}
- **Turns**: ${turns}
- **Cost**: $${cost?.toFixed(4) ?? 'unknown'}
- **Messages**: ${userMessages.length} user messages, ${events.length} total events
`;

  try {
    memory.writeMemoryFile(repoPath, sessionPath, content);
    logger.info(`[memory-autosave] Saved session metadata: ${sessionPath}`);
  } catch (err) {
    logger.warn(`[memory-autosave] Failed to save session metadata: ${err}`);
  }
}

// ─── Public API ───

export interface AutoSaveOptions {
  sessionId: string;
  repoPath: string;
  cwd: string;
  events: AgentEvent[];
  /** Branch name used to generate a descriptive session filename. */
  branchName?: string;
  /** Which adapter to use for text generation (defaults to registry default). */
  adapterType?: string;
  /** Callback when auto-save starts/finishes. */
  onStatus?: (status: 'started' | 'completed' | 'skipped', filesWritten?: string[]) => void;
}

/**
 * Trigger memory auto-save for a session. Debounced, guarded against concurrent runs.
 * Call this after a `result` event or before context compaction.
 */
export function triggerAutoSave(opts: AutoSaveOptions): void {
  const { sessionId } = opts;

  const appSettings = settings.getSettings();
  if (appSettings.memoryAutoSave === false) {
    logger.debug(`[memory-autosave] Auto-save disabled in settings, skipping`);
    opts.onStatus?.('skipped');
    return;
  }

  // Guard: already in progress
  if (inProgress.has(sessionId)) {
    logger.debug(`[memory-autosave] Already in progress for session ${sessionId}`);
    return;
  }

  // Guard: not enough turns
  if (countUserTurns(opts.events) < MIN_TURNS_FOR_AUTOSAVE) {
    logger.debug(`[memory-autosave] Too few turns for session ${sessionId}, skipping`);
    opts.onStatus?.('skipped');
    return;
  }

  // Clear existing debounce timer
  const existing = debounceTimers.get(sessionId);
  if (existing) clearTimeout(existing);

  // Debounce
  const timer = setTimeout(() => {
    debounceTimers.delete(sessionId);
    runAutoSave(opts).catch(err => {
      logger.error(`[memory-autosave] Auto-save failed for session ${sessionId}: ${err}`);
    });
  }, DEBOUNCE_MS);

  debounceTimers.set(sessionId, timer);
}

/**
 * Decide whether a per-turn auto-save should run now, be deferred, or be
 * skipped, given when the session last saved and how much it has grown since.
 * Exported for tests.
 */
export function planTurnAutoSave(
  sessionId: string,
  eventCount: number,
  now = Date.now(),
): { action: 'run' } | { action: 'defer'; delayMs: number } | { action: 'skip' } {
  const last = lastSave.get(sessionId);
  if (!last) return { action: 'run' };
  const newEvents = eventCount - last.eventCount;
  // History shrank (/clear or rewind): the old baseline is meaningless, start over.
  if (newEvents < 0) return { action: 'run' };
  if (newEvents < MIN_NEW_EVENTS) return { action: 'skip' };
  const elapsed = now - last.at;
  if (elapsed >= MIN_SAVE_INTERVAL_MS) return { action: 'run' };
  return { action: 'defer', delayMs: MIN_SAVE_INTERVAL_MS - elapsed };
}

/**
 * Trigger auto-save after a completed turn. Runs at once for the first save,
 * but subsequent turns are rate-limited: too soon after the last save and the
 * run is deferred until the interval elapses; too little new activity and it
 * is skipped entirely. Compaction and `/clear` use `triggerAutoSave` and are
 * not throttled, since context is about to be lost.
 */
export async function triggerAutoSaveImmediate(opts: AutoSaveOptions): Promise<void> {
  const appSettings = settings.getSettings();
  if (appSettings.memoryAutoSave === false) {
    opts.onStatus?.('skipped');
    return;
  }

  if (inProgress.has(opts.sessionId)) return;

  if (countUserTurns(opts.events) < MIN_TURNS_FOR_AUTOSAVE) {
    opts.onStatus?.('skipped');
    return;
  }

  const plan = planTurnAutoSave(opts.sessionId, opts.events.length);
  if (plan.action === 'skip') {
    logger.debug(`[memory-autosave] Too little new activity for session ${opts.sessionId}, skipping`);
    opts.onStatus?.('skipped');
    return;
  }
  if (plan.action === 'defer') {
    // Only one deferred run per session; a later turn re-plans from scratch.
    if (debounceTimers.has(opts.sessionId)) return;
    logger.debug(`[memory-autosave] Deferring auto-save for session ${opts.sessionId} by ${Math.round(plan.delayMs / 1000)}s`);
    const timer = setTimeout(() => {
      debounceTimers.delete(opts.sessionId);
      runAutoSave(opts).catch(err => {
        logger.error(`[memory-autosave] Auto-save failed for session ${opts.sessionId}: ${err}`);
      });
    }, plan.delayMs);
    debounceTimers.set(opts.sessionId, timer);
    return;
  }

  // Clear any pending debounce
  const existing = debounceTimers.get(opts.sessionId);
  if (existing) {
    clearTimeout(existing);
    debounceTimers.delete(opts.sessionId);
  }

  await runAutoSave(opts);
}

async function runAutoSave(opts: AutoSaveOptions): Promise<void> {
  const { sessionId, repoPath, cwd, events, branchName, adapterType, onStatus } = opts;

  if (inProgress.has(sessionId)) return;
  inProgress.add(sessionId);
  // Record up front so a failing extraction doesn't re-run every turn.
  lastSave.set(sessionId, { at: Date.now(), eventCount: events.length });
  onStatus?.('started');

  try {
    const extraction = await runExtraction(repoPath, cwd, events, sessionId, adapterType, branchName);

    if (!extraction) {
      // Extraction failed or was unavailable: keep at least a heuristic
      // session note so the work isn't lost, but never overwrite a richer
      // note a previous successful extraction already wrote.
      const sessionPath = generateSessionFilename(sessionId, branchName);
      if (!memory.readMemoryFile(repoPath, sessionPath)) {
        saveSessionMetadata(repoPath, sessionId, events, branchName);
      }
      onStatus?.('skipped');
      return;
    }

    const written = applyExtraction(repoPath, extraction, sessionId, branchName);

    // Auto-saves add thread notes; archive the expired ones whether or not
    // auto-compact is on.
    memoryCompact.expireSessionNotes(repoPath);

    // Auto-saves grow memory; opportunistically compact it back down
    // (deduped, contradictions resolved).
    memoryCompact.maybeCompact({ repoPath, cwd, adapterType });

    if (written.length > 0) {
      logger.info(`[memory-autosave] Session ${sessionId}: wrote ${written.length} files: ${written.join(', ')}`);
      onStatus?.('completed', written);
    } else {
      logger.info(`[memory-autosave] Session ${sessionId}: nothing to save`);
      onStatus?.('skipped');
    }
  } finally {
    inProgress.delete(sessionId);
  }
}

/**
 * Clean up any pending timers for a session.
 */
export function cancelAutoSave(sessionId: string): void {
  const timer = debounceTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(sessionId);
  }
  lastSave.delete(sessionId);
}
