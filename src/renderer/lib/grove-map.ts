/**
 * The grove map (alpha, Settings > Grove map): where everything goes when
 * no thread is open. Each project is a log cabin room; each of its open
 * threads is a person at a desk. Desks are pushed together in fours: the
 * back row faces you, the front row faces away, its screens lit in the
 * thread's status colour. Rooms stack in two columns, joined by paths, with
 * a garden below and trees in the space between.
 *
 * Everything here is plain data on a 6px grid ("art units"), so the layout
 * can be tested without a DOM. GroveMap.svelte draws the scenery on a canvas
 * and the people, tags and banners on top.
 */
import type { AgentSpriteState } from './agent-sprite.js';
import {
  type Art, GROUND, BLOOMS, ROOM, ROUND_TREE, PINE, SMALL_TREE, BUSH, ROCK, MUSHROOM, POND, LAMP_POST, BENCH, SIGNPOST,
  WINDOW, CLOCK, NOTICE_BOARD, BOOKSHELF, BIG_PLANT, DESK_PLANT, LANTERN, CRATE, PAPERS, MUG, EASEL, WATERING_CAN, SPROUT,
  FLAG, fence, desks,
} from './grove-map-art.js';

/** Screen pixels per art unit. */
export const MAP_SCALE = 6;

/** The map's width, in art units. */
const MAP_W = 176;
/** A room's width, its back wall's height, and the desks' left edge. */
const ROOM_W = 76;
const WALL_H = 16;
const DESK_X = 16;
/** A seat's width: one desk. */
const SEAT_W = 22;
/** The first back row's top, and the distance from one cluster of four
 *  desks to the next, room for the banners in between. */
const FIRST_ROW = 25;
const CLUSTER_STRIDE = 37;
/** The two columns of rooms, the path between them, and the gap between
 *  rooms in a column (a path runs through it). */
const COLUMN_X = [6, 94] as const;
const GUTTER_X = 84;
const PATH_W = 4;
const FIRST_ROOM_Y = 12;
const ROOM_GAP = 16;
/** The door: a gap in the front step, centred. */
const DOOR_X = 34;
const DOOR_W = 8;
const GARDEN_H = 44;
/** The back row's people show down to their laptop: the desk hides the rest. */
const BACK_ROW_ROWS = 7;

export interface MapThread {
  id: string;
  name: string;
  state: AgentSpriteState;
  /** Background agents (subagents) it is running now. */
  helpers: number;
}

export interface MapProject {
  repo: string;
  name: string;
  /** The project colour, or null when there is none to show. */
  color: string | null;
  /** Its open threads, in sidebar order. */
  threads: MapThread[];
}

/** One rectangle of scenery, in art units. */
export interface Pixel { x: number; y: number; w: number; h: number; fill: string }

/** A thread's seat. Positions are screen pixels on the map. */
export interface MapSeat {
  id: string;
  /** Its project, whose room it is in. */
  repo: string;
  name: string;
  state: AgentSpriteState;
  projectColor: string | null;
  /** 'front': back row, facing you. 'back': front row, facing its desk. */
  facing: 'front' | 'back';
  /** The click area. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The person, relative to the click area; `cropRows` hides what the
   *  desk covers. */
  spriteX: number;
  spriteY: number;
  cropRows: number | null;
  /** The name tag's centre and top, and the banner's top. */
  tagX: number;
  tagY: number;
  calloutY: number;
  /** The front row's lit screen, relative to the click area. */
  screen: { x: number; y: number } | null;
  callout: 'attention' | 'error' | null;
}

/** A subagent at work beside its thread's desk. Screen pixels. */
export interface MapHelper { key: string; repo: string; seed: string; projectColor: string | null; x: number; y: number }

/** A room, for its sign. Screen pixels. */
export interface MapRoom { repo: string; name: string; color: string | null; threads: number; x: number; y: number; w: number; h: number }

/** A pool of lamp light, centred on x, y. Screen pixels. */
export interface MapGlow { x: number; y: number; size: number }

/** A firefly. Screen pixels, and a delay so they don't blink together. */
export interface MapFly { x: number; y: number; delay: number }

export interface GroveMapLayout {
  /** The scenery's size in art units (the canvas), and on screen. */
  cols: number;
  rows: number;
  width: number;
  height: number;
  rooms: MapRoom[];
  seats: MapSeat[];
  helpers: MapHelper[];
  /** Back to front. */
  scenery: Pixel[];
  glows: MapGlow[];
  flies: MapFly[];
}

interface Rect { x: number; y: number; w: number; h: number }

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });

/** FNV-1a over two numbers: the same spot always gets the same thing. */
function hash2(a: number, b: number): number {
  let h = 0x811c9dc5;
  for (const n of [a, b, a * 31 + b]) {
    h ^= n & 0xffff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/** Mulberry32: a small seeded random number generator, giving [0, 1). */
function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A room's height for `n` threads: a cluster of four desks per four
 *  threads, the last with a front row only when it has more than two. */
export function roomHeight(n: number): number {
  const clusters = Math.max(1, Math.ceil(n / 4));
  const last = n - (clusters - 1) * 4;
  return FIRST_ROW + CLUSTER_STRIDE * (clusters - 1) + (last > 2 ? 35 : 27);
}

function callout(state: AgentSpriteState): MapSeat['callout'] {
  if (state === 'permission' || state === 'asking') return 'attention';
  if (state === 'error') return 'error';
  return null;
}

/** Turns a map into runs of one colour, placed at x, y. */
function draw(out: Pixel[], a: Art, x: number, y: number): void {
  a.rows.forEach((row, dy) => {
    let dx = 0;
    while (dx < row.length) {
      const key = row[dx];
      if (key === '.' || !(key in a.pal)) {
        dx++;
        continue;
      }
      let w = 1;
      while (row[dx + w] === key) w++;
      out.push({ x: x + dx, y: y + dy, w, h: 1, fill: a.pal[key] });
      dx += w;
    }
  });
}

const size = (a: Art): { w: number; h: number } => ({ w: a.rows[0].length, h: a.rows.length });

export function layoutGroveMap(projects: MapProject[]): GroveMapLayout {
  const M = MAP_SCALE;
  const shown = projects.filter((p) => p.threads.length > 0);

  // Rooms, into the shorter column.
  const columnY = [FIRST_ROOM_Y, FIRST_ROOM_Y];
  const placed = shown.map((p, index) => {
    const column = columnY[0] <= columnY[1] ? 0 : 1;
    const h = roomHeight(p.threads.length);
    const room = { project: p, index, column, x: COLUMN_X[column], y: columnY[column], w: ROOM_W, h };
    columnY[column] += h + ROOM_GAP;
    return room;
  });
  const lowest = Math.max(FIRST_ROOM_Y, ...placed.map((r) => r.y + r.h));
  const mainPathY = lowest + 12;
  const gardenY = mainPathY + PATH_W + 2;
  const rowsTotal = gardenY + GARDEN_H;

  // A path along the bottom. The lowest room in each column walks straight
  // down to it; a room with another under it turns along the gap between
  // them to a path between the columns.
  const paths: Rect[] = [{ x: 0, y: mainPathY, w: MAP_W, h: PATH_W }];
  const lastInColumn = new Set([0, 1].map((c) => placed.filter((r) => r.column === c).pop()));
  let gutterTop = Infinity;
  for (const r of placed) {
    const bottom = r.y + r.h;
    const doorMid = r.x + DOOR_X + DOOR_W / 2;
    if (lastInColumn.has(r)) {
      paths.push({ x: doorMid - PATH_W / 2, y: bottom, w: PATH_W, h: mainPathY - bottom });
      continue;
    }
    paths.push({ x: doorMid - PATH_W / 2, y: bottom, w: PATH_W, h: 6 });
    paths.push(r.column === 0
      ? { x: doorMid - PATH_W / 2, y: bottom + 5, w: GUTTER_X + PATH_W - (doorMid - PATH_W / 2), h: PATH_W }
      : { x: GUTTER_X, y: bottom + 5, w: doorMid + PATH_W / 2 - GUTTER_X, h: PATH_W });
    gutterTop = Math.min(gutterTop, bottom + 5);
  }
  if (gutterTop < mainPathY) paths.push({ x: GUTTER_X, y: gutterTop, w: PATH_W, h: mainPathY - gutterTop });

  // What the scenery mustn't cover: rooms (with their shadow) and paths.
  const taken: Rect[] = [
    ...placed.map((r) => grow({ x: r.x, y: r.y, w: r.w, h: r.h + 2 }, 2)),
    ...paths.map((p) => grow(p, 1)),
    { x: 0, y: mainPathY - 1, w: MAP_W, h: rowsTotal - mainPathY + 1 },
  ];
  const isFree = (r: Rect) => r.x >= 0 && r.x + r.w <= MAP_W && r.y >= 0 && !taken.some((t) => overlaps(r, t));

  const ground: Pixel[] = [{ x: 0, y: 0, w: MAP_W, h: rowsTotal, fill: GROUND.grass }];
  const rand = seeded(7);
  for (let i = 0; i < Math.round(rowsTotal / 3.5); i++) {
    ground.push({ x: Math.floor(rand() * MAP_W), y: Math.floor(rand() * rowsTotal), w: 2 + Math.floor(rand() * 5), h: 1 + Math.floor(rand() * 3), fill: GROUND.patch });
  }
  for (let i = 0; i < rowsTotal; i++) {
    const x = Math.floor(rand() * (MAP_W - 3));
    const y = Math.floor(rand() * (rowsTotal - 2));
    const fill = rand() < 0.5 ? GROUND.tuftDark : GROUND.tuftLight;
    ground.push({ x, y, w: 1, h: 1, fill }, { x: x + 2, y, w: 1, h: 1, fill }, { x: x + 1, y: y + 1, w: 1, h: 1, fill });
  }
  for (let i = 0; i < Math.round(rowsTotal / 6); i++) {
    ground.push({ x: Math.floor(rand() * MAP_W), y: Math.floor(rand() * rowsTotal), w: 1, h: 1, fill: BLOOMS[i % BLOOMS.length] });
  }
  for (const p of paths) {
    ground.push({ ...p, fill: GROUND.path }, { x: p.x, y: p.y, w: p.w, h: 1, fill: GROUND.pathEdge });
    for (let i = 0; i < Math.round((p.w * p.h) / 9); i++) {
      ground.push({ x: p.x + 1 + Math.floor(rand() * Math.max(1, p.w - 2)), y: p.y + 1 + Math.floor(rand() * Math.max(1, p.h - 2)), w: 1, h: 1, fill: rand() < 0.5 ? GROUND.pebble : GROUND.pebbleLight });
    }
  }

  // Scenery that stands in the grass, drawn back to front.
  const standing: { art: Art; x: number; y: number }[] = [];
  const glows: MapGlow[] = [];
  const stand = (a: Art, x: number, y: number) => standing.push({ art: a, x, y });
  const lamp = (x: number, y: number) => {
    stand(LAMP_POST, x, y);
    glows.push({ x: (x + 2.5) * M, y: (y + 2) * M, size: 220 });
  };

  // The treeline along the top.
  for (let x = 0, i = 0; x < MAP_W - 6; x += 12, i++) {
    const a = i % 3 === 1 ? ROUND_TREE : PINE;
    stand(a, x - (a === ROUND_TREE ? 1 : 0), -9 + Math.floor(hash2(x, 1) * 5));
  }

  // Lamps by the path between the columns, where there's room.
  for (let y = FIRST_ROOM_Y + 18; y + 16 < mainPathY; y += 44) {
    const spot = { x: GUTTER_X + PATH_W + 1, y, w: 5, h: 16 };
    if (isFree(spot)) {
      lamp(spot.x, spot.y);
      taken.push(spot);
    }
  }

  // The space between: a big tree where a 20-unit square is free, else a
  // smaller thing, chosen by place so it stays put.
  for (let y = 2; y + 20 <= mainPathY - 1; y += 10) {
    for (let x = 0; x + 20 <= MAP_W; x += 10) {
      const cell = { x, y, w: 20, h: 20 };
      if (!isFree(cell) || hash2(x, y) > 0.55) continue;
      const a = hash2(y, x) < 0.5 ? ROUND_TREE : PINE;
      const { w, h } = size(a);
      const spot = { x: x + Math.floor(hash2(x + 3, y) * (20 - w)), y: y + Math.floor(hash2(x, y + 3) * (20 - h)), w, h };
      stand(a, spot.x, spot.y);
      taken.push(spot);
    }
  }
  const small = [SMALL_TREE, BUSH, BUSH, ROCK, MUSHROOM];
  for (let y = 2; y + 10 <= mainPathY - 1; y += 10) {
    for (let x = 0; x + 10 <= MAP_W; x += 10) {
      const cell = { x, y, w: 10, h: 10 };
      const roll = hash2(x + 101, y);
      if (!isFree(cell) || roll > 0.7) continue;
      const a = small[Math.floor(hash2(x, y + 101) * small.length)];
      const { w, h } = size(a);
      const spot = { x: x + Math.floor(hash2(x + 7, y) * (10 - w)), y: y + Math.floor(hash2(x, y + 7) * (10 - h)), w, h };
      stand(a, spot.x, spot.y);
      taken.push(spot);
    }
  }

  // The garden, below the path along the bottom.
  const g = gardenY;
  const garden: Pixel[] = [];
  for (const bed of [{ x: 66, y: g + 8 }, { x: 66, y: g + 16 }, { x: 96, y: g + 8 }, { x: 96, y: g + 16 }]) {
    garden.push({ x: bed.x, y: bed.y, w: 14, h: 5, fill: GROUND.bedEdge }, { x: bed.x + 1, y: bed.y + 1, w: 12, h: 3, fill: GROUND.bed });
    for (let i = 0; i < 6; i++) {
      garden.push({ x: bed.x + 2 + i * 2, y: bed.y + 1, w: 1, h: 1, fill: BLOOMS[(i + bed.y) % BLOOMS.length] }, { x: bed.x + 2 + i * 2, y: bed.y + 2, w: 1, h: 1, fill: GROUND.tuftLight });
    }
  }
  draw(garden, POND, 8, g + 10);
  stand(fence(38), 1, g);
  stand(fence(36), 48, g);
  stand(fence(36), 92, g);
  stand(fence(38), 137, g);
  stand(BENCH, 30, g + 18);
  stand(BENCH, 50, g + 18);
  stand(BENCH, 118, g + 18);
  stand(BENCH, 140, g + 18);
  stand(SIGNPOST, 160, g + 8);
  for (const [a, x, y] of [[ROCK, 32, g + 12], [ROCK, 4, g + 8], [ROCK, 84, g + 14], [MUSHROOM, 26, g + 28], [MUSHROOM, 61, g + 26], [MUSHROOM, 128, g + 30]] as const) stand(a, x, y);
  for (const [a, x] of [[ROUND_TREE, 0], [PINE, 22], [ROUND_TREE, 44], [PINE, 70], [ROUND_TREE, 98], [PINE, 124], [ROUND_TREE, 146], [PINE, 164]] as const) {
    stand(a, x, g + 27 + Math.floor(hash2(x, g) * 3));
  }
  lamp(44, g + 2);
  lamp(133, g + 2);

  standing.sort((a, b) => (a.y + a.art.rows.length) - (b.y + b.art.rows.length));
  const trees: Pixel[] = [];
  for (const s of standing) draw(trees, s.art, s.x, s.y);

  // The rooms, and the people in them.
  const roomsOut: MapRoom[] = [];
  const seats: MapSeat[] = [];
  const helpers: MapHelper[] = [];
  const inside: Pixel[] = [];
  for (const r of placed) {
    const p = r.project;
    const px = (x: number) => (r.x + x) * M;
    const py = (y: number) => (r.y + y) * M;
    const at = (x: number, y: number, w: number, h: number, fill: string) => inside.push({ x: r.x + x, y: r.y + y, w, h, fill });
    at(0, r.h, ROOM_W, 2, ROOM.shadow);
    // Floor, a two-tone check.
    at(2, WALL_H, ROOM_W - 4, r.h - WALL_H - 2, ROOM.floor);
    for (let y = WALL_H; y < r.h - 2; y += 4) {
      for (let x = 2 + (((y - WALL_H) / 4) % 2) * 4; x < ROOM_W - 2; x += 8) at(x, y, Math.min(4, ROOM_W - 2 - x), Math.min(4, r.h - 2 - y), ROOM.floorAlt);
    }
    // Back wall: logs under a cap, a trim along the floor.
    at(0, 0, ROOM_W, WALL_H, ROOM.log);
    for (let y = 3; y < WALL_H - 1; y += 3) at(0, y, ROOM_W, 1, ROOM.logSeam);
    at(0, 0, ROOM_W, 1, ROOM.wallCap);
    at(0, WALL_H - 1, ROOM_W, 1, ROOM.trim);
    // Side walls, and the step in front with its door.
    at(0, 0, 2, r.h, ROOM.side);
    at(1, WALL_H, 1, r.h - WALL_H, ROOM.sideInner);
    at(ROOM_W - 2, 0, 2, r.h, ROOM.side);
    at(ROOM_W - 2, WALL_H, 1, r.h - WALL_H, ROOM.sideInner);
    at(0, r.h - 2, DOOR_X, 2, ROOM.step);
    at(0, r.h - 2, DOOR_X, 1, ROOM.stepTop);
    at(DOOR_X + DOOR_W, r.h - 2, ROOM_W - DOOR_X - DOOR_W, 2, ROOM.step);
    at(DOOR_X + DOOR_W, r.h - 2, ROOM_W - DOOR_X - DOOR_W, 1, ROOM.stepTop);

    const color = p.color ?? '#a8a29e';
    const decor: Pixel[] = [];
    const place = (a: Art, x: number, y: number) => draw(decor, a, r.x + x, r.y + y);
    place(WINDOW, 18, 6);
    place(WINDOW, 48, 6);
    place(CLOCK, 36, 8);
    place(NOTICE_BOARD, 62, 6);
    place(BOOKSHELF, 3, 7);
    place(BIG_PLANT, 64, 16);
    const touch = r.index % 3;
    if (touch === 0) place(EASEL, 64, 30);
    if (touch === 1) {
      place(WATERING_CAN, 62, 32);
      place(SPROUT, 71, 35);
    }
    if (touch === 2) place(FLAG, 66, 28);
    if (touch !== 1) place(CRATE, 66, r.h - 9);
    place(LANTERN, 3, r.h - 18);
    glows.push({ x: px(5.5), y: py(r.h - 16), size: 150 });

    p.threads.forEach((t, i) => {
      const cluster = Math.floor(i / 4);
      const inCluster = Math.min(4, p.threads.length - cluster * 4);
      const k = i % 4;
      const top = FIRST_ROW + cluster * CLUSTER_STRIDE;
      const deskX = DESK_X + (k % 2) * SEAT_W;
      if (k === 0) {
        const twoSided = inCluster > 2;
        // The rug, three rings in the project colour over the floor.
        const rug = { x: DESK_X - 3, y: top - 2, w: 50, h: twoSided ? 23 : 25 };
        at(rug.x, rug.y, rug.w, rug.h, mix(color, ROOM.floor, 0.3));
        at(rug.x + 1, rug.y + 1, rug.w - 2, rug.h - 2, mix(color, ROOM.floor, 0.12));
        at(rug.x + 2, rug.y + 2, rug.w - 4, rug.h - 4, mix(color, ROOM.floor, 0.2));
        at(rug.x + 3, rug.y + 3, rug.w - 6, rug.h - 6, mix(color, ROOM.floor, 0.12));
        place(desks(inCluster > 1 ? 2 : 1, twoSided), DESK_X, top + 7);
      }
      const front = k < 2;
      if (front) {
        place(PAPERS, deskX + 2, top + 8);
        place(MUG, deskX + 16, top + 8);
        const seatY = top - 8;
        seats.push({
          id: t.id, repo: p.repo, name: t.name, state: t.state, projectColor: p.color, facing: 'front',
          x: px(deskX), y: py(seatY), w: SEAT_W * M, h: 16 * M,
          spriteX: (t.state === 'starting' ? 12 : 8) * M, spriteY: 8 * M, cropRows: BACK_ROW_ROWS,
          tagX: 11 * M, tagY: 4 * M, calloutY: 0,
          screen: null, callout: callout(t.state),
        });
        const facingSeatTaken = k + 2 < inCluster;
        if (!facingSeatTaken) {
          for (let n = 0; n < Math.min(2, t.helpers); n++) {
            helpers.push({ key: `${t.id}:${n}`, repo: p.repo, seed: `${t.id}:helper:${n}`, projectColor: p.color, x: px(deskX + 3 + n * 8), y: py(top + 16) });
          }
        }
      } else {
        place(DESK_PLANT, deskX + 17, top + 12);
        const seatY = top + 8;
        seats.push({
          id: t.id, repo: p.repo, name: t.name, state: t.state, projectColor: p.color, facing: 'back',
          x: px(deskX), y: py(seatY), w: SEAT_W * M, h: 21 * M,
          spriteX: 8 * M, spriteY: 4 * M, cropRows: null,
          tagX: 11 * M, tagY: 13 * M + 2, calloutY: 17 * M,
          screen: { x: 8 * M, y: 0 }, callout: callout(t.state),
        });
      }
    });
    inside.push(...decor);
    roomsOut.push({ repo: p.repo, name: p.name, color: p.color, threads: p.threads.length, x: px(0), y: py(0), w: ROOM_W * M, h: r.h * M });
  }

  // Fireflies over the open grass.
  const fly = seeded(23);
  const flies: MapFly[] = [];
  for (let tries = 0; flies.length < 18 && tries < 400; tries++) {
    const x = Math.floor(fly() * MAP_W);
    const y = Math.floor(fly() * rowsTotal);
    if (!placed.some((r) => overlaps({ x, y, w: 1, h: 1 }, { x: r.x, y: r.y, w: r.w, h: r.h }))) {
      flies.push({ x: x * M, y: y * M, delay: Math.round(fly() * 300) / 100 });
    }
  }

  return {
    cols: MAP_W,
    rows: rowsTotal,
    width: MAP_W * M,
    height: rowsTotal * M,
    rooms: roomsOut,
    seats,
    helpers,
    scenery: [...ground, ...garden, ...trees, ...inside],
    glows,
    flies,
  };
}

/** `a` over `b` at strength `t`, for the rugs: the project colour woven into
 *  the floor. Both are #rrggbb; anything else stands in as grey. */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(/^#[0-9a-f]{6}$/i.test(a) ? a.slice(1) : 'a8a29e', 16);
  const pb = parseInt(b.slice(1), 16);
  return '#' + [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) * t + ((pb >> s) & 255) * (1 - t)).toString(16).padStart(2, '0')).join('');
}
