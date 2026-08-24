/**
 * Isometric room math for the Game Dev Tycoon UI mode.
 *
 * The office is a 2:1 isometric room drawn in one SVG. The room grows (and the
 * decor tier upgrades) with the number of live sessions, Game-Dev-Tycoon
 * style: garage → startup office → studio → studio HQ.
 */

// 2:1 isometric tile (screen px per tile)
export const TILE_W = 52;
export const TILE_H = 26;
export const WALL_H = 96;
export const DESK_H = 22;
/** Screen px per developer-sprite pixel. */
export const SPRITE_SCALE = 2.6;

export interface Pt {
  x: number;
  y: number;
}

/** Project tile coordinates (fractions allowed) to screen coordinates. */
export function iso(tx: number, ty: number): Pt {
  return { x: (tx - ty) * (TILE_W / 2), y: (tx + ty) * (TILE_H / 2) };
}

export interface RoomTier {
  name: string;
  /** Alternating floor tile colors. */
  floorA: string;
  floorB: string;
  /** Left (−x edge) and right (−y edge) wall colors. */
  wallLeft: string;
  wallRight: string;
  /** Baseboard trim along the wall bottoms. */
  trim: string;
  /** Whether decor (plant) is drawn. */
  decor: boolean;
}

const TIERS: { maxDevs: number; tier: RoomTier }[] = [
  {
    maxDevs: 2,
    tier: {
      name: 'Garage',
      floorA: '#8b8b92', floorB: '#84848b',
      wallLeft: '#7d8894', wallRight: '#6b7682',
      trim: '#565e68', decor: false,
    },
  },
  {
    maxDevs: 6,
    tier: {
      name: 'Startup Office',
      floorA: '#c89a62', floorB: '#c1915a',
      wallLeft: '#4a9edb', wallRight: '#e0813f',
      trim: '#8a5f38', decor: true,
    },
  },
  {
    maxDevs: 12,
    tier: {
      name: 'Studio',
      floorA: '#b98d55', floorB: '#b0844e',
      wallLeft: '#3fb8af', wallRight: '#8a5fb0',
      trim: '#77552f', decor: true,
    },
  },
  {
    maxDevs: Infinity,
    tier: {
      name: 'Studio HQ',
      floorA: '#67707c', floorB: '#5f6874',
      wallLeft: '#33506e', wallRight: '#24364a',
      trim: '#3c444e', decor: true,
    },
  },
];

export interface RoomLayout {
  tier: RoomTier;
  /** Room size in tiles. */
  cols: number;
  rows: number;
  /** Desks per row. */
  perRow: number;
  /** Origin tile of each desk; a desk spans 2 tiles in x and 1 in y. */
  desks: Pt[];
  /** SVG viewBox that fits walls, floor, and headroom for status bubbles. */
  viewBox: { x: number; y: number; w: number; h: number };
}

export function roomLayout(count: number): RoomLayout {
  const tier = TIERS.find((t) => count <= t.maxDevs)!.tier;

  const perRow = count <= 2 ? 1 : count <= 6 ? 2 : count <= 12 ? 3 : 4;
  const rowsNeeded = Math.max(1, Math.ceil(count / perRow));
  const cols = perRow * 3 + 3;
  const rows = rowsNeeded * 3 + 2;

  const desks: Pt[] = [];
  for (let i = 0; i < count; i++) {
    desks.push({
      x: 2 + (i % perRow) * 3,
      y: 2 + Math.floor(i / perRow) * 3,
    });
  }

  const pad = 24;
  const headroom = 60; // status bubbles above the back-corner desk row
  const left = iso(0, rows).x - pad;
  const right = iso(cols, 0).x + pad;
  const top = -WALL_H - headroom;
  const bottom = iso(cols, rows).y + pad;

  return {
    tier,
    cols,
    rows,
    perRow,
    desks,
    viewBox: { x: left, y: top, w: right - left, h: bottom - top },
  };
}
