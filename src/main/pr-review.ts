import { z } from 'zod';
import { git } from './git.js';
import { prFilePatches, prHeadSha, prSubmitReview, type GhReviewComment } from './gh.js';
import type { PrReviewLineComment, PrReviewSubmit, PrReviewSubmitResult } from '../shared/types.js';

/**
 * Posting a review from the Changes tab's Branch view to the thread's PR.
 *
 * Line comments were written against the local branch, and may be older than
 * its latest commits. One goes on its line only when the PR's own diff has
 * those lines in one hunk with the same text the comment was written on;
 * GitHub only takes lines in its diff, and the text check stops a comment
 * whose lines have moved since from landing on other code. Any other comment
 * is quoted in the review summary, so it is never dropped and never lands on
 * the wrong line.
 *
 * An approval is pinned to the PR's head commit, and only made when that is
 * the commit checked out here: approving should cover what was reviewed.
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

/** One line of a patch a comment can sit on: the hunk it's in, and its text. */
interface PatchLine {
  hunk: number;
  text: string;
}

/** The lines a comment can sit on in one file's patch, per side. */
export interface CommentableLines {
  old: Map<number, PatchLine>;
  new: Map<number, PatchLine>;
}

/** Line text without a CRLF file's carriage return, so both sides compare alike. */
function lineText(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

export function commentableLines(patch: string): CommentableLines {
  const old = new Map<number, PatchLine>();
  const neu = new Map<number, PatchLine>();
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
    const text = lineText(line.slice(1));
    if (line[0] === '+') neu.set(n++, { hunk, text });
    else if (line[0] === '-') old.set(o++, { hunk, text });
    else if (line[0] === ' ') {
      old.set(o++, { hunk, text });
      neu.set(n++, { hunk, text });
    }
  }
  return { old, new: neu };
}

/** The comment as GitHub takes it, or null when its lines aren't all in one
 *  hunk of the PR's diff on that side, or don't read as they did when the
 *  comment was written. */
export function inlineComment(c: PrReviewLineComment, lines: CommentableLines): GhReviewComment | null {
  const onSide = lines[c.side];
  const start = Math.min(c.startLine, c.endLine);
  const end = Math.max(c.startLine, c.endLine);
  const wrote = c.snippet.split('\n').map(lineText);
  if (wrote.length !== end - start + 1) return null;
  let hunk: number | undefined;
  for (let n = start; n <= end; n++) {
    const line = onSide.get(n);
    if (!line || line.text !== wrote[n - start]) return null;
    if (hunk !== undefined && line.hunk !== hunk) return null;
    hunk = line.hunk;
  }
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

/** Post the review. Comments go on their lines where the PR's diff allows,
 *  and into the summary otherwise. */
export async function submitPrReview(worktreePath: string, repoPath: string, req: PrReviewSubmit): Promise<PrReviewSubmitResult> {
  // GitHub needs a body to comment or request changes.
  if (req.event !== 'APPROVE' && !req.body.trim()) throw new Error('Write a summary to comment or request changes');
  // Read fresh: the PR may have moved on since the last poll.
  const [headSha, patches, localHead] = await Promise.all([
    prHeadSha(repoPath, req.prNumber),
    req.comments.length > 0 ? prFilePatches(repoPath, req.prNumber) : Promise.resolve(new Map<string, string | null>()),
    req.event === 'APPROVE' ? git(['rev-parse', 'HEAD'], worktreePath).then((s) => s.trim()) : Promise.resolve(''),
  ]);
  if (req.event === 'APPROVE' && localHead !== headSha) {
    throw new Error(
      `This checkout is at ${localHead.slice(0, 7)} but PR #${req.prNumber} is at ${headSha.slice(0, 7)}. ` +
      'Push or pull until they match, so the approval covers what you reviewed.',
    );
  }

  const inline: GhReviewComment[] = [];
  const quoted: PrReviewLineComment[] = [];
  const linesByPath = new Map<string, CommentableLines>();
  for (const c of req.comments) {
    const patch = patches.get(c.filePath);
    let placed: GhReviewComment | null = null;
    if (patch) {
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

  const body = buildReviewBody(req.body, quoted);
  const { url } = await prSubmitReview(repoPath, req.prNumber, { event: req.event, body, commitId: headSha, comments: inline });
  return { url, inline: inline.length, quoted: quoted.length };
}
