/** Delay between successive session resumes at startup, so a pile of agent
 *  subprocesses doesn't all boot at the same moment. */
export const RESUME_STAGGER_MS = 1000;

/**
 * Order persisted open tabs for startup resume: the previously active tab
 * first (it's the one on screen), then the rest in their persisted order.
 * Duplicates are dropped.
 */
export function orderTabsForResume(openTabs: string[], activeTab: string | null | undefined): string[] {
  const unique = [...new Set(openTabs)];
  if (!activeTab || !unique.includes(activeTab)) return unique;
  return [activeTab, ...unique.filter((id) => id !== activeTab)];
}
