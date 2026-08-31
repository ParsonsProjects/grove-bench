/**
 * Skill suggestions: mine a repo's session event logs for recurring workflows
 * and propose skills that would package them.
 *
 * Two passes, in line with the memory-autosave design:
 *  1. A local heuristic pass is the gatekeeper — it clusters similar user
 *     prompts and counts repeated Bash commands across sessions, and only
 *     patterns seen in enough distinct sessions become candidates. No model
 *     call happens unless the heuristics found something.
 *  2. An optional distillation pass hands the surviving candidates to the
 *     adapter's one-shot generateText (the same offline mechanism memory
 *     extraction uses) to write a proper name/description/instruction draft.
 *     When the adapter can't generate text, heuristic drafts are used as-is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { AgentEvent, SkillInfo, SkillSuggestion } from '../shared/types.js';
import { loadSkillSuggestionCache, saveSkillSuggestionCache } from './app-state.js';
import { logger } from './logger.js';

// ─── Extraction from event logs ───

export interface SessionActivity {
  sessionId: string;
  /** User-authored prompts (system-injected turns filtered out). */
  prompts: string[];
  /** Normalized Bash commands the agent ran. */
  bashCommands: string[];
}

/** First line, collapsed whitespace, capped — enough to identify a command. */
export function normalizeCommand(command: string): string {
  return command.split(/\r?\n/)[0].replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Trivial commands that recur in every session and would only produce noise. */
const COMMAND_STOPLIST = /^(cd|ls|dir|pwd|cat|type|echo|git (status|diff|log|branch|add|show)\b|npm (test|install)$|node -v|npm -v)/i;

export function extractActivity(sessionId: string, events: AgentEvent[]): SessionActivity {
  const prompts: string[] = [];
  const bashCommands: string[] = [];
  for (const event of events) {
    if (event.type === 'user_message' && typeof event.text === 'string') {
      const text = event.text.trim();
      // Skip Grove's own injected turns (memory restore notices, PR prompts…)
      if (!text || text.startsWith('[System]')) continue;
      prompts.push(text.slice(0, 500));
    } else if (event.type === 'assistant_tool_use' && event.toolName === 'Bash') {
      const command = (event.toolInput as { command?: unknown } | null)?.command;
      if (typeof command === 'string' && command.trim()) {
        const normalized = normalizeCommand(command);
        if (normalized && !COMMAND_STOPLIST.test(normalized)) {
          bashCommands.push(normalized);
        }
      }
    }
  }
  return { sessionId, prompts, bashCommands };
}

// ─── Prompt clustering ───

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'then', 'them', 'they',
  'please', 'can', 'you', 'should', 'would', 'make', 'sure', 'into', 'when',
  'all', 'are', 'was', 'were', 'have', 'has', 'not', 'but', 'its', 'our',
  'use', 'using', 'also', 'each', 'need', 'want', 'like', 'just', 'more',
]);

export function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return new Set(tokens);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export interface PromptSample {
  sessionId: string;
  text: string;
}

export interface PromptCluster {
  /** Representative prompt (the first one seen). */
  label: string;
  samples: PromptSample[];
  sessionCount: number;
}

/** Greedy single-pass clustering: a prompt joins the first cluster whose
 *  representative it overlaps with beyond the threshold. Cheap and stable —
 *  good enough for threshold gating, which is all this pass does. */
export function clusterPrompts(samples: PromptSample[], threshold = 0.5): PromptCluster[] {
  const clusters: Array<{ label: string; samples: PromptSample[]; tokens: Set<string> }> = [];
  for (const sample of samples) {
    const tokens = tokenize(sample.text);
    if (tokens.size < 3) continue; // too short to identify a workflow
    const match = clusters.find((c) => jaccard(c.tokens, tokens) >= threshold);
    if (match) {
      match.samples.push(sample);
    } else {
      clusters.push({ label: sample.text, samples: [sample], tokens });
    }
  }
  return clusters.map(({ tokens: _t, ...cluster }) => ({
    ...cluster,
    sessionCount: new Set(cluster.samples.map((s) => s.sessionId)).size,
  }));
}

// ─── Pattern candidates ───

export interface PatternCandidate {
  kind: 'prompt' | 'command';
  /** Representative prompt or command. */
  label: string;
  sessionCount: number;
  occurrences: number;
  examples: string[];
}

export function findPatterns(activities: SessionActivity[], minSessions = 3): PatternCandidate[] {
  const candidates: PatternCandidate[] = [];

  // Recurring asks: similar prompts across enough distinct sessions
  const samples = activities.flatMap((a) => a.prompts.map((text) => ({ sessionId: a.sessionId, text })));
  for (const cluster of clusterPrompts(samples)) {
    if (cluster.sessionCount >= minSessions) {
      candidates.push({
        kind: 'prompt',
        label: cluster.label,
        sessionCount: cluster.sessionCount,
        occurrences: cluster.samples.length,
        examples: cluster.samples.slice(0, 3).map((s) => s.text.slice(0, 200)),
      });
    }
  }

  // Recurring commands: the same normalized command across enough sessions
  const bySessions = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const activity of activities) {
    for (const command of activity.bashCommands) {
      (bySessions.get(command) ?? bySessions.set(command, new Set()).get(command)!).add(activity.sessionId);
      counts.set(command, (counts.get(command) ?? 0) + 1);
    }
  }
  for (const [command, sessions] of bySessions) {
    if (sessions.size >= minSessions) {
      candidates.push({
        kind: 'command',
        label: command,
        sessionCount: sessions.size,
        occurrences: counts.get(command) ?? sessions.size,
        examples: [command],
      });
    }
  }

  // Strongest signals first; cap so distillation stays one small model call
  return candidates
    .sort((a, b) => b.sessionCount - a.sessionCount || b.occurrences - a.occurrences)
    .slice(0, 8);
}

// ─── Heuristic suggestion drafts ───

/** Stable id from the pattern label, so dismissals survive re-analysis. */
export function suggestionId(label: string): string {
  let hash = 5381;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) + hash + label.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function kebabName(candidate: PatternCandidate): string {
  const source = candidate.kind === 'command' ? candidate.label.split(' ')[0] + ' workflow' : candidate.label;
  const words = [...tokenize(source)].slice(0, 3);
  const name = words.join('-').replace(/[^a-z0-9-]/g, '');
  return name || 'recurring-workflow';
}

export function suggestionFromPattern(candidate: PatternCandidate): SkillSuggestion {
  const where = `${candidate.sessionCount} sessions`;
  return {
    id: suggestionId(candidate.label),
    name: kebabName(candidate),
    description: candidate.kind === 'prompt'
      ? `Use when asked to: ${candidate.label.slice(0, 140)}`
      : `Use when the workflow needs: ${candidate.label}`,
    draftInstructions: candidate.kind === 'prompt'
      ? `Recurring request across ${where}. Examples:\n${candidate.examples.map((e) => `- ${e}`).join('\n')}\n\nDocument the proven steps for this task here.`
      : `This command ran in ${where} (${candidate.occurrences} times total):\n\n\`\`\`\n${candidate.label}\n\`\`\`\n\nDocument when to run it, what to check first, and how to verify the result.`,
    rationale: candidate.kind === 'prompt'
      ? `Similar requests in ${where} (${candidate.occurrences} prompts)`
      : `Same command run in ${where} (${candidate.occurrences} times)`,
    evidence: candidate.examples,
    sessionCount: candidate.sessionCount,
  };
}

// ─── Coverage filter ───

/** Drop suggestions an existing skill already covers: same name, or a
 *  description that substantially overlaps an existing skill's. */
export function filterCovered(suggestions: SkillSuggestion[], existing: SkillInfo[]): SkillSuggestion[] {
  const existingNames = new Set(existing.map((s) => s.name));
  const existingTokens = existing.map((s) => tokenize(`${s.name} ${s.description}`));
  return suggestions.filter((suggestion) => {
    if (existingNames.has(suggestion.name)) return false;
    const tokens = tokenize(`${suggestion.name} ${suggestion.description}`);
    return !existingTokens.some((et) => jaccard(et, tokens) >= 0.5);
  });
}

// ─── LLM distillation ───

const distilledSchema = z.array(z.object({
  patternIndex: z.number().int().min(0),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string().min(1),
  instructions: z.string().min(1),
  rationale: z.string().min(1),
})).max(8);

/** Pull the first JSON array out of a model reply (tolerates code fences and
 *  prose around it) and validate it. Null when nothing usable came back. */
export function parseDistilled(text: string): z.infer<typeof distilledSchema> | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const result = distilledSchema.safeParse(JSON.parse(match[0]));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const DISTILL_SYSTEM_PROMPT = [
  'You turn recurring developer-workflow patterns into agent skill proposals.',
  'You receive a JSON array of patterns mined from coding-session history: each has kind ("prompt" = similar user requests, "command" = a repeatedly run shell command), a representative label, occurrence counts, and examples.',
  'Reply with ONLY a JSON array. For each pattern genuinely worth packaging as a reusable skill, output {"patternIndex": <index into the input array>, "name": "<kebab-case skill name>", "description": "<one sentence: when the agent should invoke it>", "instructions": "<concise markdown instruction body with concrete steps/commands from the evidence>", "rationale": "<one short sentence why this recurs>"}.',
  'Skip weak patterns rather than padding the list. Never invent workflows not present in the input.',
].join('\n');

type TextGenerator = (systemPrompt: string, userMessage: string, options?: { cwd?: string }) => Promise<string>;

export async function distillSuggestions(
  generateText: TextGenerator,
  candidates: PatternCandidate[],
  cwd?: string,
): Promise<SkillSuggestion[] | null> {
  const reply = await generateText(DISTILL_SYSTEM_PROMPT, JSON.stringify(candidates, null, 2), cwd ? { cwd } : undefined);
  const parsed = parseDistilled(reply);
  if (!parsed) return null;
  const suggestions: SkillSuggestion[] = [];
  for (const item of parsed) {
    const candidate = candidates[item.patternIndex];
    if (!candidate) continue; // model pointed at a pattern that doesn't exist
    suggestions.push({
      id: suggestionId(candidate.label),
      name: item.name,
      description: item.description,
      draftInstructions: item.instructions,
      rationale: item.rationale,
      evidence: candidate.examples,
      sessionCount: candidate.sessionCount,
    });
  }
  return suggestions;
}

// ─── Orchestration ───

export interface AnalyzeOptions {
  repoPath: string;
  sessionIds: string[];
  eventsDir: string;
  existingSkills: SkillInfo[];
  /** Optional one-shot text generation (adapter.generateText). */
  generateText?: TextGenerator | null;
  /** Patterns must appear in at least this many distinct sessions. */
  minSessions?: number;
  /** Most recent sessions to read (bounded I/O). */
  maxSessions?: number;
}

function readEventLog(eventsDir: string, sessionId: string): AgentEvent[] {
  try {
    const raw = fs.readFileSync(path.join(eventsDir, `${sessionId}.jsonl`), 'utf-8');
    const events: AgentEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* torn write — skip line */ }
    }
    return events;
  } catch {
    return []; // no log for this session
  }
}

/** Mine the repo's session logs and refresh the cached suggestions. */
export async function analyzeRepo(opts: AnalyzeOptions): Promise<SkillSuggestion[]> {
  const minSessions = opts.minSessions ?? 3;
  const sessionIds = opts.sessionIds.slice(-1 * (opts.maxSessions ?? 30));
  const activities = sessionIds
    .map((id) => extractActivity(id, readEventLog(opts.eventsDir, id)))
    .filter((a) => a.prompts.length > 0 || a.bashCommands.length > 0);

  const candidates = findPatterns(activities, minSessions);
  let suggestions = candidates.map(suggestionFromPattern);

  if (candidates.length > 0 && opts.generateText) {
    try {
      const distilled = await distillSuggestions(opts.generateText, candidates, opts.repoPath);
      if (distilled && distilled.length > 0) suggestions = distilled;
    } catch (err) {
      logger.warn('[skill-suggestions] distillation failed — using heuristic drafts:', err);
    }
  }

  const cache = loadSkillSuggestionCache(opts.repoPath);
  const dismissed = new Set(cache?.dismissedIds ?? []);
  suggestions = filterCovered(suggestions, opts.existingSkills)
    .filter((s) => !dismissed.has(s.id));

  saveSkillSuggestionCache(opts.repoPath, {
    suggestions,
    dismissedIds: [...dismissed],
    analyzedAt: Date.now(),
  });
  return suggestions;
}

export function getCachedSuggestions(repoPath: string): SkillSuggestion[] {
  return loadSkillSuggestionCache(repoPath)?.suggestions ?? [];
}

export function dismissSuggestion(repoPath: string, suggestionId: string): void {
  const cache = loadSkillSuggestionCache(repoPath) ?? { suggestions: [], dismissedIds: [], analyzedAt: 0 };
  if (!cache.dismissedIds.includes(suggestionId)) cache.dismissedIds.push(suggestionId);
  cache.suggestions = cache.suggestions.filter((s) => s.id !== suggestionId);
  saveSkillSuggestionCache(repoPath, cache);
}
