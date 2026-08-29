import { git } from './git.js';
import type { AgentAdapter } from './adapters/types.js';

/** Cap on the staged patch included in the prompt — the --stat summary always
 *  goes in full, so a truncated patch still yields a usable message. */
const MAX_DIFF_CHARS = 40_000;

const GENERATION_TIMEOUT_MS = 60_000;

export const COMMIT_MESSAGE_SYSTEM_PROMPT = `You write git commit messages.

Given the staged diff, respond with exactly one commit message for it:
- First line: an imperative summary of at most 72 characters. Match the style of the repo's recent commit subjects when they are shown (e.g. keep using "feat:"/"fix:" prefixes if the repo does).
- For a non-trivial change, add a blank line and a short body — 2 to 5 lines of prose or bullets explaining what changed and why.
- Describe the change itself, not the files touched.

Output ONLY the commit message text. No markdown fences, no surrounding quotes, no commentary before or after.`;

/** Assemble the user message: recent subjects (style guide), stat summary, and the patch. */
export function buildCommitPrompt(stat: string, diff: string, recentSubjects: string[]): string {
  const parts: string[] = [];
  if (recentSubjects.length > 0) {
    parts.push(`Recent commit subjects in this repo:\n${recentSubjects.map((s) => `- ${s}`).join('\n')}`);
  }
  parts.push(`Staged changes summary:\n${stat.trim()}`);
  const patch = diff.length > MAX_DIFF_CHARS
    ? `${diff.slice(0, MAX_DIFF_CHARS)}\n... (diff truncated)`
    : diff;
  parts.push(`Staged diff:\n${patch}`);
  parts.push('Write the commit message for these staged changes.');
  return parts.join('\n\n');
}

/** Strip fences/quotes/labels a model might wrap the message in. */
export function cleanCommitMessage(raw: string): string {
  let msg = raw.trim();
  // Fenced block — keep only its contents
  const fence = msg.match(/^```[a-z]*\n([\s\S]*?)\n?```$/);
  if (fence) msg = fence[1].trim();
  // "Commit message:" style prefix on its own line
  msg = msg.replace(/^commit message:?\s*\n?/i, '').trim();
  // Fully quoted single-line output
  const quoted = msg.match(/^"([^"\n]+)"$/);
  if (quoted) msg = quoted[1].trim();
  return msg;
}

/** Generate a commit message for the staged changes via the adapter's text generation. */
export async function generateCommitMessage(worktreePath: string, adapter: AgentAdapter): Promise<string> {
  if (!adapter.generateText) {
    throw new Error(`The ${adapter.displayName} agent does not support text generation`);
  }

  const diff = await git(['diff', '--cached'], worktreePath);
  if (!diff.trim()) throw new Error('No staged changes to describe');
  const stat = await git(['diff', '--cached', '--stat'], worktreePath);
  const recentSubjects = await git(['log', '-10', '--format=%s'], worktreePath)
    .then((out) => out.split('\n').map((s) => s.trim()).filter(Boolean))
    .catch(() => [] as string[]); // e.g. repo with no commits yet

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), GENERATION_TIMEOUT_MS);
  try {
    const raw = await adapter.generateText(
      COMMIT_MESSAGE_SYSTEM_PROMPT,
      buildCommitPrompt(stat, diff, recentSubjects),
      { cwd: worktreePath, abortSignal: abortController.signal },
    );
    const message = cleanCommitMessage(raw);
    if (!message) throw new Error('The agent returned an empty commit message');
    return message;
  } finally {
    clearTimeout(timeout);
  }
}
