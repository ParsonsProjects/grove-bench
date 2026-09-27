// Shared pixel world for the Grove Log scenes. No Svelte in here.
//
// Every scene is its own small canvas: the backing store is the art
// resolution (about 330 x 150 on a laptop, 190 x 150 on a phone) and the
// canvas is scaled up by a whole number of device pixels, so every art pixel
// stays a crisp square. A scene module adds its own props and characters on
// top of the backdrop drawn here (sky, stars, moon or sun, clouds, hills,
// ground, tufts, fireflies), and the whole world layer is tinted for the time
// of day, which the page drives from the scroll position.

import {
  C,
  statusHex,
  treePalette,
  skyBands,
  worldTint,
  hillColours,
  cloudColours,
  mix,
  rgba,
  hexToRgb,
} from '../../grove/palette.js';
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
  moonSprite,
  sunSprite,
  halo,
  ringHalo,
  cloudShape,
  BENCH_W,
} from '../../grove/sprites.js';
import { characterSprites } from './sprites.js';
import { agentLooks } from '../lanes.js';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Offsets from a tree's centre to the things around it. */
export const P = { bench: -2, agent: 6, lamp: 25, sign: -18 };

export const TREE_EXTRA = 1;
// Each lane's tree gets a small hue shift, same in every scene.
const TREE_VARIANTS = { auth: [-4, 0], api: [8, 0.015], fix: [-12, -0.01] };

/**
 * Picks the art size for a CSS width: whole device pixels per art pixel,
 * big enough to read, never so small that three plots do not fit.
 */
export function fitStage(cssW, dpr) {
  const compact = cssW < 560;
  const minK = compact ? 1.5 : 2.5;
  const minW = compact ? 180 : 250;
  const maxW = compact ? 250 : 380;
  const devW = Math.max(1, Math.floor(cssW * dpr));
  let s = Math.max(1, Math.ceil(minK * dpr - 1e-6));
  while (devW / s > maxW) s++;
  s = Math.max(1, Math.min(s, Math.floor(devW / minW)));
  return { s, W: Math.floor(devW / s), k: s / dpr, compact };
}

/** Bresenham line into a pixel list. */
export function linePixels(x0, y0, x1, y1, out = []) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}

export function quad(x0, y0, x1, y1, cx, cy, t) {
  const u = 1 - t;
  return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {(env: any) => any} factory scene module
 * @param {{ reduced?: boolean, tod?: number, onchange?: () => void }} opts
 */
export function createEngine(canvas, factory, opts = {}) {
  const ctx = canvas.getContext('2d');
  const world = makeCanvas(1, 1);
  const skyLayer = makeCanvas(1, 1);
  const moon = moonSprite();
  const sun = sunSprite();
  const treeCache = new Map();
  let skyKey = '';
  let ground = null;
  let stars = [];
  let clouds = [];
  let fireflies = [];
  let hillKey = '';
  let hillPal = null;
  let cloudKey = '';
  let cloudPal = null;
  let meteor = null;
  let nextMeteor = 3 + Math.random() * 4;

  const env = {
    W: 320,
    H: 150,
    k: 3,
    s: 3,
    groundY: 118,
    compact: false,
    block: 7,
    tod: opts.tod ?? 0,
    time: 0,
    reduced: !!opts.reduced,
    /** Pointer in art pixels, or null. */
    pointer: null,
    particles: [],
    changed: () => opts.onchange?.(),
  };

  const scene = factory(env);
  const bd = {
    moon: [0.3, 0.22],
    sun: 0.74,
    clouds: 3,
    fireflies: 14,
    seed: 0,
    ground: 34,
    ...(scene.backdrop ?? {}),
  };

  // -------------------------------------------------------------------------
  // Size

  function resize(cssW) {
    const dpr = window.devicePixelRatio || 1;
    const fit = fitStage(cssW, dpr);
    env.s = fit.s;
    env.k = fit.k;
    env.W = fit.W;
    env.compact = fit.W < 262;
    env.block = env.compact ? 5 : 7;
    env.H = scene.height ? scene.height(env) : 150;
    env.groundY = env.H - (typeof bd.ground === 'function' ? bd.ground(env) : bd.ground);
    canvas.width = env.W;
    canvas.height = env.H;
    canvas.style.width = `${env.W * env.k}px`;
    canvas.style.height = `${env.H * env.k}px`;
    world.canvas.width = env.W;
    world.canvas.height = env.H;
    skyLayer.canvas.width = env.W;
    skyLayer.canvas.height = env.H;
    ctx.imageSmoothingEnabled = false;
    world.ctx.imageSmoothingEnabled = false;
    skyKey = '';
    ground = null;
    treeCache.clear();
    seed();
    scene.layout?.();
  }

  function seed() {
    const { W, groundY } = env;
    const horizon = groundY - 20;
    const count = Math.round((W * horizon) / 600);
    stars = Array.from({ length: count }, (_, i) => {
      const r = hash(i + bd.seed * 131, 91);
      return {
        x: Math.floor(hash(i + bd.seed * 131, 17) * W),
        y: Math.floor(hash(i + bd.seed * 131, 29) ** 1.3 * (horizon - 6)) + 2,
        kind: r > 0.93 ? 2 : r > 0.7 ? 1 : 0,
        phase: hash(i, 5) * Math.PI * 2,
        speed: 0.6 + hash(i, 8) * 1.8,
      };
    });
    const band = Math.max(16, groundY - 80);
    clouds = Array.from({ length: bd.clouds }, (_, i) => {
      const s = i + bd.seed * 7;
      const w = 30 + Math.floor(hash(s, 51) * 36);
      const h = 8 + Math.floor(hash(s, 52) * 6);
      return {
        rows: cloudShape(s + 7, w, h),
        w,
        h,
        x: hash(s, 53) * (W + w),
        y: 6 + Math.floor(((i + hash(s, 54)) / Math.max(1, bd.clouds)) * band * 0.8),
        speed: 1 + hash(s, 55) * 1.4,
      };
    });
    const n = bd.fireflies ? clamp(Math.round((W * bd.fireflies) / 300), 6, 30) : 0;
    fireflies = Array.from({ length: n }, (_, i) => ({
      x: hash(i + bd.seed, 3) * W,
      y: groundY - 6 - hash(i + bd.seed, 4) * 64,
      vx: 0,
      vy: 0,
      p1: hash(i, 5) * 10,
      p2: hash(i, 6) * 10,
      p3: hash(i, 7) * 10,
      phase: hash(i, 8) * Math.PI * 2,
      speed: 1.2 + hash(i, 9) * 1.6,
    }));
  }

  // -------------------------------------------------------------------------
  // Plots: a tree, a sign post, a bench, an agent and a status lamp

  const blocksByExtra = new Map();
  const blocksFor = (extra) => {
    let b = blocksByExtra.get(extra);
    if (!b) blocksByExtra.set(extra, (b = treeBlocks(extra)));
    return b;
  };

  /**
   * @param {'auth' | 'api' | 'fix'} key
   * @param {number} x tree centre in art px
   */
  function makePlot(key, x, o = {}) {
    return {
      key,
      x,
      pal: treePalette(...TREE_VARIANTS[key]),
      sprites: characterSprites(agentLooks[key]),
      growth: 1,
      tree: true,
      sign: 1,
      bench: 1,
      lampPost: true,
      pose: 'sit',
      ax: x,
      ay: 0,
      walkT: 0,
      status: 'working',
      lampOn: 1,
      shake: 0,
      screen: 0,
      lamp: null,
      ...o,
    };
  }

  function treeImage(pal, block, key) {
    const id = `${key}|${block}`;
    let c = treeCache.get(id);
    if (c) return c;
    const size = treeSize(block, TREE_EXTRA);
    const made = makeCanvas(size.w, size.h);
    drawTree(made.ctx, (size.w - 1) / 2, size.h - 1, pal, { block, extraTrunk: TREE_EXTRA });
    treeCache.set(id, made.canvas);
    return made.canvas;
  }

  /** Draws a tree with its root row on `baseY`; growth 0..1. */
  function drawTreeAt(w, x, baseY, pal, growth, block = env.block, key = 'tree') {
    if (growth <= 0) return;
    const size = treeSize(block, TREE_EXTRA);
    if (growth >= 0.999) {
      w.drawImage(treeImage(pal, block, key), Math.round(x - (size.w - 1) / 2), baseY - size.h + 1);
    } else {
      drawTree(w, Math.round(x), baseY, pal, { block, extraTrunk: TREE_EXTRA, growth, blocks: blocksFor(TREE_EXTRA) });
    }
  }

  function treeTop(block = env.block) {
    return env.groundY - treeSize(block, TREE_EXTRA).h + 1;
  }

  function drawPlot(w, p) {
    const G = env.groundY;
    const x = Math.round(p.x);
    const sx = p.shake > 0 && !env.reduced ? Math.round(Math.sin(p.shake * 40)) : 0;
    if (p.tree) drawTreeAt(w, x + sx, G, p.pal, p.growth, env.block, p.key);
    if (p.sign > 0) drawSignPost(w, x + P.sign, G, Math.max(1, Math.round(13 * p.sign)));
    if (p.bench > 0) {
      const hgt = Math.ceil(13 * p.bench);
      w.save();
      w.beginPath();
      w.rect(x + P.bench - 2, G - hgt + 1, BENCH_W + 4, hgt);
      w.clip();
      drawBench(w, x + P.bench, G);
      w.restore();
    }
    drawAgent(w, p);
    p.lamp = p.lampPost ? drawLamp(w, x + P.lamp, G) : null;
  }

  function drawAgent(w, p) {
    const G = env.groundY;
    const x = Math.round(p.x);
    if (p.pose === 'sit') w.drawImage(p.sprites.sit, x + P.agent, G - 16);
    else if (p.pose === 'shrug') w.drawImage(p.sprites.shrug, x + P.agent - 1, G - 16);
    else if (p.pose === 'walk') {
      const frame = env.reduced ? 0 : Math.floor(p.walkT * 7) % 2;
      w.drawImage(frame ? p.sprites.walkB : p.sprites.walkA, Math.round(p.ax) - 4, Math.round(p.ay) - 14 - frame);
    } else if (p.pose === 'stand') {
      w.drawImage(p.sprites.walkA, Math.round(p.ax) - 4, Math.round(p.ay) - 14);
    }
  }

  /** Where an agent's head is, for bubbles and hit boxes. */
  function agentBox(p) {
    const G = env.groundY;
    if (p.pose === 'sit' || p.pose === 'shrug') return { x: Math.round(p.x) + P.agent, y: G - 16, w: 9, h: 15, cx: Math.round(p.x) + P.agent + 4.5 };
    if (p.pose === 'walk' || p.pose === 'stand') return { x: Math.round(p.ax) - 4, y: Math.round(p.ay) - 15, w: 9, h: 15, cx: Math.round(p.ax) + 0.5 };
    return null;
  }

  function plotLights(p, extra = 0) {
    const tt = tnow();
    const night = nightAmount();
    const glow = 0.35 + 0.65 * night;
    const x = Math.round(p.x);
    const G = env.groundY;
    if (p.pose === 'sit' || p.pose === 'shrug') {
      const working = p.status === 'working';
      const flicker = env.reduced ? 0.85 : 0.72 + 0.18 * Math.sin(tt * 13 + x) + 0.1 * Math.sin(tt * 31 + x * 2);
      const lit = (working ? flicker : 0.45) * (1 + (p.screen + extra) * 0.5);
      const ax = x + P.agent + (p.pose === 'shrug' ? -1 : 0);
      const ay = G - 16;
      const img = p.pose === 'shrug' ? p.sprites.shrug : p.sprites.sit;
      // The agent, relit by its own screen so it reads against the night.
      ctx.globalAlpha = (0.35 + 0.25 * lit) * night + 0.05;
      ctx.drawImage(img, ax, ay);
      ctx.globalCompositeOperation = 'lighter';
      const r = 10 + Math.round((p.screen + extra) * 4);
      ctx.globalAlpha = Math.min(1, lit * glow);
      ctx.drawImage(halo(C.primaryLight, r, 0.8), ax + 4 - r + (p.pose === 'shrug' ? 1 : 0), ay + 9 - r);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, lit * (0.35 + 0.4 * night));
      ctx.fillStyle = C.screen;
      const o = p.pose === 'shrug' ? 1 : 0;
      ctx.fillRect(ax + 2 + o, ay + 9, 5, 1);
      ctx.globalAlpha = 1;
    }
    if (p.lamp) drawLampLight(p.lamp, p.status, p.lampOn, glow, tt, x);
  }

  function drawLampLight(lamp, status, on, glow, tt, seedX = 0) {
    const colour = statusHex[status] ?? '#555555';
    const off = status === 'off';
    const period = status === 'permission' ? 1.0 : 1.5;
    const pulse = off || status === 'ready' || env.reduced ? 1 : 0.5 + 0.5 * Math.sin((tt * Math.PI * 2) / period + seedX);
    const { gx, gy, gw, gh, cx, cy } = lamp;
    if (!off) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.35 + 0.65 * pulse) * glow * on;
      ctx.drawImage(halo(colour, 12, 0.9), cx - 12, cy - 12);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = off ? '#3a3a3a' : mix(colour, '#000000', 0.35 * (1 - pulse));
    ctx.fillRect(gx, gy, gw, gh);
    if (!off) {
      ctx.fillStyle = mix(colour, '#ffffff', 0.55 * pulse);
      ctx.fillRect(gx + 1, gy + 1, 2, 1);
    }
  }

  // -------------------------------------------------------------------------
  // Particles

  function burstLeaves(x, y, n, spread = 1, colours = [C.leafTop, '#5ab868', '#4aaa58', '#3a9a48']) {
    if (env.reduced) return;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4 * spread;
      const v = 16 + Math.random() * 36 * spread;
      env.particles.push({
        kind: 'leaf',
        x: x + (Math.random() - 0.5) * 18,
        y: y + (Math.random() - 0.5) * 10,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 2 + Math.random() * 1.5,
        colour: colours[i % colours.length],
        phase: Math.random() * 6,
      });
    }
  }

  function dropLeaf(x, y, colour) {
    if (env.reduced) return;
    env.particles.push({ kind: 'leaf', x, y, vx: (Math.random() - 0.5) * 8, vy: -4, life: 2.4, colour, phase: Math.random() * 6 });
  }

  function puff(x, y, colour = C.pathDark) {
    if (env.reduced) return;
    for (let i = 0; i < 7; i++) {
      env.particles.push({
        kind: 'dust',
        x: x + (i - 3),
        y,
        vx: (i - 3) * 6,
        vy: -8 - Math.random() * 8,
        life: 0.5 + Math.random() * 0.3,
        colour,
      });
    }
  }

  function updateParticles(dt) {
    const ps = env.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i];
      q.life -= dt;
      if (q.kind === 'leaf') {
        q.vy += 26 * dt;
        q.vx += Math.sin(env.time * 3 + q.phase) * 20 * dt;
        q.vx *= 1 - 1.2 * dt;
        q.vy = Math.min(q.vy, 16);
      } else {
        q.vy += 30 * dt;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.kind === 'leaf' && q.y > env.groundY + 2) q.life = Math.min(q.life, 0.3);
      if (q.life <= 0) ps.splice(i, 1);
    }
  }

  function drawParticles(w) {
    for (const q of env.particles) {
      w.globalAlpha = Math.min(1, q.life * 2);
      w.fillStyle = q.colour;
      const x = Math.round(q.x);
      const y = Math.round(q.y);
      if (q.kind === 'leaf') {
        const flip = Math.floor(env.time * 5 + q.phase) % 2;
        w.fillRect(x, y, flip ? 2 : 1, flip ? 1 : 2);
      } else {
        w.fillRect(x, y, 1, 1);
      }
    }
    w.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // Update

  function tnow() {
    return env.reduced ? 0 : env.time;
  }

  function nightAmount() {
    return 1 - smooth(0.3, 0.85, env.tod);
  }

  function update(dt) {
    if (env.reduced) return;
    env.time += dt;
    scene.update?.(dt);
    updateParticles(dt);
    updateFireflies(dt);
    if (meteor) {
      meteor.t += dt;
      if (meteor.t > meteor.life) meteor = null;
    } else if (env.time > nextMeteor && env.tod < 0.25 && bd.meteors !== false) {
      meteor = { x: env.W * (0.3 + Math.random() * 0.6), y: 4 + Math.random() * Math.max(8, env.groundY - 100), t: 0, life: 0.7 };
      nextMeteor = env.time + 6 + Math.random() * 8;
    }
  }

  function updateFireflies(dt) {
    const { W, groundY } = env;
    const top = Math.max(6, groundY - 90);
    const t = env.time;
    const ptr = env.pointer;
    for (const f of fireflies) {
      let ax = Math.sin(t * 0.7 + f.p1) * 7 + Math.cos(t * 0.31 + f.p2) * 5;
      let ay = Math.cos(t * 0.53 + f.p3) * 6 + Math.sin(t * 0.23 + f.p1) * 3;
      if (ptr) {
        const dx = ptr.x - f.x;
        const dy = ptr.y - f.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 80) {
          const pull = (1 - d / 80) * 60;
          ax += (dx / d) * pull - (dy / d) * pull * 0.6;
          ay += (dy / d) * pull + (dx / d) * pull * 0.6;
          if (d < 9) {
            ax -= (dx / d) * 80;
            ay -= (dy / d) * 80;
          }
        }
      }
      f.vx = (f.vx + ax * dt) * (1 - 0.9 * dt);
      f.vy = (f.vy + ay * dt) * (1 - 0.9 * dt);
      const sp = Math.hypot(f.vx, f.vy);
      const max = ptr ? 34 : 12;
      if (sp > max) {
        f.vx *= max / sp;
        f.vy *= max / sp;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < -12) f.x += W + 24;
      if (f.x > W + 12) f.x -= W + 24;
      if (f.y < top) f.vy += 20 * dt;
      if (f.y > groundY + 6) f.vy -= 30 * dt;
    }
  }

  // -------------------------------------------------------------------------
  // Backdrop

  function drawSky(todv) {
    const { W, H, groundY } = env;
    const bucket = Math.round(todv * 200) / 200;
    const key = `${bucket}|${W}|${H}|${groundY}`;
    if (key === skyKey) return;
    skyKey = key;
    const bands = skyBands(bucket).map(hexToRgb);
    const horizon = groundY - 6;
    const img = skyLayer.ctx.createImageData(W, H);
    const data = img.data;
    const n = bands.length;
    for (let y = 0; y < H; y++) {
      const f = clamp(y / horizon, 0, 1) * (n - 1);
      const i = Math.floor(f);
      const frac = f - i;
      for (let x = 0; x < W; x++) {
        const c = bands[Math.min(n - 1, i + (frac > bayer(x, y) ? 1 : 0))];
        const o = (y * W + x) * 4;
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        data[o + 3] = 255;
      }
    }
    skyLayer.ctx.putImageData(img, 0, 0);
  }

  function drawStars(tt, night) {
    if (night <= 0.01) return;
    for (const s of stars) {
      const tw = env.reduced ? 0.8 : 0.55 + 0.45 * Math.sin(tt * s.speed + s.phase);
      const a = night * (s.kind === 0 ? 0.45 : 0.8) * tw;
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

  function drawMoonSun(todv) {
    const { W, groundY } = env;
    const horizon = groundY - 14;
    const moonA = 1 - smooth(0.42, 0.72, todv);
    if (moonA > 0.01 && bd.moon) {
      const mx = Math.round(W * bd.moon[0] - todv * 30);
      const my = Math.round(Math.max(10, groundY * bd.moon[1]) + todv * 60);
      ctx.globalAlpha = moonA;
      ctx.drawImage(ringHalo(C.primaryPale, 19, [0.1, 0.06, 0.03]), mx - 19, my - 19);
      ctx.drawImage(moon, mx - 7, my - 7);
      ctx.globalAlpha = 1;
    }
    const rise = smooth(0.36, 1, todv);
    if (rise > 0.001 && bd.sun != null) {
      const sx = Math.round(W * bd.sun);
      const sy = Math.round(horizon + 12 - rise * Math.min(92, horizon - 16));
      ctx.drawImage(ringHalo(C.amberLight, 26, [0.28, 0.15, 0.07]), sx - 26, sy - 26);
      ctx.drawImage(sun, sx - 7, sy - 7);
    }
  }

  function drawClouds(todv, tt) {
    const bucket = Math.round(todv * 100) / 100;
    if (cloudKey !== String(bucket)) {
      cloudKey = String(bucket);
      cloudPal = cloudColours(bucket);
    }
    const W = env.W;
    ctx.globalAlpha = 0.45 + 0.55 * smooth(0.2, 0.6, todv);
    for (const c of clouds) {
      const span = W + c.w + 20;
      const drift = env.reduced ? 0 : tt * c.speed;
      const x0 = Math.round(((((c.x + drift) % span) + span) % span) - c.w - 10);
      c.rows.forEach((run, y) => {
        if (!run) return;
        const [a, b] = run;
        ctx.fillStyle = y >= c.h - 3 ? cloudPal.shade : cloudPal.body;
        ctx.fillRect(x0 + a, c.y + y, b - a, 1);
        const above = c.rows[y - 1];
        ctx.fillStyle = cloudPal.top;
        if (!above) ctx.fillRect(x0 + a, c.y + y, b - a, 1);
        else {
          if (a < above[0]) ctx.fillRect(x0 + a, c.y + y, above[0] - a, 1);
          if (b > above[1]) ctx.fillRect(x0 + above[1], c.y + y, b - above[1], 1);
        }
      });
    }
    ctx.globalAlpha = 1;
  }

  function drawMeteor(night) {
    if (!meteor || env.reduced || night < 0.5) return;
    const p = meteor.t / meteor.life;
    const hx = Math.round(meteor.x - p * 50);
    const hy = Math.round(meteor.y + p * 22);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = rgba(C.cream, (1 - i / 8) * (1 - p) * night);
      ctx.fillRect(hx + Math.round(i * 2.3), hy - i, 1, 1);
    }
  }

  function drawBirds(todv, tt) {
    const a = smooth(0.55, 0.75, todv);
    if (a <= 0.01) return;
    const W = env.W;
    ctx.fillStyle = rgba('#1e2433', a * 0.85);
    for (let i = 0; i < 3; i++) {
      const x = Math.round(W + 30 - ((((env.reduced ? 40 + i * 60 : tt * 11) + i * 23 + 60) % (W + 60))));
      const y = Math.round(Math.max(14, env.groundY - 100) + i * 7 + (env.reduced ? 0 : Math.sin(tt * 0.8 + i) * 2));
      const up = env.reduced || Math.floor(tt * 4 + i) % 2 === 0;
      if (up) {
        ctx.fillRect(x - 2, y - 1, 1, 1);
        ctx.fillRect(x - 1, y, 1, 1);
        ctx.fillRect(x, y + 1, 1, 1);
        ctx.fillRect(x + 1, y, 1, 1);
        ctx.fillRect(x + 2, y - 1, 1, 1);
      } else {
        ctx.fillRect(x - 2, y + 1, 5, 1);
        ctx.fillRect(x, y + 2, 1, 1);
      }
    }
  }

  const farTop = (x) =>
    env.groundY - 26 - Math.round(9 * Math.sin(x * 0.011 + 1) + 6 * Math.sin(x * 0.027 + 2.2) + 3 * Math.sin(x * 0.063 + 0.4));
  const nearTop = (x) =>
    env.groundY - 11 - Math.round(6 * Math.sin(x * 0.017 + 0.3) + 4 * Math.sin(x * 0.041 + 1.7) + 2 * Math.sin(x * 0.09));

  function drawHills(todv) {
    const bucket = Math.round(todv * 100) / 100;
    if (hillKey !== String(bucket)) {
      hillKey = String(bucket);
      const h = hillColours(bucket);
      const bands = skyBands(bucket);
      const base = h.near;
      const pal = {
        leaves: ['#6ec87a', '#5ab868', '#4aaa58', '#3a9a48'].map((c) => mix(base, c, 0.28)),
        hi: mix(base, '#6ec87a', 0.34),
        seam: mix(base, '#000000', 0.12),
        deep: mix(base, '#000000', 0.18),
        trunk: mix(base, C.wood, 0.25),
        trunkHi: mix(base, C.wood, 0.3),
        trunkLo: mix(base, C.woodDark, 0.25),
        root: mix(base, C.woodDark, 0.25),
        rootLo: mix(base, C.woodDeep, 0.25),
      };
      hillPal = {
        far: h.far,
        farRim: mix(h.far, bands[6], 0.45),
        near: h.near,
        nearRim: mix(h.near, bands[7], 0.35),
        trees: [1, 2].map((blk) => {
          const size = treeSize(blk, 0);
          const made = makeCanvas(size.w, size.h);
          drawTree(made.ctx, (size.w - 1) / 2, size.h - 1, pal, { block: blk, extraTrunk: 0 });
          return made.canvas;
        }),
      };
    }
    const { W, groundY } = env;
    const off = bd.seed * 211;
    for (let x = 0; x < W; x++) {
      const ft = farTop(x + off);
      ctx.fillStyle = hillPal.farRim;
      ctx.fillRect(x, ft, 1, 1);
      ctx.fillStyle = hillPal.far;
      ctx.fillRect(x, ft + 1, 1, groundY - ft);
    }
    for (let i = Math.floor((off - 30) / 26); i <= Math.ceil((off + W + 30) / 26); i++) {
      if (hash(i, 41) < 0.35) continue;
      const u = i * 26 + Math.floor(hash(i, 43) * 12);
      const img = hillPal.trees[hash(i, 47) > 0.55 ? 1 : 0];
      ctx.drawImage(img, u - off - Math.floor(img.width / 2), nearTop(u) - img.height + 3);
    }
    for (let x = 0; x < W; x++) {
      const nt = nearTop(x + off);
      ctx.fillStyle = hillPal.nearRim;
      ctx.fillRect(x, nt, 1, 1);
      ctx.fillStyle = hillPal.near;
      ctx.fillRect(x, nt + 1, 1, groundY - nt + 2);
    }
  }

  function buildGround() {
    const { W, H, groundY } = env;
    const depth = H - groundY + 3;
    const g = makeCanvas(W, depth);
    const c = g.ctx;
    const oy = 2; // strip row 0 is groundY - 2
    const withPath = bd.path !== false;
    c.fillStyle = C.grassTop;
    c.fillRect(0, oy, W, 1);
    c.fillStyle = C.grass;
    c.fillRect(0, oy + 1, W, 2);
    let meadowTop = oy + 3;
    if (withPath) {
      c.fillStyle = C.pathEdge;
      c.fillRect(0, oy + 3, W, 1);
      c.fillStyle = C.path;
      c.fillRect(0, oy + 4, W, 3);
      c.fillStyle = C.pathDark;
      c.fillRect(0, oy + 7, W, 1);
      meadowTop = oy + 8;
    }
    const meadowRows = depth - meadowTop;
    const mcols = [C.grassDark, C.meadow, mix(C.meadow, C.meadowDeep, 0.5), C.meadowDeep].map(hexToRgb);
    const img = c.getImageData(0, 0, W, depth);
    const d = img.data;
    for (let y = meadowTop; y < depth; y++) {
      const f = Math.min(1, (y - meadowTop) / Math.max(1, Math.min(meadowRows, 40))) * (mcols.length - 1);
      const i = Math.floor(f);
      for (let x = 0; x < W; x++) {
        const col = mcols[Math.min(mcols.length - 1, i + (f - i > bayer(x, y) ? 1 : 0))];
        const o = (y * W + x) * 4;
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
        d[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    const sd = bd.seed * 977;
    for (let x = 0; x < W; x++) {
      const wx = x + sd;
      const r = hash(wx, 11);
      if (r < 0.45) {
        c.fillStyle = C.grassTop;
        c.fillRect(x, oy - 1, 1, 1);
        if (r < 0.12) c.fillRect(x, oy - 2, 1, 1);
      }
      if (withPath && hash(wx, 13) < 0.08) {
        c.fillStyle = C.pathDark;
        c.fillRect(x, oy + 4 + Math.floor(hash(wx, 14) * 3), 1, 1);
      }
      if (withPath && hash(wx, 15) < 0.05) {
        c.fillStyle = C.cream;
        c.fillRect(x, oy + 5, 1, 1);
      }
      for (let j = 0; j < 2; j++) {
        if (hash(wx, 20 + j) < 0.22) {
          const y = meadowTop + 1 + Math.floor(hash(wx, 30 + j) * Math.max(1, meadowRows - 3));
          const shade = (y - meadowTop) / Math.max(1, meadowRows);
          c.fillStyle = shade < 0.35 ? C.grass : shade < 0.7 ? C.grassDark : C.meadow;
          c.fillRect(x, y, 1, 2);
        }
      }
      if (hash(wx, 25) < 0.02) {
        const y = meadowTop + 2 + Math.floor(hash(wx, 26) * Math.max(1, Math.min(meadowRows, 26) - 4));
        c.fillStyle = hash(wx, 27) < 0.5 ? C.cream : C.amberLight;
        c.fillRect(x, y, 1, 1);
        c.fillStyle = C.grass;
        c.fillRect(x, y + 1, 1, 1);
      }
    }
    ground = g.canvas;
  }

  function drawTufts(w, tt, fg) {
    const { W, H, groundY } = env;
    const spacing = fg ? 19 : 11;
    const y0 = fg ? H - 3 : groundY + 1;
    const sd = bd.seed * 13;
    for (let i = -1; i <= Math.ceil(W / spacing) + 1; i++) {
      const id = i + sd;
      if (hash(id, fg ? 61 : 63) < (fg ? 0.35 : 0.45)) continue;
      const x = i * spacing + Math.floor(hash(id, 65) * (spacing - 4));
      const hgt = fg ? 4 + Math.floor(hash(id, 67) * 4) : 2 + Math.floor(hash(id, 67) * 2);
      const sway = env.reduced ? 0 : Math.round(Math.sin(tt * 1.3 + i * 0.7) * (fg ? 1.2 : 0.8));
      w.fillStyle = fg ? C.meadowDeep : C.grassDark;
      w.fillRect(x, y0 - hgt + 2, 1, hgt);
      w.fillRect(x + 2, y0 - hgt + 3, 1, hgt - 1);
      w.fillStyle = fg ? C.grassDark : C.grassTop;
      w.fillRect(x + sway, y0 - hgt, 1, 2);
      w.fillRect(x + 2 + sway, y0 - hgt + 1, 1, 2);
      w.fillRect(x - 1 + sway, y0 - hgt + 2, 1, 2);
      if (fg && hash(id, 69) < 0.3) {
        w.fillStyle = hash(id, 71) < 0.5 ? C.amberLight : C.cream;
        w.fillRect(x + 1 + sway, y0 - hgt - 1, 1, 1);
      }
    }
  }

  function drawFireflies(tt, night) {
    const vis = smooth(0.1, 0.9, night);
    if (vis <= 0.02) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fireflies) {
      const b = env.reduced ? 0.8 : 0.5 + 0.5 * Math.sin(tt * f.speed + f.phase);
      if (b < 0.18) continue;
      const x = Math.round(f.x);
      const y = Math.round(f.y);
      ctx.globalAlpha = b * vis * 0.8;
      ctx.drawImage(halo(C.firefly, 4, 1), x - 4, y - 4);
      ctx.globalAlpha = b * vis;
      ctx.fillStyle = C.firefly;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** A leader line with a dark outline and an arrow tip, for labels. */
  function drawLeader(points, end, alpha = 1) {
    const tt = tnow();
    const pts = points.map(([x, y]) => [Math.round(x), Math.round(y)]);
    const px = [];
    for (let i = 1; i < pts.length; i++) linePixels(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], px);
    const [ex, ey] = pts[pts.length - 1];
    const tip =
      end === 'down'
        ? [[ex, ey + 1], [ex - 1, ey], [ex + 1, ey], [ex - 2, ey - 1], [ex + 2, ey - 1]]
        : end === 'right'
          ? [[ex + 1, ey], [ex, ey - 1], [ex, ey + 1], [ex - 1, ey - 2], [ex - 1, ey + 2]]
          : [[ex - 1, ey], [ex, ey - 1], [ex, ey + 1], [ex + 1, ey - 2], [ex + 1, ey + 2]];
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = '#0b1224';
    for (const [x, y] of [...px, ...tip]) ctx.fillRect(x - 1, y - 1, 3, 3);
    const march = env.reduced ? 0 : Math.floor(tt * 10);
    ctx.fillStyle = C.cream;
    px.forEach(([x, y], i) => {
      ctx.globalAlpha = alpha * ((i - march) % 4 === 0 ? 0.55 : 1);
      ctx.fillRect(x, y, 1, 1);
    });
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffe7a8';
    for (const [x, y] of tip) ctx.fillRect(x, y, 1, 1);
    ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // Render

  function render() {
    const tt = tnow();
    const todv = env.tod;
    const night = nightAmount();
    drawSky(todv);
    ctx.drawImage(skyLayer.canvas, 0, 0);
    drawStars(tt, night);
    drawClouds(todv, tt);
    drawMoonSun(todv);
    drawMeteor(night);
    drawBirds(todv, tt);
    scene.drawSky?.(ctx, tt);
    drawHills(todv);

    const w = world.ctx;
    w.globalCompositeOperation = 'source-over';
    w.clearRect(0, 0, env.W, env.H);
    if (!ground) buildGround();
    w.drawImage(ground, 0, env.groundY - 2);
    drawTufts(w, tt, false);
    scene.drawWorld?.(w, tt);
    drawParticles(w);
    drawTufts(w, tt, true);
    const tint = worldTint(todv);
    if (tint.alpha > 0.001) {
      w.globalCompositeOperation = 'source-atop';
      w.fillStyle = rgba(tint.colour, tint.alpha);
      w.fillRect(0, 0, env.W, env.H);
      w.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(world.canvas, 0, 0);

    scene.drawLights?.(ctx, tt, night);
    drawFireflies(tt, night);
    scene.drawTop?.(ctx, tt, night);
  }

  Object.assign(env, {
    ctx,
    makePlot,
    drawPlot,
    drawAgent,
    agentBox,
    plotLights,
    drawLampLight,
    drawTreeAt,
    treeTop,
    treeSize: (block = env.block) => treeSize(block, TREE_EXTRA),
    blocksFor,
    burstLeaves,
    dropLeaf,
    puff,
    drawLeader,
    tnow,
    nightAmount,
  });

  return {
    scene,
    env,
    resize,
    frame(dt) {
      update(dt);
      render();
    },
    render,
    setTod(t) {
      env.tod = t;
    },
    setReduced(v) {
      env.reduced = v;
      if (v) env.particles.length = 0;
      scene.setReduced?.(v);
    },
    setPointer(cssX, cssY) {
      env.pointer = cssX == null ? null : { x: cssX / env.k, y: cssY / env.k };
    },
    /** Overlay anchor in CSS px, or null. */
    pin(key) {
      const p = scene.pin?.(key);
      return p ? [p[0] * env.k, p[1] * env.k, p[2] != null ? p[2] * env.k : undefined, p[3] != null ? p[3] * env.k : undefined] : null;
    },
    /** Clickable characters in CSS px. */
    hits() {
      return (scene.hits?.() ?? []).map((h) => ({ ...h, x: h.x * env.k, y: h.y * env.k, w: h.w * env.k, h: h.h * env.k }));
    },
    get k() {
      return env.k;
    },
  };
}
