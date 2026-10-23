import { git, gitPatch } from './git.js';
import type { AgentAdapter } from './adapters/types.js';
import { assertTextGeneration, generateBackgroundText, unwrapFence } from './background-text.js';

/** Cap on the staged patch included in the prompt — the --stat summary always
 *  goes in full, so a patch with files left out still yields a usable message. */
const MAX_DIFF_CHARS = 40_000;
/** At most this many paths on one git command line, as attachNumstat keeps
 *  to, well inside Windows' 32,767 characters. */
const MAX_DIFF_PATHS = 200;
/** The prompt names at most this many of the files left out. */
const MAX_LEFT_NAMED = 20;

export const COMMIT_MESSAGE_SYSTEM_PROMPT = `You write git commit messages.

Given the staged diff, respond with exactly one commit message for it:
- First line: an imperative summary of at most 72 characters. Match the style of the repo's recent commit subjects when they are shown (e.g. keep using "feat:"/"fix:" prefixes if the repo does).
- For a non-trivial change, add a blank line and a short body — 2 to 5 lines of prose or bullets explaining what changed and why.
- Describe the change itself, not the files touched.

Output ONLY the commit message text. No markdown fences, no surrounding quotes, no commentary before or after.`;

/** Assemble the user message: recent subjects (style guide), stat summary,
 *  the files left out of the patch (stagedDiff), and the patch. */
export function buildCommitPrompt(stat: string, diff: string, recentSubjects: string[], left: string[] = []): string {
  const parts: string[] = [];
  if (recentSubjects.length > 0) {
    parts.push(`Recent commit subjects in this repo:\n${recentSubjects.map((s) => `- ${s}`).join('\n')}`);
  }
  parts.push(`Staged changes summary:\n${stat.trim()}`);
  if (left.length > 0) {
    const named = left.slice(0, MAX_LEFT_NAMED).join(', ');
    const more = left.length > MAX_LEFT_NAMED ? ` and ${left.length - MAX_LEFT_NAMED} more` : '';
    parts.push(`Left out of the diff below, too large to include (the summary above counts their lines): ${named}${more}`);
  }
  parts.push(`Staged diff:\n${diff}`);
  parts.push('Write the commit message for these staged changes.');
  return parts.join('\n\n');
}

/**
 * The staged diff for the prompt, at most MAX_DIFF_CHARS, and the files left
 * out of it. Git lists files by path, so the whole diff cut short could be
 * one large file (a lockfile sorts before src/). Past the limit, this diffs
 * as many files as fit, those with the fewest changed lines first, found in
 * a few git runs. Git is stopped at the limit each time.
 */
export async function stagedDiff(cwd: string): Promise<{ diff: string; left: string[] }> {
  const whole = await gitPatch(['diff', '--cached'], cwd, MAX_DIFF_CHARS);
  if (whole !== null) return { diff: whole, left: [] };
  // -z and no renames: one raw path per file, which a pathspec can name.
  const files = (await git(['diff', '--cached', '--no-renames', '--numstat', '-z'], cwd))
    .split('\0').filter(Boolean)
    .map((record) => {
      const [added, deleted, ...name] = record.split('\t');
      const path = name.join('\t');
      // Its diff is at least "diff --git a/<path> b/<path>" and two characters
      // ("+" and a newline) per changed line. Binary files count "-".
      return { path, least: 2 * path.length + 16 + 2 * ((Number(added) || 0) + (Number(deleted) || 0)) };
    });
  let total = 0;
  const picked = [...files].sort((a, b) => a.least - b.least)
    .filter((f) => (total += f.least) <= MAX_DIFF_CHARS)
    .slice(0, MAX_DIFF_PATHS);
  // The first `fit` of them make a diff that fits; more than `under` don't.
  // A diff only grows with each file added, so try them all, then search.
  let fit = 0;
  let under = picked.length;
  let diff = '';
  for (let n = under; fit < under; n = Math.ceil((fit + under) / 2)) {
    // :(literal), so a name such as a[1].ts doesn't match a1.ts as a glob.
    const patch = await gitPatch(['diff', '--cached', '--no-renames', '--', ...picked.slice(0, n).map((f) => `:(literal)${f.path}`)], cwd, MAX_DIFF_CHARS);
    if (patch === null) under = n - 1;
    else { fit = n; diff = patch; }
  }
  const kept = new Set(picked.slice(0, fit));
  return { diff, left: files.filter((f) => !kept.has(f)).map((f) => f.path) };
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

  const stat = await git(['diff', '--cached', '--stat'], worktreePath);
  if (!stat.trim()) throw new Error('No staged changes to describe');
  const { diff, left } = await stagedDiff(worktreePath);
  const recentSubjects = await git(['log', '-10', '--format=%s'], worktreePath)
    .then((out) => out.split('\n').map((s) => s.trim()).filter(Boolean))
    .catch(() => [] as string[]); // e.g. repo with no commits yet

  const raw = await generateBackgroundText(
    adapter,
    COMMIT_MESSAGE_SYSTEM_PROMPT,
    buildCommitPrompt(stat, diff, recentSubjects, left),
    worktreePath,
  );
  const message = cleanCommitMessage(raw);
  if (!message) throw new Error('The agent returned an empty commit message');
  return message;
}
