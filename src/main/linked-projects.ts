/**
 * What a thread's agent is given beyond its own folder: the "Additional
 * working directories" setting and its linked projects, each a worktree of
 * another project on the thread's branch (docs/linked-projects-plan.md).
 * Pure functions: the session manager passes their results to the adapter.
 */

import path from 'node:path';
import type { LinkedCheckout } from '../shared/types.js';
import { isPathInside } from './agent-utils.js';

export interface AgentFolders {
  /** Folders outside the thread's own the agent may work in: the linked
   *  worktrees first, then the setting's folders. Absolute, each once. */
  additionalDirectories: string[];
  /** Linked projects' own folders, which the agent edits through their
   *  worktrees instead. A folder that holds the thread's own folder or one
   *  of the worktrees is left out, as refusing edits there would refuse
   *  those too. */
  protectedEditRoots: string[];
}

/** The folders a thread's agent gets, from its own folder (`cwd`), the
 *  setting's folders and its links. */
export function agentFolders(
  cwd: string,
  workingDirectories: readonly string[],
  links: readonly LinkedCheckout[],
): AgentFolders {
  const additionalDirectories: string[] = [];
  for (const dir of [...links.map((l) => l.path), ...workingDirectories]) {
    const trimmed = dir.trim();
    if (!trimmed || !path.isAbsolute(trimmed)) continue;
    const resolved = path.resolve(trimmed);
    // Inside the thread's folder: the agent has it already.
    if (isPathInside(cwd, resolved)) continue;
    if (additionalDirectories.some((d) => isPathInside(d, resolved) && isPathInside(resolved, d))) continue;
    additionalDirectories.push(resolved);
  }
  const working = [cwd, ...links.map((l) => l.path)];
  const protectedEditRoots: string[] = [];
  for (const link of links) {
    const root = path.resolve(link.repoPath);
    if (working.some((w) => isPathInside(root, path.resolve(w)))) continue;
    if (protectedEditRoots.some((r) => isPathInside(r, root) && isPathInside(root, r))) continue;
    protectedEditRoots.push(root);
  }
  return { additionalDirectories, protectedEditRoots };
}
