/**
 * Diff view types shared between DiffView.svelte and plain .ts modules
 * (e.g. diff-highlight). Defined here rather than in DiffView.svelte's module
 * script because `tsc --noEmit` resolves `*.svelte` to an ambient module with
 * only a default export, so named type imports from a .svelte file fail.
 */

export interface HunkRange {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/** A run of hidden lines between (or around) hunks that the user can reveal.
 *  Positions are new-side line numbers (inclusive); `oldOffset` maps a new
 *  line number to the old side (old = new + oldOffset) inside the gap. */
export interface ContextGap {
  id: string;
  fromNew: number;
  toNew: number;
  oldOffset: number;
}

export interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'header' | 'expander';
  text: string;
  /** Legacy single line number: new-side for add/context, old-side for del. */
  lineNum?: number;
  oldLineNum?: number;
  newLineNum?: number;
  /** Parsed `@@ -a,b +c,d @@` range on hunk rows. */
  hunk?: HunkRange;
  /** Hidden-line gap on expander rows. */
  gap?: ContextGap;
}

export interface SideBySideRow {
  type: 'context' | 'change' | 'hunk' | 'expander';
  left?: { lineNum?: number; text: string };
  right?: { lineNum?: number; text: string };
  hunkText?: string;
  gap?: ContextGap;
  /** Intraline ranges (char offsets into text) that changed, per side. */
  leftRanges?: [number, number][];
  rightRanges?: [number, number][];
}

/** A review comment anchored to lines of a file in the diff. `side` says
 *  which line numbering `startLine`/`endLine` use. */
export interface ReviewComment {
  id: string;
  filePath: string;
  side: 'old' | 'new';
  startLine: number;
  endLine: number;
  /** The anchored lines' text, captured when the comment was written so the
   *  prompt still makes sense if the file changes underneath. */
  snippet: string;
  body: string;
  createdAt: number;
}
