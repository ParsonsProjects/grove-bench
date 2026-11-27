import type { ToolView } from '../../shared/tool-view.js';
import { worktreeImageType } from '../../shared/attachments.js';

/**
 * An image file a call wrote or edited (an SVG, mostly: Write writes text),
 * to show as it is in the worktree now. Not one it deleted or moved (no
 * content), nor one that failed or is still running. The thread shows it
 * under the call (ToolCallBlock), and a Summary turn shows it while its
 * steps are folded (lib/turns.ts). Draw it with `hideUnavailable`: it may be
 * gone since, or outside the worktree.
 */
export function writtenImageOf(view: ToolView, pending: boolean, isError?: boolean): { name: string; path: string } | null {
  if (view.kind !== 'edit' || !view.path || pending || isError) return null;
  if (view.write === undefined && !view.edits?.length) return null;
  return worktreeImageType(view.path) ? { name: view.path, path: view.path } : null;
}
