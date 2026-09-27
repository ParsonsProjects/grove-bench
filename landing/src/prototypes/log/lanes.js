// Lanes (branches) of the gutter graph, and the agent that works on each.
// Colours are hex so the canvas scenes and the SVG graph share them: main is a
// light neutral, feat/auth the primary blue, feat/api teal and fix/login-bug
// tree green. `text` is a lighter tint that stays readable on the dark page.

import { primary, oklch, mix, leaves, woodDark, woodLight, amber, green } from '../grove/palette.js';

/** @typedef {'main' | 'auth' | 'api' | 'fix'} LaneKey */

const teal = oklch(0.65, 0.15, 200);

export const lanes = {
  main: { key: 'main', name: 'main', index: 0, stroke: '#bdbdbd', text: '#e3e3e3' },
  auth: { key: 'auth', name: 'feat/auth', index: 1, stroke: primary, text: oklch(0.74, 0.13, 254.6) },
  api: { key: 'api', name: 'feat/api', index: 2, stroke: teal, text: oklch(0.82, 0.11, 200) },
  fix: { key: 'fix', name: 'fix/login-bug', index: 3, stroke: '#6ec87a', text: '#8fd89a' },
};

export const laneList = [lanes.main, lanes.auth, lanes.api, lanes.fix];
export const branchKeys = /** @type {const} */ (['auth', 'api', 'fix']);

/** Status lamp colours. `lamp` is the lit glass, `glow` the halo. */
export const status = {
  working: { lamp: oklch(0.7, 0.16, 254.6), glow: primary, word: 'working' },
  permission: { lamp: amber, glow: amber, word: 'needs you' },
  ready: { lamp: green, glow: green, word: 'ready' },
  neutral: { lamp: '#fff1c9', glow: '#ffe7a8', word: '' },
};

/** CSS custom properties for a lane chip. */
export function laneStyle(key) {
  const l = lanes[key];
  return `--lane: ${l.stroke}; --lane-text: ${l.text};`;
}

// The agents' looks: each hoodie is its lane colour, so a character reads as
// the lane beside it.
export const agentLooks = {
  auth: { hoodie: primary, hair: mix(woodDark, '#111111', 0.5) },
  api: { hoodie: mix(teal, '#0c4a52', 0.25), hair: mix(woodLight, amber, 0.55) },
  fix: { hoodie: leaves[2], hair: '#1e1e1e' },
};
