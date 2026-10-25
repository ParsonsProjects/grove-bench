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

/** How far quickEditDiff goes on an edit: lines added or removed (jsdiff's
 *  maxEditLength, so a replaced line counts twice), then milliseconds. ACP
 *  agents can send the whole file before and after; a small change to one
 *  diffs in a few milliseconds, while a heavy change to 20,000 lines gives
 *  up in about 40. Under the large-diff limits only the time is capped:
 *  inserting 600 lines is 600 changes but takes a few milliseconds, while a
 *  rewrite of 1,000 lines gives up in 50 instead of taking 200 or more. */
const QUICK_EDIT_LENGTH = 500;
const QUICK_DIFF_MS = 50;

/** How long fullEditDiff works on an edit call, all its replacements
 *  together. In Node, a rewrite of 2,000 lines took about a second to
 *  diff; of 10,000, 28 s. */
const FULL_DIFF_MS = 1000;

/** An edit's diff, ready to draw. `linedUp` is false when a replacement had
 *  too many changes to work out in time, so its lines are the old text, then
 *  the new; `partly` when others in the edit were worked out. `quick` marks
 *  one only quickEditDiff gave up on: fullEditDiff with no known diff may
 *  still line it up ("Compare line by line"). */
export interface EditDiff { lines: DiffLine[]; linedUp: boolean; partly?: boolean; quick?: boolean }

/**
 * An edit's diff, worked out with capped effort, and whether it's large
 * enough to wait for "Show edit" (isLargeDiff). `diff` is null when it wasn't
 * worked out (a large write, or a large edit past the cap): fullEditDiff
 * works it out once asked. Under the large-diff limits, a replacement past
 * the cap is its old text, then its new, which is no bigger and takes no
 * time; the others keep their diffs.
 */
export function quickEditDiff(view: ToolView, filePath: string): { diff: EditDiff | null; large: boolean } {
  // A diff is no bigger than the text it's made from.
  const small = !isLargeDiff(editSize(view));
  if (!view.edits?.length) return small ? { diff: { lines: writeLines(view), linedUp: true }, large: false } : { diff: null, large: true };
  if (!small) {
    // Held back unless it all works out: "Show edit" works it out in full.
    const patched = patchLines(view.edits, filePath, { maxEditLength: QUICK_EDIT_LENGTH, ms: QUICK_DIFF_MS, allOrNothing: true });
    return patched ? { diff: patched, large: isLargeDiff(diffSize(patched.lines)) } : { diff: null, large: true };
  }
  const patched = patchLines(view.edits, filePath, { ms: QUICK_DIFF_MS });
  return { diff: patched.linedUp ? patched : { ...patched, quick: true }, large: false };
}

/** An edit's diff once shown: what quickEditDiff already worked out, else
 *  worked out in full (a held-back edit's "Show edit", or "Compare line by
 *  line" with `known` null). Past FULL_DIFF_MS it's the old text, then the
 *  new, which takes no time to work out. Both buttons warn of a pause, not
 *  a window frozen for a minute. */
export function fullEditDiff(view: ToolView, filePath: string, known: EditDiff | null): EditDiff {
  if (known) return known;
  if (!view.edits?.length) return { lines: writeLines(view), linedUp: true };
  return patchLines(view.edits, filePath, { ms: FULL_DIFF_MS });
}

/** A whole-file write's diff lines: all of it, added. */
function writeLines(view: ToolView): DiffLine[] {
  if (!view.write) return [];
  return view.write.split('\n').map((line, i) => ({ type: 'add' as const, text: line, lineNum: i + 1 }));
}

/** A replacement with no more than this on each side is diffed whatever the
 *  time left: in Node, 50 lines all changed took about half a millisecond
 *  (500, 45). So one heavy replacement can't leave the small ones after it
 *  undiffed, and a small edit is never shown as old-then-new. */
const CHEAP_LINES = 50;
const CHEAP_CHARS = 5000;

/** Each replacement as a patch's diff lines, within `ms` for them all and
 *  `maxEditLength` changed lines each. One past them is its old text, then
 *  its new, as is every one but a cheap one after the time is up (they
 *  aren't tried: jsdiff splits the text before its clock starts). The
 *  others keep their diffs. With `allOrNothing`, null instead. */
function patchLines(edits: ToolTextEdit[], filePath: string, limits: { maxEditLength?: number; ms: number; allOrNothing: true }): EditDiff | null;
function patchLines(edits: ToolTextEdit[], filePath: string, limits: { maxEditLength?: number; ms: number }): EditDiff;
function patchLines(edits: ToolTextEdit[], filePath: string, limits: { maxEditLength?: number; ms: number; allOrNothing?: true }): EditDiff | null {
  const deadline = performance.now() + limits.ms;
  const out: DiffLine[] = [];
  let anyLinedUp = false;
  let anyFellBack = false;
  let timeUp = false;
  for (const edit of edits) {
    // Nothing to show, and no reason to say a replacement was compared.
    if (edit.oldText === edit.newText) continue;
    const timeout = deadline - performance.now();
    if (timeout <= 0) timeUp = true;
    const patch = isCheap(edit) ? createPatch(filePath || 'file', edit.oldText, edit.newText, '', '', { context: 3 })
      : timeUp ? undefined
      : createPatch(filePath || 'file', edit.oldText, edit.newText, '', '', { context: 3, timeout, maxEditLength: limits.maxEditLength });
    if (patch === undefined) {
      if (limits.allOrNothing) return null;
      // Without allOrNothing there's no maxEditLength: the time ran out.
      timeUp = true;
      anyFellBack = true;
      oldThenNew(edit, out);
      continue;
    }
    anyLinedUp = true;
    // One at a time: spreading 130,000 or so into push() overflows the stack.
    for (const line of parseDiffLines(patch)) out.push(line);
  }
  return !anyFellBack ? { lines: out, linedUp: true } : { lines: out, linedUp: false, ...(anyLinedUp ? { partly: true } : {}) };
}

function isCheap(edit: ToolTextEdit): boolean {
  return edit.oldText.length <= CHEAP_CHARS && edit.newText.length <= CHEAP_CHARS
    && atMostLines(edit.oldText, CHEAP_LINES) && atMostLines(edit.newText, CHEAP_LINES);
}

/** Whether `text` has no more than `max` lines (as textLines counts them),
 *  counting no further. */
function atMostLines(text: string, max: number): boolean {
  let breaks = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    if (++breaks > max) return false;
  }
  return breaks + (text.endsWith('\n') ? 0 : 1) <= max;
}

/** A replacement as all of its old lines, then all of its new, onto `out`. */
function oldThenNew(edit: ToolTextEdit, out: DiffLine[]): void {
  const oldLines = textLines(edit.oldText);
  const newLines = textLines(edit.newText);
  if (!oldLines.length && !newLines.length) return;
  out.push({ type: 'hunk', text: `@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@` });
  oldLines.forEach((text, i) => out.push({ type: 'del', text, lineNum: i + 1, oldLineNum: i + 1, unpaired: true }));
  newLines.forEach((text, i) => out.push({ type: 'add', text, lineNum: i + 1, newLineNum: i + 1, unpaired: true }));
}

/** A text's lines, as a patch counts them: a final newline ends the last
 *  line rather than starting another. */
function textLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
