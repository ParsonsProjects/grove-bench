// Geometry for Grove Path. No drawing and no DOM in here.
//
// World units are art pixels. The world is the page itself: world y is the
// page y divided by the pixel scale k, so the path scrolls with the page 1:1.
// Lanes are functions of y. Each agent has a track: a piecewise linear,
// never decreasing map from the scroll "focus line" u to its y on the path.

import { treeSize } from '../grove/sprites.js';
import { treePalette, oldTreePalette } from '../grove/palette.js';
import { BRANCH_KEYS } from './data.js';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Smoothstep on 0..1. */
export const S = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

// Single file order on main: feat/auth leads, fix/login-bug walks last.
export const ORDER = { auth: 0, api: 1, fix: 2 };
export const GAP = 18;

// Lane x as a share of the path region (wide screens) and packed tight in
// a corridor beside the text (narrow screens).
const WIDE_FRAC = { main: 0.13, auth: 0.315, api: 0.545, fix: 0.775 };
const CORRIDOR = { main: 6, auth: 19, api: 30, fix: 41 };
export const HALF = { main: 6, lane: 4, detour: 3 };
const FORK_DY = 40;
const MERGE_DY = 40;
const OPEN_T = 26;
export const TREE_EXTRA = 1;

/**
 * @param {{
 *   k: number, W: number, H: number, wide: boolean, R: number, RW: number,
 *   zones: Record<string, { top: number, bottom: number }>,
 *   panels: { top: number, bottom: number }[],
 *   uTop: number, uMax: number, vhArt: number,
 * }} m
 */
export function buildWorld(m) {
  const { wide, R, RW, zones: Z } = m;
  const h = (z) => z.bottom - z.top;

  // -------------------------------------------------------------------------
  // Opening and closing of the lanes (narrow screens only): wide in scenes,
  // packed into the corridor beside each text panel.

  const panels = wide ? [] : m.panels;
  function open(y) {
    let closed = 0;
    for (const p of panels) {
      const a = p.top - 4;
      const b = p.bottom + 4;
      let c = 0;
      if (y >= a && y <= b) c = 1;
      else if (y < a && y > a - OPEN_T) c = S((y - (a - OPEN_T)) / OPEN_T);
      else if (y > b && y < b + OPEN_T) c = 1 - S((y - b) / OPEN_T);
      if (c > closed) closed = c;
    }
    return 1 - closed;
  }

  function baseX(key, y) {
    const wx = R + WIDE_FRAC[key] * RW;
    if (wide) return wx;
    return lerp(R + CORRIDOR[key], wx, open(y));
  }
  const mainX = (y) => baseX('main', y);

  // -------------------------------------------------------------------------
  // Stops

  const heroBlock = wide ? 8 : 6;
  const ctaBlock = wide ? 9 : 7;
  const heroTree = treeSize(heroBlock, TREE_EXTRA);
  const ctaTree = treeSize(ctaBlock, TREE_EXTRA);

  const zh = Z.hero;
  const horizon = Math.round(wide ? zh.top + Math.max(heroTree.h + 8, h(zh) * 0.46) : zh.top + heroTree.h + 2);
  const heroBase = horizon + 6;
  const heroFeet = heroBase + (wide ? 80 : 72);

  const zw = Z.worktrees;
  const fork = { fix: zw.top + 16, api: zw.top + 30, auth: zw.top + 44 };
  const zt = Z.terminals;
  const bench = {};
  for (const key of BRANCH_KEYS) bench[key] = zt.top + 124 - GAP * ORDER[key];
  const zp = Z.permissions;
  const gateY = zp.top + 96;
  const zc = Z.checkpoints;
  const sunY = zc.top + 112;
  const STONE_STEP = 18;
  const stones = [3, 2, 1, 0].map((i) => sunY - i * STONE_STEP);
  const zm = Z.memory;
  const memHold = {};
  for (const key of BRANCH_KEYS) memHold[key] = zm.top + 134 - GAP * ORDER[key];
  const zr = Z.review;
  const merge = { auth: zr.top + 14, api: zr.top + 28, fix: zr.top + 42 };
  const mainGateY = zr.top + 132;
  const zx = Z.cta;
  const mainEnd = zx.top + 104;
  const endFeet = zx.top + 100;
  const mainStart = heroBase - 2;

  // The feat/api detour round the gate, bulging left.
  const DETOUR = { from: gateY - 34, to: gateY + 30, dx: -15 };
  function detourDX(y) {
    const t = (y - DETOUR.from) / (DETOUR.to - DETOUR.from);
    if (t <= 0 || t >= 1) return 0;
    const bump = t < 0.35 ? S(t / 0.35) : t > 0.65 ? S((1 - t) / 0.35) : 1;
    return DETOUR.dx * bump;
  }

  /** Lane centre at y, or null where the lane does not exist. */
  function laneX(key, y, detour = false) {
    if (key === 'main') return y >= mainStart && y <= mainEnd ? mainX(y) : null;
    const f = fork[key];
    const mm = merge[key];
    if (y < f || y > mm + MERGE_DY) return null;
    let x = baseX(key, y);
    if (y < f + FORK_DY) x = lerp(mainX(y), x, S((y - f) / FORK_DY));
    else if (y > mm) x = lerp(x, mainX(y), S((y - mm) / MERGE_DY));
    if (detour && key === 'api') x += detourDX(y);
    return x;
  }

  /** Where an agent stands at y: its lane, or main before the fork and after the merge. */
  function agentX(key, y, detour = false) {
    return laneX(key, y, detour) ?? mainX(y);
  }

  const onLane = (key, y) => laneX(key, y) != null;

  // -------------------------------------------------------------------------
  // Props (drawn sorted by base y)

  const props = [];
  const X = (key, y) => Math.round(baseX(key, y));

  // Hero: the project's own tree at the head of main, a status lamp.
  const heroTreeX = Math.round(mainX(heroBase));
  props.push({ kind: 'tree', id: 'hero', x: heroTreeX, base: heroBase, block: heroBlock, pal: treePalette(6, 0.01) });
  const heroLamp = { kind: 'lamp', id: 'hero', x: Math.round(mainX(heroBase + 44)) + 13, base: heroBase + 44, status: 'working' };
  props.push(heroLamp);

  // Worktrees: a sign and a tree per lane, plus the .grove-wt board.
  const signs = [];
  const forkTrees = {};
  for (const key of BRANCH_KEYS) {
    const sy = fork[key] + FORK_DY + 12;
    const sx = X(key, sy) + 7;
    props.push({ kind: 'sign', x: sx, base: sy, height: 13 });
    signs.push({ key, x: sx + 1, y: sy - 13 });
    const ty = zw.top + 160 - GAP * ORDER[key];
    const t = { kind: 'tree', id: 'wt-' + key, lane: key, x: X(key, ty) + 22, base: ty, block: 4, pal: treePalette([-4, 8, -12][ORDER[key]], [0, 0.015, -0.01][ORDER[key]]) };
    forkTrees[key] = t;
    props.push(t);
  }
  const wtY = zw.top + 150;
  const wtSign = { x: Math.round((mainX(wtY) + baseX('auth', wtY)) / 2) - 1, y: wtY - 12 };
  props.push({ kind: 'sign', x: wtSign.x - 1, base: wtY, height: 12 });

  // Terminals: bench and lamp beside each lane.
  const benches = {};
  for (const key of BRANCH_KEYS) {
    const by = bench[key];
    const bx = X(key, by) + 8;
    benches[key] = { x: bx, base: by, seatX: bx + 8, seatY: by + 1 - 16 };
    props.push({ kind: 'bench', x: bx, base: by + 1 });
    props.push({ kind: 'lamp', id: 'bench-' + key, lane: key, x: X(key, by) + 35, base: by + 1, status: 'working' });
  }

  // Permissions: a gate across feat/api, an amber lamp, a detour path.
  const apiGateX = X('api', gateY);
  props.push({ kind: 'laneGate', x: apiGateX, base: gateY });
  props.push({ kind: 'lamp', id: 'gate', lane: 'api', x: apiGateX + 11, base: gateY + 1, status: 'permission' });

  // Checkpoints: stones along fix/login-bug, the sundial, the lane's tree.
  const fixX = X('fix', sunY);
  const stoneMarks = stones.map((y, i) => ({ n: i + 1, x: X('fix', y) - 13, y: y - 4 }));
  for (const s of stoneMarks) props.push({ kind: 'cpStone', n: s.n, x: s.x, base: s.y + 4 });
  const sundial = { x: fixX + 17, base: sunY + 3 };
  props.push({ kind: 'sundial', x: sundial.x, base: sundial.base });
  const cpTree = { kind: 'tree', id: 'cp-fix', lane: 'fix', x: fixX + 24, base: sunY - 26, block: 4, pal: forkTrees.fix.pal };
  props.push(cpTree);

  // Project memory: the old tree and the memory stone beside main.
  const memTop = zm.top;
  const oldX = Math.round(mainX(memTop + 74)) - (wide ? 20 : 17);
  props.push({ kind: 'tree', id: 'old', x: oldX, base: memTop + 74, block: wide ? 5 : 4, pal: oldTreePalette });
  const memStone = { x: Math.round(mainX(memTop + 78)) + 17, base: memTop + 78 };
  props.push({ kind: 'memStone', x: memStone.x, base: memStone.base });
  const chipStep = Math.ceil(27 / m.k);
  const chips = [0, 1, 2, 3].map((i) => ({ x: Math.round(mainX(memTop + 92 + i * chipStep)), y: memTop + 92 + i * chipStep }));

  // Review and ship: lamps where each lane turns home, the gate on main.
  const mergeLamps = {};
  for (const key of BRANCH_KEYS) {
    const ly = merge[key] - 2;
    const l = { kind: 'lamp', id: 'merge-' + key, lane: key, x: X(key, ly) + 8, base: ly, status: 'working' };
    mergeLamps[key] = l;
    props.push(l);
  }
  const gateX = Math.round(mainX(mainGateY));
  props.push({ kind: 'mainGate', x: gateX, base: mainGateY });

  // The end of main: the big tree.
  const ctaTreeX = Math.round(mainX(mainEnd)) + (wide ? 50 : 42);
  const ctaTreeProp = { kind: 'tree', id: 'cta', x: ctaTreeX, base: zx.top + 118, block: ctaBlock, pal: treePalette(10, 0.02) };
  props.push(ctaTreeProp);
  props.push({ kind: 'lamp', id: 'end', x: Math.round(mainX(mainEnd)) - 14, base: mainEnd - 6, status: 'ready' });

  // A few bushes in open meadow (left gutter on wide screens, and the how-it-works stretch).
  const bushes = [];
  const addBush = (x, base, small) => {
    bushes.push({ x, base });
    props.push({ kind: 'bush', x, base, seed: bushes.length * 7, small });
  };
  if (wide && R > 26) {
    for (let y = zw.top - 40; y < zx.top; y += 90) {
      if (y > memTop - 10 && y < memTop + 90) continue;
      addBush(Math.round(R - 12 - (Math.floor(y / 90) % 2) * 8), Math.round(y), (Math.floor(y / 90) % 3) === 1);
    }
  }
  {
    const zhw = Z.how;
    const y0 = zhw.top + Math.min(70, h(zhw) * 0.5);
    for (const [key, dy] of [['auth', 0], ['api', 26], ['fix', 8]]) addBush(X(key, y0 + dy), Math.round(y0 + dy), key === 'api');
  }

  // -------------------------------------------------------------------------
  // Tracks

  const vh = m.vhArt;
  const C = Math.max(50, Math.round(vh * 0.3));
  const L = {
    hero: 14,
    bench: Math.round(vh * 0.34),
    gate: Math.round(vh * 0.16),
    sun: Math.round(vh * 0.3),
    mem: Math.round(vh * 0.18),
  };

  function buildTrack(holds, o) {
    holds = [...holds].sort((a, b) => a.h - b.h);
    const uStartOf = (hd) => {
      let u = hd.h + o;
      if (hd.first) u = Math.max(u, m.uTop);
      if (hd.last) u = Math.min(u, m.uMax - 2);
      return u;
    };
    const knots = [];
    holds.forEach((hd, i) => {
      const uS = uStartOf(hd);
      knots.push([uS, hd.h]);
      if (hd.last) return;
      const uE = uS + hd.L;
      knots.push([uE, hd.h]);
      hd.uS = uS;
      hd.uE = uE;
      const uC = Math.max(uE + C, hd.h + o + C);
      const next = holds[i + 1];
      if (next && (uC - o >= next.h || uC >= uStartOf(next))) return;
      knots.push([uC, uC - o]);
    });
    // Keep u strictly increasing and y never decreasing, trusting later knots.
    const out = [knots[knots.length - 1]];
    for (let i = knots.length - 2; i >= 0; i--) {
      const [u, y] = knots[i];
      if (u < out[0][0] && y <= out[0][1]) out.unshift(knots[i]);
    }
    return out;
  }

  const tracks = {};
  const holdInfo = {};
  for (const key of BRANCH_KEYS) {
    const o = GAP * ORDER[key];
    const holds = [
      { name: 'hero', h: heroFeet - o, L: L.hero, first: true },
      { name: 'bench', h: bench[key], L: L.bench },
      { name: 'mem', h: memHold[key], L: L.mem },
      { name: 'end', h: endFeet - o, L: 0, last: true },
    ];
    if (key === 'api') holds.push({ name: 'gate', h: gateY - 9, L: L.gate });
    if (key === 'fix') holds.push({ name: 'sun', h: sunY, L: L.sun });
    tracks[key] = buildTrack(holds, o);
    holdInfo[key] = Object.fromEntries(holds.map((hd) => [hd.name, hd]));
  }

  // Time of day by focus line: night through the first half, dawn at project
  // memory, full day by the end.
  const mid = (z) => (z.top + z.bottom) / 2;
  const todKnots = [
    [mid(Z.hero), 0],
    [mid(Z.permissions), 0.06],
    [mid(Z.checkpoints), 0.28],
    [mid(Z.memory), 0.5],
    [mid(Z.review), 0.78],
    [Math.min(mid(Z.how), m.uMax - 60), 0.92],
    [Math.min(mid(Z.cta), m.uMax), 1],
  ];
  const tod = (u) => evalKnots(todKnots, u);

  // The big tree at the end grows over the last stretch of scroll.
  const ctaGrow = { from: Math.min(zx.top + 20, m.uMax - 140), to: Math.min(zx.top + 110, m.uMax - 4) };

  // Callouts in the hero (label position, target point), in art pixels.
  const lampHead = { x: heroLamp.x + 1, y: heroLamp.base - 18 };
  const callouts = [
    { key: 'tree', label: 'git worktree', x: heroTreeX + Math.round(heroTree.w / 2) + 6, y: heroBase - Math.round(heroTree.h * 0.62), tx: heroTreeX + Math.round(heroTree.w / 2) - 4, ty: heroBase - Math.round(heroTree.h * 0.55) },
    { key: 'agent', label: 'AI conversation', x: Math.round(mainX(heroFeet)) + 16, y: heroFeet - 10, tx: Math.round(mainX(heroFeet)) + 6, ty: heroFeet - 8 },
    { key: 'lamp', label: 'status', x: lampHead.x + 10, y: lampHead.y - 4, tx: lampHead.x + 4, ty: lampHead.y },
  ];

  return {
    ...m,
    C,
    open,
    mainX,
    laneX,
    agentX,
    onLane,
    detourDX,
    DETOUR,
    props,
    tracks,
    holdInfo,
    tod,
    ctaGrow,
    callouts,
    horizon,
    heroBase,
    heroFeet,
    heroTree: { x: heroTreeX, ...heroTree },
    fork,
    merge,
    FORK_DY,
    MERGE_DY,
    mainStart,
    mainEnd,
    signs,
    wtSign,
    forkTrees,
    benches,
    gateY,
    apiGateX,
    sunY,
    stones,
    stoneMarks,
    sundial,
    cpTree,
    memStone,
    chips,
    memTop,
    mergeLamps,
    mainGateY,
    gateX,
    ctaTree: ctaTreeProp,
    endFeet,
  };
}

/** Piecewise linear evaluation, clamped at both ends. */
export function evalKnots(knots, u) {
  if (u <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [u1, y1] = knots[i];
    if (u <= u1) {
      const [u0, y0] = knots[i - 1];
      return y0 + ((y1 - y0) * (u - u0)) / (u1 - u0);
    }
  }
  return knots[knots.length - 1][1];
}
