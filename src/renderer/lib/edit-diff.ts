import { createPatch } from 'diff';
import type { DiffLine } from './diff-types.js';
import type { ToolView, ToolTextEdit } from '../../shared/tool-view.js';
import { diffSize, editSize, isLargeDiff } from './diff-highlight.js';
import { parseDiffLines } from './diff-parse.js';

/**
 * Diff lines for an edit call (see shared/tool-view.ts), worked out within
 * limits. createPatch slows down with how much changed, not with file size:
 * in Node, a heavy change to 20,000 lines took over a minute, and the
 * window is frozen while it runs. quickEditDiff decides whether an edit
 * waits for "Show edit"; fullEditDiff works it out once asked.
 */

/** How far quickEditDiff goes on an edit with large text: changed lines
 *  (jsdiff's maxEditLength), then milliseconds. ACP agents can send the
 *  whole file before and after; a small change to one diffs in a few
 *  milliseconds, while a heavy change to 20,000 lines gives up in about 40. */
const QUICK_EDIT_LENGTH = 500;
const QUICK_DIFF_MS = 50;

/** How long fullEditDiff works on an edit call, all its replacements
 *  together. In Node, a rewrite of 2,000 lines took about a second to
 *  diff; of 10,000, 28 s. */
const FULL_DIFF_MS = 1000;

/** What a shown edit says when it is the old text, then the new. */
export const OLD_THEN_NEW = 'Too many changes to compare line by line, so this shows the old text, then the new.';

/** An edit's diff, ready to draw. `linedUp` is false when it had too many
 *  changes to work out in time, so `lines` are the old text, then the new. */
export interface EditDiff { lines: DiffLine[]; linedUp: boolean }

/**
 * An edit's diff lines, and whether they're large enough to wait for
 * "Show edit" (isLargeDiff). An edit with large text (editSize) is diffed
 * with capped effort first. `lines` is null when they weren't worked out
 * (a large write, or the cap was hit): fullEditDiff works them out once
 * asked.
 */
export function quickEditDiff(view: ToolView, filePath: string): { lines: DiffLine[] | null; large: boolean } {
  // A diff is no bigger than the text it's made from.
  if (!isLargeDiff(editSize(view))) return { lines: diffLinesOf(view, filePath), large: false };
  // A write's rows are its text.
  if (!view.edits?.length) return { lines: null, large: true };
  const lines = patchLines(view.edits, filePath, { maxEditLength: QUICK_EDIT_LENGTH, ms: QUICK_DIFF_MS });
  return { lines, large: !lines || isLargeDiff(diffSize(lines)) };
}

/** A held-back edit's diff once asked for: the lines quickEditDiff already
 *  worked out, else worked out in full. Past FULL_DIFF_MS it's the old text,
 *  then the new, which takes no time to work out. "Show edit" warns of a
 *  pause, not a window frozen for a minute. */
export function fullEditDiff(view: ToolView, filePath: string, known: DiffLine[] | null): EditDiff {
  if (known) return { lines: known, linedUp: true };
  if (!view.edits?.length) return { lines: diffLinesOf(view, filePath), linedUp: true };
  const lines = patchLines(view.edits, filePath, { ms: FULL_DIFF_MS });
  return lines ? { lines, linedUp: true } : { lines: oldThenNew(view.edits), linedUp: false };
}

/** Diff lines for an edit call with no time limit: each replacement as a
 *  patch, or a whole-file write as added lines. Only for an edit whose
 *  text is under the large-diff limits. */
function diffLinesOf(view: ToolView, filePath: string): DiffLine[] {
  if (view.edits?.length) return patchLines(view.edits, filePath, { ms: Infinity }) ?? [];
  if (!view.write) return [];
  return view.write.split('\n').map((line, i) => ({ type: 'add' as const, text: line, lineNum: i + 1 }));
}

/** Each replacement as a patch's diff lines, or null once they take longer
 *  than `ms` together, or one needs more than `maxEditLength` changed lines.
 *  jsdiff's clock starts after it splits the text into lines, so a huge
 *  edit can run a little over. */
function patchLines(edits: ToolTextEdit[], filePath: string, limits: { maxEditLength?: number; ms: number }): DiffLine[] | null {
  const deadline = performance.now() + limits.ms;
  const out: DiffLine[] = [];
  for (const edit of edits) {
    if (!edit.oldText && !edit.newText) continue;
    const timeout = deadline - performance.now();
    if (timeout <= 0) return null;
    const patch = createPatch(filePath || 'file', edit.oldText, edit.newText, '', '', { context: 3, timeout, maxEditLength: limits.maxEditLength });
    if (patch === undefined) return null;
    // One at a time: spreading 130,000 or so into push() overflows the stack.
    for (const line of parseDiffLines(patch)) out.push(line);
  }
  return out;
}

/** Each replacement as all of its old lines, then all of its new. */
function oldThenNew(edits: ToolTextEdit[]): DiffLine[] {
  const out: DiffLine[] = [];
  for (const edit of edits) {
    const oldLines = textLines(edit.oldText);
    const newLines = textLines(edit.newText);
    if (!oldLines.length && !newLines.length) continue;
    out.push({ type: 'hunk', text: `@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@` });
    oldLines.forEach((text, i) => out.push({ type: 'del', text, lineNum: i + 1, oldLineNum: i + 1 }));
    newLines.forEach((text, i) => out.push({ type: 'add', text, lineNum: i + 1, newLineNum: i + 1 }));
  }
  return out;
}

/** A text's lines, as a patch counts them: a final newline ends the last
 *  line rather than starting another. */
function textLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
