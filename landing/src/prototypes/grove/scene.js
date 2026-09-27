// Night Grove scene: world state, camera and drawing. No Svelte in here.
//
// The canvas backing store is the low internal resolution (around 360 x 210
// on a laptop) and the canvas is scaled up by an integer number of device
// pixels, so every art pixel is a crisp square.

import {
  C,
  statusHex,
  looks,
  treePalette,
  oldTreePalette,
  skyBands,
  worldTint,
  hillColours,
  cloudColours,
  mix,
  rgba,
  hexToRgb,
} from './palette.js';
import {
  hash,
  bayer,
  makeCanvas,
  drawTree,
  treeBlocks,
  treeSize,
  agentSprites,
  drawBench,
  drawLamp,
  drawSignPost,
  drawGate,
  drawSundial,
  drawStone,
  moonSprite,
  sunSprite,
  halo,
  ringHalo,
  cloudShape,
  BENCH_W,
} from './sprites.js';
import { STARTING_AGENTS, PLANTED_AGENTS, createAgent, stepAgent, answerAgent } from './agents.js';

export const LAYOUT = {
  oldTree: 40,
  stone: 68,
  // Slots in the order they fill: three starting trees, then new ones to the left.
  slots: [260, 330, 400, 190, 120],
  sundial: 466,
  gate: 534,
};

const TREE_BLOCK = 7;
const TREE_EXTRA = 1;
const OLD_BLOCK = 10;
const TREE = treeSize(TREE_BLOCK, TREE_EXTRA); // 55 x 71
const OLD = treeSize(OLD_BLOCK, TREE_EXTRA);
const TREE_VARIANTS = [
  [-4, 0],
  [8, 0.015],
  [-12, -0.01],
  [14, 0.01],
  [-18, 0.02],
];
const REWIND_SLOT = 2; // fix/login-bug, next to the sundial
const MAX_TURN = 4;

// Offsets from a tree's centre.
const P = { bench: -2, agent: 6, lamp: 25, sign: -18 };

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ reduced?: boolean, onchange?: () => void, onplanted?: (index: number) => void }} options
 */
export function createScene(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  let reduced = !!options.reduced;
  const onchange = options.onchange ?? (() => {});

  // Size and camera.
  let W = 320;
  let H = 200;
  let k = 1; // CSS px per art pixel
  let groundY = 150;
  let reserveCss = 0;
  let insetLeftCss = 0;
  let camX = 200;
  let camReady = false;
  let focusOverride = null; // { range, pri, until }

  // Layers.
  const world = makeCanvas(W, H);
  const skyLayer = makeCanvas(W, H);
  let skyKey = '';
  let ground = null; // cached ground strip
  const GROUND_FROM = -420;
  const GROUND_TO = 1000;
  const treeCache = new Map();
  const moon = moonSprite();
  const sun = sunSprite();

  // Story.
  let chapter = 0;
  let local = 0;
  let tod = 0;
  let todShown = 0;
  const anim = { fence: 0, memory: 0, merge: 0, term: 0, shake: 0 };
  let merged = false;
  let hover = -1;
  let time = 0;

  // Rewind.
  let turn = MAX_TURN;
  let rewindNote = null; // { mode, turn }

  // World contents.
  /** @type {any[]} */
  const plots = [];
  const particles = [];
  let fireflies = [];
  let stars = [];
  let clouds = [];
  let meteor = null;
  let nextMeteor = 4;
  let pointer = null;

  const blocksSmall = treeBlocks(TREE_EXTRA);
  const blocksOld = treeBlocks(TREE_EXTRA);

  const addPlot = (def, slotIndex, seated) => {
    const agent = createAgent(def);
    const plot = {
      slot: slotIndex,
      x: LAYOUT.slots[slotIndex],
      agent,
      pal: treePalette(...TREE_VARIANTS[slotIndex]),
      sprites: agentSprites(looks[def.look]),
      growth: seated ? 1 : 0,
      growthTarget: 1,
      shown: seated ? blocksSmall.length : 0,
      phase: seated ? 'sit' : 'seed',
      seedY: 0,
      seedV: 0,
      bench: seated ? 1 : 0,
      sign: seated ? 1 : 0,
      walkX: 0,
      walkT: 0,
      lampOn: seated ? 1 : 0,
      shake: 0,
    };
    plots.push(plot);
    return plot;
  };

  STARTING_AGENTS.forEach((def, i) => addPlot(def, i, true));

  // -------------------------------------------------------------------------
  // Size

  function resize(cssW, cssH, reserve = reserveCss) {
    reserveCss = reserve;
    const dpr = window.devicePixelRatio || 1;
    const devW = Math.max(1, cssW * dpr);
    const devH = Math.max(1, cssH * dpr);
    const s = Math.max(1, Math.round(Math.min(devH / 216, devW / 168)));
    W = Math.ceil(devW / s);
    H = Math.ceil(devH / s);
    k = s / dpr;
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${W * k}px`;
    canvas.style.height = `${H * k}px`;
    world.canvas.width = W;
    world.canvas.height = H;
    skyLayer.canvas.width = W;
    skyLayer.canvas.height = H;
    ctx.imageSmoothingEnabled = false;
    world.ctx.imageSmoothingEnabled = false;
    const reservePx = Math.ceil(reserveCss / k);
    groundY = clamp(H - reservePx - 10, Math.min(H - 12, 112), H - 12);
    skyKey = '';
    ground = null;
    seedStars();
    seedFireflies();
    seedClouds();
    if (!camReady || reduced) {
      camX = cameraTarget();
      camReady = true;
    }
  }

  function seedStars() {
    const horizon = groundY - 20;
    const count = Math.round((W * horizon) / 650);
    stars = Array.from({ length: count }, (_, i) => {
      const r = hash(i, 91);
      return {
        x: Math.floor(hash(i, 17) * W),
        y: Math.floor(hash(i, 29) ** 1.3 * (horizon - 8)) + 2,
        kind: r > 0.93 ? 2 : r > 0.7 ? 1 : 0,
        phase: hash(i, 5) * Math.PI * 2,
        speed: 0.6 + hash(i, 8) * 1.8,
      };
    });
  }

  function seedClouds() {
    const count = Math.max(3, Math.round(W / 90));
    const band = Math.max(20, groundY - 118);
    clouds = Array.from({ length: count }, (_, i) => {
      const w = 34 + Math.floor(hash(i, 51) * 40);
      const h = 9 + Math.floor(hash(i, 52) * 7);
      return {
        rows: cloudShape(i + 7, w, h),
        w,
        h,
        x: hash(i, 53) * (W + w),
        y: 8 + Math.floor(((i + hash(i, 54)) / count) * band * 0.9),
        speed: 1.2 + hash(i, 55) * 1.6,
        par: 0.05 + hash(i, 56) * 0.08,
      };
    });
  }

  function seedFireflies() {
    const count = clamp(Math.round((W * 60) / 700), 12, 34);
    fireflies = Array.from({ length: count }, (_, i) => ({
      x: camX + hash(i, 3) * W,
      y: groundY - 8 - hash(i, 4) * 70,
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
  // Camera

  function plotsRange() {
    const xs = plots.map((p) => p.x);
    return [Math.min(...xs) - 34, Math.max(...xs) + 34];
  }

  function focusFor(ch) {
    const [a, b] = plotsRange();
    const rewindX = LAYOUT.slots[REWIND_SLOT];
    switch (ch) {
      case 0:
        return { range: [a, b], pri: LAYOUT.slots[1] + 4, inset: insetLeftCss / k };
      case 3:
        return { range: [LAYOUT.oldTree - 46, b], pri: -Infinity };
      case 4:
        return { range: [rewindX - 32, LAYOUT.sundial + 20], pri: LAYOUT.sundial - 10 };
      case 5:
        return { range: [a, LAYOUT.gate + 22], pri: Infinity };
      default:
        return { range: [a, b], pri: LAYOUT.slots[1] + 4 };
    }
  }

  function cameraTarget() {
    const f = focusOverride && focusOverride.until > time ? focusOverride : focusFor(chapter);
    const inset = Math.min(f.inset ?? 0, W * 0.6);
    const avail = W - inset;
    const [a, b] = f.range;
    let centre;
    if (b - a <= avail) centre = (a + b) / 2;
    else centre = clamp(f.pri, a + avail / 2, b - avail / 2);
    return centre - avail / 2 - inset;
  }

  // -------------------------------------------------------------------------
  // Story

  function setStory(ch, loc, t) {
    const changed = ch !== chapter;
    chapter = ch;
    local = loc;
    tod = t;
    if (changed) {
      focusOverride = null;
      if (ch === 1 && !reduced) {
        for (const p of plots) p.shake = 0.5;
        for (const p of plots) burstLeaves(p.x, groundY - 50, 5, 0.6);
      }
      if (ch !== 4 && (turn !== MAX_TURN || rewindNote)) {
        turn = MAX_TURN;
        rewindNote = null;
        updateRewindGrowth();
      }
      if (ch !== 5 && merged) merged = false;
      onchange();
    }
    if (reduced) {
      todShown = tod;
      camX = cameraTarget();
      settleAnim();
    }
  }

  function targets() {
    return {
      fence: chapter >= 1 && chapter <= 4 ? 1 : 0,
      memory: chapter === 3 ? 1 : 0,
      term: chapter === 2 ? 1 : 0,
      merge: chapter === 5 ? clamp((local - 0.04) / 0.5, 0, 1) : 0,
    };
  }

  function settleAnim() {
    const t = targets();
    anim.fence = t.fence;
    anim.memory = t.memory;
    anim.term = t.term;
    anim.merge = t.merge;
    if (chapter === 5 && anim.merge >= 1 && !merged) {
      merged = true;
      onchange();
    }
    for (const p of plots) {
      p.growth = p.growthTarget;
      p.shown = Math.round(p.growth * blocksSmall.length);
    }
  }

  // -------------------------------------------------------------------------
  // Interactions

  function plant() {
    const index = plots.length;
    const def = PLANTED_AGENTS[index - STARTING_AGENTS.length];
    if (!def) return null;
    const plot = addPlot(def, index, reduced);
    plot.seedY = Math.round(cameraY0() - 6);
    plot.agent.bubble = null;
    if (reduced) {
      plot.agent.bubble = { tool: def.script[0][0], detail: def.script[0][1] };
      camX = cameraTarget();
    } else {
      const [a, b] = plotsRange();
      focusOverride = { range: [a, b], pri: plot.x, until: time + 7 };
    }
    onchange();
    return index;
  }

  const cameraY0 = () => Math.max(4, groundY - 150);

  function answer(index, allow) {
    const p = plots[index];
    if (!p || p.agent.status !== 'permission') return;
    answerAgent(p.agent, allow);
    onchange();
  }

  function setTurn(n) {
    turn = clamp(Math.round(n), 1, MAX_TURN);
    rewindNote = null;
    updateRewindGrowth();
    onchange();
  }

  function rewind(mode) {
    if (turn >= MAX_TURN) return;
    rewindNote = { mode, turn };
    updateRewindGrowth();
    onchange();
  }

  function updateRewindGrowth() {
    const p = plots[REWIND_SLOT];
    if (!p) return;
    const keepFiles = rewindNote?.mode === 'conv';
    p.growthTarget = keepFiles ? 1 : growthForTurn(turn);
    if (reduced) {
      p.growth = p.growthTarget;
      p.shown = Math.round(p.growth * blocksSmall.length);
    }
  }

  const growthForTurn = (n) => 0.3 + (0.7 * (n - 1)) / (MAX_TURN - 1);

  function focusPlot(index) {
    const p = plots[index];
    if (!p) return;
    const [a, b] = plotsRange();
    const view = cameraTarget();
    const sx = p.x - view;
    if (sx > 34 && sx < W - 34) return; // already on screen
    focusOverride = { range: [a, b], pri: p.x, until: time + 6 };
    if (reduced) camX = cameraTarget();
  }

  // -------------------------------------------------------------------------
  // Particles

  function burstLeaves(x, y, n, spread = 1) {
    if (reduced) return;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4 * spread;
      const v = 18 + Math.random() * 40 * spread;
      particles.push({
        kind: 'leaf',
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 10,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 2.2 + Math.random() * 1.6,
        colour: [C.leafTop, '#5ab868', '#4aaa58', '#3a9a48'][i % 4],
        phase: Math.random() * 6,
      });
    }
  }

  function dropLeaf(x, y, colour) {
    if (reduced) return;
    particles.push({ kind: 'leaf', x, y, vx: (Math.random() - 0.5) * 8, vy: -4, life: 2.5, colour, phase: Math.random() * 6 });
  }

  function puff(x, y) {
    for (let i = 0; i < 7; i++) {
      particles.push({
        kind: 'dust',
        x: x + (i - 3),
        y,
        vx: (i - 3) * 6,
        vy: -8 - Math.random() * 8,
        life: 0.6 + Math.random() * 0.3,
        colour: C.pathDark,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Update

  function update(dt) {
    time += dt;
    if (reduced) return;

    // Time of day eases after the scroll position.
    todShown += (tod - todShown) * (1 - Math.exp(-dt * 4));

    // Camera.
    const target = cameraTarget();
    camX += (target - camX) * (1 - Math.exp(-dt * 2.4));

    // Chapter animations.
    const t = targets();
    anim.fence += Math.sign(t.fence - anim.fence) * Math.min(Math.abs(t.fence - anim.fence), dt * 1.6);
    anim.memory += (t.memory - anim.memory) * (1 - Math.exp(-dt * 3));
    anim.term += (t.term - anim.term) * (1 - Math.exp(-dt * 4));
    anim.merge += Math.sign(t.merge - anim.merge) * Math.min(Math.abs(t.merge - anim.merge), dt * 0.9);
    if (chapter === 5 && anim.merge >= 0.999 && !merged) {
      merged = true;
      const gate = LAYOUT.gate;
      burstLeaves(gate, groundY - 34, 36, 1.2);
      for (const p of plots) burstLeaves(p.x, groundY - 58, 8, 0.8);
      onchange();
    }

    let changed = false;
    for (const p of plots) {
      // Agents' tool calls.
      if (p.phase === 'sit' && stepAgent(p.agent, dt)) changed = true;
      p.shake = Math.max(0, p.shake - dt);
      updatePlanting(p, dt);
      // Growth toward the target (rewind uses this too).
      if (p.phase === 'sit' || p.phase === 'grow' || p.phase === 'walk') {
        const before = p.shown;
        const speed = p.phase === 'grow' ? 0.5 : 0.9;
        p.growth += Math.sign(p.growthTarget - p.growth) * Math.min(Math.abs(p.growthTarget - p.growth), dt * speed);
        p.shown = Math.floor(p.growth * blocksSmall.length);
        if (p.shown < before) {
          for (let i = p.shown; i < before; i++) {
            const pos = blockPos(p, blocksSmall[i]);
            dropLeaf(pos.x, pos.y, blocksSmall[i].kind === 'leaf' ? p.pal.leaves[blocksSmall[i].tone] : C.wood);
          }
        }
      }
    }
    if (changed) onchange();

    // Idle falling leaves from the trees.
    if (Math.random() < dt * 0.35) {
      const p = plots[Math.floor(Math.random() * plots.length)];
      if (p.growth > 0.8) dropLeaf(p.x + (Math.random() - 0.5) * 44, groundY - 44 - Math.random() * 20, p.pal.leaves[1]);
    }

    // Particles.
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life -= dt;
      if (q.kind === 'leaf') {
        q.vy += 26 * dt;
        q.vx += Math.sin(time * 3 + q.phase) * 20 * dt;
        q.vx *= 1 - 1.2 * dt;
        q.vy = Math.min(q.vy, 16);
      } else {
        q.vy += 30 * dt;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.kind === 'leaf' && q.y > groundY + 2) q.life = Math.min(q.life, 0.3);
      if (q.life <= 0) particles.splice(i, 1);
    }

    updateFireflies(dt);

    // Now and then a shooting star, while it is still night.
    if (meteor) {
      meteor.t += dt;
      if (meteor.t > meteor.life) meteor = null;
    } else if (time > nextMeteor && todShown < 0.3) {
      meteor = { x: W * (0.35 + Math.random() * 0.55), y: 6 + Math.random() * Math.max(10, groundY - 140), t: 0, life: 0.7 };
      nextMeteor = time + 7 + Math.random() * 8;
    }
  }

  function blockPos(p, b) {
    const left = p.x - (TREE.w - 1) / 2;
    const top = groundY - TREE.h + 1;
    return { x: left + b.c * TREE.step + 3, y: top + b.r * TREE.step + 3 };
  }

  function updatePlanting(p, dt) {
    if (p.phase === 'seed') {
      p.seedV += 160 * dt;
      p.seedY += p.seedV * dt;
      if (p.seedY >= groundY - 1) {
        p.seedY = groundY - 1;
        puff(p.x, groundY);
        p.phase = 'grow';
        p.growth = 0;
        onchange();
      }
    } else if (p.phase === 'grow') {
      if (p.growth > 0.55) p.bench = Math.min(1, p.bench + dt * 1.6);
      if (p.growth > 0.3) p.sign = Math.min(1, p.sign + dt * 2.5);
      if (p.growth >= 1) {
        p.phase = 'walk';
        p.bench = 1;
        p.sign = 1;
        p.walkX = Math.round(camX) - 12;
        p.walkT = 0;
        onchange();
      }
    } else if (p.phase === 'walk') {
      p.walkT += dt;
      const target = p.x + P.agent;
      p.walkX = Math.min(target, p.walkX + dt * 42);
      if (p.walkX >= target) {
        p.phase = 'sit';
        p.lampOn = 1;
        const [tool, detail] = p.agent.script[0];
        p.agent.bubble = { tool, detail };
        p.agent.timer = 0;
        options.onplanted?.(plots.indexOf(p));
        onchange();
      }
    }
  }

  function updateFireflies(dt) {
    const cam = camX;
    const top = Math.max(6, groundY - 110);
    for (const f of fireflies) {
      let ax = Math.sin(time * 0.7 + f.p1) * 7 + Math.cos(time * 0.31 + f.p2) * 5;
      let ay = Math.cos(time * 0.53 + f.p3) * 6 + Math.sin(time * 0.23 + f.p1) * 3;
      if (pointer) {
        const px = pointer.x + cam;
        const dx = px - f.x;
        const dy = pointer.y - f.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 90) {
          const pull = (1 - d / 90) * 60;
          ax += (dx / d) * pull - (dy / d) * pull * 0.6;
          ay += (dy / d) * pull + (dx / d) * pull * 0.6;
          if (d < 10) {
            ax -= (dx / d) * 80;
            ay -= (dy / d) * 80;
          }
        }
      }
      f.vx = (f.vx + ax * dt) * (1 - 0.9 * dt);
      f.vy = (f.vy + ay * dt) * (1 - 0.9 * dt);
      const sp = Math.hypot(f.vx, f.vy);
      const max = pointer ? 34 : 12;
      if (sp > max) {
        f.vx *= max / sp;
        f.vy *= max / sp;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < cam - 24) f.x += W + 48;
      if (f.x > cam + W + 24) f.x -= W + 48;
      if (f.y < top) f.vy += 20 * dt;
      if (f.y > groundY + 6) f.vy -= 30 * dt;
    }
  }

  // -------------------------------------------------------------------------
  // Draw

  function render() {
    const cam = Math.round(camX);
    const tt = reduced ? 0 : time;
    const todv = reduced ? tod : todShown;
    const night = 1 - smooth(0.3, 0.85, todv);

    drawSky(todv);
    ctx.drawImage(skyLayer.canvas, 0, 0);
    drawStars(tt, night);
    drawClouds(todv, tt);
    drawMoonSun(todv, tt);
    drawMeteor(night);
    drawBirds(todv, tt);
    drawHills(cam, todv);

    // World layer, lit for the hour.
    const w = world.ctx;
    w.globalCompositeOperation = 'source-over';
    w.clearRect(0, 0, W, H);
    drawGround(w, cam);
    drawTufts(w, cam, tt, 1);
    drawOldTree(w, cam);
    drawFences(w, cam);
    for (const p of plots) drawPlot(w, p, cam, tt);
    drawEmptySlots(w, cam);
    drawSundialAt(w, cam);
    drawGate(w, LAYOUT.gate - cam, groundY + 1);
    drawParticles(w, cam);
    drawTufts(w, cam, tt, 1.25);
    const tint = worldTint(todv);
    if (tint.alpha > 0.001) {
      w.globalCompositeOperation = 'source-atop';
      w.fillStyle = rgba(tint.colour, tint.alpha);
      w.fillRect(0, 0, W, H);
      w.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(world.canvas, 0, 0);

    // Light sources on top.
    drawLights(cam, tt, night);
    drawMemory(cam, tt);
    drawMerge(cam, tt);
    drawFireflies(cam, tt, night);
    drawHover(cam, tt);
  }

  function drawSky(todv) {
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
        const band = i + (frac > bayer(x, y) ? 1 : 0);
        const c = bands[Math.min(n - 1, band)];
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
    const shift = Math.round(camX * 0.02);
    for (const s of stars) {
      const tw = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(tt * s.speed + s.phase);
      const a = night * (s.kind === 0 ? 0.45 : 0.8) * tw;
      if (a < 0.05) continue;
      const x = (((s.x - shift) % W) + W) % W;
      ctx.fillStyle = rgba(s.kind === 0 ? C.primaryPale : C.cream, a);
      ctx.fillRect(x, s.y, 1, 1);
      if (s.kind === 2 && tw > 0.7) {
        ctx.fillStyle = rgba(C.cream, a * 0.45);
        ctx.fillRect(x - 1, s.y, 1, 1);
        ctx.fillRect(x + 1, s.y, 1, 1);
        ctx.fillRect(x, s.y - 1, 1, 1);
        ctx.fillRect(x, s.y + 1, 1, 1);
      }
    }
  }

  function drawMoonSun(todv, tt) {
    const skyTop = 0;
    const horizon = groundY - 20;
    // Moon: high at night, sinking to the left toward day.
    const moonA = 1 - smooth(0.45, 0.8, todv);
    if (moonA > 0.01) {
      // On narrow screens the title fills the sky, so the moon tucks into the corner.
      const narrow = W < 220;
      const mx = Math.round(narrow ? W - 24 - todv * 40 : W * (0.8 - 0.25 * todv));
      const my = Math.round((narrow ? 16 : Math.max(skyTop + 14, groundY - 124)) + todv * 70);
      ctx.globalAlpha = moonA;
      ctx.drawImage(ringHalo(C.primaryPale, 19, [0.1, 0.06, 0.03]), mx - 19, my - 19);
      ctx.drawImage(moon, mx - 7, my - 7);
      ctx.globalAlpha = 1;
    }
    // Sun: rises on the right from dawn.
    const rise = smooth(0.38, 1, todv);
    if (rise > 0.001) {
      const sx = Math.round(W * 0.7);
      const sy = Math.round(horizon + 14 - rise * Math.min(90, horizon - 20));
      ctx.drawImage(ringHalo(C.amberLight, 26, [0.28, 0.15, 0.07]), sx - 26, sy - 26);
      ctx.drawImage(sun, sx - 7, sy - 7);
    }
    void tt;
  }

  let cloudKey = '';
  let cloudPal = null;
  function drawClouds(todv, tt) {
    const bucket = Math.round(todv * 100) / 100;
    if (cloudKey !== String(bucket)) {
      cloudKey = String(bucket);
      cloudPal = cloudColours(bucket);
    }
    const alpha = 0.45 + 0.55 * smooth(0.2, 0.6, todv);
    ctx.globalAlpha = alpha;
    for (const c of clouds) {
      const span = W + c.w + 20;
      const drift = reduced ? 0 : tt * c.speed;
      const x0 = Math.round(((((c.x - camX * c.par + drift) % span) + span) % span) - c.w - 10);
      c.rows.forEach((run, y) => {
        if (!run) return;
        const [a, b] = run;
        const shade = y >= c.h - 3;
        ctx.fillStyle = shade ? cloudPal.shade : cloudPal.body;
        ctx.fillRect(x0 + a, c.y + y, b - a, 1);
        // Lit top edge.
        const above = c.rows[y - 1];
        if (!above) {
          ctx.fillStyle = cloudPal.top;
          ctx.fillRect(x0 + a, c.y + y, b - a, 1);
        } else {
          ctx.fillStyle = cloudPal.top;
          if (a < above[0]) ctx.fillRect(x0 + a, c.y + y, above[0] - a, 1);
          if (b > above[1]) ctx.fillRect(x0 + above[1], c.y + y, b - above[1], 1);
        }
      });
    }
    ctx.globalAlpha = 1;
  }

  function drawMeteor(night) {
    if (!meteor || reduced || night < 0.5) return;
    const p = meteor.t / meteor.life;
    const hx = Math.round(meteor.x - p * 60);
    const hy = Math.round(meteor.y + p * 26);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = rgba(C.cream, (1 - i / 9) * (1 - p) * night);
      ctx.fillRect(hx + Math.round(i * 2.3), hy - Math.round(i * 1), 1, 1);
    }
  }

  function drawBirds(todv, tt) {
    const a = smooth(0.6, 0.8, todv);
    if (a <= 0.01) return;
    ctx.fillStyle = rgba('#1e2433', a * 0.85);
    for (let i = 0; i < 3; i++) {
      const x = Math.round((((reduced ? 40 + i * 60 : tt * 11) + i * 23 + 60) % (W + 60)) - 30);
      const y = Math.round(Math.max(18, groundY - 110) + i * 7 + Math.sin(tt * 0.8 + i) * 2);
      const up = Math.floor(tt * 4 + i) % 2 === 0;
      if (up) {
        ctx.fillRect(x - 2, y - 1, 1, 1);
        ctx.fillRect(x - 1, y, 1, 1);
        ctx.fillRect(x, y + 1, 1, 1);
        ctx.fillRect(x + 1, y, 1, 1);
        ctx.fillRect(x + 2, y - 1, 1, 1);
      } else {
        ctx.fillRect(x - 2, y + 1, 2, 1);
        ctx.fillRect(x, y + 1, 1, 1);
        ctx.fillRect(x + 1, y + 1, 2, 1);
        ctx.fillRect(x, y + 2, 1, 1);
      }
    }
  }

  const farTop = (x) =>
    groundY - 28 - Math.round(9 * Math.sin(x * 0.011 + 1) + 6 * Math.sin(x * 0.027 + 2.2) + 3 * Math.sin(x * 0.063 + 0.4));
  const nearTop = (x) =>
    groundY - 12 - Math.round(6 * Math.sin(x * 0.017 + 0.3) + 4 * Math.sin(x * 0.041 + 1.7) + 2 * Math.sin(x * 0.09));

  let hillKey = '';
  let hillPal = null;
  function drawHills(cam, todv) {
    const bucket = Math.round(todv * 100) / 100;
    if (hillKey !== String(bucket)) {
      hillKey = String(bucket);
      const h = hillColours(bucket);
      const bands = skyBands(bucket);
      hillPal = {
        far: h.far,
        farRim: mix(h.far, bands[6], 0.45),
        near: h.near,
        nearRim: mix(h.near, bands[7], 0.35),
        trees: [1, 2].map((blk) => {
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
          const size = treeSize(blk, 0);
          const made = makeCanvas(size.w, size.h);
          drawTree(made.ctx, (size.w - 1) / 2, size.h - 1, pal, { block: blk, extraTrunk: 0 });
          return made.canvas;
        }),
      };
    }
    const pf = Math.round(cam * 0.18);
    const pn = Math.round(cam * 0.42);
    for (let x = 0; x < W; x++) {
      const ft = farTop(x + pf);
      ctx.fillStyle = hillPal.farRim;
      ctx.fillRect(x, ft, 1, 1);
      ctx.fillStyle = hillPal.far;
      ctx.fillRect(x, ft + 1, 1, groundY - ft);
    }
    // Small far trees along the near hills.
    for (let i = Math.floor((pn - 30) / 26); i <= Math.ceil((pn + W + 30) / 26); i++) {
      if (hash(i, 41) < 0.35) continue;
      const u = i * 26 + Math.floor(hash(i, 43) * 12);
      const big = hash(i, 47) > 0.55;
      const img = hillPal.trees[big ? 1 : 0];
      const sx = u - pn - Math.floor(img.width / 2);
      ctx.drawImage(img, sx, nearTop(u) - img.height + 3);
    }
    for (let x = 0; x < W; x++) {
      const nt = nearTop(x + pn);
      ctx.fillStyle = hillPal.nearRim;
      ctx.fillRect(x, nt, 1, 1);
      ctx.fillStyle = hillPal.near;
      ctx.fillRect(x, nt + 1, 1, groundY - nt + 2);
    }
  }

  function buildGround() {
    const width = GROUND_TO - GROUND_FROM;
    const depth = H - groundY + 3;
    const g = makeCanvas(width, depth);
    const c = g.ctx;
    const oy = 2; // strip row 0 is groundY - 2
    // Bands: grass, path, meadow.
    c.fillStyle = C.grassTop;
    c.fillRect(0, oy, width, 1);
    c.fillStyle = C.grass;
    c.fillRect(0, oy + 1, width, 2);
    c.fillStyle = C.pathEdge;
    c.fillRect(0, oy + 3, width, 1);
    c.fillStyle = C.path;
    c.fillRect(0, oy + 4, width, 3);
    c.fillStyle = C.pathDark;
    c.fillRect(0, oy + 7, width, 1);
    const meadowTop = oy + 8;
    const meadowRows = depth - meadowTop;
    const mcols = [C.grassDark, C.meadow, mix(C.meadow, C.meadowDeep, 0.5), C.meadowDeep].map(hexToRgb);
    const img = c.getImageData(0, 0, width, depth);
    const d = img.data;
    for (let y = meadowTop; y < depth; y++) {
      const f = Math.min(1, (y - meadowTop) / Math.max(1, Math.min(meadowRows, 60))) * (mcols.length - 1);
      const i = Math.floor(f);
      for (let x = 0; x < width; x++) {
        const band = Math.min(mcols.length - 1, i + (f - i > bayer(x, y) ? 1 : 0));
        const col = mcols[band];
        const o = (y * width + x) * 4;
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
        d[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    // Details per column.
    for (let x = 0; x < width; x++) {
      const wx = x + GROUND_FROM;
      const r = hash(wx, 11);
      if (r < 0.45) {
        c.fillStyle = C.grassTop;
        c.fillRect(x, oy - 1, 1, 1);
        if (r < 0.12) c.fillRect(x, oy - 2, 1, 1);
      }
      if (hash(wx, 13) < 0.08) {
        c.fillStyle = C.pathDark;
        c.fillRect(x, oy + 4 + Math.floor(hash(wx, 14) * 3), 1, 1);
      }
      if (hash(wx, 15) < 0.05) {
        c.fillStyle = C.cream;
        c.fillRect(x, oy + 5, 1, 1);
      }
      // Meadow blades and a few flowers.
      for (let j = 0; j < 2; j++) {
        if (hash(wx, 20 + j) < 0.22) {
          const y = meadowTop + 1 + Math.floor(hash(wx, 30 + j) * Math.max(1, meadowRows - 3));
          const shade = (y - meadowTop) / Math.max(1, meadowRows);
          c.fillStyle = shade < 0.35 ? C.grass : shade < 0.7 ? C.grassDark : C.meadow;
          c.fillRect(x, y, 1, 2);
        }
      }
      if (hash(wx, 25) < 0.018) {
        const y = meadowTop + 2 + Math.floor(hash(wx, 26) * Math.max(1, Math.min(meadowRows, 30) - 4));
        c.fillStyle = hash(wx, 27) < 0.5 ? C.cream : C.amberLight;
        c.fillRect(x, y, 1, 1);
        c.fillStyle = C.grass;
        c.fillRect(x, y + 1, 1, 1);
      }
    }
    ground = g.canvas;
  }

  function drawGround(w, cam) {
    if (!ground) buildGround();
    w.drawImage(ground, GROUND_FROM - cam, groundY - 2);
  }

  function drawTufts(w, cam, tt, parallax) {
    const fg = parallax > 1;
    const off = Math.round(cam * parallax);
    const spacing = fg ? 19 : 11;
    const y0 = fg ? H - 3 : groundY + 1;
    for (let i = Math.floor((off - 10) / spacing); i <= Math.ceil((off + W + 10) / spacing); i++) {
      if (hash(i, fg ? 61 : 63) < (fg ? 0.35 : 0.45)) continue;
      const x = i * spacing + Math.floor(hash(i, 65) * (spacing - 4)) - off;
      const hgt = fg ? 4 + Math.floor(hash(i, 67) * 4) : 2 + Math.floor(hash(i, 67) * 2);
      const sway = reduced ? 0 : Math.round(Math.sin(tt * 1.3 + i * 0.7) * (fg ? 1.2 : 0.8));
      w.fillStyle = fg ? C.meadowDeep : C.grassDark;
      w.fillRect(x, y0 - hgt + 2, 1, hgt);
      w.fillRect(x + 2, y0 - hgt + 3, 1, hgt - 1);
      w.fillStyle = fg ? C.grassDark : C.grassTop;
      w.fillRect(x + sway, y0 - hgt, 1, 2);
      w.fillRect(x + 2 + sway, y0 - hgt + 1, 1, 2);
      w.fillRect(x - 1 + sway, y0 - hgt + 2, 1, 2);
      if (fg && hash(i, 69) < 0.3) {
        w.fillStyle = hash(i, 71) < 0.5 ? C.amberLight : C.cream;
        w.fillRect(x + 1 + sway, y0 - hgt - 1, 1, 1);
      }
    }
  }

  function cachedTree(pal, block, extra, key) {
    let c = treeCache.get(key);
    if (c) return c;
    const size = treeSize(block, extra);
    const made = makeCanvas(size.w, size.h);
    drawTree(made.ctx, (size.w - 1) / 2, size.h - 1, pal, { block, extraTrunk: extra });
    treeCache.set(key, made.canvas);
    return made.canvas;
  }

  function drawOldTree(w, cam) {
    const x = LAYOUT.oldTree - cam;
    if (x < -OLD.w || x > W + OLD.w) return;
    const img = cachedTree(oldTreePalette, OLD_BLOCK, TREE_EXTRA, 'old');
    w.drawImage(img, Math.round(x - (OLD.w - 1) / 2), groundY - OLD.h + 1);
    drawStone(w, LAYOUT.stone - cam, groundY);
  }

  function drawFences(w, cam) {
    const h = Math.round(anim.fence * 7);
    if (h <= 0) return;
    const occupied = new Set(plots.map((p) => p.x));
    const sorted = [...LAYOUT.slots].sort((a, b) => a - b);
    const marks = new Set();
    sorted.forEach((x, i) => {
      if (!occupied.has(x)) return;
      marks.add(i === 0 ? x - 35 : (sorted[i - 1] + x) / 2);
      marks.add(i === sorted.length - 1 ? x + 35 : (sorted[i + 1] + x) / 2);
    });
    for (const m of marks) {
      const cx = Math.round(m - cam);
      if (cx < -10 || cx > W + 10) continue;
      const base = groundY + 1;
      for (let px = -5; px <= 5; px += 3) {
        w.fillStyle = C.cream;
        w.fillRect(cx + px, base - h + 1, 1, h);
        w.fillStyle = C.woodPale;
        w.fillRect(cx + px, base - h + 1, 1, 1);
      }
      if (h > 3) {
        w.fillStyle = C.woodPale;
        w.fillRect(cx - 6, base - h + 3, 13, 1);
        if (h > 5) w.fillRect(cx - 6, base - 2, 13, 1);
      }
    }
  }

  function drawPlot(w, p, cam, tt) {
    const x = p.x - cam;
    if (x < -60 || x > W + 60) return;
    // Tree.
    const shakeX = p.shake > 0 ? Math.round(Math.sin(p.shake * 40)) : 0;
    if (p.phase === 'seed') {
      // Seed falling.
      w.fillStyle = C.woodPale;
      w.fillRect(x, Math.round(p.seedY) - 1, 2, 2);
      w.fillStyle = C.woodDark;
      w.fillRect(x + 1, Math.round(p.seedY), 1, 1);
      return;
    }
    if (p.growth >= 0.999 && p.shown >= blocksSmall.length) {
      const img = cachedTree(p.pal, TREE_BLOCK, TREE_EXTRA, 'slot' + p.slot);
      w.drawImage(img, Math.round(x - (TREE.w - 1) / 2) + shakeX, groundY - TREE.h + 1);
    } else {
      drawTree(w, x + shakeX, groundY, p.pal, {
        block: TREE_BLOCK,
        extraTrunk: TREE_EXTRA,
        growth: p.phase === 'grow' ? p.growth : Math.max(p.growth, 0.05),
        blocks: blocksSmall,
      });
    }
    // Sign post.
    if (p.sign > 0) drawSignPost(w, x + P.sign, groundY, Math.round(13 * p.sign));
    // Bench builds plank by plank.
    if (p.bench > 0) {
      w.save();
      w.beginPath();
      const hgt = Math.ceil(13 * p.bench);
      w.rect(x + P.bench - 2, groundY - hgt + 1, BENCH_W + 4, hgt);
      w.clip();
      drawBench(w, x + P.bench, groundY);
      w.restore();
    }
    // Agent.
    if (p.phase === 'sit') {
      w.drawImage(p.sprites.sit, x + P.agent, groundY - 16);
    } else if (p.phase === 'walk') {
      const frame = Math.floor(p.walkT * 6) % 2;
      w.drawImage(frame ? p.sprites.walkB : p.sprites.walkA, Math.round(p.walkX - cam), groundY - 14 - frame);
    }
    // Lamp.
    if (p.bench >= 1) p.lamp = drawLamp(w, x + P.lamp, groundY);
    void tt;
  }

  function drawEmptySlots(w, cam) {
    const occupied = new Set(plots.map((p) => p.slot));
    LAYOUT.slots.forEach((sx, i) => {
      if (occupied.has(i)) return;
      const x = sx - cam;
      if (x < -20 || x > W + 20) return;
      // A patch of turned soil waiting for a seed.
      w.fillStyle = C.woodDark;
      w.fillRect(x - 6, groundY, 13, 2);
      w.fillRect(x - 4, groundY - 1, 9, 1);
      w.fillStyle = C.woodDeep;
      w.fillRect(x - 3, groundY + 1, 7, 1);
      w.fillStyle = C.wood;
      w.fillRect(x - 2, groundY - 1, 1, 1);
      w.fillRect(x + 2, groundY, 1, 1);
    });
  }

  function sundialAngle(n) {
    // Turn 1 points left, turn 4 points right, sweeping over the back.
    const t = (n - 1) / (MAX_TURN - 1);
    return Math.PI + t * Math.PI;
  }

  function drawSundialAt(w, cam) {
    const x = LAYOUT.sundial - cam;
    if (x < -20 || x > W + 20) return;
    const ticks = [];
    for (let i = 1; i <= MAX_TURN; i++) ticks.push({ angle: sundialAngle(i), active: i <= turn });
    drawSundial(w, x, groundY + 1, sundialAngle(turn), ticks);
  }

  function drawParticles(w, cam) {
    for (const q of particles) {
      const a = Math.min(1, q.life * 2);
      w.globalAlpha = a;
      w.fillStyle = q.colour;
      const x = Math.round(q.x - cam);
      const y = Math.round(q.y);
      if (q.kind === 'leaf') {
        const flip = Math.floor(time * 5 + q.phase) % 2;
        w.fillRect(x, y, flip ? 2 : 1, flip ? 1 : 2);
      } else {
        w.fillRect(x, y, 1, 1);
      }
    }
    w.globalAlpha = 1;
  }

  function displayStatus(p) {
    if (merged) return 'ready';
    return p.agent.status;
  }

  function drawLights(cam, tt, night) {
    const glow = 0.35 + 0.65 * night;
    for (const p of plots) {
      const x = p.x - cam;
      if (x < -40 || x > W + 40) continue;
      const status = displayStatus(p);
      const colour = statusHex[status] ?? C.primary;
      // Laptop light on the face and around the lid.
      if (p.phase === 'sit') {
        const working = status === 'working';
        const flicker = reduced ? 0.85 : 0.72 + 0.18 * Math.sin(tt * 13 + p.slot) + 0.1 * Math.sin(tt * 31 + p.slot * 2);
        const lit = (working ? flicker : 0.45) * (1 + anim.term * 0.4);
        const ax = x + P.agent;
        const ay = groundY - 16;
        // The agent, relit by its own screen so it reads against the night.
        ctx.globalAlpha = (0.35 + 0.25 * lit) * night + 0.05;
        ctx.drawImage(p.sprites.sit, ax, ay);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, lit * glow);
        ctx.drawImage(halo(C.primaryLight, 10 + Math.round(anim.term * 4), 0.8), ax + 4 - 10 - Math.round(anim.term * 4), ay + 7 - 10 - Math.round(anim.term * 4));
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = Math.min(1, lit * (0.35 + 0.4 * night));
        ctx.fillStyle = C.screen;
        ctx.fillRect(ax + 2, ay + 4, 5, 2);
        ctx.fillRect(ax + 1, ay + 7, 7, 1);
        ctx.globalAlpha = Math.min(1, lit);
        ctx.fillStyle = C.primaryPale;
        ctx.fillRect(ax + 4, ay + 9, 1, 1);
        ctx.globalAlpha = 1;
      }
      // Status lamp.
      if (p.lamp && p.bench >= 1) {
        const period = status === 'permission' ? 1.0 : 1.5;
        const pulse =
          status === 'ready' || reduced || p.phase !== 'sit' ? 1 : 0.5 + 0.5 * Math.sin((tt * Math.PI * 2) / period);
        const on = p.phase === 'sit' ? 1 : 0.15;
        const { gx, gy, gw, gh, cx, cy } = p.lamp;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (0.35 + 0.65 * pulse) * glow * on;
        ctx.drawImage(halo(colour, 12, 0.9), cx - 12, cy - 12);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = on;
        ctx.fillStyle = mix(colour, '#000000', 0.35 * (1 - pulse));
        ctx.fillRect(gx, gy, gw, gh);
        ctx.fillStyle = mix(colour, '#ffffff', 0.55 * pulse);
        ctx.fillRect(gx + 1, gy + 1, 2, 1);
        ctx.globalAlpha = 1;
      }
    }
  }

  function quad(x0, y0, x1, y1, cx, cy, t) {
    const u = 1 - t;
    return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
  }

  function drawMemory(cam, tt) {
    const m = anim.memory;
    // The rune always glows a little.
    const sx = LAYOUT.stone - cam;
    if (sx > -40 && sx < W + 40) {
      const rune = drawStoneRunePositions(sx);
      const pulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(tt * 2.2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.15 + 0.85 * m) * pulse;
      ctx.drawImage(halo(C.primaryLight, 16, 0.9), sx - 16 + 1, groundY - 5 - 16);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.35 + 0.65 * Math.max(m, 0.2);
      ctx.fillStyle = mix(C.primaryLight, '#ffffff', 0.3 * m);
      for (const [rx, ry] of rune) ctx.fillRect(rx, ry, 1, 1);
      ctx.globalAlpha = 1;
    }
    if (m < 0.02) return;
    // Glowing leaves in the old tree.
    const ox = LAYOUT.oldTree - cam;
    const left = Math.round(ox - (OLD.w - 1) / 2);
    const top = groundY - OLD.h + 1;
    ctx.globalCompositeOperation = 'lighter';
    blocksOld.forEach((b, i) => {
      if (b.kind !== 'leaf' || hash(i, 77) < 0.55) return;
      const pulse = reduced ? 0.6 : 0.5 + 0.5 * Math.sin(tt * 1.7 + i);
      ctx.globalAlpha = m * pulse * 0.28;
      ctx.fillStyle = C.primaryLight;
      ctx.fillRect(left + b.c * OLD.step + 2, top + b.r * OLD.step + 2, OLD_BLOCK - 4, OLD_BLOCK - 4);
    });
    ctx.globalCompositeOperation = 'source-over';
    // Threads of light from the stone to every bench.
    const x0 = sx + 1;
    const y0 = groundY - 8;
    for (const p of plots) {
      if (p.phase !== 'sit') continue;
      const x1 = p.x - cam + P.agent + 4;
      const y1 = groundY - 17;
      const cx = (x0 + x1) / 2;
      const cy = Math.min(y0, y1) - 26 - Math.abs(x1 - x0) * 0.12;
      const len = Math.abs(x1 - x0) + 40;
      const steps = Math.ceil(len / 1.2);
      const reveal = reduced ? 1 : clamp(m * 1.4 - 0.1, 0, 1);
      ctx.fillStyle = C.primaryLight;
      for (let i = 0; i <= steps * reveal; i++) {
        const [px, py] = quad(x0, y0, x1, y1, cx, cy, i / steps);
        const rx = Math.round(px);
        if (rx < -2 || rx > W + 2) continue;
        ctx.globalAlpha = m * (0.3 + 0.2 * ((i + Math.floor(tt * 12)) % 6 === 0 ? 1 : 0));
        ctx.fillRect(rx, Math.round(py), 1, 1);
      }
      // Pulses travelling to the bench.
      if (!reduced) {
        ctx.globalCompositeOperation = 'lighter';
        for (let j = 0; j < 3; j++) {
          const t = (tt * 0.28 + j / 3 + p.slot * 0.17) % 1;
          if (t > reveal) continue;
          const [px, py] = quad(x0, y0, x1, y1, cx, cy, t);
          ctx.globalAlpha = m * 0.9;
          ctx.drawImage(halo(C.primaryPale, 3, 1), Math.round(px) - 3, Math.round(py) - 3);
          ctx.fillStyle = C.primaryPale;
          ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawStoneRunePositions(sx) {
    // Same geometry as drawStone, without drawing.
    const left = sx - 8;
    const top = groundY - 8;
    return [
      [1, 0], [2, 0], [3, 0], [2, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [2, 3], [1, 4], [3, 4],
    ].map(([dx, dy]) => [left + 6 + dx, top + 2 + dy]);
  }

  function drawMerge(cam, tt) {
    const r = anim.merge;
    if (r <= 0.001) return;
    const gateX = LAYOUT.gate - cam;
    const pathY = groundY + 5;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of plots) {
      if (p.phase !== 'sit') continue;
      const sx = p.x - cam + P.agent + 4;
      const drop = pathY - (groundY - 1);
      const run = gateX - sx;
      const total = drop + run;
      const shown = total * r;
      ctx.fillStyle = C.primaryLight;
      ctx.globalAlpha = 0.7;
      // Down from the bench.
      const d = Math.min(drop, shown);
      ctx.fillRect(sx, groundY - 1, 1, Math.round(d));
      // Along the main path.
      if (shown > drop) {
        const len = Math.round(shown - drop);
        const x0 = Math.max(sx, -2);
        const x1 = Math.min(sx + len, W + 2);
        if (x1 > x0) ctx.fillRect(x0, pathY, x1 - x0, 1);
      }
      // Travelling sparks.
      if (!reduced) {
        for (let j = 0; j < 4; j++) {
          const pos = ((tt * 38 + j * (total / 4)) % Math.max(1, shown));
          let px;
          let py;
          if (pos < drop) {
            px = sx;
            py = groundY - 1 + pos;
          } else {
            px = sx + (pos - drop);
            py = pathY;
          }
          px = Math.round(px);
          if (px < -3 || px > W + 3) continue;
          ctx.globalAlpha = 0.9;
          ctx.drawImage(halo(C.primaryPale, 3, 1), px - 3, Math.round(py) - 3);
        }
      }
    }
    // The gate lights up once the branches arrive.
    if (merged) {
      ctx.globalAlpha = reduced ? 0.8 : 0.6 + 0.3 * Math.sin(tt * 2);
      ctx.drawImage(halo(C.green, 22, 0.8), Math.round(gateX) - 22, groundY - 22 - 16);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFireflies(cam, tt, night) {
    const vis = smooth(0.1, 0.9, night);
    if (vis <= 0.02) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fireflies) {
      const b = reduced ? 0.8 : 0.5 + 0.5 * Math.sin(tt * f.speed + f.phase);
      if (b < 0.18) continue;
      const x = Math.round(f.x - cam);
      const y = Math.round(f.y);
      if (x < -4 || x > W + 4) continue;
      ctx.globalAlpha = b * vis * 0.8;
      ctx.drawImage(halo(C.firefly, 4, 1), x - 4, y - 4);
      ctx.globalAlpha = b * vis;
      ctx.fillStyle = C.firefly;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHover(cam, tt) {
    const p = plots[hover];
    if (!p) return;
    const x = p.x - cam;
    const bob = reduced ? 0 : Math.round(Math.sin(tt * 5)) ;
    const l = Math.round(x - 31) - bob;
    const r = Math.round(x + 31) + bob;
    const t = groundY - 74 - bob;
    const b = groundY + 3 + bob;
    ctx.fillStyle = C.cream;
    const L = 4;
    for (const [cx, cy, dx, dy] of [
      [l, t, 1, 1],
      [r, t, -1, 1],
      [l, b, 1, -1],
      [r, b, -1, -1],
    ]) {
      ctx.fillRect(dx > 0 ? cx : cx - L + 1, cy, L, 1);
      ctx.fillRect(cx, dy > 0 ? cy : cy - L + 1, 1, L);
    }
  }

  // -------------------------------------------------------------------------
  // Overlay layout (CSS px relative to the stage)

  function layout() {
    const cam = Math.round(camX);
    const X = (wx) => (wx - cam) * k;
    const Y = (wy) => wy * k;
    return {
      k,
      width: W * k,
      plots: plots.map((p) => ({
        sign: [X(p.x + P.sign + 1), Y(groundY - 8)],
        bubble: [X(p.x + P.agent + 4.5), Y(groundY - 18)],
        hit: [X(p.x - 31), Y(groundY - 73), 62 * k, 76 * k],
        visible: p.x - cam > -60 && p.x - cam < W + 60,
        signVisible: p.sign >= 1,
      })),
      gate: [X(LAYOUT.gate + 0.5), Y(groundY - 25)],
      sundial: [X(LAYOUT.sundial + 0.5), Y(groundY - 25)],
      oldTree: [X(LAYOUT.oldTree), Y(groundY - OLD.h)],
      // Notes pinned around the old tree's crown.
      tags: [
        [X(LAYOUT.oldTree - 16), Y(groundY - OLD.h + 22)],
        [X(LAYOUT.oldTree + 26), Y(groundY - OLD.h + 38)],
        [X(LAYOUT.oldTree - 22), Y(groundY - OLD.h + 56)],
        [X(LAYOUT.oldTree + 22), Y(groundY - OLD.h + 70)],
      ],
    };
  }

  function snapshot() {
    return plots.map((p, i) => {
      const a = p.agent;
      let bubble = a.bubble;
      let status = displayStatus(p);
      if (p.phase !== 'sit') bubble = null;
      if (merged && p.phase === 'sit') bubble = { tool: 'merge', detail: 'main' };
      if (i === REWIND_SLOT && chapter === 4 && a.history) {
        const h = a.history[turn - 1];
        if (rewindNote) bubble = { tool: rewindNote.mode === 'all' ? 'rewind' : 'conv', detail: `turn ${rewindNote.turn}` };
        else if (turn < MAX_TURN) bubble = { tool: h.step[0], detail: h.step[1], turn };
      }
      return {
        index: i,
        id: a.id,
        branch: a.branch,
        model: a.model,
        task: a.task,
        ask: a.ask,
        term: a.term,
        answered: a.answered,
        status,
        realStatus: a.status,
        bubble,
        seated: p.phase === 'sit',
        phase: p.phase,
        rewindTarget: i === REWIND_SLOT,
      };
    });
  }

  return {
    resize,
    frame(dt) {
      update(dt);
      render();
    },
    render,
    setStory,
    setReduced(v) {
      reduced = v;
      if (v) {
        todShown = tod;
        camX = cameraTarget();
        settleAnim();
        for (const p of plots) {
          if (p.phase !== 'sit') {
            p.phase = 'sit';
            p.growth = 1;
            p.shown = blocksSmall.length;
            p.bench = 1;
            p.sign = 1;
            p.lampOn = 1;
            if (!p.agent.bubble && p.agent.script[0]) p.agent.bubble = { tool: p.agent.script[0][0], detail: p.agent.script[0][1] };
          }
        }
        particles.length = 0;
        onchange();
      }
    },
    setPointer(cssX, cssY) {
      pointer = cssX == null ? null : { x: cssX / k, y: cssY / k };
    },
    setInsetLeft(css) {
      insetLeftCss = css;
    },
    setHover(i) {
      hover = i;
    },
    plant,
    answer,
    setTurn,
    rewind,
    focusPlot,
    layout,
    snapshot,
    get turn() {
      return turn;
    },
    get maxTurn() {
      return MAX_TURN;
    },
    get count() {
      return plots.length;
    },
    get rewindNote() {
      return rewindNote;
    },
  };
}
