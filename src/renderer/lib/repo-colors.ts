/**
 * Distinct accent colors for distinguishing repositories.
 * Each color is chosen for good visibility on dark backgrounds.
 */
export const DEFAULT_REPO_COLORS = [
  '#e06c75', // red
  '#61afef', // blue
  '#98c379', // green
  '#c678dd', // purple
  '#e5c07b', // yellow
  '#56b6c2', // cyan
  '#d19a66', // orange
  '#be5046', // dark red
];

/**
 * Get the accent color for a repository.
 *
 * Returns null when there's only one repo and no custom color
 * (no need to distinguish).
 */
export function getRepoColor(
  repos: string[],
  repoPath: string,
  customColors?: Record<string, string>,
): string | null {
  if (customColors?.[repoPath]) {
    return customColors[repoPath];
  }
  if (repos.length <= 1) {
    return null;
  }
  const index = repos.indexOf(repoPath);
  const safeIndex = index === -1 ? 0 : index;
  return DEFAULT_REPO_COLORS[safeIndex % DEFAULT_REPO_COLORS.length];
}

/**
 * Get the CSS class for a pending-permission tab.
 *
 * When active, the repo accent color should take priority over the orange
 * border, so we use a quieter class with a static shadow instead of the
 * flashing animation.
 */
export function getTabPendingClass(isActive: boolean, hasPending: boolean): string {
  if (!hasPending) return '';
  return isActive ? 'tab-action-required-active' : 'tab-action-required';
}

/**
 * Get a CSS `border-color` style string for a repo, or empty string if no color.
 */
export function getRepoColorStyle(
  repos: string[],
  repoPath: string,
  customColors?: Record<string, string>,
): string {
  const color = getRepoColor(repos, repoPath, customColors);
  if (!color) return '';
  return `border-color: ${color}`;
}
