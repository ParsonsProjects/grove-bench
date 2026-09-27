// World geometry for the Canopy scene. Pure functions, no DOM.
//
// The world is as tall as the page: one art pixel is `k` CSS pixels and the
// camera y is the page scroll divided by `k`. Every feature is placed from a
// measured anchor element, so the art always sits beside (or, on phones,
// between) the panels that talk about it.
//
// Reading top to bottom: the crown, the trunk (main), the fork into three
// limbs (one per worktree), a treehouse platform on each limb, the hollow
// with project memory, the limbs curving back into the trunk, the roots, the
// ground and the gate to main, then the meadow.

export const LANE_ORDER = ['auth', 'api', 'fix'];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Stem half widths (the stem is 2 * half + 1 pixels wide). */
export function stemSizes(wide) {
  return { limb: wide ? 5 : 4, trunk: wide ? 11 : 8 };
}

/**
 * @param {{
 *   anchors: Record<string, { top: number, bottom: number, y: number }>,
 *   area: { x0: number, x1: number },
 *   W: number, H: number, k: number, vh: number, wide: boolean, maxScroll: number,
 * }} m  anchor and area values are CSS page pixels
 */
export function buildLayout(m) {
  const { anchors, area, W, H, k, vh, wide, maxScroll } = m;
  const art = (css) => css / k;
  const at = (name) => Math.round(art(anchors[name].y));
  const top = (name) => Math.round(art(anchors[name].top));
  const bottom = (name) => Math.round(art(anchors[name].bottom));
  const vhArt = vh / k;

  const x0 = art(area.x0);
  const x1 = art(area.x1);
  const aw = x1 - x0;
  const f = wide ? [0.1, 0.38, 0.65, 0.9] : [0.08, 0.4, 0.66, 0.9];
  const trunkX = Math.round(x0 + aw * f[1]);
  const lanes = {
    auth: Math.round(x0 + aw * f[0]),
    api: Math.round(x0 + aw * f[2]),
    fix: Math.round(x0 + aw * f[3]),
  };
  const size = stemSizes(wide);

  // Crown: the logo's crown, every logo block made of n x n small leaf blocks.
  const heroTop = top('hero');
  const heroBottom = bottom('hero');
  const n = 3;
  const target = wide ? Math.min((heroBottom - heroTop) * 0.5, (aw * 0.92 * 5) / 7) : Math.min((aw * 0.95 * 5) / 7, 118);
  const block = clamp(Math.floor(target / (5 * n)) - 1, 5, 9);
  const step = block + 1;
  const crownW = 7 * n * step - 1;
  const crownH = 5 * n * step - 1;
  const crownTop = wide ? heroTop + 6 : Math.round(heroTop - crownH * 0.62);
  const crown = { cx: trunkX, top: crownTop, block, n, w: crownW, h: crownH, left: Math.round(trunkX - (crownW - 1) / 2) };

  // Fork: each limb leaves the trunk a little lower than the last.
  const forkY = crownTop + crownH - 2;
  const fork = {};
  LANE_ORDER.forEach((lane, i) => {
    const dx = Math.abs(lanes[lane] - trunkX);
    const len = Math.round(24 + dx * 0.42);
    fork[lane] = { y0: forkY + 6 + i * 7, len };
  });

  // Platforms.
  const authDeck = Math.max(fork.auth.y0 + fork.auth.len + 16, heroBottom - (wide ? 20 : 14));
  const apiDeck = at('api');
  const fixDeck = at('fix');
  const platforms = {
    auth: platform('auth', lanes.auth, authDeck, 1, size, { lampInside: true }),
    api: platform('api', lanes.api, apiDeck, -1, size),
    fix: platform('fix', lanes.fix, fixDeck, -1, size, { sundial: true }),
  };

  // Hanging branch signs (Worktrees). Staggered so the boards never share a row.
  const signsY = at('signs');
  const signGap = wide ? 30 : 44;
  const signs = {
    auth: { lane: 'auth', y: signsY - signGap, side: 1 },
    api: { lane: 'api', y: signsY, side: -1 },
    fix: { lane: 'fix', y: signsY + signGap, side: -1 },
  };

  // Checkpoint notches on the fix limb, turn 1 highest.
  const notchGap = wide ? 13 : 12;
  const notches = [0, 1, 2, 3].map((i) => fixDeck - 22 - (3 - i) * notchGap);

  // Project memory: a hollow in the trunk.
  const hollow = { x: trunkX, y: at('memory'), w: size.trunk * 2 - (wide ? 7 : 5), h: wide ? 24 : 20 };

  // Ground, merge and gate.
  const groundY = at('ground');
  const merge = {};
  LANE_ORDER.forEach((lane, i) => {
    const dx = Math.abs(lanes[lane] - trunkX);
    const len = Math.round(26 + dx * 0.45);
    const end = groundY - (wide ? 40 : 34) - (2 - i) * 6;
    merge[lane] = { y0: Math.max(hollow.y + 34, end - len), len };
  });
  const gateX = Math.round(x0 + aw * (wide ? 0.8 : 0.84));
  const spots = [0, 1, 2].map((i) => gateX - (wide ? 58 : 52) + i * (wide ? 14 : 13));

  // Scroll schedule (CSS px) for the walk down to the gate.
  const groundCss = groundY * k;
  let s1 = groundCss - 0.6 * vh;
  let s0 = s1 - 0.55 * vh;
  const fixClear = (fixDeck + 8) * k;
  if (s0 < fixClear) {
    s0 = fixClear;
    s1 = Math.max(s1, s0 + 0.3 * vh);
  }
  let s2 = s1 + 0.28 * vh;
  if (s2 > maxScroll - 4) {
    s2 = Math.max(s1 + 40, maxScroll - 4);
  }
  const walk = { s0, s1, s2 };

  // Time of day by scroll: night until the memory hollow comes up, dawn at
  // the ground, full day by How it works.
  const memCss = hollow.y * k;
  const howCss = anchors.how ? anchors.how.top : groundCss + vh;
  const t0 = memCss - 0.9 * vh;
  const t1 = Math.max(t0 + 1, groundCss - 0.55 * vh);
  const t2 = Math.max(t1 + 1, Math.min(howCss - 0.35 * vh, maxScroll));
  const todKeys = [
    [t0, 0],
    [t1, 0.5],
    [t2, 1],
  ];

  // The feat/api agent works until its platform climbs past this point of
  // the screen, then stops and asks.
  const askScroll = apiDeck * k - 0.64 * vh;

  // Where the lane glow has reached: a little below the middle of the screen.
  const headFrac = 0.62;

  return {
    W,
    H,
    k,
    wide,
    vhArt,
    area: { x0, x1 },
    trunkX,
    lanes,
    size,
    crown,
    fork,
    merge,
    platforms,
    signs,
    notches,
    hollow,
    groundY,
    gateX,
    spots,
    walk,
    todKeys,
    askScroll,
    headFrac,
    worldH: Math.ceil(art(maxScroll + vh)) + 4,
  };
}

/**
 * A treehouse platform. `side` is which way the deck runs from the limb:
 * 1 to the right, -1 to the left. Limb | bench | lamp, mirrored for -1, or
 * limb | lamp | bench with `lampInside`.
 */
function platform(lane, limbX, deckY, side, size, { lampInside = false, sundial = false } = {}) {
  const edge = limbX + side * (size.limb - 1);
  const benchW = 24;
  // Offsets along the deck, measured outward from the limb.
  const lampOff = lampInside ? 5 : 4 + benchW + 4;
  const benchOff = lampInside ? 11 : 4;
  const endOff = lampInside ? benchOff + benchW + 4 : lampOff + 6;
  const lampX = side > 0 ? edge + lampOff : edge - lampOff - 2;
  const benchX = side > 0 ? edge + benchOff : edge - benchOff - benchW;
  const deck0 = side > 0 ? edge : edge - endOff;
  const deck1 = side > 0 ? edge + endOff : edge;
  const out = {
    lane,
    limbX,
    deckY,
    side,
    benchX,
    seatX: benchX + 8,
    lampX,
    deck0,
    deck1,
  };
  if (sundial) {
    // The sundial sits on a small deck on the other side of the limb.
    const sx = limbX - side * (size.limb + 17);
    out.sundialX = sx;
    out.deck0 = Math.min(out.deck0, sx - 14);
    out.deck1 = Math.max(out.deck1, sx + 14);
  }
  return out;
}

/** x of a limb's centre at world row y, or null where the limb does not exist. */
export function limbX(L, lane, y) {
  const f = L.fork[lane];
  const g = L.merge[lane];
  const lx = L.lanes[lane];
  if (y < f.y0) return null;
  if (y < f.y0 + f.len) return L.trunkX + (lx - L.trunkX) * smooth((y - f.y0) / f.len);
  if (y < g.y0) return lx;
  if (y < g.y0 + g.len) return lx + (L.trunkX - lx) * smooth((y - g.y0) / g.len);
  return null;
}

/** Slope dx/dy of a limb at y (for keeping its width even on the curves). */
export function limbSlope(L, lane, y) {
  const a = limbX(L, lane, y - 0.5);
  const b = limbX(L, lane, y + 0.5);
  return a == null || b == null ? 0 : b - a;
}

/** Trunk half width at y: thicker lower down, flaring into the roots. */
export function trunkHalf(L, y) {
  const base = L.size.trunk;
  const g = L.groundY;
  const thick = smooth((y - (L.hollow.y - 90)) / 120) * (L.wide ? 4 : 3);
  const flare = y > g - 16 ? ((y - (g - 16)) / 16) ** 2 * (L.wide ? 12 : 9) : 0;
  return base + thick + flare;
}

/** Time of day for a scroll position (piecewise linear, never decreasing). */
export function todAt(L, scroll) {
  const keys = L.todKeys;
  if (scroll <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [s, t] = keys[i];
    const [ps, pt] = keys[i - 1];
    if (scroll <= s) return pt + ((t - pt) * (scroll - ps)) / Math.max(1, s - ps);
  }
  return keys[keys.length - 1][1];
}
