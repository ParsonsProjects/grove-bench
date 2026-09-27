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
  runePixels,
  moonSprite,
  sunSprite,
  halo,
  ringHalo,
  cloudShape,
  BENCH_W,
} from './sprites.js';
import { STARTING_AGENTS, PLANTED_AGENTS, createAgent, stepAgent, answerAgent, activityFor } from './agents.js';

// The world reads left to right in chapter order, so scrolling only ever
// walks the camera one way: the grove of benches (Welcome, Worktrees,
// Terminals), the old tree (Project memory), the sundial (Checkpoints) and
// the gate to main (Review and ship).
export const LAYOUT = {
  // Slots in the order they fill: three starting trees, then new ones to the
  // left, behind you rather than on the road ahead.
  slots: [120, 190, 260, 50, -20],
  oldTree: 412,
  stone: 384, // left of the old tree, facing the benches its threads run to
  sundial: 494,
  gate: 572,
};

// Bushes and flowers along the road between the stops.
const DECOR = [
  { x: 312, kind: 'bush' },
  { x: 334, kind: 'flowers' },
  { x: 354, kind: 'small' },
  { x: 462, kind: 'flowers' },
  { x: 532, kind: 'small' },
  { x: 544, kind: 'flowers' },
  { x: 614, kind: 'bush' },
  { x: 642, kind: 'flowers' },
];

// Share of each chapter the camera holds still before it moves on.
const HOLD = 0.6;

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
  // A short look at one tree (a planted one, or an agent you tabbed to),
  // blended over the scroll position and released smoothly.
  let override = null; // { pri, until }
  let overrideW = 0;

  // Layers.
  const world = makeCanvas(W, H);
  const skyLayer = makeCanvas(W, H);
  let skyKey = '';
  let ground = null; // cached ground strip
  const GROUND_FROM = -700;
  const GROUND_TO = 1400;
  const treeCache = new Map();
  const moon = moonSprite();
  const sun = sunSprite();

  // Story.
  let chapter = 0;
  let local = 0;
  let tod = 0;
  let todShown = 0;
  const anim = { fence: 0, memory: 0, merge: 0, term: 0, callout: 0 };
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

  /** Camera left edge that fits `range`, or centres `pri` when it cannot. */
  function fitCam(range, pri, inset = 0) {
    inset = Math.min(inset, W * 0.6);
    const avail = W - inset;
    const [a, b] = range;
    const centre = b - a <= avail ? (a + b) / 2 : clamp(pri, a + avail / 2, b - avail / 2);
    return centre - avail / 2 - inset;
  }

  /** Where the camera rests for a chapter, before the one-way rule. */
  function anchorFor(ch) {
    const grove = plotsRange();
    const middle = LAYOUT.slots[1] + 4;
    switch (ch) {
      case 0:
        // Keep every tree clear of the title: if they do not all fit, crop on the right.
        return fitCam(grove, insetLeftCss > 0 ? -Infinity : middle, insetLeftCss / k);
      case 1:
      case 2:
        return fitCam(grove, middle);
      case 3:
        // The old tree in the middle, its threads running back to the benches.
        return LAYOUT.oldTree - W * 0.5;
      case 4: {
        const range = [LAYOUT.slots[REWIND_SLOT] - 32, LAYOUT.sundial + 20];
        // Narrow screens: sundial on the left, gate ahead, the old tree just behind you.
        return range[1] - range[0] <= W ? fitCam(range, LAYOUT.sundial) : LAYOUT.sundial - W * 0.25;
      }
      default:
        // The gate on the right, the light arriving along the path from the left.
        return LAYOUT.gate - W * 0.7;
    }
  }

  /** One anchor per chapter, never decreasing, so the camera only moves right. */
  function anchors() {
    const out = [];
    for (let ch = 0; ch < 6; ch++) out.push(ch ? Math.max(anchorFor(ch), out[ch - 1]) : anchorFor(0));
    return out;
  }

  /**
   * The camera as a pure function of scroll: hold at a chapter's anchor for
   * the first part of the chapter, then ease to the next one. Scrolling up
   * retraces the same path.
   */
  function scrollCam() {
    const a = anchors();
    if (chapter >= 5 || local <= HOLD) return a[Math.min(chapter, 5)];
    const u = smooth(HOLD, 1, local);
    return a[chapter] + (a[chapter + 1] - a[chapter]) * u;
  }

  function cameraTarget() {
    const base = scrollCam();
    if (!override || overrideW <= 0) return base;
    return base + (fitCam(plotsRange(), override.pri) - base) * overrideW;
  }

  // -------------------------------------------------------------------------
  // Story

  function setStory(ch, loc, t) {
    const changed = ch !== chapter;
    chapter = ch;
    local = loc;
    tod = t;
    if (changed) {
      if (override) override.until = 0;
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
      // Once you plant a tree the grove changes shape, so the Welcome labels step aside.
      callout: chapter === 0 && plots.length === STARTING_AGENTS.length ? 1 : 0,
    };
  }

  function settleAnim() {
    const t = targets();
    anim.fence = t.fence;
    anim.memory = t.memory;
    anim.term = t.term;
    anim.merge = t.merge;
    anim.callout = t.callout;
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
      camX = scrollCam();
    } else {
      override = { pri: plot.x, until: time + 7 };
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

  // Whole blocks only, so a rewound tree never rests on a half-grown block.
  const growthForTurn = (n) => {
    const total = blocksSmall.length;
    return Math.round((0.3 + (0.7 * (n - 1)) / (MAX_TURN - 1)) * total) / total;
  };

  function focusPlot(index) {
    const p = plots[index];
    if (!p || reduced) return;
    const sx = p.x - camX;
    if (sx > 34 && sx < W - 34) return; // already on screen
    override = { pri: p.x, until: time + 6 };
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

    // Camera: follows the scroll, with only light smoothing for wheel steps.
    const looking = override && override.until > time;
    overrideW += ((looking ? 1 : 0) - overrideW) * (1 - Math.exp(-dt * 2.5));
    if (!looking && overrideW < 0.002) {
      override = null;
      overrideW = 0;
    }
    const target = cameraTarget();
    camX += (target - camX) * (1 - Math.exp(-dt * 14));

    // Chapter animations.
    const t = targets();
    anim.fence += Math.sign(t.fence - anim.fence) * Math.min(Math.abs(t.fence - anim.fence), dt * 1.6);
    anim.memory += (t.memory - anim.memory) * (1 - Math.exp(-dt * 3));
    anim.term += (t.term - anim.term) * (1 - Math.exp(-dt * 4));
    anim.merge += Math.sign(t.merge - anim.merge) * Math.min(Math.abs(t.merge - anim.merge), dt * 0.9);
    anim.callout += (t.callout - anim.callout) * (1 - Math.exp(-dt * 6));
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
    drawMoonSun(todv);
    drawMeteor(night);
    drawBirds(todv, tt);
    drawHills(cam, todv);

    // World layer, lit for the hour.
    const w = world.ctx;
    w.globalCompositeOperation = 'source-over';
    w.clearRect(0, 0, W, H);
    drawGround(w, cam);
    drawDecor(w, cam);
    drawTufts(w, cam, tt, 1);
    drawOldTree(w, cam);
    drawFences(w, cam);
    for (const p of plots) drawPlot(w, p, cam);
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
    drawCallouts(cam, tt);
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

  function drawMoonSun(todv) {
    const horizon = groundY - 20;
    // Moon: high at night, sinking to the left toward day.
    const moonA = 1 - smooth(0.45, 0.8, todv);
    // On phones the key and the app panel fill the sky, so the moon sits this one out.
    if (moonA > 0.01 && W >= 220) {
      // The app panel sits top right on wide screens, so the moon hangs mid sky.
      const narrow = W < 220;
      const mx = Math.round(narrow ? W - 24 - todv * 40 : W * (0.47 - 0.2 * todv));
      const my = Math.round((narrow ? 16 : Math.max(14, groundY - 124)) + todv * 70);
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
      // Clouds drift the same way the world pans as you scroll on.
      const drift = reduced ? 0 : tt * c.speed;
      const x0 = Math.round(((((c.x - camX * c.par - drift) % span) + span) % span) - c.w - 10);
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
      const x = Math.round(W + 30 - ((((reduced ? 40 + i * 60 : tt * 11) + i * 23 + 60) % (W + 60))));
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

  function drawPlot(w, p, cam) {
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
  }

  function drawEmptySlots(w, cam) {
    const occupied = new Set(plots.map((p) => p.slot));
    LAYOUT.slots.forEach((sx, i) => {
      if (occupied.has(i)) return;
      const x = sx - cam;
      if (x < -20 || x > W + 20) return;
      // A bush and a few flowers keep the empty plot from looking bare.
      drawBush(w, x - 22, groundY, i);
      drawBush(w, x + 24, groundY, i + 3, true);
      for (const [fx, col] of [[-12, C.amberLight], [-9, C.cream], [12, C.cream], [15, C.primaryPale]]) {
        w.fillStyle = C.grassDark;
        w.fillRect(x + fx, groundY - 2, 1, 3);
        w.fillStyle = col;
        w.fillRect(x + fx, groundY - 3, 1, 1);
      }
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

  function drawDecor(w, cam) {
    DECOR.forEach((d, i) => {
      const x = d.x - cam;
      if (x < -20 || x > W + 20) return;
      if (d.kind === 'flowers') {
        for (const [fx, col] of [[-4, C.amberLight], [0, C.cream], [3, C.primaryPale], [6, C.cream]]) {
          w.fillStyle = C.grassDark;
          w.fillRect(x + fx, groundY - 2, 1, 3);
          w.fillStyle = col;
          w.fillRect(x + fx, groundY - 3, 1, 1);
        }
      } else {
        drawBush(w, x, groundY, 40 + i, d.kind === 'small');
      }
    });
  }

  function drawBush(w, x, base, seed, small = false) {
    const puffs = small
      ? [[-3, 3, 3], [2, 4, 3]]
      : [[-5, 3, 4], [0, 6, 5], [5, 3, 4]];
    // Dark outline pass, then body, then a lit top edge.
    for (const pass of [0, 1, 2]) {
      for (const [dx, h, r] of puffs) {
        const cx = x + dx;
        const top = base - h - r + 1;
        for (let yy = 0; yy <= r * 2; yy++) {
          const half = Math.round(Math.sqrt(Math.max(0, r * r - (yy - r) ** 2)));
          const y = top + yy;
          if (y > base) continue;
          if (pass === 0) {
            w.fillStyle = C.leafSeam;
            w.fillRect(cx - half - 1, y, half * 2 + 3, 1);
          } else if (pass === 1) {
            w.fillStyle = yy < 2 ? C.grassTop : hash(seed + dx, yy) < 0.2 ? C.grassDark : C.grass;
            w.fillRect(cx - half, y, half * 2 + 1, 1);
          }
        }
        if (pass === 2) {
          w.fillStyle = C.leafTop;
          w.fillRect(cx - 1, top + 1, 2, 1);
        }
      }
    }
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
      const rune = runePixels(sx, groundY);
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
  // Welcome callouts: labelled leader lines to one tree, one agent, one lamp.

  function calloutGeometry() {
    const compact = W < 220;
    const [p0, p1, p2] = plots;
    const G = groundY;
    const agentRow = compact ? G - 91 : G - 80;
    const lamp = compact
      ? { x: p1.x, label: p1.x + 44, path: [[p1.x + 42, G - 79], [p1.x + 32, G - 69]] }
      : { x: p2.x, label: p2.x + 14, path: [[p2.x + 20, G - 79], [p2.x + 32, G - 67]] };
    const out = [
      { key: 'tree', label: [p0.x, G - 80], path: [[p0.x, G - 79], [p0.x, G - 73]], end: 'down' },
      {
        key: 'agent',
        label: [p1.x + 17, agentRow],
        path: [[p1.x + 17, agentRow + 1], [p1.x + 17, G - 13], [p1.x + 16, G - 13]],
        end: 'left',
      },
      {
        key: 'lamp',
        label: [lamp.label, G - 80],
        path: [...lamp.path, [lamp.x + 32, G - 18], [lamp.x + 30, G - 18]],
        end: 'left',
      },
    ];
    // Keep each label on screen and start its line right under it.
    const cam = Math.round(camX);
    const half = Math.ceil(64 / k);
    for (const c of out) {
      const x = clamp(c.label[0], cam + half + 2, cam + W - half - 2);
      if (x !== c.label[0]) {
        c.label[0] = x;
        c.path[0][0] = clamp(c.path[0][0], x - half + 4, x + half - 4);
      }
    }
    return out;
  }

  function linePixels(x0, y0, x1, y1, out) {
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
  }

  function drawCallouts(cam, tt) {
    const a = anim.callout;
    if (a < 0.02 || plots.length < 3) return;
    for (const c of calloutGeometry()) {
      const pts = c.path.map(([x, y]) => [Math.round(x - cam), Math.round(y)]);
      const px = [];
      for (let i = 1; i < pts.length; i++) linePixels(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], px);
      const [ex, ey] = pts[pts.length - 1];
      const tip =
        c.end === 'down'
          ? [[ex, ey + 1], [ex - 1, ey], [ex + 1, ey], [ex - 2, ey - 1], [ex + 2, ey - 1]]
          : [[ex - 1, ey], [ex, ey - 1], [ex, ey + 1], [ex + 1, ey - 2], [ex + 1, ey + 2]];
      // Dark outline first so the line reads over leaves and sky alike.
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = '#0b1224';
      for (const [x, y] of [...px, ...tip]) ctx.fillRect(x - 1, y - 1, 3, 3);
      // Marching light toward the target.
      const march = reduced ? 0 : Math.floor(tt * 10);
      ctx.fillStyle = C.cream;
      px.forEach(([x, y], i) => {
        ctx.globalAlpha = a * ((i - march) % 4 === 0 ? 0.55 : 1);
        ctx.fillRect(x, y, 1, 1);
      });
      ctx.globalAlpha = a * (reduced ? 1 : 0.7 + 0.3 * Math.sin(tt * 5));
      ctx.fillStyle = '#ffe7a8';
      for (const [x, y] of tip) ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
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
      sundial: [X(LAYOUT.sundial + 0.5), Y(groundY - 27)],
      // The dial face, where a range input lets you drag the shadow.
      dial: [X(LAYOUT.sundial - 14), Y(groundY - 26), 29 * k, 18 * k],
      callouts: plots.length >= 3 ? calloutGeometry().map((c) => [X(c.label[0]), Y(c.label[1])]) : [],
      calloutAlpha: anim.callout,
      // Things in the canvas that the app panel must never cover: [x0, y0, x1, y1].
      blocks: [
        ...plots.filter((p) => p.phase !== 'seed').map((p) => [X(p.x - 29), Y(groundY - 72), X(p.x + 31), Y(groundY + 2)]),
        [X(LAYOUT.oldTree - 39), Y(groundY - OLD.h - 1), X(LAYOUT.oldTree + 39), Y(groundY)],
        [X(LAYOUT.gate - 16), Y(groundY - 34), X(LAYOUT.gate + 16), Y(groundY)],
        [X(LAYOUT.sundial - 13), Y(groundY - 26), X(LAYOUT.sundial + 13), Y(groundY)],
      ],
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
      let status = p.phase === 'sit' ? displayStatus(p) : 'starting';
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
        prompt: a.prompt,
        activity: activityFor(a, p.phase),
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
      if (reduced) camX = cameraTarget();
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
    get merged() {
      return merged;
    },
    /** Camera left edge in art pixels, for checking the one-way pan. */
    get camera() {
      return camX;
    },
  };
}
