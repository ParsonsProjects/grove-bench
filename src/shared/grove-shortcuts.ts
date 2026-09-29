/**
 * Grove shortcuts that work anywhere in the window (keydown listeners on
 * `window`). Your Preview page swallows keys while it has focus, so the main
 * process hands these back to Grove.
 *
 * Keep this in step with the handlers: keyboard-shortcuts.ts (Alt+1..5, a
 * test checks it), StatusBar.svelte (Alt+M/T/E) and App.svelte (Ctrl+B,
 * Ctrl+N, Ctrl+Shift+T). Ctrl+R is left out on purpose: in the page it
 * reloads, like a browser. So is Ctrl+F, which searches the Activity tab.
 */

export interface ShortcutKey {
  /** Lower-case `KeyboardEvent.key`. */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export const GROVE_WINDOW_SHORTCUTS: readonly ShortcutKey[] = [
  ...['1', '2', '3', '4', '5'].map((key) => ({ key, alt: true })),
  { key: 'm', alt: true },
  { key: 't', alt: true },
  { key: 'e', alt: true },
  { key: 'b', ctrl: true },
  { key: 'n', ctrl: true },
  { key: 't', ctrl: true, shift: true },
];

/** `ctrl` covers Cmd too. */
export function isGroveWindowShortcut(input: { key: string; ctrl: boolean; shift: boolean; alt: boolean }): boolean {
  const key = input.key.toLowerCase();
  return GROVE_WINDOW_SHORTCUTS.some((s) =>
    s.key === key && !!s.ctrl === input.ctrl && !!s.shift === input.shift && !!s.alt === input.alt);
}
