// Drawing for Grove Path. The world is drawn into a stack of small tile
// canvases that scroll with the page. Each tile keeps a cached ground (meadow
// and paths); props, agents, the light of the hour and glows are redrawn on
// top while the tile is near the viewport.

import {
  hash,
  bayer,
  makeCanvas,
  drawTree,
  treeBlocks,
  treeSize,
  drawBench,
  drawLamp,
  drawSignPost,
  drawGate,
  drawSundial,
  drawStone,
  runePixels,
  moonSprite,
  halo,
  ringHalo,
} from '../grove/sprites.js';
import { C, statusHex, skyBands, worldTint, hillColours, mix, rgba, hexToRgb } from '../grove/palette.js';
import { drawCheckpointStone, drawLaneGate, drawBush, drawNote } from './sprites.js';
import { LANES, BRANCH_KEYS } from './data.js';
import { clamp, S, HALF, TREE_EXTRA } from './world.js';

export const TILE = 160;

const MEADOW = [
  mix(C.meadow, C.meadowDeep, 0.45),
  C.meadow,
  mix(C.meadow, C.grassDark, 0.4),
  mix(C.meadow, C.grassDark, 0.7),
].map(hexToRgb);

const PROP_H = { lamp: 24, bench: 14, sign: 16, laneGate: 12, mainGate: 36, sundial: 30, cpStone: 6, memStone: 10, bush: 14 };

/** Angle of the sundial shadow for a turn (1 points left, 4 points right). */
export function sundialAngle(turn) {
  return Math.PI + ((turn - 1) / 3) * Math.PI;
}

/**
 * @param {ReturnType<import('./world.js').buildWorld>} world
 * @param {{ reduced: boolean }} opts
 */
export function createRenderer(world, opts) {
  const { W, horizon } = world;
  const reduced = opts.reduced;
  const layer = makeCanvas(W, TILE);
  const grounds = new Map();
  const treeCache = new Map();
  const blockCache = new Map();
  const moon = moonSprite();
  let sky = null;
  let detourKey = 'faint';

  // Static props sorted by base, each with its top for culling.
  const props = world.props
    .map((p) => {
      let h = PROP_H[p.kind] ?? 20;
      if (p.kind === 'tree') h = treeSize(p.block, TREE_EXTRA).h;
      return { ...p, top: p.base - h - 2 };
    })
    .sort((a, b) => a.base - b.base);

  // -------------------------------------------------------------------------
  // Particles: leaves, fireflies, memory notes.

  const leaves = [];
  let fireflies = [];
  let t = 0;

  function burst(x, y, n, spread = 1) {
    if (reduced) return;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3 * spread;
      const v = 16 + Math.random() * 36 * spread;
      leaves.push({
        x: x + (Math.random() - 0.5) * 16,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        floor: y + 10 + Math.random() * 16,
        life: 1.8 + Math.random() * 1.4,
        colour: [C.leafTop, '#5ab868', '#4aaa58', C.greenLight][i % 4],
        phase: Math.random() * 6,
      });
    }
  }

  function seedFireflies(view) {
    const n = clamp(Math.round((W * (view.bottom - view.top)) / 3200), 10, 30);
    fireflies = Array.from({ length: n }, (_, i) => ({
      x: hash(i, 3) * W,
      y: view.top + hash(i, 4) * (view.bottom - view.top),
      vx: 0,
      vy: 0,
      p1: hash(i, 5) * 10,
      p2: hash(i, 6) * 10,
      phase: hash(i, 8) * Math.PI * 2,
      speed: 1.2 + hash(i, 9) * 1.6,
    }));
  }

  /** Advances particles. `view` is the visible world rows, `pointer` in world px or null. */
  function update(dt, view, pointer) {
    t += dt;
    for (let i = leaves.length - 1; i >= 0; i--) {
      const q = leaves[i];
      q.life -= dt;
      q.vy = Math.min(q.vy + 40 * dt, 22);
      q.vx += Math.sin(t * 3 + q.phase) * 18 * dt;
      q.vx *= 1 - 1.4 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.y > q.floor) {
        q.y = q.floor;
        q.vx = 0;
        q.vy = 0;
      }
      if (q.life <= 0) leaves.splice(i, 1);
    }
    if (!fireflies.length) seedFireflies(view);
    const span = view.bottom - view.top;
    for (const f of fireflies) {
      // Keep them near the viewport as the page scrolls.
      if (f.y < view.top - 20) f.y += span + 30;
      else if (f.y > view.bottom + 20) f.y -= span + 30;
      let ax = Math.sin(t * 0.7 + f.p1) * 7 + Math.cos(t * 0.31 + f.p2) * 5;
      let ay = Math.cos(t * 0.53 + f.p2) * 6 + Math.sin(t * 0.23 + f.p1) * 3;
      if (pointer) {
        const dx = pointer.x - f.x;
        const dy = pointer.y - f.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 110) {
          const pull = (1 - d / 110) * 70;
          ax += (dx / d) * pull - (dy / d) * pull * 0.5;
          ay += (dy / d) * pull + (dx / d) * pull * 0.5;
          if (d < 8) {
            ax -= (dx / d) * 90;
            ay -= (dy / d) * 90;
          }
        }
      }
      f.vx = (f.vx + ax * dt) * (1 - 0.9 * dt);
      f.vy = (f.vy + ay * dt) * (1 - 0.9 * dt);
      const sp = Math.hypot(f.vx, f.vy);
      const max = pointer ? 38 : 12;
      if (sp > max) {
        f.vx *= max / sp;
        f.vy *= max / sp;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < -8) f.x += W + 16;
      if (f.x > W + 8) f.x -= W + 16;
    }
  }

  // -------------------------------------------------------------------------
  // Sky (only above the horizon, at the top of the page: always night there)

  function buildSky() {
    const hgt = Math.max(1, horizon + 2);
    const s = makeCanvas(W, hgt);
    const c = s.ctx;
    const bands = skyBands(0).map(hexToRgb);
    const img = c.createImageData(W, hgt);
    const d = img.data;
    const n = bands.length;
    for (let y = 0; y < hgt; y++) {
      const f = clamp(y / Math.max(1, horizon - 4), 0, 1) * (n - 1);
      const i = Math.floor(f);
      for (let x = 0; x < W; x++) {
        const col = bands[Math.min(n - 1, i + (f - i > bayer(x, y) ? 1 : 0))];
        const o = (y * W + x) * 4;
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
        d[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    // Moon, away from the text on wide screens.
    const mx = world.wide ? Math.round(world.R + world.RW * 0.78) : W - 26;
    const my = world.wide ? Math.max(30, Math.round(horizon * 0.3)) : 30;
    c.drawImage(ringHalo(C.primaryPale, 22, [0.1, 0.06, 0.03]), mx - 22, my - 22);
    c.drawImage(moon, mx - 7, my - 7);
    // Two rows of hills with small trees along the horizon.
    const hills = hillColours(0);
    const far = (x) => horizon - 16 - Math.round(7 * Math.sin(x * 0.013 + 1) + 5 * Math.sin(x * 0.031 + 2.2) + 2 * Math.sin(x * 0.07));
    const near = (x) => horizon - 7 - Math.round(4 * Math.sin(x * 0.019 + 0.3) + 3 * Math.sin(x * 0.047 + 1.7));
    const farRim = mix(hills.far, bands.length ? '#3a4a78' : hills.far, 0.35);
    for (let x = 0; x < W; x++) {
      const ft = far(x);
      c.fillStyle = farRim;
      c.fillRect(x, ft, 1, 1);
      c.fillStyle = hills.far;
      c.fillRect(x, ft + 1, 1, hgt - ft);
    }
    const treePal = {
      leaves: ['#6ec87a', '#5ab868', '#4aaa58', '#3a9a48'].map((col) => mix(hills.near, col, 0.22)),
      hi: mix(hills.near, '#6ec87a', 0.3),
      seam: mix(hills.near, '#000000', 0.12),
      deep: mix(hills.near, '#000000', 0.18),
      trunk: mix(hills.near, C.wood, 0.25),
      trunkHi: mix(hills.near, C.wood, 0.3),
      trunkLo: mix(hills.near, C.woodDark, 0.25),
      root: mix(hills.near, C.woodDark, 0.25),
      rootLo: mix(hills.near, C.woodDeep, 0.25),
    };
    for (let i = 0; i < W / 22; i++) {
      if (hash(i, 41) < 0.4) continue;
      const u = i * 22 + Math.floor(hash(i, 43) * 10);
      drawTree(c, u, near(u) + 2, treePal, { block: hash(i, 47) > 0.6 ? 2 : 1, extraTrunk: 0 });
    }
    for (let x = 0; x < W; x++) {
      const nt = near(x);
      c.fillStyle = mix(hills.near, '#6b7aa0', 0.25);
      c.fillRect(x, nt, 1, 1);
      c.fillStyle = hills.near;
      c.fillRect(x, nt + 1, 1, hgt - nt);
    }
    sky = s.canvas;
  }

  const stars = [];
  for (let i = 0; i < Math.round((W * horizon) / 700); i++) {
    const r = hash(i, 91);
    stars.push({
      x: Math.floor(hash(i, 17) * W),
      y: 20 + Math.floor(hash(i, 29) ** 1.2 * Math.max(1, horizon - 44)),
      kind: r > 0.93 ? 2 : r > 0.7 ? 1 : 0,
      phase: hash(i, 5) * Math.PI * 2,
      speed: 0.6 + hash(i, 8) * 1.8,
    });
  }

  function drawStars(ctx) {
    for (const s of stars) {
      const tw = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(t * s.speed + s.phase);
      const a = (s.kind === 0 ? 0.45 : 0.85) * tw;
      if (a < 0.05) continue;
      ctx.fillStyle = rgba(s.kind === 0 ? C.primaryPale : C.cream, a);
      ctx.fillRect(s.x, s.y, 1, 1);
      if (s.kind === 2 && tw > 0.7) {
        ctx.fillStyle = rgba(C.cream, a * 0.45);
        ctx.fillRect(s.x - 1, s.y, 1, 1);
        ctx.fillRect(s.x + 1, s.y, 1, 1);
        ctx.fillRect(s.x, s.y - 1, 1, 1);
        ctx.fillRect(s.x, s.y + 1, 1, 1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Ground: meadow, paths and flowers. Cached per tile.

  function noise(x, y) {
    const g = 22;
    const gx = x / g;
    const gy = y / g;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = S(gx - ix);
    const fy = S(gy - iy);
    const a = hash(ix, iy * 7 + 1);
    const b = hash(ix + 1, iy * 7 + 1);
    const c = hash(ix, (iy + 1) * 7 + 1);
    const d = hash(ix + 1, (iy + 1) * 7 + 1);
    const top = a + (b - a) * fx;
    const bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  }

  function buildGround(y0) {
    const g = makeCanvas(W, TILE);
    const c = g.ctx;
    const img = c.createImageData(W, TILE);
    const d = img.data;
    for (let ry = 0; ry < TILE; ry++) {
      const y = y0 + ry;
      if (y < horizon) continue;
      for (let x = 0; x < W; x++) {
        const n = noise(x, y) * 0.75 + noise(x * 2 + 50, y * 2) * 0.25;
        const band = clamp(Math.floor(n * 3.4 + (bayer(x, y) - 0.5) * 0.9), 0, 3);
        const col = MEADOW[band];
        const o = (ry * W + x) * 4;
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
        d[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    c.save();
    c.translate(0, -y0);
    const yA = Math.max(y0, horizon);
    const yB = y0 + TILE;
    // Grass blades and flowers.
    for (let y = yA; y < yB; y++) {
      for (let x = 0; x < W; x++) {
        const r = hash(x * 3 + 1, y * 5 + 2);
        if (r < 0.05) {
          c.fillStyle = r < 0.02 ? C.grass : C.grassDark;
          c.fillRect(x, y, 1, 2);
        } else if (r > 0.9975) {
          c.fillStyle = [C.cream, C.amberLight, C.primaryPale][Math.floor(hash(x, y) * 3)];
          c.fillRect(x, y, 1, 1);
          c.fillStyle = C.grass;
          c.fillRect(x, y + 1, 1, 1);
        }
      }
    }
    // Detour, then lanes, then main on top where they meet.
    drawDetour(c, yA, yB);
    for (const key of BRANCH_KEYS) drawLane(c, key, yA, yB);
    drawMain(c, yA, yB);
    c.restore();
    return g.canvas;
  }

  function rowEdges(x, hw) {
    const cx = Math.round(x);
    return [cx - hw, cx + hw];
  }

  function drawLane(c, key, yA, yB) {
    const hw = HALF.lane;
    const tint = LANES[key].colour;
    let prev = null;
    for (let y = yA - 1; y < yB; y++) {
      const x = world.laneX(key, y);
      if (x == null) {
        prev = null;
        continue;
      }
      const [l, r] = rowEdges(x, hw);
      if (y >= yA) {
        c.fillStyle = C.path;
        c.fillRect(l, y, r - l + 1, 1);
        for (let px = l; px <= r; px++) {
          const q = hash(px * 7 + 3, y * 3 + 11);
          if (q < 0.13) {
            c.fillStyle = C.pathDark;
            c.fillRect(px, y, 1, 1);
          } else if (q > 0.985) {
            c.fillStyle = C.stoneLight;
            c.fillRect(px, y, 1, 1);
          } else if (Math.abs(px - (l + r) / 2) < 1.5 && q > 0.7) {
            c.fillStyle = mix(C.path, '#ffffff', 0.12);
            c.fillRect(px, y, 1, 1);
          }
        }
        // Edges, joined to the row above so curves stay closed.
        c.fillStyle = C.pathEdge;
        const pl = prev ? prev[0] : l;
        const pr = prev ? prev[1] : r;
        c.fillRect(Math.min(l, pl) - 1, y, Math.abs(l - pl) + 1, 1);
        c.fillRect(Math.min(r, pr) + 1, y, Math.abs(r - pr) + 1, 1);
        // Grass tufts spilling over the edge.
        if (hash(y, 31 + l) < 0.18) {
          c.fillStyle = C.grassTop;
          c.fillRect(l - 1, y, 2, 1);
        }
        if (hash(y, 37 + r) < 0.18) {
          c.fillStyle = C.grassTop;
          c.fillRect(r, y, 2, 1);
        }
        // Flowers in the lane's colour along its sides.
        if (hash(y, 53 + BRANCH_KEYS.indexOf(key)) < 0.05) {
          const side = hash(y, 59) < 0.5 ? l - 3 : r + 3;
          c.fillStyle = C.grassDark;
          c.fillRect(side, y + 1, 1, 1);
          c.fillStyle = mix(tint, '#ffffff', 0.25);
          c.fillRect(side, y, 1, 1);
          c.fillStyle = mix(tint, '#ffffff', 0.6);
          c.fillRect(side - 1, y, 1, 1);
        }
      }
      prev = [l, r];
    }
  }

  function drawMain(c, yA, yB) {
    const hw = HALF.main;
    let prev = null;
    for (let y = yA - 1; y < yB; y++) {
      const x = world.laneX('main', y);
      if (x == null) {
        prev = null;
        continue;
      }
      const [l, r] = rowEdges(x, hw);
      if (y >= yA) {
        // Flagstones: rows of 4, staggered joints.
        const row = Math.floor(y / 4);
        const inRow = ((y % 4) + 4) % 4;
        for (let px = l; px <= r; px++) {
          const lx = px - l + (row % 2) * 3;
          const joint = inRow === 0 || lx % 6 === 0;
          let col = C.stone;
          if (joint) col = C.stoneDark;
          else if (inRow === 1 || lx % 6 === 1) col = C.stoneLight;
          else if (hash(px + row * 13, row) < 0.25) col = mix(C.stone, C.path, 0.35);
          c.fillStyle = col;
          c.fillRect(px, y, 1, 1);
        }
        c.fillStyle = C.pathEdge;
        const pl = prev ? prev[0] : l;
        const pr = prev ? prev[1] : r;
        c.fillRect(Math.min(l, pl) - 1, y, Math.abs(l - pl) + 1, 1);
        c.fillRect(Math.min(r, pr) + 1, y, Math.abs(r - pr) + 1, 1);
        if (hash(y, 71 + l) < 0.2) {
          c.fillStyle = C.grassTop;
          c.fillRect(l - 1, y, 2, 1);
        }
        if (hash(y, 73 + r) < 0.2) {
          c.fillStyle = C.grassTop;
          c.fillRect(r, y, 2, 1);
        }
      }
      prev = [l, r];
    }
    // The start of main: a worn patch under the hero tree roots.
    if (world.mainStart >= yA - 4 && world.mainStart < yB) {
      const x = Math.round(world.mainX(world.mainStart));
      c.fillStyle = C.pathEdge;
      c.fillRect(x - hw - 1, world.mainStart - 1, hw * 2 + 3, 1);
    }
  }

  function drawDetour(c, yA, yB) {
    const { from, to } = world.DETOUR;
    if (to < yA || from > yB) return;
    const trodden = detourKey === 'trodden';
    for (let y = Math.max(yA, from); y <= Math.min(yB - 1, to); y++) {
      const base = world.laneX('api', y);
      if (base == null) continue;
      const dx = world.detourDX(y);
      if (Math.abs(dx) < 2) continue;
      const cx = Math.round(base + dx);
      const hw = HALF.detour;
      for (let px = cx - hw; px <= cx + hw; px++) {
        const q = hash(px * 5 + 1, y * 9 + 4);
        // Faint and grassy until someone walks it.
        if (!trodden && q < 0.45) continue;
        c.fillStyle = q < 0.55 ? C.pathDark : C.path;
        c.fillRect(px, y, 1, 1);
      }
      if (trodden) {
        c.fillStyle = C.pathEdge;
        c.fillRect(cx - hw - 1, y, 1, 1);
        c.fillRect(cx + hw + 1, y, 1, 1);
      }
    }
  }

  function groundFor(i, y0) {
    const hitsDetour = y0 + TILE >= world.DETOUR.from && y0 <= world.DETOUR.to;
    const key = hitsDetour ? `${i}|${detourKey}` : `${i}`;
    let g = grounds.get(key);
    if (!g) {
      g = buildGround(y0);
      grounds.set(key, g);
    }
    return g;
  }

  // -------------------------------------------------------------------------
  // Props and agents

  function cachedTree(p) {
    let c = treeCache.get(p.id);
    if (c) return c;
    const size = treeSize(p.block, TREE_EXTRA);
    const made = makeCanvas(size.w, size.h);
    drawTree(made.ctx, (size.w - 1) / 2, size.h - 1, p.pal, { block: p.block, extraTrunk: TREE_EXTRA });
    treeCache.set(p.id, made.canvas);
    return made.canvas;
  }

  function blocksFor(extra) {
    let b = blockCache.get(extra);
    if (!b) {
      b = treeBlocks(extra);
      blockCache.set(extra, b);
    }
    return b;
  }

  function drawTreeProp(c, p, growth) {
    const size = treeSize(p.block, TREE_EXTRA);
    if (growth >= 0.999) {
      c.drawImage(cachedTree(p), Math.round(p.x - (size.w - 1) / 2), p.base - size.h + 1);
    } else {
      // Whole blocks only, so a tree never rests on a half grown block.
      const blocks = blocksFor(TREE_EXTRA);
      const g = Math.max(1, Math.round(growth * blocks.length)) / blocks.length;
      drawTree(c, p.x, p.base, p.pal, { block: p.block, extraTrunk: TREE_EXTRA, growth: g, blocks });
    }
  }

  const lampGlass = new Map();

  function drawProp(c, p, f) {
    switch (p.kind) {
      case 'tree':
        drawTreeProp(c, p, f.growth(p));
        break;
      case 'bench':
        drawBench(c, p.x, p.base);
        break;
      case 'lamp':
        lampGlass.set(p.id, { ...drawLamp(c, p.x, p.base), status: f.lampStatus(p) });
        break;
      case 'sign':
        drawSignPost(c, p.x, p.base, p.height);
        break;
      case 'laneGate':
        drawLaneGate(c, p.x, p.base, f.gateOpen);
        break;
      case 'mainGate':
        drawGate(c, p.x, p.base + 1);
        break;
      case 'sundial': {
        const ticks = [1, 2, 3, 4].map((n) => ({ angle: sundialAngle(n), active: n <= Math.round(f.turn) }));
        drawSundial(c, p.x, p.base, sundialAngle(f.turn), ticks);
        break;
      }
      case 'cpStone':
        drawCheckpointStone(c, p.x, p.base - 4, p.n <= Math.round(f.turn));
        break;
      case 'memStone':
        drawStone(c, p.x, p.base);
        break;
      case 'bush':
        drawBush(c, p.x, p.base, p.seed, p.small);
        break;
    }
  }

  function drawAgent(c, a) {
    const x = Math.round(a.x);
    const y = Math.round(a.y);
    if (a.pose === 'sit') {
      c.drawImage(a.frames.sit, a.seat.x, a.seat.y);
      return;
    }
    // Shadow on the ground.
    c.fillStyle = 'rgba(8, 12, 20, 0.28)';
    c.fillRect(x - 3, y + 1, 7, 1);
    c.fillRect(x - 2, y + 2, 5, 1);
    const set = a.dir < 0 ? a.frames.back : a.frames.front;
    c.drawImage(set[a.frame], x - 4, y - 14);
  }

  // -------------------------------------------------------------------------
  // Tile

  /**
   * @param {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, i: number, y0: number }} tile
   * @param {any} f frame state
   */
  function drawTile(tile, f) {
    const { ctx, y0, i } = tile;
    const y1 = y0 + TILE;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (y0 < horizon + 2) {
      if (!sky) buildSky();
      ctx.clearRect(0, 0, W, TILE);
      ctx.drawImage(sky, 0, -y0);
      ctx.translate(0, -y0);
      drawStars(ctx);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // World layer, lit for the hour.
    const L = layer.ctx;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.globalCompositeOperation = 'source-over';
    L.globalAlpha = 1;
    L.clearRect(0, 0, W, TILE);
    L.drawImage(groundFor(i, y0), 0, 0);
    L.translate(0, -y0);

    // Props and agents in base order.
    const items = [];
    for (const p of props) {
      if (p.top > y1 + 2) break;
      if (p.base + 3 < y0) continue;
      items.push(p);
    }
    for (const a of f.agents) {
      const top = (a.pose === 'sit' ? a.seat.y : a.y - 15) - 2;
      const bottom = a.pose === 'sit' ? a.seat.y + 16 : a.y + 3;
      if (bottom < y0 || top > y1) continue;
      items.push({ kind: 'agent', base: a.pose === 'sit' ? a.seat.y + 17.5 : a.y + 0.5, agent: a });
    }
    items.sort((a, b) => a.base - b.base);
    for (const it of items) {
      if (it.kind === 'agent') drawAgent(L, it.agent);
      else drawProp(L, it, f);
    }
    // Falling leaves.
    for (const q of leaves) {
      if (q.y < y0 - 2 || q.y > y1 + 2) continue;
      L.globalAlpha = Math.min(1, q.life * 2);
      L.fillStyle = q.colour;
      const flip = Math.floor(t * 5 + q.phase) % 2;
      L.fillRect(Math.round(q.x), Math.round(q.y), flip ? 2 : 1, flip ? 1 : 2);
    }
    L.globalAlpha = 1;

    const tint = worldTint(f.tod);
    if (tint.alpha > 0.002) {
      L.setTransform(1, 0, 0, 1, 0, 0);
      L.globalCompositeOperation = 'source-atop';
      L.fillStyle = rgba(tint.colour, tint.alpha);
      L.fillRect(0, 0, W, TILE);
      L.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(layer.canvas, 0, 0);

    // Lights on top.
    ctx.translate(0, -y0);
    drawLights(ctx, f, y0, y1);
    drawCallouts(ctx, f, y0, y1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawLights(ctx, f, y0, y1) {
    const night = f.night;
    const glow = 0.3 + 0.7 * night;
    ctx.globalCompositeOperation = 'lighter';
    // Lamps.
    for (const p of props) {
      if (p.kind !== 'lamp' || p.base < y0 - 20 || p.base - 40 > y1) continue;
      const g = lampGlass.get(p.id);
      if (!g) continue;
      const status = f.lampStatus(p);
      const colour = statusHex[status] ?? C.primary;
      const period = status === 'permission' ? 1.0 : 1.5;
      const pulse = status === 'ready' || reduced ? 1 : 0.55 + 0.45 * Math.sin((t * Math.PI * 2) / period);
      ctx.globalAlpha = (0.35 + 0.65 * pulse) * glow;
      ctx.drawImage(halo(colour, 13, 0.9), g.cx - 13, g.cy - 13);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = mix(colour, '#000000', 0.3 * (1 - pulse));
      ctx.fillRect(g.gx, g.gy, g.gw, g.gh);
      ctx.fillStyle = mix(colour, '#ffffff', 0.55 * pulse);
      ctx.fillRect(g.gx + 1, g.gy + 1, 2, 1);
      ctx.globalCompositeOperation = 'lighter';
    }
    // Laptop light on the faces of the agents at their benches.
    for (const a of f.agents) {
      if (a.pose !== 'sit') continue;
      const ax = a.seat.x;
      const ay = a.seat.y;
      if (ay > y1 || ay + 16 < y0) continue;
      const flicker = reduced ? 0.85 : 0.72 + 0.18 * Math.sin(t * 13 + ax) + 0.1 * Math.sin(t * 31 + ay);
      ctx.globalAlpha = flicker * glow;
      ctx.drawImage(halo(C.primaryLight, 11, 0.8), ax + 4 - 11, ay + 7 - 11);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = flicker * (0.4 + 0.4 * night);
      ctx.fillStyle = C.screen;
      ctx.fillRect(ax + 2, ay + 4, 5, 2);
      ctx.fillRect(ax + 1, ay + 7, 7, 1);
      ctx.globalCompositeOperation = 'lighter';
    }
    // Memory stone rune and the notes it sends down every lane.
    const ms = world.memStone;
    if (ms.base > y0 - 30 && ms.base - 30 < y1) {
      const pulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 2.2);
      ctx.globalAlpha = (0.35 + 0.65 * f.memory) * pulse;
      ctx.drawImage(halo(C.primaryLight, 16, 0.9), ms.x - 15, ms.base - 5 - 16);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.6 + 0.4 * f.memory;
      ctx.fillStyle = mix(C.primaryLight, '#ffffff', 0.35);
      for (const [rx, ry] of runePixels(ms.x, ms.base)) ctx.fillRect(rx, ry, 1, 1);
      ctx.globalCompositeOperation = 'lighter';
    }
    for (const n of f.notes) {
      if (n.y < y0 - 8 || n.y > y1 + 8) continue;
      ctx.globalAlpha = n.a * 0.9;
      ctx.drawImage(halo(C.primaryLight, 5, 1), Math.round(n.x) - 3, Math.round(n.y) - 4);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = n.a;
      drawNote(ctx, Math.round(n.x) - 2, Math.round(n.y) - 2);
      ctx.globalCompositeOperation = 'lighter';
    }
    // The gate on main glows green once the branches are home.
    if (f.gateGlow > 0.01) {
      const gy = world.mainGateY;
      if (gy > y0 - 40 && gy - 50 < y1) {
        ctx.globalAlpha = f.gateGlow * (reduced ? 0.8 : 0.65 + 0.25 * Math.sin(t * 2));
        ctx.drawImage(halo(C.green, 24, 0.8), world.gateX - 24, gy - 18 - 24);
      }
    }
    // Fireflies, drawn to the pointer at night.
    const vis = S((night - 0.15) / 0.7);
    if (vis > 0.02) {
      for (const fl of fireflies) {
        if (fl.y < y0 - 5 || fl.y > y1 + 5) continue;
        const b = reduced ? 0.8 : 0.5 + 0.5 * Math.sin(t * fl.speed + fl.phase);
        if (b < 0.18) continue;
        const x = Math.round(fl.x);
        const y = Math.round(fl.y);
        ctx.globalAlpha = b * vis * 0.8;
        ctx.drawImage(halo(C.firefly, 4, 1), x - 4, y - 4);
        ctx.globalAlpha = b * vis;
        ctx.fillStyle = C.firefly;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawCallouts(ctx, f, y0, y1) {
    if (f.callout <= 0.01) return;
    ctx.globalAlpha = f.callout;
    ctx.fillStyle = C.cream;
    for (const c of world.callouts) {
      if (Math.max(c.y, c.ty) < y0 - 4 || Math.min(c.y, c.ty) > y1 + 4) continue;
      // An elbow: across from the label, then to the target.
      const x0 = c.x - 2;
      const yL = c.y;
      const xt = c.tx + 2;
      ctx.fillRect(Math.min(xt, x0), yL, Math.abs(x0 - xt) + 1, 1);
      ctx.fillRect(xt, Math.min(yL, c.ty), 1, Math.abs(c.ty - yL) + 1);
      ctx.fillRect(xt - 1, c.ty - 1, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  function setDetour(trodden) {
    const key = trodden ? 'trodden' : 'faint';
    if (key === detourKey) return;
    detourKey = key;
  }

  return { drawTile, update, burst, setDetour, props };
}
