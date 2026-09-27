// Lane (branch) definitions for the Branches prototype.
// Colours come from the brand: main is a light neutral, feat/auth is the
// primary blue, feat/api is teal and fix/login-bug is tree green. `text` is a
// lighter tint of the same hue so labels stay readable on the dark page.

export const AMBER = '#f59e0b';
export const GREEN = '#22c55e';
export const RED = '#ef4444';

/** @typedef {'main' | 'auth' | 'api' | 'fix'} LaneKey */

export const lanes = {
  main: {
    key: 'main',
    name: 'main',
    index: 0,
    stroke: 'oklch(0.8 0 0)',
    text: 'oklch(0.88 0 0)',
    rgb: [190, 190, 190],
  },
  auth: {
    key: 'auth',
    name: 'feat/auth',
    index: 1,
    stroke: 'oklch(0.541 0.181 254.624)',
    text: 'oklch(0.74 0.13 254.6)',
    rgb: [0, 108, 212],
  },
  api: {
    key: 'api',
    name: 'feat/api',
    index: 2,
    stroke: 'oklch(0.65 0.15 200)',
    text: 'oklch(0.8 0.12 200)',
    rgb: [0, 169, 179],
  },
  fix: {
    key: 'fix',
    name: 'fix/login-bug',
    index: 3,
    stroke: '#6ec87a',
    text: '#8fd89a',
    rgb: [110, 200, 122],
  },
};

export const laneList = [lanes.main, lanes.auth, lanes.api, lanes.fix];
export const branchLanes = [lanes.auth, lanes.api, lanes.fix];

/** Sets --lane / --lane-text custom properties for a lane. */
export function laneStyle(key) {
  const lane = lanes[key];
  return `--lane: ${lane.stroke}; --lane-text: ${lane.text};`;
}
