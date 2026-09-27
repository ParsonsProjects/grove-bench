// Pixel art pieces that only the Canopy scene needs. Everything else comes
// from the shared pixel sprites and palette in src/pixel.

import { treeBlocks, makeCanvas, spriteFromMap, hash, bayer } from '../pixel/sprites.js';
import { C, mix, hexToRgb } from '../pixel/palette.js';

// ---------------------------------------------------------------------------
// The crown: the logo tree's crown drawn big, each block a leafy clump lit
// from the upper left. A 2 px margin leaves room for leaves poking out.

export const CROWN_PAD = 2;

/**
 * @param {number} block leaf block size in art pixels
 * @param {ReturnType<typeof import('../pixel/palette.js').treePalette>} pal
 */
export function buildCrown(block, pal) {
  const logo = treeBlocks(0).filter((b) => b.kind === 'leaf');
  const step = block + 1;
  const P = CROWN_PAD;
  const w = 7 * step - 1 + P * 2;
  const h = 5 * step - 1 + P * 2;
  const made = makeCanvas(w, h);
  const img = made.ctx.createImageData(w, h);
  const data = img.data;
  const set = new Set(logo.map((b) => b.c + ',' + b.r));
  const has = (c, r) => set.has(c + ',' + r);
  const rgb = (hex) => hexToRgb(hex);
  const tones = [rgb(pal.hi), ...pal.leaves.map(rgb), rgb(pal.seam), rgb(pal.deep)];
  const put = (x, y, t) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const c = tones[Math.max(0, Math.min(tones.length - 1, t))];
    const o = (y * w + x) * 4;
    data[o] = c[0];
    data[o + 1] = c[1];
    data[o + 2] = c[2];
    data[o + 3] = 255;
  };
  for (const b of logo) {
    const x0 = P + b.c * step;
    const y0 = P + b.r * step;
    const openTop = !has(b.c, b.r - 1);
    const openLeft = !has(b.c - 1, b.r);
    const openRight = !has(b.c + 1, b.r);
    const openBottom = !has(b.c, b.r + 1);
    // Fill the block, and the seam to the right / below where a neighbour continues the mass.
    const wx = openRight ? block : step;
    const hy = openBottom ? block : step;
    for (let yy = 0; yy < hy; yy++) {
      for (let xx = 0; xx < wx; xx++) {
        const x = x0 + xx;
        const y = y0 + yy;
        const u = xx / block;
        const v = yy / block;
        // Tone 1..4 are the leaf greens light to dark; 0 is the highlight.
        let t = 1 + b.tone * 0.75 - 0.9 + (u * 0.8 + v * 1.1);
        // Leafy texture in 2 x 2 clumps.
        const n = hash((x >> 1) + 11, (y >> 1) + 7);
        if (n < 0.14) t -= 1;
        else if (n > 0.9) t += 1;
        const lo = Math.floor(t);
        let tone = t - lo > bayer(x, y) ? lo + 1 : lo;
        tone = Math.max(1, Math.min(5, tone));
        // Seams between clumps stay a touch darker so the logo blocks still read.
        if ((xx === block || yy === block) && hash(x, y + 3) < 0.7) tone = Math.max(tone, 4);
        put(x, y, tone);
      }
    }
    // Lit rims where the block meets the sky, with a few leaves poking out.
    if (openTop) {
      for (let xx = 0; xx < block; xx++) {
        const x = x0 + xx;
        put(x, y0, hash(x, 1) < 0.25 ? 1 : 0);
        if (hash(x, 2) < 0.18) put(x, y0 - 1, 1);
        if (hash(x, 3) < 0.07) put(x, y0 - 2, 2);
      }
    }
    if (openLeft) {
      for (let yy = 0; yy < block; yy++) {
        const y = y0 + yy;
        put(x0, y, hash(4, y) < 0.3 ? 1 : 0);
        if (hash(5, y) < 0.16) put(x0 - 1, y, 2);
      }
    }
    if (openRight) {
      for (let yy = 0; yy < block; yy++) {
        const y = y0 + yy;
        if (hash(6, y) < 0.16) put(x0 + block, y, 4);
      }
    }
    if (openBottom) {
      for (let xx = 0; xx < block; xx++) {
        const x = x0 + xx;
        put(x, y0 + block - 1, 5);
        if (hash(x, 9) < 0.2) put(x, y0 + block, 5);
      }
    }
  }
  made.ctx.putImageData(img, 0, 0);
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
// Small leaf sprigs along the limbs

function blob(ctx, cx, cy, r, fill, outline, hi) {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)) + 0.2);
    ctx.fillStyle = outline;
    ctx.fillRect(cx - half - 1, cy + dy, half * 2 + 3, 1);
  }
  ctx.fillRect(cx - 1, cy - r - 1, 3, 1);
  ctx.fillRect(cx - 1, cy + r + 1, 3, 1);
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)) + 0.2);
    ctx.fillStyle = fill;
    ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
  ctx.fillStyle = hi;
  ctx.fillRect(cx - r + 1, cy - 1, 1, 2);
  ctx.fillRect(cx - 1, cy - r + 1, 2, 1);
}

export function drawLeafCluster(ctx, x, y, dir, seed, pal) {
  // A twig out from the bark.
  ctx.fillStyle = C.woodDark;
  for (let i = 0; i < 6; i++) ctx.fillRect(x + dir * i, y - Math.floor(i / 2), 1, 1);
  const bx = x + dir * 7;
  const by = y - 4;
  const big = hash(seed, 1) < 0.5;
  blob(ctx, bx, by, big ? 4 : 3, pal.leaves[2], pal.seam, pal.leaves[0]);
  blob(ctx, bx + dir * (big ? 5 : 4), by + 2, 3, pal.leaves[3], pal.seam, pal.leaves[1]);
  if (hash(seed, 2) < 0.5) blob(ctx, bx - dir, by - 5, 2, pal.leaves[1], pal.seam, pal.hi);
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

/** A rounded silhouette crown for a distant tree: a few overlapping puffs in one colour, lit along the top. */
export function silhouetteCrown(r, fill, rim, seed = 1) {
  const w = r * 5;
  const h = Math.round(r * 3.4);
  const made = makeCanvas(w, h);
  const ctx = made.ctx;
  const puffs = [
    [w * 0.5, r * 1.2, r * 1.15],
    [w * 0.3, r * 1.9, r * 0.95],
    [w * 0.7, r * 1.9, r * 0.95],
    [w * (0.42 + hash(seed, 1) * 0.16), r * 2.4, r],
  ];
  const inside = (x, y) => puffs.some(([cx, cy, pr]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= pr);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      ctx.fillStyle = inside(x, y - 1) ? fill : rim;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return made.canvas;
}
