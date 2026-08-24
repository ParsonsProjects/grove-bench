/**
 * Deterministic pixel-art developer appearance for the Game Dev Tycoon UI mode.
 *
 * Every attribute is hashed independently from the session id (with a salt per
 * attribute) so a session always renders the same developer across restarts,
 * while different sessions get visibly different combinations.
 */

export type HairStyle = 'short' | 'spiky' | 'long' | 'buzz';
export type Accessory = 'none' | 'glasses' | 'headphones' | 'cap';

export interface DevAppearance {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  accessory: Accessory;
  /** Only meaningful when accessory === 'cap'. */
  capColor: string;
}

export const SKIN_TONES = ['#f8d5b0', '#eab98a', '#d29b6b', '#a9714b', '#8a5a3b', '#6b4429'];
export const HAIR_COLORS = ['#2f2418', '#4a3520', '#7a5230', '#b58143', '#d9a45c', '#1f1f24', '#8a8f98', '#b13a2f'];
export const SHIRT_COLORS = ['#3d6ea5', '#4a9e5c', '#b1543f', '#8a5fb0', '#c2913a', '#3f8f8a', '#b0507a', '#5c6470'];
const HAIR_STYLES: HairStyle[] = ['short', 'spiky', 'long', 'buzz'];
// 'none' twice: most devs wear nothing so accessories stay a highlight.
const ACCESSORIES: Accessory[] = ['none', 'none', 'glasses', 'headphones', 'cap'];

/** Dark pixels: eyes, glasses frames, headphone band/cups. */
const INK = '#22222e';

/** FNV-1a 32-bit — small, stable, good spread for short strings. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick<T>(list: T[], id: string, salt: string): T {
  return list[hashString(`${salt}:${id}`) % list.length];
}

export function developerAppearance(sessionId: string): DevAppearance {
  return {
    skin: pick(SKIN_TONES, sessionId, 'skin'),
    hair: pick(HAIR_COLORS, sessionId, 'hair'),
    hairStyle: pick(HAIR_STYLES, sessionId, 'style'),
    shirt: pick(SHIRT_COLORS, sessionId, 'shirt'),
    accessory: pick(ACCESSORIES, sessionId, 'extra'),
    capColor: pick(SHIRT_COLORS, sessionId, 'cap'),
  };
}

export const SPRITE_COLS = 12;
export const SPRITE_ROWS = 11;

/** One colored pixel of the sprite, in grid units. */
export interface SpritePixel {
  x: number;
  y: number;
  color: string;
}

/**
 * Build the developer sprite as a flat list of grid pixels (12 × 11).
 * Layout: rows 0–1 hair/headgear, 2–5 face, 6 neck, 7–10 torso. The desk is
 * drawn by the component in front of the bottom rows.
 */
export function buildSprite(a: DevAppearance): SpritePixel[] {
  // null = transparent
  const grid: (string | null)[][] = Array.from({ length: SPRITE_ROWS }, () =>
    Array<string | null>(SPRITE_COLS).fill(null),
  );

  const put = (x: number, y: number, color: string) => {
    if (x >= 0 && x < SPRITE_COLS && y >= 0 && y < SPRITE_ROWS) grid[y][x] = color;
  };
  const row = (x0: number, x1: number, y: number, color: string) => {
    for (let x = x0; x <= x1; x++) put(x, y, color);
  };

  // Face
  for (let y = 2; y <= 5; y++) row(3, 8, y, a.skin);

  // Hair
  switch (a.hairStyle) {
    case 'short':
      row(3, 8, 1, a.hair);
      put(3, 2, a.hair);
      put(8, 2, a.hair);
      break;
    case 'spiky':
      put(3, 0, a.hair);
      put(5, 0, a.hair);
      put(7, 0, a.hair);
      row(3, 8, 1, a.hair);
      break;
    case 'long':
      row(3, 8, 1, a.hair);
      for (let y = 2; y <= 5; y++) {
        put(2, y, a.hair);
        put(9, y, a.hair);
      }
      break;
    case 'buzz':
      row(4, 7, 1, a.hair);
      break;
  }

  // Eyes
  put(4, 3, INK);
  put(7, 3, INK);

  // Neck
  row(5, 6, 6, a.skin);

  // Torso + arms
  for (let y = 7; y <= 10; y++) row(2, 9, y, a.shirt);
  for (let y = 8; y <= 10; y++) {
    put(1, y, a.shirt);
    put(10, y, a.shirt);
  }

  // Accessory (drawn last so it layers over hair/face)
  switch (a.accessory) {
    case 'glasses':
      row(3, 8, 3, INK);
      put(4, 3, '#9fc4e8'); // lenses
      put(7, 3, '#9fc4e8');
      break;
    case 'headphones':
      row(4, 7, 0, INK);
      for (let y = 3; y <= 4; y++) {
        put(2, y, INK);
        put(9, y, INK);
      }
      break;
    case 'cap':
      row(4, 7, 0, a.capColor);
      row(3, 8, 1, a.capColor);
      row(2, 4, 2, a.capColor); // brim
      break;
    case 'none':
      break;
  }

  const pixels: SpritePixel[] = [];
  for (let y = 0; y < SPRITE_ROWS; y++) {
    for (let x = 0; x < SPRITE_COLS; x++) {
      const color = grid[y][x];
      if (color) pixels.push({ x, y, color });
    }
  }
  return pixels;
}
