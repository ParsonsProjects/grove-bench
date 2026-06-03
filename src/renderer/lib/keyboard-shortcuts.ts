export type WorkspaceTab = 'activity' | 'changes' | 'checkpoints' | 'plan' | 'terminal';

const TAB_BY_KEY: Record<string, WorkspaceTab> = {
  '1': 'activity',
  '2': 'changes',
  '3': 'checkpoints',
  '4': 'terminal',
};

/**
 * Map an Alt+<n> keyboard event to the workspace tab it selects, or null if the
 * event isn't a tab shortcut. Pure so the tab-switch wiring can be unit-tested
 * without mounting a component.
 */
export function parseTabShortcut(e: { altKey: boolean; key: string }): WorkspaceTab | null {
  if (!e.altKey) return null;
  return TAB_BY_KEY[e.key] ?? null;
}
