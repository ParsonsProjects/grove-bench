import type { DiffLine } from './diff-types.js';
import type { GitOperation } from '../../shared/types.js';
import { isConflictMarker } from '../../shared/git-conflicts.js';

/** A marker line git writes into a file it stopped on: `ours` opens the
 *  block (<<<<<<<), `base` starts the common ancestor's lines (|||||||,
 *  with diff3), `separator` (=======) and `theirs` closes it (>>>>>>>). */
export type ConflictMarker = 'ours' | 'base' | 'separator' | 'theirs';

const BASE = /^\|{7}(?: |$)/;
const SEPARATOR = /^={7}$/;

/**
 * The marker lines in a conflicted file's diff, by their new-side line
 * number: they are added lines, as HEAD has none of them. <<<<<<< and
 * >>>>>>> always count, as they keep the file from being marked resolved
 * (isConflictMarker); an ======= or ||||||| only between them, so a
 * Markdown underline stays an ordinary line.
 */
export function conflictMarkers(lines: DiffLine[]): Map<number, ConflictMarker> {
  const markers = new Map<number, ConflictMarker>();
  let inside = false;
  for (const line of lines) {
    if (line.type !== 'add') continue;
    const num = line.newLineNum ?? line.lineNum;
    if (num === undefined) continue;
    // In a file with CRLF endings git ends its markers with \r too.
    const text = line.text.replace(/\r$/, '');
    if (isConflictMarker(text)) {
      inside = text.startsWith('<');
      markers.set(num, inside ? 'ours' : 'theirs');
    } else if (inside && BASE.test(text)) {
      markers.set(num, 'base');
    } else if (inside && SEPARATOR.test(text)) {
      markers.set(num, 'separator');
    }
  }
  return markers;
}

/**
 * Plain words for the side a marker opens or closes, from what is under
 * way: only what git's own text after the marker leaves out. In a rebase
 * git's HEAD is the branch being rebased onto, not yours, so "HEAD"
 * misleads there. Null for the separator, and without an operation (a
 * stash pop, say), when git's text is all there is.
 */
export function conflictSideLabel(marker: ConflictMarker, op?: GitOperation): string | null {
  if (marker === 'separator') return null;
  if (marker === 'base') return 'what both sides started from';
  if (!op) return null;
  if (marker === 'ours') {
    if (op.kind !== 'rebase') return op.branch ? `${op.branch}, yours` : 'yours';
    const onto = op.incoming ? `${op.incoming}, the branch you're rebasing onto` : "the branch you're rebasing onto";
    return op.step && op.step > 1 ? `${onto}, with your earlier commits` : onto;
  }
  // git names the branch or commit after >>>>>>>.
  switch (op.kind) {
    case 'merge': return 'coming in';
    case 'rebase': return 'your commit';
    case 'cherry-pick': return 'the commit being picked';
    // git writes "parent of <commit>": the lines from before it.
    case 'revert': return 'what the revert puts back';
  }
}
