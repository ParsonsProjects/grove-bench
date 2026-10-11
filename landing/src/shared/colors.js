// The app colours its characters with Tailwind text classes (currentColor).
// These are the same colours as plain CSS values: the app theme's tokens,
// from the brand (src/shared/brand.ts), and Tailwind v4's palette for
// the rest. The page's app windows show the app's dark theme, so these are
// the dark-theme values.

import { AGENT_SPRITES, PALETTE, NIGHT } from './app-art.js';
import { statusColors } from '../lib/brand.js';

const CLASS_COLOR = {
  // Thread status (STATUS): blue working, amber needs you, green finished a
  // turn, red error.
  'text-status-working': statusColors.working,
  'text-status-attention': statusColors.attention,
  'text-status-unread': statusColors.unread,
  'text-status-error': statusColors.error,
  // Theme tokens (globals.css, dark).
  'text-foreground/60': `${NIGHT.foreground}99`,
  'text-muted-foreground': NIGHT.mutedForeground,
  'text-destructive': PALETTE.ember,
  // Tailwind's palette.
  'text-green-400': 'oklch(0.792 0.209 151.711)',
  'text-neutral-500': 'oklch(0.556 0 0)',
};

/** The colour a character wears in this state, as in the app's sidebar. */
export function stateColor(state) {
  return CLASS_COLOR[AGENT_SPRITES[state]?.colorClass] ?? CLASS_COLOR['text-foreground/60'];
}

/** Sidebar filter chips: a colour always means the same thing. */
export const FILTERS = [
  { key: 'needs', label: 'Needs you', color: statusColors.attention },
  { key: 'working', label: 'Working', color: statusColors.working },
  { key: 'unread', label: 'Unread', color: statusColors.unread },
];

/** Which filter chip a state counts towards, if any. */
export function filterFor(state) {
  if (state === 'permission' || state === 'asking') return 'needs';
  if (state === 'working' || state === 'starting' || state === 'installing') return 'working';
  if (state === 'unread') return 'unread';
  return null;
}
