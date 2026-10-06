/**
 * The shortcuts the status bar's Keys popover lists. Tab rows come from
 * TAB_BY_KEY and the agent control rows from CONTROL_SHORTCUTS, so those
 * can't drift; a test checks every window shortcut (grove-shortcuts.ts)
 * has a row. docs/help/keyboard-shortcuts.md is the full list.
 */
import type { ShortcutKey } from '../../shared/grove-shortcuts.js';
import { CONTROL_IDS, CONTROL_SHORTCUTS } from '../../shared/types.js';
import { TAB_BY_KEY, TAB_LABELS } from './keyboard-shortcuts.js';

export interface ShortcutRow {
  label: string;
  key: ShortcutKey;
}

export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

const CONTROL_LABELS: Record<string, string> = {
  [CONTROL_IDS.permissionMode]: 'Cycle mode',
  [CONTROL_IDS.thinking]: 'Toggle thinking',
  [CONTROL_IDS.effort]: 'Cycle effort level',
};

/** "Alt+M" -> { key: 'm', alt: true }. */
function parseCombo(combo: string): ShortcutKey {
  const parts = combo.split('+');
  const key = parts[parts.length - 1].toLowerCase();
  const mods = parts.slice(0, -1).map((p) => p.toLowerCase());
  return {
    key,
    ...(mods.includes('ctrl') ? { ctrl: true } : {}),
    ...(mods.includes('shift') ? { shift: true } : {}),
    ...(mods.includes('alt') ? { alt: true } : {}),
  };
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'General',
    rows: [
      { label: 'Thread finder', key: { key: 'r', ctrl: true } },
      { label: 'New thread', key: { key: 'n', ctrl: true } },
      { label: 'Reopen closed tab', key: { key: 't', ctrl: true, shift: true } },
      { label: 'Bookmarks', key: { key: 'b', ctrl: true } },
      { label: 'Search messages', key: { key: 'f', ctrl: true } },
      { label: 'Settings', key: { key: ',', ctrl: true } },
      { label: 'Help', key: { key: 'f1' } },
    ],
  },
  {
    title: 'Agent',
    rows: Object.entries(CONTROL_SHORTCUTS).map(([id, combo]) => ({
      label: CONTROL_LABELS[id] ?? id,
      key: parseCombo(combo),
    })),
  },
  {
    title: 'Tabs',
    rows: Object.entries(TAB_BY_KEY).map(([key, tab]) => ({
      label: `${TAB_LABELS[tab]} tab`,
      key: { key, alt: true },
    })),
  },
];

/** { key: 't', ctrl: true, shift: true } -> "Ctrl+Shift+T". */
export function formatShortcut(k: ShortcutKey): string {
  return [k.ctrl && 'Ctrl', k.shift && 'Shift', k.alt && 'Alt', k.key.toUpperCase()]
    .filter(Boolean)
    .join('+');
}
