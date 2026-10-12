import { z } from 'zod';
import { runProcess } from './process-host.js';
import { git, resolveMergeBase } from './git.js';
import { prFilePatches, prHeadAndBase, prSubmitReview, type GhReviewComment } from './gh.js';
import type { PrReviewLineComment, PrReviewSubmit, PrReviewSubmitResult } from '../shared/types.js';

/**
 * Posting a review from the Changes tab's Branch view to the thread's PR.
 *
 * The line comments were written against the local branch, so before one is
 * placed on its line two things are checked: the file is the same as on the
 * PR's latest commit (base side: the same merge base), and the lines are in
 * the PR's diff, which is all GitHub accepts. A comment that fails either
 * check is quoted in the review summary instead, so it is never dropped and
 * never lands on the wrong line.
 */

const lineComment = z.object({
  filePath: z.string().min(1).refine(isRepoRelative, 'Invalid file path'),
  side: z.enum(['old', 'new']),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  snippet: z.string(),
  body: z.string().trim().min(1),
});

const reviewRequest = z.object({
  prNumber: z.number().int().positive(),
  event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
  body: z.string(),
  base: z.string().optional(),
  comments: z.array(lineComment),
});

/** The renderer's request, checked. Throws a readable error when malformed. */
export function parsePrReviewSubmit(input: unknown): PrReviewSubmit {
  const parsed = reviewRequest.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid review: ${parsed.error.issues[0]?.message ?? 'bad request'}`);
  return parsed.data;
}

function isRepoRelative(p: string): boolean {
  const norm = p.replace(/\\/g, '/');
  return !norm.startsWith('/') && !/^[a-zA-Z]:/.test(norm) && !norm.split('/').includes('..');
}

/** The lines a comment can sit on in one file's patch, per side, each mapped
 *  to the hunk it's in (a range must stay inside one hunk). */
export interface CommentableLines {
  old: Map<number, number>;
  new: Map<number, number>;
}

export function commentableLines(patch: string): CommentableLines {
  const old = new Map<number, number>();
  const neu = new Map<number, number>();
  let hunk = -1;
  let o = 0;
  let n = 0;
  for (const line of patch.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      hunk++;
      o = Number(header[1]);
      n = Number(header[2]);
      continue;
    }
    if (hunk < 0) continue;
    // "\ No newline at end of file" and blank trailing lines aren't lines.
    if (line[0] === '+') neu.set(n++, hunk);
    else if (line[0] === '-') old.set(o++, hunk);
    else if (line[0] === ' ') {
      old.set(o++, hunk);
      neu.set(n++, hunk);
    }
  }
  return { old, new: neu };
}

/** The comment as GitHub takes it, or null when its lines aren't all in one
 *  hunk of the PR's diff on that side. */
export function inlineComment(c: PrReviewLineComment, lines: CommentableLines): GhReviewComment | null {
  const onSide = lines[c.side];
  const start = Math.min(c.startLine, c.endLine);
  const end = Math.max(c.startLine, c.endLine);
  const hunk = onSide.get(end);
  if (hunk === undefined) return null;
  // Within a hunk each side's line numbers run without gaps, so both ends in
  // the same hunk means every line between is in it too.
  if (start !== end && onSide.get(start) !== hunk) return null;
  const side = c.side === 'new' ? 'RIGHT' : 'LEFT';
  return {
    path: c.filePath,
    body: c.body,
    line: end,
    side,
    ...(start !== end ? { start_line: start, start_side: side } : {}),
  };
}

/** A fence longer than any run of backticks in `text`, so code can't close it. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** The summary, followed by the comments that couldn't go on their lines,
 *  each with the lines it was about. */
export function buildReviewBody(summary: string, quoted: PrReviewLineComment[]): string {
  const parts = summary.trim() ? [summary.trim()] : [];
  if (quoted.length > 0) {
    const items = quoted.map((c) => {
      const start = Math.min(c.startLine, c.endLine);
      const end = Math.max(c.startLine, c.endLine);
      const lines = start === end ? `line ${end}` : `lines ${start}-${end}`;
      const where = `\`${c.filePath}\` ${lines}${c.side === 'old' ? ' (before the change)' : ''}`;
      const fence = fenceFor(c.snippet);
      const quote = c.snippet ? `${fence}\n${c.snippet}\n${fence}\n\n` : '';
      return `**${where}**\n\n${quote}${c.body.trim()}`;
    });
    parts.push(`Line comments that couldn't go on their lines:\n\n${items.join('\n\n')}`);
  }
  return parts.join('\n\n---\n\n');
}

/** The blob for `filePath` at `rev`, or null when it isn't there (or `rev`
 *  isn't in this clone). */
async function blobAt(cwd: string, rev: string, filePath: string): Promise<string | null> {
  try {
    return (await git(['rev-parse', '--verify', '--quiet', `${rev}:${filePath}`], cwd)).trim() || null;
  } catch {
    return null;
  }
}

/** The blob the working-tree file would be if committed (line endings
 *  normalised as git would), or null when it doesn't exist. */
async function workingBlob(cwd: string, filePath: string): Promise<string | null> {
  const result = await runProcess('git', ['hash-object', '--', filePath], { cwd, reject: false });
  return result.exitCode === 0 ? result.stdout.trim() || null : null;
}

/** Whether each side of a file in the Branch view matches the PR's diff, so
 *  line numbers mean the same lines. Each answer is worked out once. */
function contentChecker(cwd: string, pr: { headSha: string; baseSha: string }, base: string | undefined) {
  const cache = new Map<string, Promise<boolean>>();
  let mergeBases: Promise<{ ours: string | null; theirs: string | null }> | null = null;

  function getMergeBases() {
    mergeBases ??= Promise.all([
      base ? resolveMergeBase(cwd, base).then((mb) => mb?.mergeBase ?? null).catch(() => null) : Promise.resolve(null),
      git(['merge-base', pr.baseSha, pr.headSha], cwd).then((s) => s.trim() || null).catch(() => null),
    ]).then(([ours, theirs]) => ({ ours, theirs }));
    return mergeBases;
  }

  async function check(filePath: string, side: 'old' | 'new'): Promise<boolean> {
    if (side === 'new') {
      const [local, onPr] = await Promise.all([workingBlob(cwd, filePath), blobAt(cwd, pr.headSha, filePath)]);
      return local !== null && local === onPr;
    }
    const { ours, theirs } = await getMergeBases();
    if (!ours || !theirs) return false;
    if (ours === theirs) return true;
    const [a, b] = await Promise.all([blobAt(cwd, ours, filePath), blobAt(cwd, theirs, filePath)]);
    return a !== null && a === b;
  }

  return (filePath: string, side: 'old' | 'new'): Promise<boolean> => {
    const key = `${side}:${filePath}`;
    let answer = cache.get(key);
    if (!answer) {
      answer = check(filePath, side);
      cache.set(key, answer);
    }
    return answer;
  };
}

/** Post the review. Comments go on their lines where the checks above allow,
 *  and into the summary otherwise. */
export async function submitPrReview(worktreePath: string, repoPath: string, req: PrReviewSubmit): Promise<PrReviewSubmitResult> {
  const inline: GhReviewComment[] = [];
  const quoted: PrReviewLineComment[] = [];
  let commitId: string | undefined;

  if (req.comments.length > 0) {
    // Read fresh: the PR may have moved on since the last poll.
    const pr = await prHeadAndBase(repoPath, req.prNumber);
    commitId = pr.headSha;
    const patches = await prFilePatches(repoPath, req.prNumber);
    const sameContent = contentChecker(worktreePath, pr, req.base);
    const linesByPath = new Map<string, CommentableLines>();
    for (const c of req.comments) {
      const patch = patches.get(c.filePath);
      let placed: GhReviewComment | null = null;
      if (patch && (await sameContent(c.filePath, c.side))) {
        let lines = linesByPath.get(c.filePath);
        if (!lines) {
          lines = commentableLines(patch);
          linesByPath.set(c.filePath, lines);
        }
        placed = inlineComment(c, lines);
      }
      if (placed) inline.push(placed);
      else quoted.push(c);
    }
  }

  const body = buildReviewBody(req.body, quoted);
  if (req.event !== 'APPROVE' && !body) throw new Error('Write a summary to comment or request changes');
  const { url } = await prSubmitReview(repoPath, req.prNumber, { event: req.event, body, commitId, comments: inline });
  return { url, inline: inline.length, quoted: quoted.length };
}
