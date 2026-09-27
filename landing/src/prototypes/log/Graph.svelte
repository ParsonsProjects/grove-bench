<script>
  import { onMount, untrack } from 'svelte';
  import { lanes, laneList, status as lampStatus } from './lanes.js';
  import { story } from './story.svelte.js';
  import { clamp, laneRects, laneXAt, rectsPath, todAt } from './graph.js';

  /**
   * The git graph in the left gutter, drawn in pixels. Lanes are built from
   * `[data-anchor]` elements inside `container`. The graph is revealed down
   * to a draw head that is a pure function of the scroll position, and the
   * time of day for every scene is worked out here from `[data-tod]` scenes.
   * feat/api stops at the permission node until the visitor answers.
   *
   * @type {{ container: HTMLElement, reduced?: boolean }}
   */
  let { container, reduced = false } = $props();

  let W = $state(0);
  let H = $state(0);
  /** @type {any} */
  let geo = $state(null);
  // Catch-up after the permission prompt is answered (time based, forward only).
  let apiLimit = $state(Infinity);

  const pending = $derived(story.permission === 'pending');

  function measure() {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cs = getComputedStyle(container);
    const gap = parseFloat(cs.getPropertyValue('--lane-gap')) || 24;
    const x0 = parseFloat(cs.getPropertyValue('--lane-x0')) || 16;
    const P = parseFloat(cs.getPropertyValue('--graph-px')) || 3;
    const wrap = container.querySelector('.lg-wrap');
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const railLeft = wr.left - rect.left + parseFloat(getComputedStyle(wrap).paddingLeft);
    const snapC = (v) => Math.round((v - P / 2) / P) * P + P / 2;
    const snapY = (v) => Math.round(v / P) * P;

    /** @type {Record<string, number>} */
    const laneX = {};
    for (const l of laneList) laneX[l.key] = snapC(railLeft + x0 + l.index * gap);

    const anchors = [];
    for (const el of container.querySelectorAll('[data-anchor]')) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      const d = /** @type {HTMLElement} */ (el).dataset;
      anchors.push({
        id: d.anchor,
        lanes: (d.lanes ?? d.lane ?? 'main').split(','),
        kind: d.kind || 'header',
        status: d.status || 'neutral',
        merges: d.merges,
        left: r.left - rect.left,
        top: r.top - rect.top,
        height: r.height,
      });
    }
    const find = (id) => anchors.find((a) => a.id === id);
    const mid = (a) => snapY(a.top + a.height / 2);
    const hero = find('hero');
    const fork = find('fork');
    const ground = anchors.find((a) => a.kind === 'ground');
    if (!hero || !fork || !ground) return;

    const small = gap < 14;
    const dy = snapY(Math.max(48, gap * 2.6));
    const mx = laneX.main;
    const startY = mid(hero);
    const forkY = mid(fork);
    const groundY = mid(ground);
    const groundX = Math.max(mx + P * 4, snapC(ground.left));

    /** @type {Record<string, number>} */
    const merge = {};
    for (const a of anchors) if (a.kind === 'merge' && a.merges) merge[a.merges] = mid(a);
    for (const key of ['auth', 'api', 'fix']) merge[key] ??= groundY - 200;
    const perm = find('permission');
    const permY = perm ? mid(perm) : merge.api - dy;

    const branches = ['auth', 'api', 'fix'].map((key) => ({
      key,
      d: rectsPath(laneRects(mx, laneX[key], forkY, merge[key], dy, P)),
    }));
    const mainD = rectsPath([[mx - P / 2, startY, P, groundY - startY + P]]);

    const nodes = [];
    for (const a of anchors) {
      if (a.kind === 'header' || a.kind === 'row') {
        a.lanes.forEach((lane, i) => {
          const x = laneX[lane] ?? mx;
          const last = i === a.lanes.length - 1;
          nodes.push({
            id: `${a.id}:${lane}`,
            anchor: a.id,
            lane,
            kind: a.kind,
            status: a.status,
            x,
            y: mid(a),
            cx: last && a.left - 12 > x + P * 4 ? a.left - (small ? 6 : 12) : null,
          });
        });
      } else if (a.kind === 'merge') {
        nodes.push({ id: a.id, anchor: a.id, lane: 'main', kind: 'merge', merges: a.merges, status: 'ready', x: mx, y: mid(a), cx: null });
      }
    }

    // Time of day keys: the centre of every scene, in page order.
    const todKeys = [...container.querySelectorAll('[data-tod]')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return [r.top - rect.top + r.height / 2, parseFloat(/** @type {HTMLElement} */ (el).dataset.tod)];
      })
      .filter(([, t]) => Number.isFinite(t))
      .sort((a, b) => a[0] - b[0]);
    // Guard the one-way rule even if a key is out of order.
    for (let i = 1; i < todKeys.length; i++) todKeys[i][1] = Math.max(todKeys[i][1], todKeys[i - 1][1]);

    W = rect.width;
    H = rect.height;
    geo = { P, laneX, dy, startY, forkY, merge, permY, groundY, groundX, branches, mainD, nodes, todKeys, small, mx };
    story.marks = {
      fork: forkY,
      permission: permY,
      'merge-auth': merge.auth,
      'merge-api': merge.api,
      'merge-fix': merge.fix,
      ground: groundY,
    };
    update();
  }

  // Scroll-driven values. Pure functions of the scroll position.
  function update() {
    if (!container || !geo) return;
    const rect = container.getBoundingClientRect();
    const vh = window.innerHeight;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    // Near the bottom the head speeds up so the graph always finishes.
    const nearEnd = clamp((window.scrollY - (maxScroll - vh * 0.8)) / (vh * 0.8), 0, 1);
    const top = -rect.top;
    story.head = reduced ? H : top + vh * (0.62 + 0.36 * nearEnd);
    story.tod = todAt(geo.todKeys, top + vh * (0.5 + 0.5 * nearEnd));
    story.apiHead = Math.min(story.head, apiLimit);
  }

  let raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      update();
    });
  }

  onMount(() => {
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    const onLayout = () => measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', onLayout);
    window.addEventListener('log:layout', onLayout);
    document.fonts?.ready.then(() => measure());
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('log:layout', onLayout);
      cancelAnimationFrame(raf);
    };
  });

  $effect(() => {
    reduced;
    untrack(update);
  });

  // feat/api waits at the permission node; once answered it catches up.
  let catchRaf = 0;
  $effect(() => {
    const isPending = pending;
    const g = geo;
    if (!g) return;
    untrack(() => {
      cancelAnimationFrame(catchRaf);
      if (isPending) {
        apiLimit = g.permY;
        update();
        return;
      }
      if (apiLimit === Infinity) return;
      const from = apiLimit;
      const dur = reduced ? 0 : 1200;
      const t0 = performance.now();
      const run = (now) => {
        const to = Math.max(from, story.head);
        const u = dur ? Math.min(1, (now - t0) / dur) : 1;
        apiLimit = from + (to - from) * (1 - Math.pow(1 - u, 3));
        if (u < 1) catchRaf = requestAnimationFrame(run);
        else apiLimit = Infinity;
        update();
      };
      catchRaf = requestAnimationFrame(run);
    });
    return () => cancelAnimationFrame(catchRaf);
  });

  const head = $derived(story.head);
  const apiHead = $derived(story.apiHead);
  const groundP = $derived(geo ? clamp((head - geo.groundY) / 110, 0, 1) : 0);
  const snapHead = (v) => (geo ? Math.floor(v / geo.P) * geo.P : v);

  const laneEnds = (key) => (key === 'main' ? [geo.startY, geo.groundY] : [geo.forkY, geo.merge[key]]);
  const laneHead = (key) => (key === 'api' ? apiHead : head);

  const heads = $derived.by(() => {
    if (!geo || reduced) return [];
    const out = [];
    for (const l of laneList) {
      const [a, b] = laneEnds(l.key);
      const hy = snapHead(laneHead(l.key));
      if (hy <= a + geo.P || hy >= b - geo.P) continue;
      if (l.key === 'api' && pending && hy >= geo.permY) continue;
      const x = l.key === 'main' ? geo.mx : laneXAt(geo.mx, geo.laneX[l.key], a, b, geo.dy, hy);
      if (x == null) continue;
      const cx = geo.mx + Math.round((x - geo.mx) / geo.P) * geo.P;
      out.push({ key: l.key, x: cx, y: hy, color: lanes[l.key].stroke });
    }
    return out;
  });

  function nodeStatus(n) {
    if (n.anchor === 'permission') return pending ? 'permission' : 'working';
    if (n.kind === 'merge' && n.merges === 'api' && pending) return 'off';
    return n.status;
  }
  function nodeLit(n) {
    const h = n.lane === 'api' ? apiHead : head;
    if (n.kind === 'merge' && n.merges === 'api') return !pending && apiHead >= n.y - 1 && head >= n.y - 1;
    return h >= n.y - 1;
  }

  // Lamp: 5 x 5 cells. Hook, cap, two rows of glass, base.
  const FRAME = [
    [2, 0],
    [1, 1],
    [2, 1],
    [3, 1],
    [0, 2],
    [4, 2],
    [0, 3],
    [4, 3],
    [1, 4],
    [2, 4],
    [3, 4],
  ];
  const GLASS = [
    [1, 2],
    [2, 2],
    [3, 2],
    [1, 3],
    [2, 3],
    [3, 3],
  ];
</script>

<svg
  class="graph"
  width={W}
  height={H}
  viewBox="0 0 {W || 1} {H || 1}"
  aria-hidden="true"
  focusable="false"
  shape-rendering="crispEdges"
  data-head={head.toFixed(1)}
  data-api-head={apiHead.toFixed(1)}
  data-tod={story.tod.toFixed(4)}
>
  {#if geo}
    {@const P = geo.P}
    <defs>
      <clipPath id="lg-reveal">
        <rect x="0" y="0" width={W} height={Math.max(0, snapHead(head))} />
      </clipPath>
      <clipPath id="lg-reveal-api">
        <rect x="0" y="0" width={W} height={Math.max(0, snapHead(apiHead))} />
      </clipPath>
    </defs>

    <!-- Ghost of the whole graph: where the log is going -->
    <g opacity="0.16">
      <path d={geo.mainD} fill={lanes.main.stroke} />
      {#each geo.branches as b (b.key)}
        <path d={b.d} fill={lanes[b.key].stroke} />
      {/each}
    </g>

    <!-- Live graph, revealed down to the draw head -->
    <g clip-path="url(#lg-reveal)">
      <path d={geo.mainD} fill={lanes.main.stroke} />
      {#each geo.branches as b (b.key)}
        {#if b.key !== 'api'}
          <path d={b.d} fill={lanes[b.key].stroke} />
        {/if}
      {/each}
    </g>
    <g clip-path="url(#lg-reveal-api)">
      {#each geo.branches as b (b.key)}
        {#if b.key === 'api'}
          <path d={b.d} fill={lanes.api.stroke} />
        {/if}
      {/each}
    </g>

    <!-- feat/api waits here until the prompt is answered -->
    {#if pending && head >= geo.permY}
      <g class="waiting" transform="translate({geo.laneX.api - P / 2} {geo.permY + P * 3})">
        {#each Array(12) as _, i}
          <rect x="0" y={i * P * 2} width={P} height={P} fill={lampStatus.permission.lamp} opacity={1 - i / 12} />
        {/each}
      </g>
    {/if}

    <!-- Main runs sideways into the big tree's roots at the very end -->
    {#if groundP > 0}
      <rect
        x={geo.mx + P / 2}
        y={geo.groundY}
        width={Math.max(0, Math.floor(((geo.groundX - geo.mx) * groundP) / P) * P)}
        height={P}
        fill={lanes.main.stroke}
      />
    {/if}

    <!-- Commit lamps and their dotted connectors -->
    {#each geo.nodes as n (n.id)}
      {@const lit = nodeLit(n)}
      {@const st = nodeStatus(n)}
      {@const s = lampStatus[st] ?? lampStatus.neutral}
      {@const big = n.kind === 'merge'}
      {@const u = big ? P + 1 : n.kind === 'row' ? Math.max(1, P - 1) : P}
      {#if n.cx != null}
        {#each Array(Math.max(0, Math.floor((n.cx - n.x - P * 4) / (P * 2)))) as _, i}
          <rect
            x={Math.round(n.x + P * 2.5 + i * P * 2)}
            y={Math.round(n.y - P / 2)}
            width={P}
            height={P}
            fill={lanes[n.lane].stroke}
            opacity={lit ? 0.7 : 0.22}
          />
        {/each}
      {/if}
      <g
        class="lamp"
        class:lit
        class:pulse={lit && !reduced && (st === 'working' || st === 'permission')}
        class:urgent={st === 'permission'}
        transform="translate({Math.round(n.x - u * 2.5)} {Math.round(n.y - u * 3)})"
      >
        {#if lit && st !== 'off'}
          <g class="halo" fill={s.glow}>
            <rect x={-u * 2} y={-Math.round(u / 2)} width={u * 9} height={u * 7} opacity="0.07" />
            <rect x={-u} y={Math.round(u / 2)} width={u * 7} height={u * 5} opacity="0.12" />
          </g>
        {/if}
        <g>
          {#each FRAME as [c, r]}
            <rect x={c * u} y={r * u} width={u} height={u} fill={lit ? lanes[n.lane].stroke : '#4a4a4a'} />
          {/each}
          <g class="glass">
            {#each GLASS as [c, r]}
              <rect x={c * u} y={r * u} width={u} height={u} fill={lit && st !== 'off' ? s.lamp : '#262626'} />
            {/each}
            {#if lit && st !== 'off'}
              <rect x={u} y={u * 2} width={u} height={u} fill="#ffffff" opacity="0.7" />
            {/if}
            {#if big && lit && n.merges}
              <rect x={u * 3} y={u * 3} width={u} height={u} fill={lanes[n.merges].stroke} />
            {/if}
          </g>
        </g>
      </g>
    {/each}

    <!-- Draw heads: a bright pixel spark per lane -->
    {#each heads as h (h.key)}
      <g transform="translate({Math.round(h.x - P * 2.5)} {Math.round(h.y - P * 2.5)})">
        <rect x="0" y="0" width={P * 5} height={P * 5} fill={h.color} opacity="0.18" />
        <rect x={P} y={P} width={P * 3} height={P * 3} fill={h.color} opacity="0.45" />
        <rect x={P * 2} y={P * 2} width={P} height={P} fill="#ffffff" />
      </g>
    {/each}
  {/if}
</svg>

<style>
  .graph {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    pointer-events: none;
    overflow: visible;
  }
  .lamp.lit .glass {
    animation: lamp-pop 0.36s steps(3) both;
    transform-box: fill-box;
    transform-origin: center;
  }
  @keyframes lamp-pop {
    from {
      transform: scale(0.34);
    }
  }
  .lamp.pulse .halo {
    animation: lamp-pulse 1.5s steps(3) infinite;
  }
  .lamp.pulse.urgent .halo {
    animation-duration: 1s;
  }
  @keyframes lamp-pulse {
    50% {
      opacity: 0.25;
    }
  }
  .waiting {
    animation: waiting 0.8s steps(2) infinite;
  }
  @keyframes waiting {
    50% {
      opacity: 0.45;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lamp.lit .glass,
    .lamp.pulse .halo,
    .waiting {
      animation: none;
    }
  }
</style>
