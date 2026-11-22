import { store } from '../stores/sessions.svelte.js';

/** '#n ' prefix when several threads in the project share this branch, so
 *  same-branch threads (several agents on one worktree, say) can be told
 *  apart. Mirrors the old tab bar's numbering. */
function branchIndex(s: { id: string; repoPath: string; branch: string }): string {
  const siblings = store.sessionsForRepo(s.repoPath).filter((x) => x.branch === s.branch);
  if (siblings.length <= 1) return '';
  const idx = siblings.findIndex((x) => x.id === s.id);
  return `#${idx + 1} `;
}

/** A thread's name in the sidebar and on the board: a user/auto name when
 *  set, else the branch with a '#n' prefix when shared. A thread in a folder
 *  without git has no branch and is named after its first turn, so until
 *  then it's "New thread". Kept apart from sessionLabel so rename prefill and
 *  no-op detection use the plain name without the index. */
export function threadLabel(s: { id: string; repoPath: string; displayName?: string | null; branch: string }): string {
  if (s.displayName) return s.displayName;
  return s.branch ? branchIndex(s) + s.branch : 'New thread';
}
