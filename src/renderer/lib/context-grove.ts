/**
 * The context grove: a strip of pixel plants along the top of the status bar
 * that fills in as a conversation uses up its context window. Bare ground at
 * 0%, a full grove at 100%, thinning out again after a compact or clear.
 *
 * Where each plant stands, what it grows into and when it sprouts are random,
 * seeded by the conversation id. So each conversation keeps its own grove, and
 * plants grow where they stand rather than jumping about as the context fills.
 *
 * In the open conversation the grove plays out each change (see GroveGrowth):
 * plants sprout one after another and each rises out of the ground.
 */
import { hashString } from './agent-sprite.js';

/** Strip size in art pixels. Wide enough for a 4K screen; the bar clips it. */
export const GROVE_W = 2048;
export const GROVE_H = 8;
/** Screen pixels per art pixel. */
export const GROVE_SCALE = 2;
/** Percent of the context window between one growth stage and the next. */
export const GROVE_STAGE_GAP = 12;
/** Milliseconds between animation frames: whole-pixel steps, a few a second. */
export const GROVE_STEP_MS = 80;
/** Milliseconds a plant takes to rise out of the ground. */
export const GROVE_GROW_MS = 480;

// The logo tree's colours, lightest at the top.
const PALETTE: Record<string, string> = {
  a: '#6ec87a',
  b: '#5ab868',
  c: '#4aaa58',
  d: '#3a9a48',
  t: '#8a6a4a',
  r: '#6a5040',
};
const BLOOMS = ['#e8c65a', '#e88aa6', '#e6e1d6'];

const TUFT = ['d.d', '.d.'];
const FLOWER = ['.f.', 'd.d', '.d.'];
const BUSH = ['.bab.', 'bcccb', 'cdddc'];
const SAPLING = ['.b.', 'bcb', '.t.'];
const YOUNG_TREE = ['..a..', '.bbb.', 'ccccc', '.ddd.', '..t..', '..t..'];
// The logo tree with its gaps closed up.
const TREE = ['...a...', '..bbb..', '.ccccc.', 'ddddddd', '.ddddd.', '...t...', '...t...', '..rrr..'];

export type GrovePlantKind = 'tree' | 'small-tree' | 'bush' | 'grass';

/** What each kind of plant looks like at each stage, smallest first. */
const STAGES: Record<GrovePlantKind, string[][]> = {
  tree: [SAPLING, YOUNG_TREE, TREE],
  // Stays young, so a full grove has an uneven skyline.
  'small-tree': [SAPLING, YOUNG_TREE],
  bush: [TUFT, BUSH],
  grass: [TUFT],
};

export interface GrovePlant {
  /** Centre column, in art pixels. */
  x: number;
  kind: GrovePlantKind;
  /** Percent of context used at which it sprouts. Each later stage comes GROVE_STAGE_GAP after the last. */
  at: number;
  /** Drawn dimmed, behind the others. */
  far: boolean;
  /** Flower colour, for grass in bloom. */
  bloom: string | null;
}

export interface GroveRun {
  x: number;
  y: number;
  w: number;
  fill: string;
  far: boolean;
}

export interface GrovePath {
  key: string;
  fill: string;
  far: boolean;
  d: string;
}

/** Mulberry32: a small seeded random number generator, giving [0, 1). */
function seededRandom(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A conversation's grove: every plant it will grow, left to right. */
export function groveLayout(seed: string): GrovePlant[] {
  const random = seededRandom(hashString(seed));
  const plants: GrovePlant[] = [];
  // Mostly 2 to 6 art pixels apart, so the trees crowd and overlap like a
  // grove, with the odd clearing.
  const gap = () => 2 + Math.floor(random() * 5) + (random() < 0.08 ? 6 + Math.floor(random() * 10) : 0);
  for (let x = 1 + Math.floor(random() * 4); x < GROVE_W; x += gap()) {
    const roll = random();
    const kind: GrovePlantKind = roll < 0.3 ? 'tree' : roll < 0.47 ? 'small-tree' : roll < 0.67 ? 'bush' : 'grass';
    // Above 0%, so bare ground stays bare, and early enough that it is fully
    // grown by 100%.
    const span = 100 - (STAGES[kind].length - 1) * GROVE_STAGE_GAP;
    const at = (1 - random()) * span;
    const far = (kind === 'tree' || kind === 'small-tree') && random() < 0.4;
    const bloom = kind === 'grass' && random() < 0.35 ? BLOOMS[Math.floor(random() * BLOOMS.length)] : null;
    plants.push({ x, kind, at, far, bloom });
  }
  return plants;
}

/** The plant's growth stage with this much context used, or -1 before it sprouts. */
export function plantStage(plant: GrovePlant, percent: number): number {
  if (percent < plant.at) return -1;
  return Math.min(STAGES[plant.kind].length - 1, Math.floor((percent - plant.at) / GROVE_STAGE_GAP));
}

/**
 * The grove with this much context used, as one-pixel-high runs. Plants are
 * painted onto a pixel grid, far ones first, so nearer plants cover them and
 * each pixel ends up a single colour.
 *
 * `growth` holds how far each growing plant (by index) has risen, from 0 to 1.
 * A growing plant comes up out of the ground in front of its stage before.
 */
export function groveRuns(plants: GrovePlant[], percent: number, growth: ReadonlyMap<number, number> = new Map()): GroveRun[] {
  const fills: (string | null)[] = new Array(GROVE_W * GROVE_H).fill(null);
  const far: boolean[] = new Array(GROVE_W * GROVE_H).fill(false);

  function paint(plant: GrovePlant, stage: number, risen: number) {
    const map = plant.bloom ? FLOWER : STAGES[plant.kind][stage];
    // Only the top rows show while it rises; the rest is still underground.
    const rows = risen >= 1 ? map.length : Math.max(1, Math.ceil(risen * map.length));
    // Centred on the plant's column and standing on the bottom row, so each
    // stage grows out of the last.
    const left = plant.x - Math.floor(map[0].length / 2);
    const top = GROVE_H - rows;
    for (let dy = 0; dy < rows; dy++) {
      const row = map[dy];
      for (let dx = 0; dx < row.length; dx++) {
        const x = left + dx;
        const fill = row[dx] === 'f' ? plant.bloom : PALETTE[row[dx]];
        if (!fill || x < 0 || x >= GROVE_W) continue;
        const i = (top + dy) * GROVE_W + x;
        fills[i] = fill;
        far[i] = plant.far;
      }
    }
  }

  const indexes = plants.map((_, i) => i);
  const painted = [...indexes.filter((i) => plants[i].far), ...indexes.filter((i) => !plants[i].far)];
  for (const i of painted) {
    const plant = plants[i];
    const stage = plantStage(plant, percent);
    if (stage < 0) continue;
    const risen = growth.get(i) ?? 1;
    if (risen < 1 && stage > 0) paint(plant, stage - 1, 1);
    paint(plant, stage, risen);
  }

  const runs: GroveRun[] = [];
  for (let y = 0; y < GROVE_H; y++) {
    let x = 0;
    while (x < GROVE_W) {
      const i = y * GROVE_W + x;
      const fill = fills[i];
      if (!fill) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < GROVE_W && fills[i + w] === fill && far[i + w] === far[i]) w++;
      runs.push({ x, y, w, fill, far: far[i] });
      x += w;
    }
  }
  return runs;
}

/**
 * The runs gathered into one SVG path per colour. Every conversation's status
 * bar is mounted at once, so a full grove stays a handful of elements.
 */
export function grovePaths(runs: GroveRun[]): GrovePath[] {
  const byKey = new Map<string, GrovePath>();
  for (const r of runs) {
    const key = `${r.far ? 'far' : 'near'} ${r.fill}`;
    let path = byKey.get(key);
    if (!path) {
      path = { key, fill: r.fill, far: r.far, d: '' };
      byKey.set(key, path);
    }
    path.d += `M${r.x} ${r.y}h${r.w}v1h-${r.w}z`;
  }
  return [...byKey.values()];
}

/** How long the grove takes to sweep across this many percent. */
export function groveSweepMs(delta: number): number {
  return delta > 0 ? Math.min(2400, 300 + delta * 80) : 0;
}

export interface GroveFrame {
  /** The percent to draw the grove at. */
  percent: number;
  /** How far each growing plant has risen (see groveRuns). */
  growth: ReadonlyMap<number, number>;
  /** Nothing left to play until the next retarget. */
  done: boolean;
}

/**
 * Plays the grove from one amount of context to another. The drawn percent
 * sweeps across, so plants sprout one after another, and each plant that
 * sprouts or moves up a stage rises out of the ground over GROVE_GROW_MS.
 * Plants that go (after a compact or clear) just go, one after another.
 */
export class GroveGrowth {
  private from = 0;
  private to = 0;
  private start = 0;
  private duration = 0;
  /** Each plant's stage as last drawn. */
  private stages: number[] = [];
  /** When each growing plant reached its stage. */
  private sproutedAt = new Map<number, number>();

  constructor(
    readonly plants: GrovePlant[],
    percent: number,
  ) {
    this.settle(percent);
  }

  /** Jumps straight to `percent`, with nothing growing. */
  settle(percent: number): void {
    this.from = this.to = percent;
    this.duration = 0;
    this.stages = this.plants.map((p) => plantStage(p, percent));
    this.sproutedAt.clear();
  }

  /** Sweeps towards `percent`, carrying on from wherever the grove is at `now`. */
  retarget(percent: number, now: number): void {
    const from = this.frame(now).percent;
    this.from = from;
    this.to = percent;
    this.start = now;
    this.duration = groveSweepMs(Math.abs(percent - from));
  }

  /** The grove at `now`. Frames must be asked for in time order. */
  frame(now: number): GroveFrame {
    const t = this.duration > 0 ? Math.min(1, (now - this.start) / this.duration) : 1;
    const percent = this.from + (this.to - this.from) * t;
    this.plants.forEach((plant, i) => {
      const stage = plantStage(plant, percent);
      if (stage > this.stages[i]) this.sproutedAt.set(i, now);
      else if (stage < this.stages[i]) this.sproutedAt.delete(i);
      this.stages[i] = stage;
    });
    const growth = new Map<number, number>();
    for (const [i, at] of this.sproutedAt) {
      const risen = (now - at) / GROVE_GROW_MS;
      if (risen >= 1) this.sproutedAt.delete(i);
      else growth.set(i, risen);
    }
    return { percent, growth, done: t === 1 && growth.size === 0 };
  }
}
