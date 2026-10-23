import { git, gitPatch, MAX_TEXT_FILE_BYTES } from './git.js';
import type { AgentAdapter } from './adapters/types.js';
import { assertTextGeneration, generateBackgroundText, unwrapFence } from './background-text.js';

/** Cap on the staged patch included in the prompt — the --stat summary lists
 *  every file, so a patch with files left out still yields a usable message. */
const MAX_DIFF_CHARS = 40_000;
/** The --stat summary lists at most this many files (then "..." and the totals). */
const MAX_STAT_FILES = 500;
/** A file's diff is cut short to fit only when at least this much room is left. */
const MIN_CUT_CHARS = 2_000;
/** The prompt names at most this many of the files left out. */
const MAX_LEFT_NAMED = 20;

export const COMMIT_MESSAGE_SYSTEM_PROMPT = `You write git commit messages.

Given the staged diff, respond with exactly one commit message for it:
- First line: an imperative summary of at most 72 characters. Match the style of the repo's recent commit subjects when they are shown (e.g. keep using "feat:"/"fix:" prefixes if the repo does).
- For a non-trivial change, add a blank line and a short body — 2 to 5 lines of prose or bullets explaining what changed and why.
- Describe the change itself, not the files touched.

Output ONLY the commit message text. No markdown fences, no surrounding quotes, no commentary before or after.`;

/** What of the staged diff goes in the prompt (stagedDiff, fitDiff). */
export interface PromptDiff {
  diff: string;
  /** Files whose diff is left out to keep the prompt short. */
  left: string[];
  /** The whole diff was over MAX_TEXT_FILE_BYTES, so none of it was read. */
  overLimit?: boolean;
}

/** Assemble the user message: recent subjects (style guide), stat summary,
 *  and the patch, saying what was left out of it. */
export function buildCommitPrompt(stat: string, { diff, left, overLimit }: PromptDiff, recentSubjects: string[]): string {
  const parts: string[] = [];
  if (recentSubjects.length > 0) {
    parts.push(`Recent commit subjects in this repo:\n${recentSubjects.map((s) => `- ${s}`).join('\n')}`);
  }
  parts.push(`Staged changes summary:\n${stat.trim()}`);
  if (overLimit) {
    parts.push('The staged diff is too large to include, so describe the change from the summary above.');
  } else {
    if (left.length > 0) {
      const named = left.slice(0, MAX_LEFT_NAMED).join(', ');
      const more = left.length > MAX_LEFT_NAMED ? ` and ${left.length - MAX_LEFT_NAMED} more` : '';
      parts.push(`Left out of the diff below to keep it short (the summary above counts their lines): ${named}${more}`);
    }
    parts.push(`Staged diff:\n${diff}`);
  }
  parts.push('Write the commit message for these staged changes.');
  return parts.join('\n\n');
}

/**
 * The staged diff for the prompt. Read once, with git stopped past
 * MAX_TEXT_FILE_BYTES, and fitted to MAX_DIFF_CHARS by fitDiff. Colour and
 * external diff tools are off, whatever the user's git config says.
 */
export async function stagedDiff(cwd: string): Promise<PromptDiff> {
  const patch = await gitPatch(['diff', '--cached', '--no-color', '--no-ext-diff'], cwd);
  return patch === null ? { diff: '', left: [], overLimit: true } : fitDiff(patch);
}

/**
 * A patch fitted to `room` characters, a file at a time. Git lists files by
 * path, so a patch cut at the limit could be one large file (a lockfile
 * sorts before src/). This keeps whole files' diffs, the shortest first, and
 * cuts the next one short to the room left, so a change that is one large
 * file still shows how it starts. Files keep git's order.
 */
export function fitDiff(patch: string, room = MAX_DIFF_CHARS): PromptDiff {
  if (patch.length <= room) return { diff: patch, left: [] };
  const files = patch.split(/^(?=diff --git )/m);
  const shortestFirst = files.map((text, i) => ({ text, i })).sort((a, b) => a.text.length - b.text.length);
  const shown = new Map<number, string>();
  for (const { text, i } of shortestFirst) {
    if (text.length <= room) {
      shown.set(i, text);
      room -= text.length;
      continue;
    }
    const cut = '\n... (cut short)\n';
    if (room >= MIN_CUT_CHARS) shown.set(i, text.slice(0, room - cut.length) + cut);
    break;
  }
  return {
    diff: files.map((_, i) => shown.get(i) ?? '').join(''),
    left: files.filter((_, i) => !shown.has(i)).map(fileOf),
  };
}

/** The file a section of a patch is about, from its "diff --git" line. */
function fileOf(section: string): string {
  const end = section.indexOf('\n');
  const header = (end === -1 ? section : section.slice(0, end)).replace(/^diff --git /, '');
  // "a/<path> b/<path>": the same path twice, unless the file was renamed.
  const length = (header.length - 5) / 2;
  const path = header.slice(2, 2 + length);
  return Number.isInteger(length) && header === `a/${path} b/${path}` ? path : header;
}

/** Strip fences/quotes/labels a model might wrap the message in. */
export function cleanCommitMessage(raw: string): string {
  // Fenced block — keep only its contents
  let msg = unwrapFence(raw.trim());
  // "Commit message:" style prefix on its own line
  msg = msg.replace(/^commit message:?\s*\n?/i, '').trim();
  // Fully quoted single-line output
  const quoted = msg.match(/^"([^"\n]+)"$/);
  if (quoted) msg = quoted[1].trim();
  return msg;
}

/** Generate a commit message for the staged changes via the adapter's text generation. */
export async function generateCommitMessage(worktreePath: string, adapter: AgentAdapter): Promise<string> {
  assertTextGeneration(adapter);

  const stat = await git(['diff', '--cached', '--no-color', '--stat', `--stat-count=${MAX_STAT_FILES}`], worktreePath);
  if (!stat.trim()) throw new Error('No staged changes to describe');
  const [diff, recentSubjects] = await Promise.all([
    stagedDiff(worktreePath),
    git(['log', '-10', '--format=%s'], worktreePath)
      .then((out) => out.split('\n').map((s) => s.trim()).filter(Boolean))
      .catch(() => [] as string[]), // e.g. repo with no commits yet
  ]);

  const raw = await generateBackgroundText(
    adapter,
    COMMIT_MESSAGE_SYSTEM_PROMPT,
    buildCommitPrompt(stat, diff, recentSubjects),
    worktreePath,
  );
  const message = cleanCommitMessage(raw);
  if (!message) throw new Error('The agent returned an empty commit message');
  return message;
}
