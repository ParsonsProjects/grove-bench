/**
 * Pure, deterministic mapping from a session id to a pixel-art developer's
 * visual appearance. Same id → same appearance, stable across reloads.
 * Used by the Game Dev Tycoon UI mode.
 */

export interface DeveloperAppearance {
  hairColor: string;
  shirtColor: string;
  skinTone: string;
  accessory: 'none' | 'glasses' | 'headphones' | 'hat';
  monitorTint: string;
}

const HAIR_COLORS = [
  '#3a2a20', // dark brown
  '#6a4a2a', // brown
  '#a0703a', // light brown
  '#d4a050', // blonde
  '#c43a3a', // red
  '#1a1a1a', // black
  '#8a4aa0', // purple (dyed)
  '#3a7a5a', // green (dyed)
];

const SHIRT_COLORS = [
  '#3a6aaa', // blue
  '#aa3a3a', // red
  '#3a8a4a', // green
  '#aa8a3a', // yellow/mustard
  '#6a3a8a', // purple
  '#3a8a8a', // teal
  '#aa5a3a', // orange
  '#5a5a5a', // grey
  '#1a1a1a', // black
];

const SKIN_TONES = [
  '#f4d4b4', // very light
  '#e4b894', // light
  '#c4986a', // medium
  '#8a5a3a', // tan
  '#5a3a2a', // dark
];

const ACCESSORIES: DeveloperAppearance['accessory'][] = [
  'none',
  'none',
  'none',
  'glasses',
  'glasses',
  'headphones',
  'hat',
];

const MONITOR_TINTS = [
  '#3a6aaa',
  '#6a3a8a',
  '#3a8a4a',
  '#aa3a3a',
  '#aa8a3a',
];

/** Stable 32-bit FNV-1a hash for a string. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  const h = hash(`${seed}:${salt}`);
  return list[h % list.length]!;
}

export function getDeveloperAppearance(sessionId: string): DeveloperAppearance {
  const seed = hash(sessionId);
  return {
    hairColor: pick(HAIR_COLORS, seed, 1),
    shirtColor: pick(SHIRT_COLORS, seed, 2),
    skinTone: pick(SKIN_TONES, seed, 3),
    accessory: pick(ACCESSORIES, seed, 4),
    monitorTint: pick(MONITOR_TINTS, seed, 5),
  };
}
