// Pixel art pieces that only the Canopy scene needs. Everything else comes
// from the Night Grove sprites and palette (imported, not copied).

import { treeBlocks, drawTree, makeCanvas, spriteFromMap, hash } from '../grove/sprites.js';
import { C, mix } from '../grove/palette.js';

// ---------------------------------------------------------------------------
// The crown: the logo tree's crown, each logo block made of n x n leaf blocks.

/**
 * @param {number} block small leaf block size in art pixels
 * @param {number} n sub blocks per logo block
 * @param {ReturnType<typeof import('../grove/palette.js').treePalette>} pal
 */
export function buildCrown(block, n, pal) {
  const logo = treeBlocks(0).filter((b) => b.kind === 'leaf');
  const rows = 5 * n;
  const has = new Set();
  const blocks = [];
  for (const b of logo) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = b.c * n + i;
        const r = b.r * n + j;
        has.add(c + ',' + r);
        blocks.push({ c, r, kind: 'leaf', tone: 0, order: 0 });
      }
    }
  }
  // Round the silhouette: drop most outer corner blocks and a few along the bottom.
  const open = (c, r) => !has.has(c + ',' + r);
  const drop = new Set();
  for (const b of blocks) {
    const exposed = [open(b.c - 1, b.r), open(b.c + 1, b.r), open(b.c, b.r - 1), open(b.c, b.r + 1)].filter(Boolean).length;
    if (exposed >= 2 && hash(b.c, b.r + 71) < 0.8) drop.add(b.c + ',' + b.r);
    else if (b.r === rows - 1 && Math.abs(b.c - (7 * n - 1) / 2) > n && hash(b.c, 5) < 0.4) drop.add(b.c + ',' + b.r);
  }
  const kept = blocks.filter((b) => !drop.has(b.c + ',' + b.r));
  for (const b of kept) {
    const t = (b.r / rows) * 4.1 + (hash(b.c, b.r) - 0.5) * 0.9;
    b.tone = Math.max(0, Math.min(3, Math.floor(t)));
  }
  const step = block + 1;
  const w = 7 * n * step - 1;
  const h = rows * step - 1;
  const made = makeCanvas(w, h);
  // drawTree centres a 7 x 8 block tree on cx; these numbers put our blocks at 0,0.
  drawTree(made.ctx, (7 * step - 2) / 2, 8 * step - 2, pal, { block, extraTrunk: 0, blocks: kept });
  return made.canvas;
}

// ---------------------------------------------------------------------------
// Agents climbing, seen from behind, two frames (hand over hand).

const CLIMB_A = [
  's.......s',
  'b.......b',
  'b.hhhhh.b',
  'bhhhhhhhb',
  'bhhhhhhhb',
  '.bhhhhhb.',
  '.bbbbbbb.',
  '.bbbbbbb.',
  '.bbBbBbb.',
  '.bbbbbbb.',
  '.BBBBBBB.',
  '..ppppp..',
  '..pp.pp..',
  '..pp..pp.',
  '..ff..ff.',
];
const CLIMB_B = [
  '........s',
  's.......b',
  'b.hhhhh.b',
  'bhhhhhhhb',
  'bhhhhhhhb',
  '.bhhhhhb.',
  '.bbbbbbb.',
  '.bbbbbbb.',
  '.bbBbBbb.',
  '.bbbbbbb.',
  '.BBBBBBB.',
  '..ppppp..',
  '..pp.pp..',
  '.pp..pp..',
  '.ff..ff..',
];

export function climbSprites(look) {
  const colours = {
    h: look.beanie ?? look.hair,
    s: C.skin,
    b: look.hoodie,
    B: mix(look.hoodie, '#000000', 0.25),
    p: C.pants,
    f: C.shoes,
  };
  return [spriteFromMap(CLIMB_A, colours), spriteFromMap(CLIMB_B, colours)];
}

// ---------------------------------------------------------------------------
// Bark

export const BARK = {
  body: C.wood,
  hi: mix(C.wood, '#ffffff', 0.18),
  lo: C.woodDark,
  edge: C.woodDeep,
  streak: mix(C.woodDark, C.wood, 0.25),
};

/**
 * One row of a stem, centred on cx. `half` is the half width, `slope` dx/dy
 * so curves keep their thickness.
 */
export function stemRow(ctx, y, yy, cx, half, slope, seed) {
  const w = Math.max(1, Math.round(half * Math.sqrt(1 + slope * slope)));
  const c = Math.round(cx);
  const x0 = c - w;
  const x1 = c + w;
  ctx.fillStyle = BARK.edge;
  ctx.fillRect(x0 - 1, yy, x1 - x0 + 3, 1);
  ctx.fillStyle = BARK.body;
  ctx.fillRect(x0, yy, x1 - x0 + 1, 1);
  ctx.fillStyle = BARK.hi;
  ctx.fillRect(x0, yy, w > 3 ? 2 : 1, 1);
  ctx.fillStyle = BARK.lo;
  ctx.fillRect(x1 - (w > 3 ? 1 : 0), yy, w > 3 ? 2 : 1, 1);
  // Bark streaks that follow the stem.
  ctx.fillStyle = BARK.streak;
  for (let col = -w + 2; col <= w - 2; col++) {
    const run = 5 + Math.floor(hash(seed * 31 + col, 9) * 9);
    const cell = Math.floor((y + hash(seed, col + 40) * 30) / run);
    if (hash(seed * 131 + col, cell) < 0.17) ctx.fillRect(c + col, yy, 1, 1);
  }
}

// ---------------------------------------------------------------------------
// Small leaf clusters along the limbs

export function drawLeafCluster(ctx, x, y, dir, seed, pal) {
  // A twig out from the bark.
  ctx.fillStyle = C.woodDark;
  for (let i = 0; i < 5; i++) ctx.fillRect(x + dir * i, y - Math.floor(i / 2), 1, 1);
  const bx = x + dir * 5;
  const spots = [
    [0, -3],
    [dir * 4, -5],
    [dir * 4, -1],
    [dir * 8, -3],
    [0, -7],
  ];
  spots.forEach(([dx, dy], i) => {
    if (i > 2 && hash(seed, i) < 0.45) return;
    ctx.fillStyle = pal.seam;
    ctx.fillRect(bx + dx - 3, y + dy - 3, 6, 6);
  });
  spots.forEach(([dx, dy], i) => {
    if (i > 2 && hash(seed, i) < 0.45) return;
    const tone = Math.min(3, 1 + Math.floor(hash(seed, i + 9) * 3));
    const px = bx + dx - 2;
    const py = y + dy - 2;
    ctx.fillStyle = pal.leaves[tone];
    ctx.fillRect(px, py, 4, 4);
    ctx.fillStyle = pal.leaves[Math.max(0, tone - 1)];
    ctx.fillRect(px, py, 3, 1);
    ctx.fillRect(px, py, 1, 3);
  });
}

// ---------------------------------------------------------------------------
// Treehouse deck

/** Deck planks from x0 to x1 at y (top), braced back to the limb at limbX. */
export function drawDeck(ctx, x0, x1, y, limbX, half) {
  const w = x1 - x0 + 1;
  // Braces first, so the planks sit on top.
  ctx.fillStyle = C.woodDark;
  for (const dir of [-1, 1]) {
    const outer = dir < 0 ? x0 + 4 : x1 - 4;
    if ((outer - limbX) * dir < half + 6) continue;
    const from = limbX + dir * (half + 1);
    const drop = Math.round(Math.abs(outer - from) * 0.75);
    for (let i = 0; i <= drop; i++) {
      const px = Math.round(outer + ((from - outer) * i) / Math.max(1, drop));
      ctx.fillRect(px, y + 3 + i, 2, 1);
    }
  }
  ctx.fillStyle = C.woodDeep;
  ctx.fillRect(x0 - 1, y - 1, w + 2, 5);
  ctx.fillStyle = C.woodPale;
  ctx.fillRect(x0, y, w, 1);
  ctx.fillStyle = C.wood;
  ctx.fillRect(x0, y + 1, w, 1);
  ctx.fillStyle = C.woodDark;
  ctx.fillRect(x0, y + 2, w, 1);
  ctx.fillStyle = C.woodDeep;
  for (let x = x0 + 4; x < x1 - 1; x += 7) ctx.fillRect(x, y + 1, 1, 2);
  // Rail posts at both ends.
  for (const px of [x0, x1 - 1]) {
    ctx.fillStyle = C.woodDark;
    ctx.fillRect(px, y - 6, 2, 6);
    ctx.fillStyle = C.woodPale;
    ctx.fillRect(px, y - 6, 1, 1);
  }
}

// ---------------------------------------------------------------------------
// Hollow in the trunk, where the notes live

/** Where the four notes sit inside a hollow centred on (cx, cy): [x, y, w, h]. */
export function hollowNotes(cx, cy, w) {
  const nw = w >= 16 ? 4 : 3;
  return [
    [-nw - 1, -3],
    [1, -5],
    [-nw, 2],
    [2, 1],
  ].map(([dx, dy]) => [cx + dx, Math.round(cy + dy), nw, 3]);
}

export function drawHollow(ctx, cx, cy, w, h) {
  const rx = w / 2;
  const ry = h / 2;
  for (let r = 0; r < h; r++) {
    const d = (r + 0.5 - ry) / ry;
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - d * d)));
    const y = Math.round(cy - ry + r);
    ctx.fillStyle = C.woodDeep;
    ctx.fillRect(cx - half - 1, y, half * 2 + 3, 1);
    if (half > 1) {
      ctx.fillStyle = r > h * 0.7 ? '#20150f' : '#140d0a';
      ctx.fillRect(cx - half + 1, y, half * 2 - 1, 1);
    }
  }
  // Lit lower lip.
  ctx.fillStyle = C.woodPale;
  ctx.fillRect(cx - Math.round(rx * 0.6), Math.round(cy + ry), Math.round(rx * 1.2), 1);
  // Four folded notes.
  for (const [x, y, nw] of hollowNotes(cx, cy, w)) {
    ctx.fillStyle = C.cream;
    ctx.fillRect(x, y, nw, 3);
    ctx.fillStyle = mix(C.cream, C.wood, 0.4);
    ctx.fillRect(x, y + 2, nw, 1);
  }
}

// ---------------------------------------------------------------------------
// Ground props

export function drawBush(ctx, x, base, seed, small = false) {
  const puffs = small
    ? [
        [-3, 3, 3],
        [2, 4, 3],
      ]
    : [
        [-5, 3, 4],
        [0, 6, 5],
        [5, 3, 4],
      ];
  for (const pass of [0, 1]) {
    for (const [dx, h, r] of puffs) {
      const cx = x + dx;
      const top = base - h - r + 1;
      for (let yy = 0; yy <= r * 2; yy++) {
        const half = Math.round(Math.sqrt(Math.max(0, r * r - (yy - r) ** 2)));
        const y = top + yy;
        if (y > base) continue;
        if (pass === 0) {
          ctx.fillStyle = C.leafSeam;
          ctx.fillRect(cx - half - 1, y, half * 2 + 3, 1);
        } else {
          ctx.fillStyle = yy < 2 ? C.grassTop : hash(seed + dx, yy) < 0.2 ? C.grassDark : C.grass;
          ctx.fillRect(cx - half, y, half * 2 + 1, 1);
        }
      }
    }
  }
}

/** A silhouette crown for a distant tree, in one colour with a lit top edge. */
export function silhouetteCrown(block, fill, rim) {
  const logo = treeBlocks(0).filter((b) => b.kind === 'leaf');
  const step = block + 1;
  const made = makeCanvas(7 * step, 5 * step);
  const ctx = made.ctx;
  const set = new Set(logo.map((b) => b.c + ',' + b.r));
  for (const b of logo) {
    ctx.fillStyle = fill;
    ctx.fillRect(b.c * step, b.r * step, step, step);
    if (!set.has(b.c + ',' + (b.r - 1))) {
      ctx.fillStyle = rim;
      ctx.fillRect(b.c * step, b.r * step, step, 1);
    }
  }
  return made.canvas;
}
