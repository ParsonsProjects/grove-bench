<script>
  // The key to the metaphor: what a tree, an agent on a bench and a lamp mean.
  import { treeGreens } from '../shared/brand.js';
  import { SITTING } from './sprites.js';
  import { C, looks, statusHex } from './palette.js';

  /** @type {{ class?: string, compact?: boolean }} */
  let { class: className = '', compact = false } = $props();

  const look = looks[0];
  const colours = {
    h: look.hair,
    s: C.skin,
    S: C.skinShade,
    e: '#1e1e1e',
    b: look.hoodie,
    B: look.hoodie,
    l: C.laptop,
    L: C.laptopEdge,
    g: C.primaryLight,
    p: C.pants,
    f: C.shoes,
  };
  // Agent sprite as rects, offset to sit on a little bench.
  const agentRects = SITTING.flatMap((row, y) =>
    [...row].flatMap((ch, x) => (ch === '.' || !colours[ch] ? [] : [{ x: x + 8, y, fill: colours[ch] }])),
  );
</script>

<aside class="legend {className}" class:compact aria-label="Key to the grove">
  {#if !compact}<p class="title">Key</p>{/if}
  <ul>
    <li>
      <svg class="icon" viewBox="0 0 21 24" width="18" height="21" aria-hidden="true" shape-rendering="crispEdges">
        {#each treeGreens as p}<rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />{/each}
      </svg>
      <span><b>Tree</b> {compact ? 'git worktree on its own branch' : 'a git worktree on its own branch'}</span>
    </li>
    <li>
      <svg class="icon" viewBox="0 0 25 16" width="25" height="16" aria-hidden="true" shape-rendering="crispEdges">
        <rect x="1" y="3" width="23" height="2" fill={C.wood} />
        <rect x="1" y="6" width="23" height="2" fill={C.wood} />
        <rect x="0" y="10" width="25" height="2" fill={C.woodPale} />
        <rect x="2" y="12" width="2" height="4" fill={C.woodDark} />
        <rect x="21" y="12" width="2" height="4" fill={C.woodDark} />
        <g transform="translate(0 -1)">
          {#each agentRects as r}<rect x={r.x} y={r.y} width="1" height="1" fill={r.fill} />{/each}
        </g>
      </svg>
      {#if compact}
        <span><b>Agent</b> AI conversation with its own terminal</span>
      {:else}
        <span><b>Agent on a bench</b> one AI conversation, with its own terminal</span>
      {/if}
    </li>
    <li>
      <span class="icon lamps" aria-hidden="true">
        <i style="background: {statusHex.working}"></i>
        <i style="background: {statusHex.permission}"></i>
        <i style="background: {statusHex.ready}"></i>
      </span>
      {#if compact}
        <span>
          <b>Lamp</b>
          <span class="st" style="--c: #5aa0ff">working</span>,
          <span class="st" style="--c: {statusHex.permission}">needs you</span>,
          <span class="st" style="--c: {statusHex.ready}">ready</span>
        </span>
      {:else}
        <span>
          <b>Lamp</b> status:
          <span class="st" style="--c: #5aa0ff">blue</span> working,
          <span class="st" style="--c: {statusHex.permission}">amber</span> needs you,
          <span class="st" style="--c: {statusHex.ready}">green</span> ready
        </span>
      {/if}
    </li>
  </ul>
</aside>

<style>
  .legend {
    --edge: #0b1224;
    padding: 8px 12px 10px;
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
    font-size: 13px;
    line-height: 1.3;
    color: #dfe5f2;
    background: rgb(11 18 36 / 0.86);
    box-shadow:
      inset 0 0 0 1px rgb(217 223 240 / 0.18),
      0 -3px 0 0 var(--edge),
      0 3px 0 0 var(--edge),
      -3px 0 0 0 var(--edge),
      3px 0 0 0 var(--edge);
  }
  .title {
    margin-bottom: 6px;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #93a0c0;
  }
  ul {
    display: grid;
    gap: 7px;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: 28px 1fr;
    align-items: center;
    gap: 8px;
  }
  .icon {
    justify-self: center;
    image-rendering: pixelated;
  }
  b {
    font-weight: 700;
    color: #f4ecdd;
  }
  .lamps {
    display: flex;
    gap: 3px;
  }
  .lamps i {
    width: 6px;
    height: 9px;
    box-shadow: 0 0 0 1px #0b1224;
  }
  .st {
    color: var(--c);
    font-weight: 700;
  }
  .compact {
    padding: 5px 10px 6px;
    font-size: 12px;
    line-height: 1.2;
  }
  .compact ul {
    gap: 3px;
  }
  .compact li {
    grid-template-columns: 26px 1fr;
    gap: 6px;
  }
</style>
