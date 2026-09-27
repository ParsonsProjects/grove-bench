// Sprite data and small pixel drawing helpers for the Night Grove scene.
// Everything is drawn with fillRect at integer coordinates on a low
// resolution canvas, so the art stays crisp when it is scaled up.

import { treeGreens } from '../shared/brand.js';
import { C, rgba, mix } from './palette.js';

// ---------------------------------------------------------------------------
// Utilities

/** Deterministic 0..1 hash for integer inputs. */
export function hash(a, b = 0) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Offscreen canvas helper. */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas: c, ctx };
}

/**
 * Turns a string map into a canvas. `.` is transparent, any other character
 * is looked up in `colours`.
 */
export function spriteFromMap(rows, colours) {
  const w = Math.max(...rows.map((r) => r.length));
  const { canvas, ctx } = makeCanvas(w, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || !colours[ch]) continue;
      ctx.fillStyle = colours[ch];
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

// ---------------------------------------------------------------------------
// Trees, built from the logo sprite. The logo is a 7 x 8 grid of blocks:
// five canopy rows, two trunk rows, one root row.

/**
 * @param {number} extraTrunk extra trunk rows for taller trees
 * @returns {{ c: number, r: number, kind: 'leaf' | 'trunk' | 'root', tone: number, order: number }[]}
 */
export function treeBlocks(extraTrunk = 0) {
  const leafTones = ['#6ec87a', '#5ab868', '#4aaa58', '#3a9a48'];
  const blocks = [];
  for (const p of treeGreens) {
    const c = p.x / 3;
    const r0 = p.y / 3;
    if (r0 <= 4) blocks.push({ c, r: r0, kind: 'leaf', tone: Math.max(0, leafTones.indexOf(p.fill)) });
    else if (r0 <= 6) blocks.push({ c, r: r0, kind: 'trunk', tone: 0 });
    else blocks.push({ c, r: r0 + extraTrunk, kind: 'root', tone: 0 });
  }
  for (let i = 0; i < extraTrunk; i++) blocks.push({ c: 3, r: 7 + i, kind: 'trunk', tone: 0 });

  const rows = 8 + extraTrunk;
  // Growth order: centre root, trunk bottom up, side roots, then the crown
  // spreading out from just above the trunk, the top block last.
  for (const b of blocks) {
    if (b.kind === 'root') b.order = b.c === 3 ? 0 : 50;
    else if (b.kind === 'trunk') b.order = 10 + (rows - b.r);
    else b.order = 100 + Math.abs(b.c - 3) * 1 + (4 - b.r) * 1.15;
  }
  blocks.sort((a, b) => a.order - b.order);
  return blocks;
}

export function treeSize(block, extraTrunk = 0) {
  const step = block + 1;
  return { w: 7 * step - 1, h: (8 + extraTrunk) * step - 1, step };
}

/**
 * Draws a tree whose root row sits on `baseY`, centred on `cx`.
 * `growth` 0..1 reveals the blocks in growth order, the newest one popping in.
 */
export function drawTree(ctx, cx, baseY, pal, { block = 7, extraTrunk = 1, growth = 1, blocks } = {}) {
  blocks ??= treeBlocks(extraTrunk);
  const { w, h, step } = treeSize(block, extraTrunk);
  const left = Math.round(cx - (w - 1) / 2);
  const top = baseY - h + 1;
  const total = blocks.length;
  const shown = Math.max(0, Math.min(total, growth * total));
  const full = Math.floor(shown);
  const set = new Set();
  for (let i = 0; i < full; i++) set.add(blocks[i].c + ',' + blocks[i].r);

  // Seams between neighbouring blocks so the canopy reads as one mass.
  for (let i = 0; i < full; i++) {
    const b = blocks[i];
    const x = left + b.c * step;
    const y = top + b.r * step;
    const seam = b.kind === 'leaf' ? pal.seam : pal.rootLo;
    if (set.has(b.c + 1 + ',' + b.r)) {
      const nb = blocks.find((o) => o.c === b.c + 1 && o.r === b.r);
      ctx.fillStyle = nb && nb.kind !== b.kind ? pal.rootLo : seam;
      ctx.fillRect(x + block, y, 1, block);
    }
    if (set.has(b.c + ',' + (b.r + 1))) {
      const below = blocks.find((o) => o.c === b.c && o.r === b.r + 1);
      ctx.fillStyle = below && below.kind !== b.kind ? pal.deep : seam;
      ctx.fillRect(x, y + block, block, 1);
      if (set.has(b.c + 1 + ',' + b.r) && set.has(b.c + 1 + ',' + (b.r + 1))) ctx.fillRect(x + block, y + block, 1, 1);
    }
  }

  for (let i = 0; i < Math.ceil(shown); i++) {
    const b = blocks[i];
    const partial = i === full ? shown - full : 1;
    const x = left + b.c * step;
    const y = top + b.r * step;
    if (partial < 1) {
      const s = Math.max(1, Math.round(block * partial));
      const o = Math.floor((block - s) / 2);
      ctx.fillStyle = b.kind === 'leaf' ? pal.hi : pal.trunkHi;
      ctx.fillRect(x + o, y + o, s, s);
      continue;
    }
    drawBlock(ctx, x, y, block, b, pal, i, set);
  }
  return { left, top, w, h };
}

function drawBlock(ctx, x, y, s, b, pal, i, set) {
  if (b.kind === 'leaf') {
    const base = pal.leaves[b.tone];
    const lighter = pal.leaves[Math.max(0, b.tone - 1)];
    ctx.fillStyle = base;
    ctx.fillRect(x, y, s, s);
    // Light from the upper left, brightest on edges open to the sky.
    const openTop = !set?.has(b.c + ',' + (b.r - 1));
    const openLeft = !set?.has(b.c - 1 + ',' + b.r);
    ctx.fillStyle = openTop || b.tone === 0 ? pal.hi : lighter;
    ctx.fillRect(x, y, s - 1, 1);
    if (openTop && s >= 7) {
      ctx.fillStyle = lighter;
      ctx.fillRect(x + 1, y + 1, s - 3, 1);
    }
    ctx.fillStyle = openLeft ? pal.hi : lighter;
    ctx.fillRect(x, y, 1, s - 1);
    ctx.fillStyle = pal.seam;
    ctx.fillRect(x + 1, y + s - 1, s - 1, 1);
    ctx.fillRect(x + s - 1, y + 1, 1, s - 1);
    // A few leaf flecks.
    ctx.fillStyle = pal.deep;
    const fx = 2 + Math.floor(hash(i, 3) * (s - 4));
    const fy = 2 + Math.floor(hash(i, 7) * (s - 4));
    ctx.fillRect(x + fx, y + fy, 1, 1);
    if (s >= 7) {
      ctx.fillStyle = lighter;
      ctx.fillRect(x + ((fx + 3) % (s - 3)) + 1, y + ((fy + 2) % (s - 3)) + 1, 1, 1);
    }
    return;
  }
  const isRoot = b.kind === 'root';
  ctx.fillStyle = isRoot ? pal.root : pal.trunk;
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = isRoot ? pal.trunk : pal.trunkHi;
  ctx.fillRect(x, y, 1, s);
  if (!isRoot) ctx.fillRect(x + 1, y, s - 2, 1);
  ctx.fillStyle = isRoot ? pal.rootLo : pal.trunkLo;
  ctx.fillRect(x + s - 1, y, 1, s);
  // Bark lines.
  ctx.fillRect(x + 2 + (i % 2), y + 1, 1, Math.max(1, s - 4));
  if (s >= 7) ctx.fillRect(x + s - 3, y + 3, 1, s - 4);
}

// ---------------------------------------------------------------------------
// Agents. Front view, sitting on a bench with a laptop on their lap.

export const SITTING = [
  '..hhhhh..',
  '.hhhhhhh.',
  '.hsssssh.',
  '.sessses.',
  '.sssssss.',
  '..sSSSs..',
  '.bbbbbbb.',
  'bbBbbbBbb',
  'bLLLLLLLb',
  'blllglllb',
  'slllllll' + 's',
  '.LLLLLLL.',
  '.pp...pp.',
  '.pp...pp.',
  '.ff...ff.',
];

const STANDING_A = [
  '..hhhhh..',
  '.hhhhhhh.',
  '.hsssssh.',
  '.sessses.',
  '.sssssss.',
  '..sSSSs..',
  '.bbbbbbb.',
  'bbbbbbbbb',
  'bbBbbbBbb',
  'bbbbbbbbb',
  's.bbbbb.s',
  '..ppppp..',
  '..pp.pp..',
  '..pp.pp..',
  '..ff.ff..',
];

const STANDING_B = [
  ...STANDING_A.slice(0, 12),
  '..pp.pp..',
  '.pp...pp.',
  '.ff...ff.',
];

function withBeanie(rows) {
  return ['..kkkkk..', '.kkkkkkk.', ...rows.slice(2)];
}

/** Pre-renders one agent's sprites. */
export function agentSprites(look) {
  const colours = {
    h: look.hair,
    k: look.beanie ?? look.hair,
    s: C.skin,
    S: C.skinShade,
    e: '#1e1e1e',
    b: look.hoodie,
    B: mix(look.hoodie, '#000000', 0.25),
    l: C.laptop,
    L: C.laptopEdge,
    g: mix(C.laptop, C.primaryLight, 0.6),
    p: C.pants,
    f: C.shoes,
  };
  const map = (rows) => spriteFromMap(look.beanie ? withBeanie(rows) : rows, colours);
  return { sit: map(SITTING), walkA: map(STANDING_A), walkB: map(STANDING_B), w: 9, h: 15 };
}

// ---------------------------------------------------------------------------
// Props

export const BENCH_W = 24;
export const BENCH_H = 13;

/** Bench, front view. (x, groundY) is the bottom left. */
export function drawBench(ctx, x, groundY) {
  const y = groundY - BENCH_H + 1;
  // Back posts.
  ctx.fillStyle = C.woodDark;
  ctx.fillRect(x + 1, y, 2, 9);
  ctx.fillRect(x + BENCH_W - 3, y, 2, 9);
  // Back planks.
  for (const py of [1, 4]) {
    ctx.fillStyle = C.wood;
    ctx.fillRect(x, y + py, BENCH_W, 2);
    ctx.fillStyle = C.woodPale;
    ctx.fillRect(x, y + py, BENCH_W, 1);
    ctx.fillStyle = C.woodDeep;
    ctx.fillRect(x, y + py + 2, BENCH_W, 1);
  }
  // Seat.
  ctx.fillStyle = C.woodPale;
  ctx.fillRect(x - 1, y + 7, BENCH_W + 2, 1);
  ctx.fillStyle = C.wood;
  ctx.fillRect(x - 1, y + 8, BENCH_W + 2, 1);
  ctx.fillStyle = C.woodDeep;
  ctx.fillRect(x - 1, y + 9, BENCH_W + 2, 1);
  // Legs.
  ctx.fillStyle = C.woodDark;
  ctx.fillRect(x + 1, y + 10, 2, 3);
  ctx.fillRect(x + BENCH_W - 3, y + 10, 2, 3);
}

/** Lantern on a post. Returns the centre of the glass for the glow. */
export function drawLamp(ctx, x, groundY) {
  const top = groundY - 21;
  ctx.fillStyle = C.woodDark;
  ctx.fillRect(x, top + 6, 2, 16);
  ctx.fillStyle = C.woodDeep;
  ctx.fillRect(x + 1, top + 6, 1, 16);
  // Lantern frame.
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(x - 1, top, 4, 1);
  ctx.fillRect(x - 2, top + 1, 6, 1);
  ctx.fillRect(x - 2, top + 2, 1, 3);
  ctx.fillRect(x + 3, top + 2, 1, 3);
  ctx.fillRect(x - 2, top + 5, 6, 1);
  return { gx: x - 1, gy: top + 2, gw: 4, gh: 3, cx: x + 1, cy: top + 3 };
}

/** Sign post (the board itself is an HTML overlay). */
export function drawSignPost(ctx, x, groundY, height = 13) {
  ctx.fillStyle = C.wood;
  ctx.fillRect(x, groundY - height + 1, 2, height);
  ctx.fillStyle = C.woodDark;
  ctx.fillRect(x + 1, groundY - height + 1, 1, height);
}

/** Gate at the end of the main path. */
export function drawGate(ctx, x, groundY) {
  const h = 30;
  const half = 13;
  for (const px of [x - half, x + half - 2]) {
    ctx.fillStyle = C.wood;
    ctx.fillRect(px, groundY - h + 1, 3, h);
    ctx.fillStyle = C.woodPale;
    ctx.fillRect(px, groundY - h + 1, 1, h);
    ctx.fillStyle = C.woodDark;
    ctx.fillRect(px + 2, groundY - h + 1, 1, h);
  }
  ctx.fillStyle = C.woodDark;
  ctx.fillRect(x - half - 2, groundY - h - 1, half * 2 + 3, 2);
  ctx.fillStyle = C.wood;
  ctx.fillRect(x - half - 3, groundY - h - 3, half * 2 + 5, 2);
  ctx.fillStyle = C.woodPale;
  ctx.fillRect(x - half - 3, groundY - h - 3, half * 2 + 5, 1);
  // Chains for the hanging board.
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(x - 6, groundY - h + 1, 1, 3);
  ctx.fillRect(x + 5, groundY - h + 1, 1, 3);
  return { boardX: x, boardY: groundY - h + 4 };
}

/** Sundial on a stone pedestal. `angle` is in radians, 0 = pointing right. */
export function drawSundial(ctx, x, groundY, angle, ticks = []) {
  const bronze = mix(C.wood, C.amber, 0.45);
  const bronzeDark = mix(C.woodDark, C.amber, 0.25);
  // Base and column.
  ctx.fillStyle = C.stoneDark;
  ctx.fillRect(x - 8, groundY - 1, 17, 2);
  ctx.fillStyle = C.stone;
  ctx.fillRect(x - 7, groundY - 3, 15, 2);
  ctx.fillStyle = C.stoneLight;
  ctx.fillRect(x - 7, groundY - 3, 15, 1);
  ctx.fillStyle = C.stone;
  ctx.fillRect(x - 4, groundY - 12, 9, 9);
  ctx.fillStyle = C.stoneLight;
  ctx.fillRect(x - 4, groundY - 12, 2, 9);
  ctx.fillStyle = C.stoneDark;
  ctx.fillRect(x + 3, groundY - 12, 2, 9);
  ctx.fillRect(x - 1, groundY - 11, 1, 7);
  // Capital.
  ctx.fillStyle = C.stoneLight;
  ctx.fillRect(x - 6, groundY - 14, 13, 2);
  ctx.fillStyle = C.stoneDark;
  ctx.fillRect(x - 6, groundY - 13, 13, 1);
  // Dial plate, a squashed disc with a thick rim.
  const cy = groundY - 18;
  const rx = 12;
  const ry = 4;
  ctx.fillStyle = C.stoneDark;
  for (let dy = 0; dy <= ry; dy++) {
    const span = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)));
    ctx.fillRect(x - span, cy + dy + 2, span * 2 + 1, 1);
  }
  for (let dy = -ry; dy <= ry; dy++) {
    const span = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)));
    ctx.fillStyle = dy <= -ry + 1 ? C.stoneLight : dy >= ry - 1 ? C.stone : C.cream;
    ctx.fillRect(x - span, cy + dy, span * 2 + 1, 1);
  }
  ctx.fillStyle = C.stoneLight;
  ctx.fillRect(x - rx + 2, cy - ry + 1, rx * 2 - 3, 1);
  // Hour marks on the rim.
  for (const t of ticks) {
    const tx = Math.round(x + Math.cos(t.angle) * (rx - 2));
    const ty = Math.round(cy + Math.sin(t.angle) * (ry - 1));
    ctx.fillStyle = t.active ? bronze : C.stone;
    ctx.fillRect(tx, ty, 1, 1);
    ctx.fillRect(tx + (Math.cos(t.angle) > 0 ? -1 : 1), ty, 1, 1);
  }
  // Shadow of the gnomon across the plate.
  ctx.fillStyle = C.stoneDeep;
  const len = rx - 3;
  for (let i = 0; i <= len; i++) {
    const px = Math.round(x + Math.cos(angle) * i);
    const py = Math.round(cy + Math.sin(angle) * i * (ry / rx) * 1.2);
    ctx.fillRect(px, py, 1, 1);
    if (i < len - 3) ctx.fillRect(px, py + 1, 1, 1);
  }
  // Gnomon, a bronze fin.
  ctx.fillStyle = bronze;
  for (let i = 0; i < 6; i++) ctx.fillRect(x, cy - 6 + i, 1 + Math.floor(i * 0.7), 1);
  ctx.fillStyle = bronzeDark;
  ctx.fillRect(x, cy - 1, 5, 1);
  ctx.fillStyle = mix(bronze, '#ffffff', 0.4);
  ctx.fillRect(x, cy - 6, 1, 2);
  return { cx: x, cy };
}

/** Memory stone, a mossy boulder with a rune. Returns the rune position. */
export function drawStone(ctx, x, groundY) {
  const rows = [
    '....ssssssss....',
    '..sSSSSSSSSSSs..',
    '.sSSSSSSSSSSSSd.',
    'sSSSSSSSSSSSSSdd',
    'sSSSSSSSSSSSSddd',
    'sSSSSSSSSSSSSddd',
    'sSSSSSSSSSSSdddd',
    'ddSSSSSSSSSddddd',
    '.dddddddddddddd.',
  ];
  const colours = { s: C.stoneLight, S: C.stone, d: C.stoneDark };
  const top = groundY - rows.length + 1;
  const left = x - 8;
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx];
      if (ch === '.') continue;
      ctx.fillStyle = colours[ch];
      ctx.fillRect(left + rx, top + ry, 1, 1);
    }
  });
  // Moss on top.
  ctx.fillStyle = C.moss;
  ctx.fillRect(left + 4, top, 6, 1);
  ctx.fillRect(left + 3, top + 1, 3, 1);
  ctx.fillRect(left + 11, top + 1, 2, 1);
  return runePixels(x, groundY);
}

/** Where the rune sits on a stone drawn at (x, groundY). */
export function runePixels(x, groundY) {
  const left = x - 8;
  const top = groundY - 8;
  return RUNE.map(([dx, dy]) => [left + 6 + dx, top + 2 + dy]);
}

// A small rune glyph, carved into the stone and lit from within.
const RUNE = [
  [1, 0], [2, 0], [3, 0],
  [2, 1],
  [0, 2], [1, 2], [2, 2], [3, 2], [4, 2],
  [2, 3],
  [1, 4], [3, 4],
];

// ---------------------------------------------------------------------------
// Sky objects

export function moonSprite() {
  const r = 7;
  const size = r * 2 + 1;
  const { canvas, ctx } = makeCanvas(size, size);
  const light = C.cream;
  const mid = mix(C.cream, C.primaryPale, 0.5);
  const dark = mix(C.primaryPale, '#6b7aa0', 0.55);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y);
      if (d > r + 0.3) continue;
      // Terminator on the lower left.
      const lit = x * 0.7 - y * 0.7;
      ctx.fillStyle = lit < -4 ? dark : lit < 1 ? mid : light;
      ctx.fillRect(x + r, y + r, 1, 1);
    }
  }
  // Craters.
  ctx.fillStyle = mix(mid, dark, 0.5);
  for (const [cx, cy, w] of [[9, 4, 2], [5, 8, 3], [10, 10, 1], [4, 4, 1]]) ctx.fillRect(cx, cy, w, w === 3 ? 2 : w);
  return canvas;
}

export function sunSprite() {
  const r = 7;
  const size = r * 2 + 1;
  const { canvas, ctx } = makeCanvas(size, size);
  const core = mix(C.amber, '#ffffff', 0.65);
  const rim = mix(C.amber, '#ffffff', 0.25);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y);
      if (d > r + 0.3) continue;
      ctx.fillStyle = d > r - 1.2 ? rim : core;
      ctx.fillRect(x + r, y + r, 1, 1);
    }
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// Glows. Dithered discs drawn with additive blending on top of the scene.

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const haloCache = new Map();

/** A dithered radial glow sprite, cached per colour and radius. */
export function halo(hex, radius, strength = 1) {
  const key = `${hex}|${radius}|${strength}`;
  let c = haloCache.get(key);
  if (c) return c;
  const size = radius * 2 + 1;
  const made = makeCanvas(size, size);
  const ctx = made.ctx;
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const d = Math.hypot(x, y) / radius;
      if (d > 1) continue;
      const v = (1 - d) ** 1.6 * strength;
      // Quantise to a few alpha steps, dither between them.
      const steps = 4;
      const q = v * steps;
      const lo = Math.floor(q);
      const frac = q - lo;
      const level = frac * 16 > BAYER[(y + 64) % 4][(x + 64) % 4] ? lo + 1 : lo;
      if (level <= 0) continue;
      ctx.fillStyle = rgba(hex, Math.min(1, level / steps) * 0.55);
      ctx.fillRect(x + radius, y + radius, 1, 1);
    }
  }
  c = made.canvas;
  haloCache.set(key, c);
  return c;
}

/** A glow made of a few solid pixel rings, cleaner than dithering for big lights. */
export function ringHalo(hex, radius, alphas = [0.16, 0.1, 0.05]) {
  const key = `ring|${hex}|${radius}|${alphas.join()}`;
  let c = haloCache.get(key);
  if (c) return c;
  const size = radius * 2 + 1;
  const made = makeCanvas(size, size);
  const n = alphas.length;
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const d = Math.hypot(x, y) / radius;
      if (d > 1) continue;
      const band = Math.min(n - 1, Math.floor(d * n));
      made.ctx.fillStyle = rgba(hex, alphas[band]);
      made.ctx.fillRect(x + radius, y + radius, 1, 1);
    }
  }
  c = made.canvas;
  haloCache.set(key, c);
  return c;
}

/** Puffy cloud mask: rows of [start, end) runs, plus which rows are the lit top. */
export function cloudShape(seed, w, h) {
  const puffs = [];
  const n = 3 + Math.floor(hash(seed, 1) * 3);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const r = h * (0.35 + 0.45 * Math.sin(Math.PI * t)) * (0.8 + hash(seed, i + 2) * 0.35);
    puffs.push({ x: w * (0.12 + 0.76 * t), y: h - r * 0.9, r });
  }
  const rows = [];
  for (let y = 0; y < h; y++) {
    let a = w;
    let b = -1;
    for (let x = 0; x < w; x++) {
      if (puffs.some((p) => Math.hypot(x - p.x, (y - p.y) * 1.25) <= p.r)) {
        a = Math.min(a, x);
        b = Math.max(b, x);
      }
    }
    rows.push(b >= a ? [a, b + 1] : null);
  }
  // Flat bottom.
  rows[h - 1] = rows[h - 2] ? [rows[h - 2][0] + 1, rows[h - 2][1] - 1] : rows[h - 1];
  return rows;
}

/** Bayer threshold (0..1) for ordered dithering. */
export function bayer(x, y) {
  return (BAYER[((y % 4) + 4) % 4][((x % 4) + 4) % 4] + 0.5) / 16;
}
