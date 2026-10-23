/**
 * Decide whether a repo's accordion section should render collapsed.
 *
 * Repos are collapsed by default — the active session is always visible in the
 * sidebar's Active section, so the Inactive tree starts closed. An explicit
 * stored toggle — in either direction — always wins over the default.
 */
export function isRepoCollapsed(
  collapsed: Record<string, boolean>,
  repo: string,
): boolean {
  return collapsed[repo] ?? true;
}
