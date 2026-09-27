// Small helpers shared by the scene modules.

import { P } from './engine.js';

/**
 * Tree centres for three plots spread across [left, right] in art px, at
 * most `max` apart, so each plot (sign, tree, bench, lamp) fits.
 */
export function spreadPlots(env, left, right, max = 100) {
  const L = env.block === 7 ? 28 : 21;
  const R = P.lamp + 5;
  const span = Math.max(0, right - left - L - R);
  const gap = Math.min(max, span / 2);
  const mid = (left + L + right - R) / 2;
  return [mid - gap, mid, mid + gap].map((v) => Math.round(v));
}

/** Index into a looping list of `n` steps, `period` seconds each. */
export function cycle(time, n, period = 2.6, offset = 0) {
  return Math.floor(time / period + offset) % n;
}

/** Anchor for a speech bubble over an agent's head. */
export function bubbleAt(env, p) {
  const box = env.agentBox(p);
  return box ? [box.cx, box.y - 2] : null;
}

/** Anchor for the board on a plot's sign post. */
export function signAt(env, p) {
  return [Math.round(p.x) + P.sign + 1, env.groundY - 8];
}

/** Hit box (top left, size) around an agent, padded so it is easy to tap. */
export function hitAt(env, p, pad = 3) {
  const box = env.agentBox(p);
  return box ? [box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2] : null;
}
