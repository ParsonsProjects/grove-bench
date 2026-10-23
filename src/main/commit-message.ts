import { git, gitPatch } from './git.js';
import type { AgentAdapter } from './adapters/types.js';
import { assertTextGeneration, generateBackgroundText, unwrapFence } from './background-text.js';

/** Cap on the staged patch included in the prompt. The --stat summary goes in
 *  too, so a patch with files left out still yields a usable message. */
const MAX_DIFF_CHARS = 40_000;
/** The --stat summary lists at most this many files (then "..." and the totals). */
const MAX_STAT_FILES = 500;
/** A staged diff over gitPatch's limit (MAX_TEXT_FILE_BYTES) is read again
 *  without its largest files until the rest has at most this many changed
 *  lines, which at 100 characters a line is half that limit. */
const MAX_REREAD_LINES = 20_000;
/** At most this many paths left out on one git command line, as
 *  attachNumstat keeps to, well inside Windows' 32,767 characters. */
const MAX_EXCLUDED_PATHS = 200;
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
      parts.push(`Left out of the diff below to keep it short: ${named}${more}`);
    }
    parts.push(`Staged diff:\n${diff}`);
  }
  parts.push('Write the commit message for these staged changes.');
  return parts.join('\n\n');
}

/** `git diff --cached` as the model should see it, whatever the user's git
 *  config: no colour, no external diff tool, and no textconv, which runs a
 *  program on the content (git-crypt's decrypts it, which mustn't be sent
 *  to a model); renames found, and the a/ b/ prefixes fileOf reads. */
const STAGED_DIFF = ['diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames', '--src-prefix=a/', '--dst-prefix=b/'];

/**
 * The staged diff for the prompt, fitted to MAX_DIFF_CHARS by fitDiff. Read
 * once, with git stopped past gitPatch's limit. A diff over it is read again
 * without the files with the most changed lines (which fitDiff would have
 * cut or left out), so the smaller changes beside a rewritten lockfile
 * still show.
 */
export async function stagedDiff(cwd: string): Promise<PromptDiff> {
  const patch = await gitPatch(STAGED_DIFF, cwd);
  if (patch !== null) return fitDiff(patch);
  const files = (await git(['diff', '--cached', '--no-renames', '--numstat', '-z'], cwd))
    .split('\0').filter(Boolean)
    .map((record) => {
      const [added, deleted, ...name] = record.split('\t');
      return { path: name.join('\t'), lines: (Number(added) || 0) + (Number(deleted) || 0) };
    })
    .sort((a, b) => b.lines - a.lines);
  let lines = files.reduce((sum, f) => sum + f.lines, 0);
  const without: string[] = [];
  for (const f of files) {
    if (lines <= MAX_REREAD_LINES || without.length === MAX_EXCLUDED_PATHS) break;
    without.push(f.path);
    lines -= f.lines;
  }
  // :(top), as numstat's paths are from the top of the repo; :(literal), so
  // a name such as a[1].ts doesn't also leave out a1.ts.
  const rest = without.length > 0
    ? await gitPatch([...STAGED_DIFF, '--', ...without.map((path) => `:(top,exclude,literal)${path}`)], cwd)
    : null;
  if (rest === null) return { diff: '', left: [], overLimit: true };
  const fitted = fitDiff(rest);
  return { diff: fitted.diff, left: [...without, ...fitted.left] };
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
  // At each "diff --git" after a newline (not after a lone \r, which ^ with m would allow).
  const files = patch.split(/(?<=\n)(?=diff --git )/);
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

/** The file a section of a patch is about: its path, or "old → new" for a
 *  renamed file. Git quotes a name with unusual characters, which is left
 *  as git writes it. */
function fileOf(section: string): string {
  const end = section.indexOf('\n');
  const header = end === -1 ? section : section.slice(0, end);
  const same = /^diff --git a\/(.*) b\/\1$/.exec(header);
  if (same) return same[1];
  const from = /^rename from (.*)$/m.exec(section);
  const to = /^rename to (.*)$/m.exec(section);
  return from && to ? `${from[1]} → ${to[1]}` : header.replace(/^diff --git /, '');
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

  // Together: when nothing is staged, the diff is empty and quick.
  const [stat, diff, recentSubjects] = await Promise.all([
    git(['diff', '--cached', '--no-color', '--stat', `--stat-count=${MAX_STAT_FILES}`], worktreePath),
    stagedDiff(worktreePath),
    git(['log', '-10', '--format=%s'], worktreePath)
      .then((out) => out.split('\n').map((s) => s.trim()).filter(Boolean))
      .catch(() => [] as string[]), // e.g. repo with no commits yet
  ]);
  if (!stat.trim()) throw new Error('No staged changes to describe');

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
