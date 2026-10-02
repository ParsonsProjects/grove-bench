// The app colours its characters with Tailwind text classes (currentColor).
// These are the same colours as plain CSS values: Tailwind v4's palette and
// the app theme (src/renderer/styles/globals.css).

import { AGENT_SPRITES } from './app-art.js';

const CLASS_COLOR = {
  'text-primary': 'oklch(0.541 0.181 254.624)',
  'text-amber-500': 'oklch(0.769 0.188 70.08)',
  'text-green-400': 'oklch(0.792 0.209 151.711)',
  'text-foreground/60': 'oklch(0.835 0 0 / 0.6)',
  'text-neutral-500': 'oklch(0.556 0 0)',
  'text-red-500': 'oklch(0.637 0.237 25.331)',
  'text-muted-foreground': 'oklch(0.576 0 0)',
  'text-destructive': 'oklch(0.608 0.22 22)',
  'text-cyan-400': 'oklch(0.789 0.154 211.53)',
  'text-blue-400': 'oklch(0.707 0.165 254.624)',
};

/** The colour a character wears in this state, as in the app's sidebar. */
export function stateColor(state) {
  return CLASS_COLOR[AGENT_SPRITES[state]?.colorClass] ?? CLASS_COLOR['text-foreground/60'];
}

/** Sidebar filter chips: a colour always means the same thing. */
export const FILTERS = [
  { key: 'needs', label: 'Needs you', color: CLASS_COLOR['text-amber-500'] },
  { key: 'working', label: 'Working', color: CLASS_COLOR['text-primary'] },
  { key: 'unread', label: 'Unread', color: CLASS_COLOR['text-green-400'] },
];

/** Which filter chip a state counts towards, if any. */
export function filterFor(state) {
  if (state === 'permission' || state === 'asking') return 'needs';
  if (state === 'working' || state === 'starting' || state === 'installing') return 'working';
  if (state === 'unread') return 'unread';
  return null;
}
