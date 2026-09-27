// Canopy scene: a tall pixel grove drawn behind the page. No Svelte in here.
//
// One fixed canvas fills the viewport. Its backing store is small (about
// 480 x 300 on a desktop) and scaled up by a whole number of device pixels.
// The camera y is the page scroll divided by the art pixel size, so the world
// moves exactly with the page: scrolling down only moves the view down, and
// scrolling up retraces the same frames. The fraction of an art pixel left
// over is taken up by a CSS translate, so the art never lags the text.
//
// The static world (stems, crown, decks, ground) is drawn into small tiles
// on demand and cached; only the tiles in view are drawn each frame.

import { C, statusHex, looks, treePalette, skyBands, worldTint, hillColours, cloudColours, mix, rgba, hexToRgb } from '../pixel/palette.js';
import {
  hash,
  bayer,
  makeCanvas,
  agentSprites,
  drawBench,
  drawLamp,
  drawGate,
  drawSundial,
  moonSprite,
  sunSprite,
  halo,
  ringHalo,
  cloudShape,
} from '../pixel/sprites.js';
import { createAgent, stepAgent, answerAgent } from '../pixel/agents.js';
import { AGENTS, CHECKPOINTS } from './data.js';
import { LANE_ORDER, limbX, limbSlope, trunkHalf, todAt } from './layout.js';
import { buildCrown, CROWN_PAD, climbSprites, stemRow, drawLeafCluster, drawDeck, drawHollow, hollowNotes, drawBush, silhouetteCrown } from './art.js';

const TILE = 128;
const STAR_RATE = 0.04;
const MOON_RATE = 0.06;
const CLOUD_RATE = 0.12;
const FAR_RATE = 0.3;
const MID_RATE = 0.55;
const MAX_TURN = CHECKPOINTS.length;

const GLOW = { auth: C.primaryLight, api: '#3fd0d8', fix: C.leafTop };
const TERM = ['$ npm run dev', 'server running'];
const DENY_SAY = "No zod, then. I'll check the input by hand.";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ reduced?: boolean, onchange?: () => void }} options
 */
export function createScene(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  let reduced = !!options.reduced;
  const onchange = options.onchange ?? (() => {});

  // View.
  let W = 320;
  let H = 200;
  let s = 1;
  let dpr = 1;
  let k = 1;
  let vh = 800;
  /** @type {ReturnType<typeof import('./layout.js').buildLayout> | null} */
  let L = null;
  let scroll = 0;
  let lastScroll = 0;
  let camY = 0;
  let tod = 0;
  let time = 0;
  let maxCam = 1;

  // Layers and caches.
  const world = makeCanvas(W, H + 1);
  const skyLayer = makeCanvas(W, H + 1);
  let skyKey = '';
  const tiles = new Map();
  let crownImg = null;
  const leafPal = treePalette(0, 0);
  const moon = moonSprite();
  const sun = sunSprite();

  // Conversations.
  const agents = AGENTS.map((def, i) => {
    const look = looks[def.look];
    return { i, def, a: createAgent(def), lane: def.lane, sprites: agentSprites(look), climb: climbSprites(look), say: null, sayUntil: 0 };
  });
  // feat/auth opens on the edit the hero talks about.
  primeAuth();

  let answered = null;
  let turn = MAX_TURN;
  let rewound = null;
  const arrived = [false, false, false];
  let hover = -1;

  let stars = [];
  let fireflies = [];
  let particles = [];
  let clouds = [];
  let far = null;
  let pointer = null;
  let lastSig = '';

  function primeAuth() {
    const a = agents[0].a;
    a.step = 1;
    const [tool, detail] = a.script[1];
    a.bubble = { tool, detail };
  }

  // -------------------------------------------------------------------------
  // Size and layout

  function resize(vw, vhCss) {
    vh = vhCss;
    dpr = window.devicePixelRatio || 1;
    const devW = Math.max(1, vw * dpr);
    const devH = Math.max(1, vhCss * dpr);
    s = Math.max(1, Math.round(Math.min(devH / 270, devW / 195)));
    W = Math.ceil(devW / s);
    H = Math.ceil(devH / s);
    k = s / dpr;
    canvas.width = W;
    canvas.height = H + 1;
    canvas.style.width = `${(W * s) / dpr}px`;
    canvas.style.height = `${((H + 1) * s) / dpr}px`;
    world.canvas.width = W;
    world.canvas.height = H + 1;
    skyLayer.canvas.width = W;
    skyLayer.canvas.height = H + 1;
    ctx.imageSmoothingEnabled = false;
    world.ctx.imageSmoothingEnabled = false;
    skyKey = '';
    tiles.clear();
    return { W, H, k, s, dpr };
  }

  function setLayout(layout) {
    L = layout;
    tiles.clear();
    crownImg = buildCrown(L.crown.block, leafPal);
    maxCam = Math.max(1, L.worldH - H);
    camY = scroll / k;
    tod = todAt(L, scroll);
    seedStars();
    seedClouds();
    seedFar();
    seedFireflies();
    notifyIfChanged(true);
  }

  function setScroll(y) {
    lastScroll = scroll;
    scroll = Math.max(0, y);
    camY = scroll / k;
    if (L) tod = todAt(L, scroll);
    if (L) checkArrivals();
  }

  // -------------------------------------------------------------------------
  // Seeds

  function seedStars() {
    const span = H + maxCam * STAR_RATE + 20;
    const count = Math.round((W * span) / 560);
    stars = Array.from({ length: count }, (_, i) => {
      const r = hash(i, 91);
      return {
        x: Math.floor(hash(i, 17) * W),
        y: Math.floor(hash(i, 29) * span),
        kind: r > 0.93 ? 2 : r > 0.7 ? 1 : 0,
        phase: hash(i, 5) * Math.PI * 2,
        speed: 0.6 + hash(i, 8) * 1.8,
      };
    });
  }

  function seedClouds() {
    const count = Math.max(3, Math.round(W / 110));
    clouds = Array.from({ length: count }, (_, i) => {
      const w = 34 + Math.floor(hash(i, 51) * 40);
      const h = 9 + Math.floor(hash(i, 52) * 7);
      return {
        rows: cloudShape(i + 7, w, h),
        w,
        h,
        x: hash(i, 53) * (W + w),
        y: Math.floor(((i + hash(i, 54)) / count) * (H + 60)),
        speed: 1.2 + hash(i, 55) * 1.6,
      };
    });
  }

  function seedFar() {
    // Hills sit just above the ground line while the ground comes into view.
    const camAtGround = Math.max(0, L.groundY - H * 0.8);
    const gF = Math.round(H * 0.6 + camAtGround * FAR_RATE);
    const gM = Math.round(H * 0.7 + camAtGround * MID_RATE);
    const farTrees = [];
    let x = -12 - hash(3, 3) * 20;
    let i = 0;
    while (x < W + 30) {
      farTrees.push({
        x: Math.round(x),
        top: Math.round(16 + hash(i, 61) * 70),
        block: hash(i, 62) > 0.55 ? 4 : 3,
        half: hash(i, 63) > 0.5 ? 3 : 2,
      });
      x += 44 + hash(i, 64) * 46;
      i++;
    }
    const xs = L.wide ? [0.02, 0.3, 0.985] : [0.03, 0.97];
    const midTrees = xs.map((f, j) => ({ x: Math.round(W * f), top: Math.round(-6 + hash(j, 71) * 44), block: 5, half: 4 }));
    far = { gF, gM, farTrees, midTrees, key: -1, sprites: null, col: null };
  }

  function seedFireflies() {
    const count = clamp(Math.round((W * H) / 5200), 12, 30);
    fireflies = Array.from({ length: count }, (_, i) => ({
      x: hash(i, 3) * W,
      y: camY + hash(i, 4) * H,
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
  // Story state, all derived from scroll plus the two interactions

  /** How far agent i has got: climb 0..1 down its limb, then walk 0..1 to the gate. */
  function walkProgress(i) {
    const { s0, s1, s2, dc, dl } = L.walk;
    const a = s0 + i * dc;
    const b = s1 + i * dl;
    const c = s2 + i * dl * 0.5;
    return {
      climb: clamp((scroll - a) / Math.max(1, b - a), 0, 1),
      walk: clamp((scroll - b) / Math.max(1, c - b), 0, 1),
      started: scroll > a,
    };
  }

  function checkArrivals() {
    for (let i = 0; i < 3; i++) {
      const q = walkProgress(i).walk;
      if (q >= 1 && !arrived[i]) {
        arrived[i] = true;
        if (!reduced && scroll > lastScroll) {
          const x = L.spots[i];
          burstLeaves(x, L.groundY - 20, 10, 0.9);
          if (i === 2) burstLeaves(L.gateX, L.groundY - 34, 26, 1.2);
        }
      } else if (q < 1 && arrived[i]) {
        arrived[i] = false;
      }
    }
  }

  const trunkOffsets = () => (L.wide ? [-5, 0, 5] : [-4, 0, 4]);

  /** Where agent i is and what it shows. World art coords, feet position. */
  function agentState(ag) {
    const i = ag.i;
    const p = L.platforms[ag.lane];
    const q = walkProgress(i);
    const off = trunkOffsets()[i];
    if (!q.started) {
      return { phase: 'seat', x: p.seatX + 4, y: p.deckY - 1, status: seatStatus(ag), bubble: seatBubble(ag) };
    }
    if (q.climb < 1) {
      const top = L.walk.climbTop;
      const y = top + (L.groundY - top) * q.climb;
      const lx = limbX(L, ag.lane, y);
      let x;
      if (lx == null) x = L.trunkX + off;
      else {
        const g = L.merge[ag.lane];
        x = lx + off * smooth((y - g.y0) / g.len);
      }
      return { phase: 'climb', x, y, status: 'working', bubble: null };
    }
    const from = L.trunkX + off;
    const x = from + (L.spots[i] - from) * q.walk;
    if (q.walk < 1) return { phase: 'walk', x, y: L.groundY, status: 'working', bubble: null };
    // One speech bubble for the three of them, clear of the gate board.
    const bubble = i === 0 && arrived.every(Boolean) ? { tool: 'done', detail: 'Ready for main' } : null;
    return { phase: 'gate', x: L.spots[i], y: L.groundY, status: 'ready', bubble };
  }

  function seatStatus(ag) {
    if (ag.i === 1) {
      if (answered) return ag.a.status;
      return scroll > L.askScroll ? 'permission' : 'working';
    }
    return ag.a.status;
  }

  function heroQuiet() {
    return scroll < vh * 0.3;
  }

  function seatBubble(ag) {
    if (ag.i === 0) return heroQuiet() ? null : ag.a.bubble;
    if (ag.i === 1) {
      if (answered) {
        if (ag.say && ag.sayUntil > time) return { say: ag.say };
        return ag.a.bubble;
      }
      return scroll > L.askScroll ? { tool: '?', detail: '' } : { term: TERM };
    }
    // fix/login-bug shows the checkpoint you have wound back to.
    if (rewound) {
      return rewound.mode === 'all'
        ? { note: `Rewound to turn ${rewound.turn}` }
        : { note: `Chat back at turn ${rewound.turn}, files kept` };
    }
    const h = CHECKPOINTS[turn - 1];
    return { turn, tool: h.step[0], detail: h.step[1] };
  }

  /** What the page needs to draw the HTML overlays for each agent. */
  function views() {
    if (!L) return [];
    return agents.map((ag) => {
      const st = agentState(ag);
      const seated = st.phase === 'seat';
      const headY = seated ? st.y - 16 : st.phase === 'climb' ? st.y - 15 : st.y - 15;
      return {
        index: ag.i,
        id: ag.def.id,
        branch: ag.def.branch,
        lane: ag.lane,
        model: ag.def.model,
        task: ag.def.task,
        ask: ag.def.ask,
        answered,
        status: st.status,
        phase: st.phase,
        bubble: st.bubble,
        head: [Math.round(st.x * 2) / 2, headY],
        hit: [st.x - 8, headY - 3, 16, 22],
      };
    });
  }

  function signature() {
    return JSON.stringify(views().map((v) => [v.status, v.phase, v.bubble, Math.round(v.head[0]), Math.round(v.head[1])]));
  }

  function notifyIfChanged(force = false) {
    if (!L) return;
    const sig = signature();
    if (force || sig !== lastSig) {
      lastSig = sig;
      onchange();
    }
  }

  // -------------------------------------------------------------------------
  // Interactions

  function answer(choice) {
    const ag = agents[1];
    if (!choice) {
      ag.a = createAgent(ag.def);
      ag.say = null;
      answered = null;
    } else {
      answered = choice;
      answerAgent(ag.a, choice !== 'deny');
      ag.say = choice === 'deny' ? DENY_SAY : null;
      ag.sayUntil = reduced ? Infinity : time + 3.6;
    }
    notifyIfChanged(true);
  }

  function setTurn(n) {
    turn = clamp(Math.round(n), 1, MAX_TURN);
    rewound = null;
    notifyIfChanged(true);
  }

  function rewind(mode) {
    rewound = mode ? { mode, turn } : null;
    notifyIfChanged(true);
  }

  // -------------------------------------------------------------------------
  // Update

  function update(dt) {
    time += dt;
    if (!L || reduced) return;
    stepAgent(agents[0].a, dt);
    if (answered) stepAgent(agents[1].a, dt);

    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life -= dt;
      q.vy += 26 * dt;
      q.vx += Math.sin(time * 3 + q.phase) * 20 * dt;
      q.vx *= 1 - 1.2 * dt;
      q.vy = Math.min(q.vy, 18);
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.y > L.groundY + 2) q.life = Math.min(q.life, 0.3);
      if (q.life <= 0) particles.splice(i, 1);
    }
    updateFireflies(dt);
    notifyIfChanged();
  }

  function burstLeaves(x, y, n, spread = 1) {
    if (reduced) return;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4 * spread;
      const v = 18 + Math.random() * 40 * spread;
      particles.push({
        x: x + (Math.random() - 0.5) * 16,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 2 + Math.random() * 1.6,
        colour: [C.leafTop, '#5ab868', '#4aaa58', '#3a9a48'][i % 4],
        phase: Math.random() * 6,
      });
    }
  }

  function updateFireflies(dt) {
    const top = camY - 16;
    const span = H + 32;
    for (const f of fireflies) {
      let ax = Math.sin(time * 0.7 + f.p1) * 7 + Math.cos(time * 0.31 + f.p2) * 5;
      let ay = Math.cos(time * 0.53 + f.p3) * 6 + Math.sin(time * 0.23 + f.p1) * 3;
      if (pointer) {
        const px = pointer.x;
        const py = pointer.y + camY;
        const dx = px - f.x;
        const dy = py - f.y;
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
      // Keep them around the view: ones that fall behind as you scroll down
      // come back in from below, so they drift the same way the world does.
      if (f.y < top) f.y += span;
      if (f.y > top + span) f.y -= span;
      if (f.x < -10) f.x += W + 20;
      if (f.x > W + 10) f.x -= W + 20;
    }
  }

  // -------------------------------------------------------------------------
  // Tiles: the static world, drawn once per layout

  function tile(t) {
    let c = tiles.get(t);
    if (c) return c;
    const made = makeCanvas(W, TILE);
    drawTile(made.ctx, t * TILE);
    tiles.set(t, made.canvas);
    if (tiles.size > 14) {
      const here = Math.floor(camY / TILE);
      let worst = null;
      for (const key of tiles.keys()) if (worst == null || Math.abs(key - here) > Math.abs(worst - here)) worst = key;
      tiles.delete(worst);
    }
    return made.canvas;
  }

  // Draw the next tile in the direction of travel while the browser is idle,
  // so scrolling rarely has to build one mid-frame.
  let prefetchQueued = false;
  function prefetch() {
    if (prefetchQueued || !L) return;
    const down = scroll >= lastScroll;
    const t = down ? Math.floor((camY + H + 1) / TILE) + 1 : Math.floor(camY / TILE) - 1;
    if (t < 0 || tiles.has(t) || t * TILE > L.worldH + TILE) return;
    prefetchQueued = true;
    const run = () => {
      prefetchQueued = false;
      if (L && !tiles.has(t)) tile(t);
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 300 });
    else setTimeout(run, 60);
  }

  const inTile = (y0, a, b) => b >= y0 && a < y0 + TILE;

  function drawTile(g, y0) {
    const y1 = y0 + TILE;
    const G = L.groundY;
    if (y1 > G + 3) drawMeadow(g, y0);

    // Stems, limbs first so the trunk covers where they join.
    const trunkTop = L.crown.top + L.crown.h - 12;
    for (let yy = 0; yy < TILE; yy++) {
      const y = y0 + yy;
      LANE_ORDER.forEach((lane, li) => {
        const x = limbX(L, lane, y);
        if (x == null) return;
        stemRow(g, y, yy, x, L.size.limb, limbSlope(L, lane, y), 11 + li);
      });
      if (y >= trunkTop && y <= G) stemRow(g, y, yy, L.trunkX, trunkHalf(L, y), 0, 7);
    }
    drawRingsCarved(g, y0);
    drawLeaves(g, y0);
    if (inTile(y0, L.crown.top - CROWN_PAD, L.crown.top + L.crown.h + CROWN_PAD)) g.drawImage(crownImg, L.crown.left - CROWN_PAD, L.crown.top - CROWN_PAD - y0);
    drawSignTwigs(g, y0);
    for (const lane of LANE_ORDER) drawPlatform(g, L.platforms[lane], y0);
    const hl = L.hollow;
    if (inTile(y0, hl.y - hl.h, hl.y + hl.h)) drawHollow(g, hl.x, hl.y - y0, hl.w, hl.h);
    if (inTile(y0, G - 40, G + 12)) drawGroundProps(g, y0);
  }

  function drawLeaves(g, y0) {
    LANE_ORDER.forEach((lane, li) => {
      const f = L.fork[lane];
      const m = L.merge[lane];
      const p = L.platforms[lane];
      const sign = L.signs[lane];
      for (let y = f.y0 + f.len + 22 + li * 17; y < m.y0 - 8; y += 50) {
        if (!inTile(y0, y - 12, y + 4)) continue;
        if (Math.abs(y - p.deckY) < 34 || Math.abs(y - sign.y) < 16) continue;
        if (hash(y, li) < 0.3) continue;
        if (lane === 'fix' && y > L.notches[0] - 10 && y < p.deckY + 30) continue;
        const j = Math.floor(y / 50);
        const dir = (j + li) % 2 ? 1 : -1;
        const x = limbX(L, lane, y) + dir * (L.size.limb + 1);
        drawLeafCluster(g, Math.round(x), y - y0, dir, j * 7 + li, leafPal);
      }
    });
    // A few on the trunk.
    const top = L.crown.top + L.crown.h + 30;
    for (let y = top; y < L.hollow.y - 40; y += 58) {
      if (!inTile(y0, y - 12, y + 4)) continue;
      const j = Math.floor(y / 58);
      const dir = j % 2 ? 1 : -1;
      const x = L.trunkX + dir * (trunkHalf(L, y) + 1);
      drawLeafCluster(g, Math.round(x), y - y0, dir, j * 13, leafPal);
    }
  }

  function drawSignTwigs(g, y0) {
    for (const lane of LANE_ORDER) {
      const sg = L.signs[lane];
      if (!inTile(y0, sg.y - 6, sg.y + 4)) continue;
      const x = Math.round(limbX(L, lane, sg.y));
      const from = x + sg.side * (L.size.limb + 1);
      const len = 12;
      g.fillStyle = C.woodDark;
      for (let i = 0; i < len; i++) g.fillRect(from + sg.side * i, sg.y - y0 - 2 - (i > len - 4 ? 1 : 0), 1, 2);
      g.fillStyle = C.wood;
      for (let i = 0; i < len - 2; i++) g.fillRect(from + sg.side * i, sg.y - y0 - 2, 1, 1);
      // A tuft of leaves at the tip.
      const tip = from + sg.side * len;
      g.fillStyle = leafPal.seam;
      g.fillRect(tip - 2, sg.y - y0 - 6, 5, 4);
      g.fillStyle = leafPal.leaves[1];
      g.fillRect(tip - 1, sg.y - y0 - 6, 3, 3);
    }
  }

  function drawPlatform(g, p, y0) {
    if (!inTile(y0, p.deckY - 26, p.deckY + 40)) return;
    const d = p.deckY - y0;
    drawDeck(g, p.deck0, p.deck1, d, p.limbX, L.size.limb);
    drawBench(g, p.benchX, d - 1);
    drawLamp(g, p.lampX, d - 1);
  }

  function drawRingsCarved(g, y0) {
    for (const y of L.notches) {
      if (!inTile(y0, y - 1, y + 2)) continue;
      const x = Math.round(limbX(L, 'fix', y));
      const h = L.size.limb;
      g.fillStyle = C.woodDeep;
      g.fillRect(x - h - 1, y - y0 - 1, h * 2 + 3, 1);
      g.fillStyle = C.woodPale;
      g.fillRect(x - h, y - y0, h * 2 + 1, 1);
      g.fillStyle = C.woodDeep;
      g.fillRect(x - h - 1, y - y0 + 1, h * 2 + 3, 1);
    }
  }

  // Ground, path and the meadow below it.
  function drawMeadow(g, y0) {
    const G = L.groundY;
    const from = Math.max(0, G + 3 - y0);
    const rows = TILE - from;
    if (rows <= 0) return;
    const img = g.createImageData(W, rows);
    const data = img.data;
    const far1 = hexToRgb(mix(C.grass, '#cfe6b0', 0.35));
    const near = hexToRgb(C.grass);
    const deep = hexToRgb(mix(C.grass, C.grassDark, 0.55));
    const pathC = hexToRgb(C.path);
    const pathD = hexToRgb(C.pathDark);
    const edge = hexToRgb(C.pathEdge);
    const aw = L.area.x1 - L.area.x0;
    for (let r = 0; r < rows; r++) {
      const y = y0 + from + r;
      const depth = y - (G + 3);
      let a;
      let b;
      let t;
      if (depth < 4) {
        a = edge;
        b = edge;
        t = 0;
      } else if (depth < 50) {
        a = far1;
        b = near;
        t = (depth - 4) / 46;
      } else {
        a = near;
        b = deep;
        t = Math.min(1, (depth - 50) / 260);
      }
      // A path winds from the gate down toward you, wider as it comes closer.
      const pc = L.gateX - 4 + Math.sin(depth * 0.013 + 0.6) * aw * 0.16 - Math.min(depth, 200) * 0.1;
      const pw = 3 + depth * 0.045;
      for (let x = 0; x < W; x++) {
        const o = (r * W + x) * 4;
        let c = t > bayer(x, y) ? b : a;
        if (depth >= 4) {
          const dx = Math.abs(x - pc);
          if (dx < pw) c = dx > pw - 1.2 ? edge : (hash(x, y) < 0.06 ? pathD : pathC);
        }
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, from);
    // Tufts and flowers, bigger the closer they are.
    for (let r = 0; r < rows; r += 1) {
      const y = y0 + from + r;
      const depth = y - (G + 3);
      if (depth < 6) continue;
      const cell = depth < 60 ? 3 : depth < 160 ? 5 : 7;
      if (depth % cell) continue;
      for (let x = 0; x < W; x += cell) {
        const hsh = hash(x * 3 + 1, y);
        if (hsh > 0.34) continue;
        const px = x + Math.floor(hash(x, y + 5) * cell);
        const tall = Math.max(2, Math.round(cell * 0.7));
        const yy = from + r;
        if (hsh < 0.025) {
          g.fillStyle = [C.cream, C.amberLight, C.primaryPale][Math.floor(hash(px, y) * 3)];
          g.fillRect(px, yy - 1, cell > 4 ? 2 : 1, cell > 4 ? 2 : 1);
          continue;
        }
        g.fillStyle = hsh < 0.17 ? C.grassTop : C.grassDark;
        g.fillRect(px, yy - tall + 1, 1, tall);
        if (cell > 3) g.fillRect(px + 2, yy - tall + 2, 1, tall - 1);
      }
    }
  }

  function drawGroundProps(g, y0) {
    const G = L.groundY;
    const d = G - y0;
    // Grass strip and the path along the ground line.
    g.fillStyle = C.grassTop;
    g.fillRect(0, d, W, 1);
    g.fillStyle = C.grass;
    g.fillRect(0, d + 1, W, 2);
    for (let x = 0; x < W; x++) {
      const r = hash(x, 11);
      if (r < 0.45) {
        g.fillStyle = C.grassTop;
        g.fillRect(x, d - 1, 1, 1);
        if (r < 0.12) g.fillRect(x, d - 2, 1, 1);
      }
    }
    // Roots spreading along the ground.
    const tx = L.trunkX;
    const spread = L.wide ? 34 : 26;
    for (const dir of [-1, 1]) {
      for (let j = 0; j < 2; j++) {
        const len = spread - j * 10;
        for (let i = 0; i < len; i++) {
          const x = Math.round(tx + dir * (trunkHalf(L, G) - 3 + i));
          const y = d - 1 + Math.round((i / len) * (2 + j * 2)) + j;
          g.fillStyle = C.woodDeep;
          g.fillRect(x, y - 1, 1, 3);
          g.fillStyle = i < len * 0.6 ? C.woodDark : C.wood;
          g.fillRect(x, y, 1, j ? 1 : 2);
        }
      }
    }
    // Bushes and flowers.
    const aw = L.area.x1 - L.area.x0;
    const bushes = [L.area.x0 + aw * 0.02, L.trunkX - spread - 10, L.gateX + 24, L.gateX + 40];
    bushes.forEach((bx, i) => drawBush(g, Math.round(bx), d, 40 + i, i % 2 === 1));
    for (let x = 0; x < W; x += 1) {
      if (hash(x, 71) > 0.035) continue;
      g.fillStyle = C.grassDark;
      g.fillRect(x, d - 2, 1, 3);
      g.fillStyle = [C.amberLight, C.cream, C.primaryPale][Math.floor(hash(x, 72) * 3)];
      g.fillRect(x, d - 3, 1, 1);
    }
    drawGate(g, L.gateX, d);
    // One lamp post per conversation beside the gate.
    for (const sx of L.spots) drawLamp(g, sx + 6, d);
  }

  // -------------------------------------------------------------------------
  // Draw

  function render() {
    if (!L) return;
    const cy = Math.floor(camY);
    const frac = camY - cy;
    canvas.style.transform = `translate3d(0, ${(-Math.round(frac * s) / dpr).toFixed(3)}px, 0)`;
    const tt = reduced ? 0 : time;
    const night = 1 - smooth((tod - 0.3) / 0.55);

    drawSky(tod);
    ctx.drawImage(skyLayer.canvas, 0, 0);
    drawStars(tt, night);
    drawMoonSun();
    drawClouds(tt);
    drawFar();

    const w = world.ctx;
    w.globalCompositeOperation = 'source-over';
    w.clearRect(0, 0, W, H + 1);
    const t0 = Math.floor(cy / TILE);
    const t1 = Math.floor((cy + H + 1) / TILE);
    for (let t = Math.max(0, t0); t <= t1; t++) w.drawImage(tile(t), 0, t * TILE - cy);
    prefetch();
    drawSundialNow(w, cy);
    drawAgents(w, cy);
    drawParticles(w, cy);
    const tint = worldTint(tod);
    if (tint.alpha > 0.001) {
      w.globalCompositeOperation = 'source-atop';
      w.fillStyle = rgba(tint.colour, tint.alpha);
      w.fillRect(0, 0, W, H + 1);
      w.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(world.canvas, 0, 0);

    drawLaneGlow(cy, tt, night);
    drawAgentLights(cy, tt, night);
    drawNotches(cy, tt);
    drawMemory(cy, tt, night);
    drawGateLights(cy, tt);
    drawFireflies(cy, tt, night);
    drawHover(cy, tt);
    drawCallouts(cy, tt);
  }

  function drawSky(todv) {
    const bucket = Math.round(todv * 200) / 200;
    const key = `${bucket}|${W}|${H}`;
    if (key === skyKey) return;
    skyKey = key;
    const bands = skyBands(bucket).map(hexToRgb);
    const img = skyLayer.ctx.createImageData(W, H + 1);
    const data = img.data;
    const n = bands.length;
    for (let y = 0; y <= H; y++) {
      const f = clamp(y / H, 0, 1) * (n - 1);
      const i = Math.floor(f);
      const fr = f - i;
      for (let x = 0; x < W; x++) {
        const c = bands[Math.min(n - 1, i + (fr > bayer(x, y) ? 1 : 0))];
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
    const oy = camY * STAR_RATE;
    for (const st of stars) {
      const y = Math.round(st.y - oy);
      if (y < 0 || y > H) continue;
      const tw = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(tt * st.speed + st.phase);
      const a = night * (st.kind === 0 ? 0.45 : 0.85) * tw;
      if (a < 0.05) continue;
      ctx.fillStyle = rgba(st.kind === 0 ? C.primaryPale : C.cream, a);
      ctx.fillRect(st.x, y, 1, 1);
      if (st.kind === 2 && tw > 0.7) {
        ctx.fillStyle = rgba(C.cream, a * 0.45);
        ctx.fillRect(st.x - 1, y, 1, 1);
        ctx.fillRect(st.x + 1, y, 1, 1);
        ctx.fillRect(st.x, y - 1, 1, 1);
        ctx.fillRect(st.x, y + 1, 1, 1);
      }
    }
  }

  function drawMoonSun() {
    const moonA = 1 - smooth((tod - 0.3) / 0.35);
    if (moonA > 0.01) {
      const mx = Math.round(L.wide ? W - 72 : W - 24);
      const my = Math.round((L.wide ? 38 : 50) - camY * MOON_RATE);
      if (my > -30) {
        ctx.globalAlpha = moonA;
        ctx.drawImage(ringHalo(C.primaryPale, 19, [0.1, 0.06, 0.03]), mx - 19, my - 19);
        ctx.drawImage(moon, mx - 7, my - 7);
        ctx.globalAlpha = 1;
      }
    }
    const rise = smooth((tod - 0.38) / 0.62);
    if (rise > 0.001) {
      const sx = Math.round(W * (L.wide ? 0.86 : 0.8));
      const sy = Math.round(H * 0.92 - rise * H * 0.7);
      ctx.drawImage(ringHalo(C.amberLight, 26, [0.28, 0.15, 0.07]), sx - 26, sy - 26);
      ctx.drawImage(sun, sx - 7, sy - 7);
    }
  }

  let cloudKey = -1;
  let cloudPal = null;
  function drawClouds(tt) {
    const bucket = Math.round(tod * 100);
    if (cloudKey !== bucket) {
      cloudKey = bucket;
      cloudPal = cloudColours(bucket / 100);
    }
    const alpha = 0.3 + 0.7 * smooth((tod - 0.2) / 0.4);
    ctx.globalAlpha = alpha;
    const spanY = H + 60;
    for (const c of clouds) {
      const span = W + c.w + 20;
      const drift = reduced ? 0 : tt * c.speed;
      const x0 = Math.round(((((c.x - drift) % span) + span) % span) - c.w - 10);
      const y0 = Math.round(((((c.y - camY * CLOUD_RATE) % spanY) + spanY) % spanY) - 40);
      c.rows.forEach((run, y) => {
        if (!run) return;
        const [a, b] = run;
        ctx.fillStyle = y >= c.h - 3 ? cloudPal.shade : cloudPal.body;
        ctx.fillRect(x0 + a, y0 + y, b - a, 1);
        const above = c.rows[y - 1];
        ctx.fillStyle = cloudPal.top;
        if (!above) ctx.fillRect(x0 + a, y0 + y, b - a, 1);
        else {
          if (a < above[0]) ctx.fillRect(x0 + a, y0 + y, above[0] - a, 1);
          if (b > above[1]) ctx.fillRect(x0 + above[1], y0 + y, b - above[1], 1);
        }
      });
    }
    ctx.globalAlpha = 1;
  }

  const farHill = (x) => Math.round(10 + 7 * Math.sin(x * 0.013 + 1) + 4 * Math.sin(x * 0.037 + 2.2) + 2 * Math.sin(x * 0.09));
  const nearHill = (x) => Math.round(6 + 5 * Math.sin(x * 0.019 + 0.3) + 3 * Math.sin(x * 0.047 + 1.7));

  function drawFar() {
    const key = Math.round(tod * 40);
    if (far.key !== key) {
      far.key = key;
      const t = key / 40;
      const bands = skyBands(t);
      const hills = hillColours(t);
      const farFill = mix(hills.far, bands[3], 0.3);
      const midFill = mix(hills.near, '#0a0f18', 0.25);
      far.col = {
        farFill,
        farRim: mix(farFill, bands[7], 0.45),
        farTrunk: mix(mix(C.woodDark, '#1a2030', 0.5), bands[5], 0.78),
        midFill,
        midRim: mix(midFill, bands[6], 0.35),
        midTrunk: mix(mix(C.woodDark, '#141820', 0.55), bands[6], 0.42),
        hillFar: hills.far,
        hillFarRim: mix(hills.far, bands[6], 0.45),
        hillNear: hills.near,
        hillNearRim: mix(hills.near, bands[7], 0.35),
      };
      far.sprites = {
        far: { 3: silhouetteCrown(6, far.col.farFill, far.col.farRim, 3), 4: silhouetteCrown(8, far.col.farFill, far.col.farRim, 4) },
        mid: silhouetteCrown(12, far.col.midFill, far.col.midRim, 7),
      };
    }
    const col = far.col;
    // Distant giants.
    drawGiants(far.farTrees, FAR_RATE, far.gF, (t) => far.sprites.far[t.block], col.farTrunk, col.farRim);
    drawHills(far.gF - camY * FAR_RATE, farHill, col.hillFar, col.hillFarRim);
    // Nearer giants at the edges.
    drawGiants(far.midTrees, MID_RATE, far.gM, () => far.sprites.mid, col.midTrunk, col.midRim);
    drawHills(far.gM - camY * MID_RATE, nearHill, col.hillNear, col.hillNearRim);
  }

  function drawGiants(list, rate, ground, spriteOf, trunkCol, rimCol) {
    const oy = camY * rate;
    const gy = Math.round(ground - oy);
    for (const t of list) {
      const img = spriteOf(t);
      const top = Math.round(t.top - oy);
      const tTop = Math.max(0, top + img.height - 3);
      const tBot = Math.min(H + 1, gy + 4);
      if (tBot > tTop) {
        ctx.fillStyle = trunkCol;
        ctx.fillRect(t.x - t.half, tTop, t.half * 2 + 1, tBot - tTop);
        ctx.fillStyle = rimCol;
        ctx.fillRect(t.x - t.half, tTop, 1, tBot - tTop);
      }
      if (top + img.height > 0 && top < H + 1) ctx.drawImage(img, t.x - (img.width >> 1), top);
    }
  }

  function drawHills(base, profile, fill, rim) {
    const b = Math.round(base);
    if (b - 20 > H) return;
    for (let x = 0; x < W; x++) {
      const top = b - profile(x);
      if (top > H) continue;
      ctx.fillStyle = rim;
      ctx.fillRect(x, top, 1, 1);
      ctx.fillStyle = fill;
      ctx.fillRect(x, top + 1, 1, H + 1 - top);
    }
  }

  function sundialAngle(n) {
    return Math.PI + ((n - 1) / (MAX_TURN - 1)) * Math.PI;
  }

  function drawSundialNow(w, cy) {
    const p = L.platforms.fix;
    if (p.sundialX == null || p.deckY < cy - 30 || p.deckY > cy + H + 30) return;
    const filesTurn = rewound?.mode === 'all' ? rewound.turn : MAX_TURN;
    const ticks = [];
    for (let i = 1; i <= MAX_TURN; i++) ticks.push({ angle: sundialAngle(i), active: i <= filesTurn });
    drawSundial(w, p.sundialX, p.deckY - 1 - cy, sundialAngle(turn), ticks);
  }

  function drawAgents(w, cy) {
    for (const ag of agents) {
      const st = agentState(ag);
      const x = Math.round(st.x);
      const y = Math.round(st.y) - cy;
      if (y < -20 || y > H + 20) continue;
      if (st.phase === 'seat') {
        w.drawImage(ag.sprites.sit, L.platforms[ag.lane].seatX, y - 16);
      } else if (st.phase === 'climb') {
        const frame = Math.floor(st.y / 5) % 2;
        w.drawImage(ag.climb[frame], x - 4, y - 14);
      } else if (st.phase === 'walk') {
        const frame = Math.floor(st.x / 3) % 2;
        w.drawImage(frame ? ag.sprites.walkB : ag.sprites.walkA, x - 4, y - 14 - frame);
      } else {
        w.drawImage(ag.sprites.walkA, x - 4, y - 14);
      }
    }
  }

  function drawParticles(w, cy) {
    for (const q of particles) {
      w.globalAlpha = Math.min(1, q.life * 2);
      w.fillStyle = q.colour;
      const x = Math.round(q.x);
      const y = Math.round(q.y) - cy;
      const flip = Math.floor(time * 5 + q.phase) % 2;
      w.fillRect(x, y, flip ? 2 : 1, flip ? 1 : 2);
    }
    w.globalAlpha = 1;
  }

  function drawLaneGlow(cy, tt, night) {
    const head = cy + H * L.headFrac;
    const strength = 0.45 + 0.4 * night;
    ctx.globalCompositeOperation = 'lighter';
    LANE_ORDER.forEach((lane, li) => {
      ctx.fillStyle = GLOW[lane];
      for (let y = cy; y <= cy + H; y++) {
        const x = limbX(L, lane, y);
        if (x == null) continue;
        const lit = y <= head;
        const rx = Math.round(x);
        ctx.globalAlpha = (lit ? 0.5 : 0.1) * strength;
        ctx.fillRect(rx, y - cy, 1, 1);
        if (lit) {
          ctx.globalAlpha = 0.14 * strength;
          ctx.fillRect(rx - 1, y - cy, 1, 1);
          ctx.fillRect(rx + 1, y - cy, 1, 1);
        }
      }
      // Sparks running down the lit part, toward where you are reading.
      if (!reduced) {
        for (let j = 0; j < 3; j++) {
          const y = Math.round(cy + ((tt * 26 + j * 61 + li * 23) % (H * L.headFrac)));
          const x = limbX(L, lane, y);
          if (x == null) continue;
          ctx.globalAlpha = 0.8 * strength;
          ctx.drawImage(halo(GLOW[lane], 3, 1), Math.round(x) - 3, y - cy - 3);
        }
      }
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function lampGlass(x, groundY) {
    const top = groundY - 21;
    return { gx: x - 1, gy: top + 2, gw: 4, gh: 3, cx: x + 1, cy: top + 3 };
  }

  function drawLampLight(x, groundY, cy, colour, pulse, glow) {
    const g = lampGlass(x, groundY);
    const gy = g.gy - cy;
    if (gy < -20 || gy > H + 20) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.35 + 0.65 * pulse) * glow;
    ctx.drawImage(halo(colour, 12, 0.9), g.cx - 12, g.cy - cy - 12);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = mix(colour, '#000000', 0.35 * (1 - pulse));
    ctx.fillRect(g.gx, gy, g.gw, g.gh);
    ctx.fillStyle = mix(colour, '#ffffff', 0.55 * pulse);
    ctx.fillRect(g.gx + 1, gy + 1, 2, 1);
  }

  function pulseFor(status, tt) {
    if (status === 'ready' || reduced) return 1;
    const period = status === 'permission' ? 1.0 : 1.5;
    return 0.5 + 0.5 * Math.sin((tt * Math.PI * 2) / period);
  }

  function drawAgentLights(cy, tt, night) {
    const glow = 0.4 + 0.6 * night;
    for (const ag of agents) {
      const p = L.platforms[ag.lane];
      if (p.deckY < cy - 40 || p.deckY > cy + H + 40) continue;
      const st = agentState(ag);
      const seated = st.phase === 'seat';
      const status = seated ? st.status : 'stopped';
      if (seated) {
        const working = status === 'working';
        const flicker = reduced ? 0.85 : 0.72 + 0.18 * Math.sin(tt * 13 + ag.i) + 0.1 * Math.sin(tt * 31 + ag.i * 2);
        const lit = working ? flicker : 0.45;
        const ax = p.seatX;
        const ay = p.deckY - 17 - cy;
        // Relight the agent by its own screen so it reads against the night.
        ctx.globalAlpha = (0.35 + 0.25 * lit) * night + 0.05;
        ctx.drawImage(ag.sprites.sit, ax, ay);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, lit * glow);
        ctx.drawImage(halo(C.primaryLight, 10, 0.8), ax + 4 - 10, ay + 7 - 10);
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
      const colour = seated ? statusHex[status] ?? C.primary : '#737373';
      drawLampLight(p.lampX, p.deckY - 1, cy, colour, seated ? pulseFor(status, tt) : 0.2, seated ? glow : 0.2);
    }
  }

  function drawGateLights(cy, tt) {
    const G = L.groundY;
    if (G < cy - 40 || G > cy + H + 60) return;
    L.spots.forEach((sx, i) => {
      const on = arrived[i];
      drawLampLight(sx + 6, G, cy, on ? C.green : '#737373', on ? 1 : 0.15, on ? 0.9 : 0.25);
    });
    if (arrived.every(Boolean)) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = reduced ? 0.7 : 0.55 + 0.25 * Math.sin(tt * 2);
      ctx.drawImage(halo(C.green, 22, 0.8), L.gateX - 22, G - 22 - 16 - cy);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawNotches(cy, tt) {
    const filesTurn = rewound?.mode === 'all' ? rewound.turn : MAX_TURN;
    const chatTurn = rewound ? rewound.turn : turn;
    L.notches.forEach((y, i) => {
      const t = i + 1;
      if (y < cy - 10 || y > cy + H + 10) return;
      const x = Math.round(limbX(L, 'fix', y));
      const h = L.size.limb;
      const kept = t <= filesTurn;
      const ahead = t > turn && !rewound;
      const a = kept ? (ahead ? 0.35 : 0.9) : 0;
      if (a > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * 0.5;
        ctx.drawImage(halo(C.green, 6, 0.9), x - 6, y - cy - 6);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = a;
        ctx.fillStyle = C.greenLight;
        ctx.fillRect(x - h, y - cy, h * 2 + 1, 1);
        ctx.globalAlpha = 1;
      }
      if (t === chatTurn) {
        const bob = reduced ? 0 : Math.round(Math.sin(tt * 4) * 0.5 + 0.5);
        ctx.fillStyle = '#0b1224';
        ctx.fillRect(x + h + 2 + bob, y - cy - 2, 4, 5);
        ctx.fillStyle = '#ffe7a8';
        ctx.fillRect(x + h + 3 + bob, y - cy - 1, 1, 3);
        ctx.fillRect(x + h + 4 + bob, y - cy, 1, 1);
      }
    });
  }

  function drawMemory(cy, tt, night) {
    const hl = L.hollow;
    if (hl.y + 30 < cy || hl.y - H * 0.6 > cy + H) return;
    const inView = hl.y > cy - 30 && hl.y < cy + H + 30;
    const glow = 0.5 + 0.5 * night;
    if (inView) {
      const pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(tt * 2.2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9 * pulse * glow;
      ctx.drawImage(halo(C.primaryLight, 18, 0.9), hl.x - 18, hl.y - cy - 18);
      for (const [x, y, nw] of hollowNotes(hl.x, hl.y, hl.w)) {
        ctx.globalAlpha = 0.55 * pulse;
        ctx.fillStyle = C.primaryPale;
        ctx.fillRect(x, y - cy, nw, 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    // Threads of light: out of the hollow, across to each limb, up to its
    // platform. They fade out on the way up, so they only show near the hollow.
    const reach = (y) => 1 - smooth((hl.y - y) / (H * 0.55));
    ctx.globalCompositeOperation = 'lighter';
    LANE_ORDER.forEach((lane, li) => {
      const p = L.platforms[lane];
      const yJoin = hl.y - 8 - li * 4;
      const lx = limbX(L, lane, yJoin);
      if (lx == null) return;
      const side = Math.sign(lx - hl.x) || 1;
      const x0 = hl.x + side * (hl.w / 2 - 1);
      const x1 = Math.round(lx) - side * 2;
      // Across, a shallow arc.
      const n = Math.abs(x1 - x0);
      for (let i = 0; i <= n; i++) {
        const x = x0 + side * i;
        if (x < -2 || x > W + 2) continue;
        const u = i / Math.max(1, n);
        const y = Math.round(hl.y - 2 + (yJoin - hl.y + 2) * u - Math.sin(u * Math.PI) * 4);
        if (y < cy || y > cy + H) continue;
        ctx.globalAlpha = (i % 3 === 0 ? 0.6 : 0.35) * glow;
        ctx.fillStyle = C.primaryLight;
        ctx.fillRect(x, y - cy, 1, 1);
      }
      // Up the limb.
      const yTop = p.deckY + 3;
      const from = Math.max(yTop, cy);
      const to = Math.min(yJoin, cy + H);
      for (let y = from; y <= to; y++) {
        const x = limbX(L, lane, y);
        if (x == null) continue;
        const fade = reach(y);
        if (fade <= 0.01) continue;
        ctx.globalAlpha = ((y + li) % 3 === 0 ? 0.55 : 0.28) * glow * fade;
        ctx.fillStyle = C.primaryPale;
        ctx.fillRect(Math.round(x) - side * 2, y - cy, 1, 1);
      }
      // Pulses rising to the platform.
      if (!reduced) {
        const len = yJoin - yTop;
        for (let j = 0; j < 4; j++) {
          const y = Math.round(yJoin - ((tt * 30 + j * (len / 4) + li * 17) % Math.max(1, len)));
          if (y < cy - 4 || y > cy + H + 4) continue;
          const x = limbX(L, lane, y);
          if (x == null) continue;
          ctx.globalAlpha = 0.9 * glow * reach(y);
          ctx.drawImage(halo(C.primaryPale, 3, 1), Math.round(x) - side * 2 - 3, y - cy - 3);
        }
      }
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFireflies(cy, tt, night) {
    const vis = smooth((night - 0.1) / 0.8);
    if (vis <= 0.02 || reduced) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fireflies) {
      const b = 0.5 + 0.5 * Math.sin(tt * f.speed + f.phase);
      if (b < 0.18) continue;
      const x = Math.round(f.x);
      const y = Math.round(f.y) - cy;
      if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;
      ctx.globalAlpha = b * vis * 0.8;
      ctx.drawImage(halo(C.firefly, 4, 1), x - 4, y - 4);
      ctx.globalAlpha = b * vis;
      ctx.fillStyle = C.firefly;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHover(cy, tt) {
    const ag = agents[hover];
    if (!ag) return;
    const v = views()[hover];
    const bob = reduced ? 0 : Math.round(Math.sin(tt * 5) * 0.5 + 0.5);
    const l = Math.round(v.head[0] - 9) - bob;
    const r = Math.round(v.head[0] + 9) + bob;
    const t = Math.round(v.head[1] - 4) - cy - bob;
    const b = Math.round(v.head[1] + 18) - cy + bob;
    ctx.fillStyle = C.cream;
    const n = 3;
    for (const [x, y, dx, dy] of [
      [l, t, 1, 1],
      [r, t, -1, 1],
      [l, b, 1, -1],
      [r, b, -1, -1],
    ]) {
      ctx.fillRect(dx > 0 ? x : x - n + 1, y, n, 1);
      ctx.fillRect(x, dy > 0 ? y : y - n + 1, 1, n);
    }
  }

  // -------------------------------------------------------------------------
  // Hero callouts: labels (HTML) with pixel leader lines to a limb, an agent
  // and a lamp. They fade out over the first part of the scroll.

  function calloutAlpha() {
    return 1 - smooth((scroll - vh * 0.08) / (vh * 0.3));
  }

  function callouts() {
    const p = L.platforms.auth;
    const D = p.deckY;
    const head = [p.seatX + 4, D - 18];
    const lamp = [p.lampX + 1, D - 24];
    const edgeAt = (y) => Math.round(limbX(L, 'api', y) ?? L.lanes.api) + L.size.limb + 1;
    if (L.wide) {
      const branchY = D - 44;
      const apiEdge = edgeAt(branchY);
      const lx = apiEdge + 7;
      return [
        {
          key: 'branch',
          text: 'git worktree, its own branch',
          label: [lx, branchY],
          align: 'left',
          narrow: W - 6 - lx < 82,
          path: [[lx - 1, branchY], [apiEdge + 1, branchY]],
          end: 'left',
        },
        {
          key: 'agent',
          text: 'AI conversation',
          label: [head[0], D - 38],
          align: 'center',
          path: [[head[0], D - 37], [head[0], D - 22]],
          end: 'down',
        },
        {
          key: 'lamp',
          text: 'status',
          label: [p.limbX - L.size.limb - 16, D - 30],
          align: 'right',
          path: [[p.limbX - L.size.limb - 15, D - 30], [lamp[0] - 2, D - 30], [lamp[0] - 2, lamp[1] + 1]],
          end: 'down',
        },
      ];
    }
    const trunkR = L.trunkX + L.size.trunk + 3;
    const branchY = D - 48;
    const apiEdge = edgeAt(branchY);
    const lx = Math.min(apiEdge + 6, W - 8 - 62);
    return [
      {
        key: 'branch',
        text: 'git worktree, its own branch',
        label: [lx, branchY],
        align: 'left',
        narrow: true,
        path: [[lx - 1, branchY], [apiEdge + 1, branchY]],
        end: 'left',
      },
      {
        key: 'agent',
        text: 'AI conversation',
        label: [trunkR + 2, D - 14],
        align: 'left',
        path: [[trunkR + 1, D - 14], [head[0] + 6, D - 14]],
        end: 'left',
      },
      {
        key: 'lamp',
        text: 'status',
        label: [lamp[0], D - 40],
        align: 'center',
        path: [[lamp[0], D - 39], [lamp[0], lamp[1] + 1]],
        end: 'down',
      },
    ];
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

  function drawCallouts(cy, tt) {
    const a = calloutAlpha();
    if (a < 0.02) return;
    for (const c of callouts()) {
      const pts = c.path.map(([x, y]) => [Math.round(x), Math.round(y) - cy]);
      const px = [];
      for (let i = 1; i < pts.length; i++) linePixels(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], px);
      const [ex, ey] = pts[pts.length - 1];
      const tip =
        c.end === 'down'
          ? [[ex, ey + 1], [ex - 1, ey], [ex + 1, ey], [ex - 2, ey - 1], [ex + 2, ey - 1]]
          : [[ex - 1, ey], [ex, ey - 1], [ex, ey + 1], [ex + 1, ey - 2], [ex + 1, ey + 2]];
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = '#0b1224';
      for (const [x, y] of [...px, ...tip]) ctx.fillRect(x - 1, y - 1, 3, 3);
      const march = reduced ? 0 : Math.floor(tt * 10);
      ctx.fillStyle = C.cream;
      px.forEach(([x, y], i) => {
        ctx.globalAlpha = a * ((i - march) % 4 === 0 ? 0.55 : 1);
        ctx.fillRect(x, y, 1, 1);
      });
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffe7a8';
      for (const [x, y] of tip) ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // Static label anchors for the page overlays (world art coords)

  function labels() {
    if (!L) return null;
    const sizeL = L.size.limb;
    return {
      signs: LANE_ORDER.map((lane) => {
        const sg = L.signs[lane];
        const x = limbX(L, lane, sg.y) + sg.side * (sizeL + 12);
        return { lane, x, y: sg.y, side: sg.side };
      }),
      plates: LANE_ORDER.map((lane) => {
        const p = L.platforms[lane];
        return { lane, x: (p.deck0 + p.deck1) / 2, y: p.deckY + 4 };
      }),
      notches: L.notches.map((y, i) => ({ turn: i + 1, x: limbX(L, 'fix', y) - L.size.limb - 3, y })),
      hollow: { x: L.hollow.x, y: L.hollow.y, w: L.hollow.w, side: L.wide ? 1 : 1 },
      gate: { x: L.gateX + 0.5, y: L.groundY - 26 },
      callouts: callouts().map((c) => ({ key: c.key, text: c.text, x: c.label[0], y: c.label[1], align: c.align, narrow: !!c.narrow })),
      trunkX: L.trunkX,
      trunkHalf: L.size.trunk,
    };
  }

  return {
    resize,
    setLayout,
    setScroll,
    frame(dt) {
      update(dt);
      render();
    },
    render() {
      render();
      notifyIfChanged();
    },
    setReduced(v) {
      reduced = v;
      if (v) {
        particles.length = 0;
        const api = agents[1];
        if (api.say) api.sayUntil = Infinity;
      }
      notifyIfChanged(true);
    },
    setPointer(cssX, cssY) {
      pointer = cssX == null ? null : { x: cssX / k, y: cssY / k };
    },
    setHover(i) {
      hover = i;
    },
    answer,
    setTurn,
    rewind,
    views,
    labels,
    calloutAlpha,
    get view() {
      return { W, H, k, s, dpr };
    },
    get turn() {
      return turn;
    },
    /** Camera top in art pixels, for checking the one-way pan. */
    get camera() {
      return camY;
    },
    get tod() {
      return tod;
    },
  };
}
