import { settingsStore } from '../stores/settings.svelte.js';

/** The base branch for PRs and new worktrees: the user's settings override
 *  when set, otherwise the repository's detected default branch. */
export async function resolveBaseBranch(repoPath: string): Promise<string> {
  const override = settingsStore.current.defaultBaseBranch?.trim();
  if (override) return override;
  try {
    const detected = await window.groveBench.getDefaultBranch(repoPath);
    return detected?.trim() || 'main';
  } catch {
    return 'main';
  }
}
