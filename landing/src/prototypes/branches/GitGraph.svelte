<script>
  import { onMount, untrack } from 'svelte';
  import { animationLoop } from '../shared/motion.js';
  import { lanes, laneList, AMBER } from './lanes.js';

  /**
   * Page-wide git graph in the left gutter. Lanes are built from anchor
   * elements (`[data-anchor]`) inside `container`, measured on resize. The
   * bright graph is revealed down to a "draw head" that follows the scroll
   * position; a faint ghost of the full graph is always visible underneath.
   *
   * Anchor kinds: header, row (node on a lane), merge (node on main where
   * `data-merges` lane joins), bus (memory panel feed), ground (tree root).
   *
   * @type {{ container: HTMLElement, reduced?: boolean, pending?: boolean, reached?: boolean }}
   */
  let { container, reduced = false, pending = false, reached = $bindable(false) } = $props();

  let W = $state(0);
  let H = $state(0);
  /** @type {any} */
  let geo = $state(null);
  let head = $state(0);
  // feat/auth stops at the permission node until the visitor answers.
  let authLimit = $state(Infinity);
  /** @type {{ id: string, x: number, y: number, o: number, color: string }[]} */
  let particles = $state([]);

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // x progress (0..1) of the S-curve used for forks and merges at height
  // fraction u (0..1). The cubic has y(t) = 1.5t(1-t) + t^3, monotonic.
  function curveX(u) {
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

  /** Lane x at page y, or null when the lane does not exist there. */
  function xAt(key, y) {
    if (!geo) return null;
    const mx = geo.laneX.main;
    if (key === 'main') return y >= geo.startY && y <= geo.groundY - geo.r ? mx : null;
    const x = geo.laneX[key];
    const mY = geo.merge[key];
    if (y < geo.forkY || y > mY) return null;
    if (y < geo.forkY + geo.dy) return mx + (x - mx) * curveX((y - geo.forkY) / geo.dy);
    if (y > mY - geo.dy) return mx + (x - mx) * curveX((mY - y) / geo.dy);
    return x;
  }

  function laneColor(key) {
    return lanes[key].stroke;
  }

  function measure() {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cs = getComputedStyle(container);
    const gap = parseFloat(cs.getPropertyValue('--lane-gap')) || 24;
    const x0 = parseFloat(cs.getPropertyValue('--lane-x0')) || 16;
    const wrap = container.querySelector('.bx-wrap');
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const railLeft = wr.left - rect.left + parseFloat(getComputedStyle(wrap).paddingLeft);

    /** @type {Record<string, number>} */
    const laneX = {};
    for (const l of laneList) laneX[l.key] = Math.round(railLeft + x0 + l.index * gap) + 0.5;

    const anchors = [];
    for (const el of container.querySelectorAll('[data-anchor]')) {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const d = /** @type {HTMLElement} */ (el).dataset;
      anchors.push({
        id: d.anchor,
        lane: d.lane || 'main',
        kind: d.kind || 'row',
        merges: d.merges,
        connect: d.connect !== 'false',
        left: r.left - rect.left,
        top: r.top - rect.top,
        width: r.width,
        height: r.height,
      });
    }
    const find = (id) => anchors.find((a) => a.id === id);
    const mid = (a) => Math.round(a.top + a.height / 2) + 0.5;
    const hero = find('hero');
    const fork = find('fork');
    const ground = anchors.find((a) => a.kind === 'ground');
    if (!hero || !fork || !ground) return;

    const small = gap < 14;
    const node = small ? 7 : gap < 20 ? 8 : 10;
    const dy = Math.max(44, gap * 2.4);
    const r = small ? 10 : 16;
    const mx = laneX.main;
    const startY = Math.max(0, mid(hero) - 180);
    const forkY = mid(fork);
    const groundY = Math.round(ground.top + (ground.height * 22) / 24) + 0.5;
    const groundX = ground.left + (ground.width * 6) / 21;

    /** @type {Record<string, number>} */
    const merge = {};
    for (const a of anchors) if (a.kind === 'merge' && a.merges) merge[a.merges] = mid(a);
    for (const key of ['auth', 'api', 'fix']) merge[key] ??= groundY - 200;
    const perm = find('permission');
    const permY = perm ? mid(perm) : merge.auth - dy;

    const forkPart = (x) =>
      `M ${mx} ${forkY} C ${mx} ${forkY + dy / 2} ${x} ${forkY + dy / 2} ${x} ${forkY + dy}`;
    const mergePart = (x, mY) => `V ${mY - dy} C ${x} ${mY - dy / 2} ${mx} ${mY - dy / 2} ${mx} ${mY}`;

    const paths = {
      main: `M ${mx} ${startY} V ${groundY - r} Q ${mx} ${groundY} ${mx + r} ${groundY}`,
      ground: `M ${mx + r} ${groundY} H ${Math.max(mx + r + 1, groundX)}`,
      authA: `${forkPart(laneX.auth)} V ${permY}`,
      authB: `M ${laneX.auth} ${permY} ${mergePart(laneX.auth, merge.auth)}`,
      api: `${forkPart(laneX.api)} ${mergePart(laneX.api, merge.api)}`,
      fix: `${forkPart(laneX.fix)} ${mergePart(laneX.fix, merge.fix)}`,
    };

    const nodes = anchors
      .filter((a) => a.kind === 'header' || a.kind === 'row' || a.kind === 'merge')
      .map((a) => {
        const lane = a.kind === 'merge' ? 'main' : a.lane;
        const x = laneX[lane] ?? mx;
        return {
          id: a.id,
          lane,
          kind: a.kind,
          merges: a.merges,
          x,
          y: mid(a),
          cx: a.connect && a.left - 10 > x + node ? a.left - (small ? 6 : 12) : null,
        };
      });

    const busA = anchors.find((a) => a.kind === 'bus');
    const bus = busA ? { x: busA.left, y: mid(busA) } : null;

    W = rect.width;
    H = rect.height;
    geo = { laneX, node, dy, r, startY, forkY, merge, permY, groundY, groundX, paths, nodes, bus, small };
  }

  // Draw head: follows scroll with a little easing so the line visibly draws.
  let target = 0;
  let raf = 0;
  let last = 0;

  function computeTarget() {
    const rect = container.getBoundingClientRect();
    const vh = window.innerHeight;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    // Near the bottom the head speeds up so the graph always finishes.
    const nearEnd = clamp((window.scrollY - (maxScroll - vh * 0.8)) / (vh * 0.8), 0, 1);
    return -rect.top + vh * (0.62 + 0.36 * nearEnd);
  }

  function step(now) {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
    last = now;
    const diff = target - head;
    if (Math.abs(diff) < 0.5) {
      head = target;
      raf = 0;
      return;
    }
    head += diff * (1 - Math.exp(-dt * 6));
    raf = requestAnimationFrame(step);
  }

  function kick() {
    if (reduced) {
      head = H;
      return;
    }
    target = computeTarget();
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(step);
    }
  }

  // Memory particles: notes travel from the memory panel into every lane.
  let pt = 0;
  function particleTick(dt) {
    pt += dt;
    const g = geo;
    if (!g || !g.bus || head < g.bus.y) {
      if (particles.length) particles = [];
      return;
    }
    const period = 3.4;
    const fall = g.small ? 160 : 240;
    const out = [];
    for (const l of laneList) {
      const lx = g.laneX[l.key];
      const hx = g.bus.x - 8 - lx;
      const total = hx + fall;
      for (let k = 0; k < 2; k++) {
        const p = (pt / period + l.index * 0.13 + k * 0.5) % 1;
        const d = p * total;
        const onBus = d < hx;
        const x = onBus ? g.bus.x - 8 - d : lx;
        const y = onBus ? g.bus.y : g.bus.y + (d - hx);
        out.push({
          id: l.key + k,
          x,
          y,
          o: Math.min(1, p * 10) * (1 - smooth(0.72, 1, p)),
          color: laneColor(l.key),
        });
      }
    }
    particles = out;
  }

  onMount(() => {
    measure();
    if (geo && !reduced) head = geo.startY;
    kick();

    const ro = new ResizeObserver(() => {
      measure();
      kick();
    });
    ro.observe(container);
    const onScroll = () => kick();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    document.fonts?.ready.then(() => {
      measure();
      kick();
    });

    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
      raf = 0;
    };
  });

  // Reduced motion: the whole graph is drawn, no head, no particles.
  $effect(() => {
    if (reduced) {
      cancelAnimationFrame(raf);
      raf = 0;
      head = H;
    } else if (geo) {
      kick();
    }
  });

  $effect(() => {
    if (reduced) {
      particles = [];
      return;
    }
    const el = container.querySelector('[data-section="memory"]');
    if (!el) return;
    return animationLoop(el, particleTick);
  });

  let catchRaf = 0;
  $effect(() => {
    const isPending = pending;
    const g = geo;
    if (!g) return;
    untrack(() => {
      cancelAnimationFrame(catchRaf);
      if (isPending) {
        authLimit = g.permY;
        return;
      }
      if (authLimit === Infinity) return;
      const from = authLimit;
      const to = Math.max(from, head);
      const dur = reduced ? 0 : 1100;
      const t0 = performance.now();
      const run = (now) => {
        const u = dur ? Math.min(1, (now - t0) / dur) : 1;
        authLimit = from + (to - from) * (1 - Math.pow(1 - u, 3));
        if (u < 1) catchRaf = requestAnimationFrame(run);
        else authLimit = Infinity;
      };
      catchRaf = requestAnimationFrame(run);
    });
    return () => cancelAnimationFrame(catchRaf);
  });

  const groundP = $derived(geo ? clamp((head - geo.groundY) / 110, 0, 1) : 0);

  $effect(() => {
    if (groundP >= 1 && !reached) reached = true;
  });

  const heads = $derived.by(() => {
    if (!geo || reduced) return [];
    const out = [];
    for (const l of laneList) {
      const start = l.key === 'main' ? geo.startY : geo.forkY;
      const end = l.key === 'main' ? geo.groundY - geo.r : geo.merge[l.key];
      const hy = l.key === 'auth' ? Math.min(head, authLimit) : head;
      if (l.key === 'auth' && pending && head > geo.permY) continue;
      if (hy <= start + 2 || hy >= end - 1) continue;
      const x = xAt(l.key, hy);
      if (x == null) continue;
      const pts = [];
      for (let y = Math.max(start, hy - 96); y <= hy; y += 6) {
        const tx = xAt(l.key, y);
        if (tx != null) pts.push(`${tx.toFixed(1)},${y.toFixed(1)}`);
      }
      pts.push(`${x.toFixed(1)},${hy.toFixed(1)}`);
      out.push({ key: l.key, x, y: hy, trail: pts.join(' '), color: laneColor(l.key, hy) });
    }
    return out;
  });

  const branchPaths = $derived(
    geo
      ? [
          { key: 'authA', lane: 'auth', d: geo.paths.authA },
          { key: 'api', lane: 'api', d: geo.paths.api },
          { key: 'fix', lane: 'fix', d: geo.paths.fix },
        ]
      : [],
  );
</script>

<svg
  class="git-graph"
  width={W}
  height={H}
  viewBox="0 0 {W || 1} {H || 1}"
  aria-hidden="true"
  focusable="false"
>
  {#if geo}
    <defs>
      <clipPath id="bx-reveal">
        <rect x="0" y="0" width={W} height={Math.max(0, head)} />
      </clipPath>
      <clipPath id="bx-reveal-auth">
        <rect x="0" y="0" width={W} height={Math.max(0, Math.min(head, authLimit))} />
      </clipPath>
      <linearGradient id="bx-main-fade" gradientUnits="userSpaceOnUse" x1="0" y1={geo.startY} x2="0" y2={geo.startY + 150}>
        <stop offset="0" stop-color={lanes.main.stroke} stop-opacity="0" />
        <stop offset="1" stop-color={lanes.main.stroke} stop-opacity="1" />
      </linearGradient>
      {#each heads as h (h.key)}
        <linearGradient id="bx-trail-{h.key}" gradientUnits="userSpaceOnUse" x1="0" y1={h.y - 96} x2="0" y2={h.y}>
          <stop offset="0" stop-color={h.color} stop-opacity="0" />
          <stop offset="1" stop-color={h.color} stop-opacity="0.9" />
        </linearGradient>
      {/each}
      <filter id="bx-glow" x="-300%" y="-300%" width="700%" height="700%">
        <feGaussianBlur stdDeviation="4" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <!-- Ghost of the whole graph: shows where the log goes before it draws -->
    <g class="ghost" fill="none" stroke-width="1.5" opacity="0.2">
      <path d={geo.paths.main} stroke="url(#bx-main-fade)" />
      <path d={geo.paths.ground} stroke={lanes.main.stroke} />
      <path d={geo.paths.authB} stroke={lanes.auth.stroke} />
      {#each branchPaths as p (p.key)}
        <path d={p.d} stroke={lanes[p.lane].stroke} />
      {/each}
    </g>

    <!-- feat/auth after the permission node: drawn only once it is answered -->
    <g fill="none" clip-path="url(#bx-reveal-auth)">
      <path d={geo.paths.authB} stroke={lanes.auth.stroke} stroke-width="6" opacity="0.14" />
      <path d={geo.paths.authB} stroke={lanes.auth.stroke} stroke-width="2" />
    </g>
    {#if pending && head >= geo.permY}
      <line
        class="waiting"
        x1={geo.laneX.auth}
        y1={geo.permY + geo.node}
        x2={geo.laneX.auth}
        y2={geo.permY + geo.node + 64}
        stroke={AMBER}
        stroke-width="2"
        stroke-dasharray="6 6"
        opacity="0.8"
      />
    {/if}

    <!-- Live graph, revealed down to the draw head -->
    <g fill="none" clip-path="url(#bx-reveal)">
      <path d={geo.paths.main} stroke="url(#bx-main-fade)" stroke-width="6" opacity="0.12" />
      {#each branchPaths as p (p.key)}
        <path d={p.d} stroke={lanes[p.lane].stroke} stroke-width="6" opacity="0.14" />
      {/each}
      <path d={geo.paths.main} stroke="url(#bx-main-fade)" stroke-width="2" />
      {#each branchPaths as p (p.key)}
        <path d={p.d} stroke={lanes[p.lane].stroke} stroke-width="2" />
      {/each}
    </g>

    <!-- Main runs sideways into the tree's roots at the very end -->
    <path
      d={geo.paths.ground}
      fill="none"
      stroke={lanes.main.stroke}
      stroke-width="2"
      pathLength="1"
      stroke-dasharray="1 1"
      stroke-dashoffset={1 - groundP}
    />

    <!-- Memory feed line -->
    {#if geo.bus}
      <line
        x1={geo.laneX.main}
        y1={geo.bus.y}
        x2={geo.bus.x - 8}
        y2={geo.bus.y}
        stroke={lanes.main.stroke}
        stroke-width="1"
        stroke-dasharray="2 5"
        opacity={head >= geo.bus.y ? 0.5 : 0.15}
      />
    {/if}

    <!-- Commit nodes and row connectors -->
    {#each geo.nodes as n (n.id)}
      {@const passed = head >= n.y - 1}
      {@const isPending = n.id === 'permission' && pending}
      {@const color = isPending ? AMBER : lanes[n.lane].stroke}
      {@const s = n.kind === 'merge' ? geo.node + 4 : geo.node}
      {#if n.cx != null}
        <line
          x1={n.x + s / 2 + 4}
          y1={n.y}
          x2={n.cx}
          y2={n.y}
          stroke={color}
          stroke-width="1.5"
          stroke-dasharray="2 4"
          opacity={passed ? 0.75 : 0.22}
        />
      {/if}
      <g class="node" class:pending={isPending} transform="translate({n.x} {n.y})">
        {#if isPending}
          <rect class="ring" x={-s} y={-s} width={s * 2} height={s * 2} fill="none" stroke={AMBER} stroke-width="1.5" />
        {/if}
        <rect
          x={-s / 2}
          y={-s / 2}
          width={s}
          height={s}
          fill="var(--color-background)"
          stroke={color}
          stroke-width="1.5"
          stroke-opacity={passed ? 1 : 0.4}
        />
        {#if passed}
          <rect class="fill" x={-s / 2} y={-s / 2} width={s} height={s} fill={color} />
          {#if n.kind === 'merge' && n.merges && !(n.merges === 'auth' && pending)}
            <rect class="fill" x={-s / 4} y={-s / 4} width={s / 2} height={s / 2} fill={lanes[n.merges].stroke} />
          {/if}
        {/if}
      </g>
    {/each}

    <!-- Memory particles -->
    {#each particles as p (p.id)}
      <rect x={p.x - 2.5} y={p.y - 2.5} width="5" height="5" fill={p.color} opacity={p.o} filter="url(#bx-glow)" />
    {/each}

    <!-- Draw heads -->
    {#each heads as h (h.key)}
      <polyline points={h.trail} fill="none" stroke="url(#bx-trail-{h.key})" stroke-width="3" />
      <rect x={h.x - 5} y={h.y - 5} width="10" height="10" fill={h.color} filter="url(#bx-glow)" class="head" />
      <rect x={h.x - 2} y={h.y - 2} width="4" height="4" fill="#fff" />
    {/each}
  {/if}
</svg>

<style>
  .git-graph {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    pointer-events: none;
    overflow: visible;
  }

  .node .fill {
    transform-box: fill-box;
    transform-origin: center;
    animation: bx-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  @keyframes bx-pop {
    from {
      transform: scale(0.1);
    }
    to {
      transform: scale(1);
    }
  }

  .node.pending .ring {
    transform-box: fill-box;
    transform-origin: center;
    animation: bx-ring 1.4s ease-out infinite;
  }
  @keyframes bx-ring {
    from {
      transform: scale(0.5);
      opacity: 1;
    }
    to {
      transform: scale(1.4);
      opacity: 0;
    }
  }

  .waiting {
    animation: bx-dash 0.9s linear infinite;
  }
  @keyframes bx-dash {
    to {
      stroke-dashoffset: -12;
    }
  }

  .head {
    animation: bx-head 1.2s ease-in-out infinite;
  }
  @keyframes bx-head {
    50% {
      opacity: 0.6;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .node .fill,
    .node.pending .ring,
    .waiting,
    .head {
      animation: none;
    }
  }
</style>
