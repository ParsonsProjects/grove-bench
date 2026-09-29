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

/** The path's bench, where the wake-up happens (see below). */
const PATH_BENCH_X = 116;

/** The path: trees, lamps, a bench and grass tufts. */
export const WALK_FRONT = layer(200, PATH_SPEED, [
  ['tree', 4],
  ['tuft', 30],
  ['lamp', 38],
  ['tree', 54],
  ['tree', 80],
  ['tuft', 106],
  ['bench', PATH_BENCH_X],
  ['lamp', 136],
  ['tuft', 146],
  ['tree', 160],
  ['tuft', 188],
]);

/** Seconds per walking frame: one step for every 3px of path. */
export const WALK_FRAME_SECONDS = 3 / PATH_SPEED;

// ─── Wake-up ───
// Opening a conversation whose agent is asleep (sleeping or stopped) opens
// the walk with a short scene: the agent asleep on the path's bench, then
// awake, then it stands and walks off and the bench goes by with the path.

/** Milliseconds into the scene at which the agent opens its eyes. */
export const WAKE_AWAKE_AT_MS = 700;
/** Milliseconds into the scene at which it stands and starts walking. */
export const WAKE_WALK_AT_MS = 1200;
/** Length of the whole scene. The chat shows after it, or the walk carries
 *  on if the agent is still starting. */
export const WAKE_SCENE_MS = 2200;

export type WakePhase = 'asleep' | 'awake' | 'walking';

/** Where the scene is after `elapsedMs`. */
export function wakePhase(elapsedMs: number): WakePhase {
  if (elapsedMs < WAKE_AWAKE_AT_MS) return 'asleep';
  if (elapsedMs < WAKE_WALK_AT_MS) return 'awake';
  return 'walking';
}

/** How far into its loop the path is when its bench is centred in the view,
 *  under the agent. The wake-up starts here, so the agent wakes on the bench
 *  and the bench then walks off with the path; the arrival ends here. */
export const BENCH_PATH_OFFSET = PATH_BENCH_X + BENCH[0].length / 2 - WALK_VIEW_W / 2;
/** The same, as a head start for the path's scroll animation. */
export const WAKE_PATH_HEAD_START_SECONDS = BENCH_PATH_OFFSET / PATH_SPEED;

// ─── Arrival ───
// The wake-up in reverse, for a new conversation's first turn: the agent
// walks up the path to the bench, sits down with its laptop and, once its
// agent is working, starts typing. It stays there until the first reply.

/** Milliseconds of walking before the agent reaches the bench and sits. */
export const ARRIVE_SIT_AT_MS = 3000;
/** Milliseconds into the scene before it starts typing, at the earliest, so
 *  sitting down reads as a moment of its own. */
export const ARRIVE_TYPE_AT_MS = 3600;

export type ArrivePhase = 'walking' | 'seated' | 'typing';

/** Where the arrival is after `elapsedMs`. It types from 'typing' on only
 *  while its agent is working; until then it sits with the laptop open. */
export function arrivePhase(elapsedMs: number): ArrivePhase {
  if (elapsedMs < ARRIVE_SIT_AT_MS) return 'walking';
  if (elapsedMs < ARRIVE_TYPE_AT_MS) return 'seated';
  return 'typing';
}

/** How far into its loop the path starts for the arrival: as far short of
 *  the bench as the walk covers, so the bench reaches the centre just as the
 *  walk ends. The bench is in view, ahead, from the start. */
export const ARRIVE_PATH_FROM = BENCH_PATH_OFFSET - (ARRIVE_SIT_AT_MS / 1000) * PATH_SPEED;
