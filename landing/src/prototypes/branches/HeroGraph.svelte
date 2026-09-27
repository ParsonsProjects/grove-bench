<script>
  import { onMount } from 'svelte';
  import { animationLoop, fitCanvas } from '../shared/motion.js';
  import { laneList } from './lanes.js';

  /**
   * Ambient generative git graph behind the hero. Lanes drift down slowly,
   * fork and merge; commit dots pulse. Near the pointer, dots glow and lanes
   * bend away a little. Faded on the text side so the headline keeps its
   * contrast. Reduced motion draws one still frame.
   *
   * @type {{ host?: HTMLElement, reduced?: boolean }}
   */
  let { host, reduced = false } = $props();

  /** @type {HTMLCanvasElement} */
  let canvas;

  const ROW = 36;
  const SPEED = 13; // px per second
  const colors = laneList.map((l) => l.rgb);

  let ctx = null;
  let W = 0;
  let H = 0;
  let colW = 30;
  let cols = 0;
  /** @type {{ lanes: Map<number, { c: number, node: boolean, phase: number }>, links: { from: number, to: number, c: number }[] }[]} */
  let rows = [];
  let baseY = 0;
  let time = 0;
  const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, a: 0, ta: 0 };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const pickColor = () => {
    const r = Math.random();
    return r < 0.22 ? 0 : 1 + Math.floor(Math.random() * 3);
  };

  function newRowAbove(below) {
    const lanesT = new Map();
    const links = [];
    const bCols = [...below.lanes.keys()].sort((a, b) => a - b);
    const minLanes = Math.max(3, Math.round(cols * 0.18));
    const maxLanes = Math.max(5, Math.round(cols * 0.5));
    const ending = new Set();
    for (const c of bCols) {
      if (bCols.length - ending.size <= minLanes) break;
      if (Math.random() < 0.08) {
        const n = bCols.find((o) => o !== c && Math.abs(o - c) <= 2 && !ending.has(o));
        if (n !== undefined) ending.add(c);
      }
    }
    for (const c of bCols) {
      if (ending.has(c)) continue;
      let nc = c;
      if (Math.random() < 0.06) {
        const d = Math.random() < 0.5 ? -1 : 1;
        if (c + d >= 0 && c + d < cols && !below.lanes.has(c + d) && !lanesT.has(c + d)) nc = c + d;
      }
      if (lanesT.has(nc)) nc = c;
      if (lanesT.has(nc)) continue;
      const color = below.lanes.get(c).c;
      lanesT.set(nc, { c: color, node: Math.random() < 0.3, phase: Math.random() * Math.PI * 2 });
      links.push({ from: nc, to: c, c: color });
    }
    for (const c of ending) {
      let best = null;
      for (const tc of lanesT.keys()) if (best === null || Math.abs(tc - c) < Math.abs(best - c)) best = tc;
      if (best !== null) links.push({ from: best, to: c, c: below.lanes.get(c).c });
    }
    if (lanesT.size < maxLanes && Math.random() < 0.34 && lanesT.size) {
      const tcols = [...lanesT.keys()];
      const n = tcols[Math.floor(Math.random() * tcols.length)];
      const f = n + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
      if (f >= 0 && f < cols && !lanesT.has(f)) {
        const color = pickColor();
        lanesT.set(f, { c: color, node: true, phase: Math.random() * Math.PI * 2 });
        links.push({ from: f, to: n, c: color });
      }
    }
    return { lanes: lanesT, links };
  }

  function seed() {
    cols = Math.max(4, Math.floor(W / colW));
    const bottom = { lanes: new Map(), links: [] };
    const start = Math.max(3, Math.round(cols * 0.3));
    while (bottom.lanes.size < start) {
      const c = Math.floor(Math.random() * cols);
      bottom.lanes.set(c, { c: pickColor(), node: Math.random() < 0.3, phase: Math.random() * 6.28 });
    }
    rows = [bottom];
    const needed = Math.ceil(H / ROW) + 3;
    while (rows.length < needed) rows.unshift(newRowAbove(rows[0]));
    baseY = -ROW;
  }

  const colX = (c) => (W - (cols - 1) * colW) / 2 + c * colW;

  // How visible the graph is at a point: faded behind the text column.
  function fade(x, y) {
    const edge = smooth(0, 60, y) * (1 - smooth(H - 80, H, y));
    if (W < 700) return edge * (0.18 + 0.82 * smooth(H * 0.5, H * 0.82, y));
    return edge * (0.1 + 0.9 * smooth(W * 0.28, W * 0.72, x));
  }

  function bend(x, y) {
    if (mouse.a <= 0.01) return x;
    const dx = x - mouse.x;
    const dy = y - mouse.y;
    const s = 80;
    return x + mouse.a * 16 * (dx / s) * Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
  }

  function glowAt(x, y) {
    if (mouse.a <= 0.01) return 0;
    const dx = x - mouse.x;
    const dy = y - mouse.y;
    return mouse.a * Math.exp(-(dx * dx + dy * dy) / (2 * 95 * 95));
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'square';

    for (let i = 0; i < rows.length - 1; i++) {
      const y0 = baseY + i * ROW;
      const y1 = y0 + ROW;
      if (y1 < -ROW || y0 > H + ROW) continue;
      for (const link of rows[i].links) {
        const x0 = colX(link.from);
        const x1 = colX(link.to);
        const mxp = (x0 + x1) / 2;
        const myp = (y0 + y1) / 2;
        const a = fade(mxp, myp) * (0.24 + 0.35 * glowAt(mxp, myp));
        if (a < 0.01) continue;
        const [r, g, b] = colors[link.c];
        ctx.strokeStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
        ctx.beginPath();
        const steps = 8;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const e = t * t * (3 - 2 * t);
          const x = x0 + (x1 - x0) * e;
          const y = y0 + ROW * t;
          const bx = bend(x, y);
          if (s === 0) ctx.moveTo(bx, y);
          else ctx.lineTo(bx, y);
        }
        ctx.stroke();
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const y = baseY + i * ROW;
      if (y < -10 || y > H + 10) continue;
      for (const [c, lane] of rows[i].lanes) {
        if (!lane.node) continue;
        const x = bend(colX(c), y);
        const f = fade(x, y);
        if (f < 0.02) continue;
        const glow = glowAt(x, y);
        const pulse = 0.5 + 0.5 * Math.sin(time * 1.7 + lane.phase);
        const a = f * (0.35 + 0.3 * pulse + 0.65 * glow);
        const size = 5 + glow * 2;
        const [r, g, b] = colors[lane.c];
        if (glow > 0.05) {
          ctx.fillStyle = `rgba(${r},${g},${b},${(f * glow * 0.22).toFixed(3)})`;
          ctx.fillRect(x - 9, y - 9, 18, 18);
        }
        ctx.fillStyle = `rgba(${r},${g},${b},${clamp(a, 0, 1).toFixed(3)})`;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
    }
  }

  function tick(dt) {
    time += dt;
    baseY += SPEED * dt;
    while (baseY > 0) {
      rows.unshift(newRowAbove(rows[0]));
      baseY -= ROW;
    }
    while (rows.length && baseY + (rows.length - 1) * ROW > H + ROW * 2) rows.pop();

    const k = 1 - Math.exp(-dt * 6);
    if (mouse.x < -9000) {
      mouse.x = mouse.tx;
      mouse.y = mouse.ty;
    }
    mouse.x += (mouse.tx - mouse.x) * k;
    mouse.y += (mouse.ty - mouse.y) * k;
    mouse.a += (mouse.ta - mouse.a) * k;
    draw();
  }

  function fit() {
    const fitted = fitCanvas(canvas);
    ctx = fitted.ctx;
    const changed = Math.abs(fitted.width - W) > 1 || Math.abs(fitted.height - H) > 1;
    W = fitted.width;
    H = fitted.height;
    colW = W < 700 ? 26 : 32;
    if (changed || !rows.length) seed();
    draw();
  }

  onMount(() => {
    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(canvas);

    const target = host ?? canvas.parentElement;
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.tx = e.clientX - r.left;
      mouse.ty = e.clientY - r.top;
      mouse.ta = 1;
    };
    const onLeave = () => {
      mouse.ta = 0;
    };
    target?.addEventListener('pointermove', onMove);
    target?.addEventListener('pointerleave', onLeave);

    return () => {
      ro.disconnect();
      target?.removeEventListener('pointermove', onMove);
      target?.removeEventListener('pointerleave', onLeave);
    };
  });

  $effect(() => {
    if (reduced) {
      mouse.a = 0;
      mouse.ta = 0;
      draw();
      return;
    }
    return animationLoop(canvas, tick);
  });
</script>

<div
  class="hero-canvas"
  role="img"
  aria-label="A slowly moving git graph: coloured branch lanes fork, run side by side and merge back."
>
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .hero-canvas {
    position: absolute;
    inset: 0;
    z-index: 0;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
