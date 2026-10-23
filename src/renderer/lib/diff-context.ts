import type { ContextGap, DiffLine } from './diff-types.js';

/** How many lines one click on an expander reveals. */
export const EXPAND_STEP = 20;

/** New-side ranges (inclusive) the user has revealed, per file. */
export type RevealedRanges = Array<[number, number]>;

function mergeRanges(ranges: RevealedRanges): RevealedRanges {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: RevealedRanges = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Add a range to the revealed set (merging overlaps). */
export function reveal(ranges: RevealedRanges, from: number, to: number): RevealedRanges {
  if (to < from) return ranges;
  return mergeRanges([...ranges, [from, to]]);
}

/** The range one expander click reveals: `up` takes lines from the bottom of
 *  the gap (just above the next hunk), `down` from the top (just below the
 *  previous hunk), `all` the whole gap. */
export function expansionFor(gap: ContextGap, dir: 'up' | 'down' | 'all'): [number, number] {
  if (dir === 'all') return [gap.fromNew, gap.toNew];
  if (dir === 'up') return [Math.max(gap.fromNew, gap.toNew - EXPAND_STEP + 1), gap.toNew];
  return [gap.fromNew, Math.min(gap.toNew, gap.fromNew + EXPAND_STEP - 1)];
}

/**
 * Rebuild a parsed unified diff with expandable context. Between hunks (and
 * before the first / after the last), hidden lines that the user revealed are
 * spliced in from `fileLines` (the new side of the file, 0-based array), and
 * whatever is still hidden is represented by an `expander` row carrying the
 * remaining gap. Without `fileLines` the diff is returned unchanged except
 * for expander rows, so the UI can still offer the controls before the file
 * content has loaded.
 */
export function withExpandableContext(
  lines: DiffLine[],
  fileLines: string[] | null,
  revealed: RevealedRanges,
): DiffLine[] {
  const hunkIdx = lines.map((l, i) => (l.type === 'hunk' && l.hunk ? i : -1)).filter(i => i >= 0);
  if (hunkIdx.length === 0) return lines;

  const out: DiffLine[] = [];
  const totalNew = fileLines?.length ?? null;
  let cursor = 0;

  // Emit [from..to] (new-side, inclusive) as context lines when revealed, and
  // expander rows for the parts that remain hidden.
  function emitGap(fromNew: number, toNew: number, oldOffset: number, gapId: string) {
    if (toNew < fromNew) return;
    const covering = mergeRanges(revealed).map(([a, b]) => [Math.max(a, fromNew), Math.min(b, toNew)] as [number, number]).filter(([a, b]) => a <= b);
    let pos = fromNew;
    for (const [a, b] of covering) {
      if (a > pos) out.push({ type: 'expander', text: '', gap: { id: `${gapId}:${pos}`, fromNew: pos, toNew: a - 1, oldOffset } });
      for (let n = a; n <= b; n++) {
        const text = fileLines?.[n - 1];
        if (text === undefined) break;
        out.push({ type: 'context', text, lineNum: n, newLineNum: n, oldLineNum: n + oldOffset });
      }
      pos = b + 1;
    }
    if (pos <= toNew) out.push({ type: 'expander', text: '', gap: { id: `${gapId}:${pos}`, fromNew: pos, toNew, oldOffset } });
  }

  for (let h = 0; h < hunkIdx.length; h++) {
    const i = hunkIdx[h];
    const hunk = lines[i].hunk!;
    // Copy anything before this hunk that isn't part of the previous hunk's body
    // (headers etc.) — hunk bodies were already copied below.
    for (; cursor < i; cursor++) if (lines[cursor].type !== 'expander') out.push(lines[cursor]);

    const prevHunk = h > 0 ? lines[hunkIdx[h - 1]].hunk! : null;
    const gapFrom = prevHunk ? prevHunk.newStart + prevHunk.newCount : 1;
    const gapTo = hunk.newStart - 1;
    const oldOffset = hunk.oldStart - hunk.newStart;
    emitGap(gapFrom, gapTo, oldOffset, `g${h}`);

    out.push(lines[i]);
    cursor = i + 1;
    // Hunk body: everything up to the next hunk header.
    const next = h + 1 < hunkIdx.length ? hunkIdx[h + 1] : lines.length;
    for (; cursor < next; cursor++) if (lines[cursor].type !== 'expander') out.push(lines[cursor]);
  }

  // Tail: after the last hunk to end of file (only knowable with file content).
  // A single hunk whose old side is empty (`@@ -0,0 +1,n @@`) is a brand-new
  // file shown in full, so there is nothing below it to reveal.
  const last = lines[hunkIdx[hunkIdx.length - 1]].hunk!;
  const wholeNewFile = hunkIdx.length === 1 && last.oldStart === 0 && last.oldCount === 0;
  const tailFrom = last.newStart + last.newCount;
  const tailTo = totalNew ?? tailFrom + EXPAND_STEP - 1;
  if (!wholeNewFile && (totalNew === null || tailTo >= tailFrom)) {
    emitGap(tailFrom, tailTo, last.oldStart + last.oldCount - (last.newStart + last.newCount), 'tail');
  }
  return out;
}
