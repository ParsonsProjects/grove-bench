// Geometry for the pixel git graph in the left gutter. Pure functions.
//
// Lanes are drawn as runs of square cells, P px wide, so forks and merges
// come out as stepped pixel staircases instead of smooth curves.

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// x progress (0..1) of the S-curve used for forks and merges at height
// fraction u (0..1). The cubic has y(t) = 1.5t(1-t) + t^3, monotonic.
export function curveX(u) {
  u = clamp(u, 0, 1);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const t = (lo + hi) / 2;
    if (1.5 * t * (1 - t) + t * t * t < u) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2;
  return 3 * t * t - 2 * t * t * t;
}

/**
 * Cells of a lane that leaves `mx` at `y0`, reaches `lx` at `y0 + dy`, runs
 * straight down and comes back to `mx` at `y1`. Returns rects [x, y, w, h]
 * with x as the cell's left edge.
 */
export function laneRects(mx, lx, y0, y1, dy, P) {
  const rects = [];
  // Lane centres sit on the same P grid as main.
  const snap = (v) => mx + Math.round((v - mx) / P) * P;
  const push = (x, y, h) => {
    const last = rects[rects.length - 1];
    if (last && last[0] === x - P / 2 && last[1] + last[3] === y) last[3] += h;
    else rects.push([x - P / 2, y, P, h]);
  };
  const stairs = (fromX, toX, ya, yb) => {
    const n = Math.max(1, Math.round((yb - ya) / P));
    let prevX = snap(fromX);
    for (let i = 0; i < n; i++) {
      const y = ya + i * P;
      const x = snap(fromX + (toX - fromX) * curveX((i + 0.5) / n));
      // Fill sideways jumps wider than one cell so the stairs stay joined.
      if (Math.abs(x - prevX) > P) {
        const lo = Math.min(x, prevX) + P;
        const hi = Math.max(x, prevX) - P;
        for (let fx = lo; fx <= hi; fx += P) rects.push([fx - P / 2, y, P, P]);
      }
      push(x, y, P);
      prevX = x;
    }
  };
  const d = Math.min(dy, (y1 - y0) / 2);
  stairs(mx, lx, y0, y0 + d);
  const run = y1 - d - (y0 + d);
  if (run > 0) push(snap(lx), y0 + d, run);
  stairs(lx, mx, y1 - d, y1);
  return rects;
}

/** Lane x at page y for a lane shaped like `laneRects`, or null outside it. */
export function laneXAt(mx, lx, y0, y1, dy, y) {
  if (y < y0 || y > y1) return null;
  const d = Math.min(dy, (y1 - y0) / 2);
  if (y < y0 + d) return mx + (lx - mx) * curveX((y - y0) / d);
  if (y > y1 - d) return lx + (mx - lx) * curveX((y - (y1 - d)) / d);
  return lx;
}

/** SVG path data for a list of rects. */
export function rectsPath(rects) {
  let d = '';
  for (const [x, y, w, h] of rects) d += `M${x} ${y}h${w}v${h}h${-w}z`;
  return d;
}

/**
 * Piecewise linear time of day over the page. `keys` are [y, tod] pairs in
 * page order with non-decreasing tod, so the result never decreases as `y`
 * grows.
 */
export function todAt(keys, y) {
  if (!keys.length) return 0;
  if (y <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [ya, ta] = keys[i - 1];
    const [yb, tb] = keys[i];
    if (y <= yb) {
      const u = yb > ya ? (y - ya) / (yb - ya) : 1;
      return ta + (tb - ta) * u;
    }
  }
  return keys[keys.length - 1][1];
}
