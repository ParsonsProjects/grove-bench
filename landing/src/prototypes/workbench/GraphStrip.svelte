<script>
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { prefersReducedMotion } from '../shared/motion.js';
  import { statusColors } from '../shared/brand.js';

  /** @type {{ sim: import('./sim.svelte.js').Sim, compact?: boolean }} */
  let { sim, compact = false } = $props();

  let width = $state(900);

  const S = $derived(compact ? 18 : 26); // px per slot
  const LABEL = $derived(compact ? 132 : 176); // room for branch names at the head
  const PAD = 12;
  const Y0 = 16;
  const ROW = 18;
  const H = Y0 + 4 * ROW + 14;
  const MAIN = 'oklch(0.62 0 0)';

  const head = Tween.of(() => sim.graph.head, { duration: prefersReducedMotion.current ? 0 : 520, easing: cubicOut });

  /** @param {number} slot */
  const X = (slot) => PAD + (slot + 4) * S;
  /** @param {number} row */
  const Y = (row) => Y0 + (row + 1) * ROW;

  const hx = $derived(X(head.current));
  const offset = $derived(Math.max(0, hx - (width - LABEL)));
  const lanes = $derived(sim.graph.lanes);
  const active = $derived(lanes.filter((l) => l.to === null));
  const laneById = $derived(new Map(lanes.map((l) => [l.id, l])));

  /** @param {any} l */
  const startX = (l) => X(l.from) + S;
  /** @param {any} l */
  const tipX = (l) => Math.max(startX(l), hx);
  /** @param {any} l */
  const endX = (l) => (l.to === null ? tipX(l) : l.closed ? X(l.to) : X(l.to) - S);
  /** @param {any} l */
  const branchPath = (l) => {
    const x0 = X(l.from);
    const x1 = x0 + S;
    const y = Y(l.row);
    return `M${x0} ${Y0} C${x0 + S * 0.55} ${Y0} ${x1 - S * 0.55} ${y} ${x1} ${y}`;
  };
  /** @param {any} l */
  const mergePath = (l) => {
    const x1 = X(l.to);
    const x0 = x1 - S;
    const y = Y(l.row);
    return `M${x0} ${y} C${x0 + S * 0.55} ${y} ${x1 - S * 0.55} ${Y0} ${x1} ${Y0}`;
  };
  /** @param {number} laneId */
  const statusOf = (laneId) => sim.panes.find((p) => p.laneId === laneId)?.status ?? 'ready';

  const label = $derived(
    `Git graph. main with ${active.length} ${active.length === 1 ? 'branch' : 'branches'} in progress` +
      (active.length ? `: ${active.map((l) => l.label).join(', ')}` : '') +
      `. ${sim.trees} merged so far.`,
  );

  /** @param {Element} node */
  function shrink(node) {
    return {
      duration: prefersReducedMotion.current ? 0 : 320,
      css: (/** @type {number} */ t) => `transform: scale(${t}); opacity: ${t}`,
    };
  }
</script>

<div class="graph" bind:clientWidth={width}>
  <svg {width} height={H} viewBox="0 0 {width} {H}" role="img" aria-label={label}>
    <g transform="translate({-offset} 0)">
      <!-- main -->
      <line x1={-S} y1={Y0} x2={hx} y2={Y0} stroke={MAIN} stroke-width="2" />

      {#each lanes as l (l.id)}
        <g style="--lane: {l.color}">
          <path class="draw" d={branchPath(l)} pathLength="1" fill="none" stroke={l.color} stroke-width="2" />
          <line x1={startX(l)} y1={Y(l.row)} x2={endX(l)} y2={Y(l.row)} stroke={l.color} stroke-width="2" />
          {#if l.to !== null && !l.closed}
            <path class="draw" d={mergePath(l)} pathLength="1" fill="none" stroke={l.color} stroke-width="2" />
          {:else if l.closed}
            <rect x={X(l.to) - 4} y={Y(l.row) - 4} width="8" height="8" fill="var(--color-sidebar)" stroke={l.color} stroke-width="1.5" />
          {/if}
        </g>
      {/each}

      {#each sim.graph.dots as d (d.id)}
        {#if d.kind === 'merge'}
          <g transform="translate({X(d.slot)} {Y0})">
            <rect class="ring" x="-8" y="-8" width="16" height="16" fill="none" stroke={d.color} stroke-width="1.5" />
            <rect class="pop" x="-5" y="-5" width="10" height="10" fill={d.color} />
          </g>
        {:else if d.lane === null}
          <rect x={X(d.slot) - 3.5} y={Y0 - 3.5} width="7" height="7" fill={MAIN} />
        {:else if laneById.get(d.lane)}
          {@const l = laneById.get(d.lane)}
          <rect class="pop" x={X(d.slot) - 3.5} y={Y(l.row) - 3.5} width="7" height="7" fill={l.color} out:shrink />
        {/if}
      {/each}

      <!-- heads and labels -->
      <text x={hx + 12} y={Y0 + 4} class="lbl main">main</text>
      {#each active as l (l.id)}
        {@const st = statusOf(l.id)}
        <rect
          class="tip"
          class:pulse={st !== 'ready'}
          x={tipX(l) - 4}
          y={Y(l.row) - 4}
          width="8"
          height="8"
          fill={statusColors[st]}
        />
        <text x={tipX(l) + 12} y={Y(l.row) + 4} class="lbl" fill={l.color}>{l.label}</text>
      {/each}
    </g>
  </svg>
</div>

<style>
  .graph {
    position: relative;
    width: 100%;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 64px);
    mask-image: linear-gradient(90deg, transparent 0, #000 64px);
  }
  svg {
    display: block;
  }
  .lbl {
    font-size: 11px;
    font-family: inherit;
  }
  .lbl.main {
    fill: oklch(0.7 0 0);
  }
  .draw {
    stroke-dasharray: 1;
    animation: draw 0.5s ease-out both;
  }
  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  .pop,
  .ring,
  .tip {
    transform-box: fill-box;
    transform-origin: center;
  }
  .pop {
    animation: pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  @keyframes pop {
    from {
      transform: scale(0);
    }
    to {
      transform: scale(1);
    }
  }
  .ring {
    opacity: 0;
    animation: ring 0.8s ease-out both;
  }
  @keyframes ring {
    from {
      opacity: 1;
      transform: scale(0.6);
    }
    to {
      opacity: 0;
      transform: scale(2.4);
    }
  }
  .pulse {
    animation: tip 1.4s ease-in-out infinite;
  }
  @keyframes tip {
    50% {
      opacity: 0.4;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .draw,
    .pop,
    .pulse {
      animation: none;
    }
    .ring {
      display: none;
    }
  }
</style>
