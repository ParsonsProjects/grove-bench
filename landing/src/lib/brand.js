// Shared brand data for the landing page. The colours and fonts are the app's
// own (src/shared/brand.ts, through shared/app-art.js), so the page and
// the app share one palette; the logo is PIXEL_TREE from the same place.

import { PALETTE, NIGHT, PAPER, STATUS, FONTS } from '../shared/app-art.js';

export { PALETTE, NIGHT, PAPER, STATUS, FONTS };

export const links = {
  github: 'https://github.com/ParsonsProjects/grove-bench',
  releases: 'https://github.com/ParsonsProjects/grove-bench/releases',
  contributing: 'https://github.com/ParsonsProjects/grove-bench/blob/main/CONTRIBUTING.md',
  license: 'https://github.com/ParsonsProjects/grove-bench/blob/main/LICENSE',
  issues: 'https://github.com/ParsonsProjects/grove-bench/issues',
};

/**
 * Thread status colours (STATUS), as the page's app windows show them. Those
 * windows are the app in its dark theme, the default, so each status wears its
 * dark-theme colour: green working, amber needs you, blue finished a turn, red
 * error. Quiet states (ready, sleeping, closed) are grey.
 */
export const statusColors = Object.fromEntries(Object.entries(STATUS).map(([tone, s]) => [tone, s.dark]));

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const named = (prefix, colours) => Object.entries(colours).map(([k, v]) => [`--${prefix}${kebab(k)}`, v]);

/**
 * The brand as CSS custom properties, so the stylesheets use the same values
 * as the app: --leaf, --sky-deep (PALETTE), --night-card, --paper-ink (NIGHT,
 * PAPER), --status-working (statusColors), --font-mono and --font-pixel.
 * applyBrand() sets them on the page before it mounts.
 */
export const brandVars = Object.fromEntries([
  ...named('', PALETTE),
  ...named('night-', NIGHT),
  ...named('paper-', PAPER),
  ...named('status-', statusColors),
  ['--font-mono', FONTS.mono],
  ['--font-pixel', FONTS.pixel],
]);

/** Sets brandVars on the root element. */
export function applyBrand(root = document.documentElement) {
  for (const [name, value] of Object.entries(brandVars)) root.style.setProperty(name, value);
}

// Model labels as the app shows them (src/main/adapters/claude-code.ts).
export const models = {
  opus: { label: 'Opus 5.5', contextWindow: 1_000_000 },
  sonnet: { label: 'Sonnet 4.6', contextWindow: 1_000_000 },
  haiku: { label: 'Haiku 4.5', contextWindow: 200_000 },
};
