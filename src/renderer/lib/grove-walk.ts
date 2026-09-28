/**
 * The grove walk: shown while a conversation's agent starts up, with grove
 * characters on. The agent walks on the spot, facing right, while the grove
 * scrolls past in two layers. Each layer is a strip drawn twice, side by
 * side, that slides left by its own width on a loop, so the join never shows.
 */
import { toRuns, BENCH, LAMP, SCENERY_PALETTE } from './agent-sprite.js';
import { PIXEL_TREE } from './pixel-tree.js';

/** The visible scene, in art pixels. */
export const WALK_VIEW_W = 120;
export const WALK_VIEW_H = 34;
/** Row of the ground line. Props and the agent stand on the row above it. */
export const WALK_GROUND_Y = 33;

export interface WalkRect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

export interface WalkLayer {
  /** Strip width in art pixels; the loop slides the strip by this much. */
  width: number;
  /** Seconds for one loop. */
  seconds: number;
  rects: WalkRect[];
}

/** Art pixels per second along the path. */
const PATH_SPEED = 10;

type Prop = 'tree' | 'far-tree' | 'lamp' | 'bench' | 'tuft';

const GRASS: Record<string, string> = { g: '#3a9a48' };
const TUFT = ['g.g', '.g.'];

// The logo tree's lowest pixels sit on row 21 and are 2 high.
const TREE_H = 23;

/** A prop's rects, with its bottom row resting on the ground. */
function propRects(prop: Prop, x: number): WalkRect[] {
  const base = WALK_GROUND_Y;
  switch (prop) {
    case 'tree':
      return PIXEL_TREE.map((p) => ({ x: x + p.x, y: base - TREE_H + p.y, w: 2, h: 2, fill: p.fill }));
    case 'far-tree':
      // The logo tree at half size: its 2px pixels land on whole screen
      // pixels at the scene's 4x scale, like the page's background dots.
      return PIXEL_TREE.map((p) => ({ x: x + p.x / 2, y: base - TREE_H / 2 + p.y / 2, w: 1, h: 1, fill: p.fill }));
    case 'lamp':
      return mapRects(LAMP, SCENERY_PALETTE, x, base - LAMP.length);
    case 'bench':
      return mapRects(BENCH, SCENERY_PALETTE, x, base - BENCH.length);
    case 'tuft':
      return mapRects(TUFT, GRASS, x, base - TUFT.length);
  }
}

function mapRects(map: string[], palette: Record<string, string>, x: number, y: number): WalkRect[] {
  return toRuns(map, palette).map((r) => ({ x: x + r.x, y: y + r.y, w: r.w, h: 1, fill: r.fill }));
}

function layer(width: number, pxPerSecond: number, props: [Prop, number][]): WalkLayer {
  return { width, seconds: width / pxPerSecond, rects: props.flatMap(([prop, x]) => propRects(prop, x)) };
}

/** Distant trees, drawn dim and moving at under half the speed. */
export const WALK_BACK = layer(150, 4, [
  ['far-tree', 2],
  ['far-tree', 16],
  ['far-tree', 44],
  ['far-tree', 58],
  ['far-tree', 70],
  ['far-tree', 102],
  ['far-tree', 128],
]);

/** The path: trees, lamps, a bench and grass tufts. */
export const WALK_FRONT = layer(200, PATH_SPEED, [
  ['tree', 4],
  ['tuft', 30],
  ['lamp', 38],
  ['tree', 54],
  ['tree', 80],
  ['tuft', 106],
  ['bench', 116],
  ['lamp', 136],
  ['tuft', 146],
  ['tree', 160],
  ['tuft', 188],
]);

/** Seconds per walking frame: one step for every 3px of path. */
export const WALK_FRAME_SECONDS = 3 / PATH_SPEED;
