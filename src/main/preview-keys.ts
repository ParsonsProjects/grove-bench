/**
 * Keyboard shortcuts pressed while your Preview page has focus. The page
 * swallows keys, so browser keys are handled here and Grove's own shortcuts
 * are sent back to the Grove window.
 */
import { isGroveWindowShortcut } from '../shared/grove-shortcuts.js';

export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export type PreviewKeyAction =
  | { kind: 'page'; command: 'reload' | 'hardReload' | 'devtools' | 'back' | 'forward' }
  | { kind: 'focusAddress' }
  /** A Grove shortcut: replay it in the Grove window. */
  | { kind: 'grove' };

export function previewKeyAction(input: KeyInput): PreviewKeyAction | null {
  if (input.type !== 'keyDown') return null;
  const ctrl = input.control || input.meta;
  const { key, shift, alt } = input;
  const lower = key.toLowerCase();

  if (key === 'F5') return { kind: 'page', command: ctrl || shift ? 'hardReload' : 'reload' };
  if (ctrl && !alt && lower === 'r') return { kind: 'page', command: shift ? 'hardReload' : 'reload' };
  if (key === 'F12' || (ctrl && shift && lower === 'i')) return { kind: 'page', command: 'devtools' };
  if (alt && !ctrl && key === 'ArrowLeft') return { kind: 'page', command: 'back' };
  if (alt && !ctrl && key === 'ArrowRight') return { kind: 'page', command: 'forward' };
  if ((ctrl && !alt && !shift && lower === 'l') || (alt && !ctrl && lower === 'd')) return { kind: 'focusAddress' };

  if (isGroveWindowShortcut({ key, ctrl, shift, alt })) return { kind: 'grove' };
  return null;
}
