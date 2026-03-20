import { logger } from './logger.js';
import * as memory from './memory.js';
import * as settings from './settings.js';
import type { AgentEvent } from '../shared/types.js';

// The Agent SDK is ESM-only; reuse the same dynamic import trick.
const dynamicImport = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@anthropic-ai/claude-agent-sdk')>;

let _query: typeof import('@anthropic-ai/claude-agent-sdk').query | null = null;

async function getQuery() {
  if (!_query) {
    const sdk = await dynamicImport('@anthropic-ai/claude-agent-sdk');
    _query = sdk.query;
  }
  return _query;
}

// ─── Types ───

interface ExtractionFile {
  action: 'create' | 'update' | 'skip';
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
const MAX_EVENTS_FOR_EXTRACTION = 60;
const DEBOUNCE_MS = 5_000;

// ─── Tracking state ───

/** Sessions currently running an auto-save extraction. */
const inProgress = new Set<string>();

/** Debounce timers keyed by session ID. */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ─── Helpers ───

/**
 * Read all non-session memory files and return them as a map of path → content.
 */
export function readAllMemoryContents(repoPath: string): Record<string, string> {
  const entries = memory.listMemoryFiles(repoPath);
  const result: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.folder.startsWith('sessions')) continue;
    const content = memory.readMemoryFile(repoPath, entry.relativePath);
    if (content) result[entry.relativePath] = content;
  }
  return result;
}

/**
 * Condense the event history into a text summary suitable for the extraction prompt.
 * Only includes user messages, assistant text, tool calls/results, and errors.
 */
function summarizeEvents(events: AgentEvent[], maxEvents: number): string {
  const relevant = events.slice(-maxEvents);
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

// ─── Extraction prompt ───

function buildExtractionPrompt(conversationSummary: string, existingMemories: Record<string, string>): string {
  const memorySection = Object.entries(existingMemories).length > 0
    ? Object.entries(existingMemories)
        .map(([p, c]) => `### ${p}\n${c}`)
        .join('\n\n')
    : '(no existing memory files)';

  return `You are a memory extraction assistant. Your job is to analyze a conversation and decide what project knowledge should be saved to persistent memory.

## Existing Memory Files
${memorySection}

## Conversation
${conversationSummary}

## Instructions
Analyze the conversation above and extract information worth persisting. Consider:
- Project structure, tech stack, or architecture discoveries
- Conventions, patterns, or important decisions
- User corrections or clarifications about how things work
- Important context about ongoing work

Rules:
- Use "update" if an existing file covers the same topic — merge new info into it.
- Use "create" only for genuinely new topics not covered by any existing file.
- Use "skip" if a file exists and needs no changes.
- Do NOT save ephemeral information (debugging steps, temporary state, conversation pleasantries).
- Do NOT duplicate information already in existing memory files.
- Memory files use markdown with YAML frontmatter (title, updatedAt).
- Organize into folders: repo/ (overview, tech stack), conventions/ (naming, patterns), architecture/ (data flow, modules).
- For the session note: only save if the conversation involved substantial work (multi-step implementation, important decisions, debugging sessions). Skip for simple Q&A.
- Keep memory files concise and factual.

Respond with ONLY valid JSON matching this schema (no markdown fences):
{
  "files": [
    {
      "action": "create" | "update" | "skip",
      "path": "folder/filename.md",
      "content": "full markdown content including YAML frontmatter",
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

async function runExtraction(
  repoPath: string,
  cwd: string,
  events: AgentEvent[],
  sessionId: string,
): Promise<ExtractionResult | null> {
  const query = await getQuery();
  const existingMemories = readAllMemoryContents(repoPath);
  const summary = summarizeEvents(events, MAX_EVENTS_FOR_EXTRACTION);
  const systemPrompt = buildExtractionPrompt(summary, existingMemories);

  logger.info(`[memory-autosave] Running extraction for session ${sessionId} (${events.length} events)`);

  try {
    // Create a single-shot input stream with one message
    let controller: ReadableStreamDefaultController<{ type: 'user'; content: string }>;
    const inputStream = new ReadableStream<{ type: 'user'; content: string }>({
      start(c) { controller = c; },
    });

    // Push the extraction request and close
    controller!.enqueue({
      type: 'user',
      content: 'Extract memories from the conversation above. Respond with JSON only.',
    });
    controller!.close();

    const abortController = new AbortController();
    // Safety timeout: 60 seconds
    const timeout = setTimeout(() => abortController.abort(), 60_000);

    let resultText = '';

    const q = query({
      prompt: inputStream as any,
      options: {
        cwd,
        abortController,
        systemPrompt: systemPrompt,
        permissionMode: 'plan', // no tool use needed
        maxTurns: 1,
      },
    });

    for await (const message of q) {
      if (message.type === 'assistant' && 'content' in message) {
        for (const block of (message as any).content ?? []) {
          if (block.type === 'text') {
            resultText += block.text;
          }
        }
      }
    }

    clearTimeout(timeout);

    // Parse the JSON response
    // Strip markdown fences if present
    const cleaned = resultText
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();

    const parsed = JSON.parse(cleaned) as ExtractionResult;

    if (!parsed.files || !parsed.sessionNote) {
      logger.warn('[memory-autosave] Invalid extraction result structure');
      return null;
    }

    return parsed;
  } catch (err) {
    logger.error(`[memory-autosave] Extraction failed: ${err}`);
    return null;
  }
}

/**
 * Apply extraction results by writing/updating memory files.
 */
function applyExtraction(repoPath: string, extraction: ExtractionResult, sessionId: string): string[] {
  const written: string[] = [];

  for (const file of extraction.files) {
    if (file.action === 'skip') continue;
    if (!file.path || !file.content) continue;

    try {
      memory.writeMemoryFile(repoPath, file.path, file.content);
      written.push(file.path);
      logger.info(`[memory-autosave] ${file.action}: ${file.path} — ${file.reason}`);
    } catch (err) {
      logger.warn(`[memory-autosave] Failed to write ${file.path}: ${err}`);
    }
  }

  if (extraction.sessionNote.shouldSave && extraction.sessionNote.content) {
    const sessionPath = `sessions/${sessionId}.md`;
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
export function saveSessionMetadata(repoPath: string, sessionId: string, events: AgentEvent[]): void {
  const userMessages = events.filter(e => e.type === 'user_message');
  const resultEvents = events.filter(e => e.type === 'result');

  if (userMessages.length === 0) return;

  const lastResult = resultEvents[resultEvents.length - 1];
  const cost = lastResult && 'totalCostUsd' in lastResult ? lastResult.totalCostUsd : undefined;
  const turns = lastResult && 'numTurns' in lastResult ? lastResult.numTurns : userMessages.length;

  const firstMessage = userMessages[0] && 'text' in userMessages[0]
    ? (userMessages[0] as any).text.slice(0, 200)
    : 'unknown';

  const content = `---
title: "Session ${sessionId.slice(0, 8)}"
updatedAt: "${new Date().toISOString()}"
---

- **First message**: ${firstMessage}
- **Turns**: ${turns}
- **Cost**: $${cost?.toFixed(4) ?? 'unknown'}
- **Messages**: ${userMessages.length} user messages, ${events.length} total events
`;

  try {
    memory.writeMemoryFile(repoPath, `sessions/${sessionId}.md`, content);
    logger.info(`[memory-autosave] Saved session metadata: sessions/${sessionId}.md`);
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
 * Trigger auto-save immediately (no debounce). Used for compaction and session end.
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

  // Clear any pending debounce
  const existing = debounceTimers.get(opts.sessionId);
  if (existing) {
    clearTimeout(existing);
    debounceTimers.delete(opts.sessionId);
  }

  await runAutoSave(opts);
}

async function runAutoSave(opts: AutoSaveOptions): Promise<void> {
  const { sessionId, repoPath, cwd, events, onStatus } = opts;

  inProgress.add(sessionId);
  onStatus?.('started');

  try {
    const extraction = await runExtraction(repoPath, cwd, events, sessionId);

    if (!extraction) {
      onStatus?.('skipped');
      return;
    }

    const written = applyExtraction(repoPath, extraction, sessionId);

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
}
