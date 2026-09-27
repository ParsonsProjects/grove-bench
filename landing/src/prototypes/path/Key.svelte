<script>
  // The key to the metaphor: tree, character, lamp.
  import { treeGreens } from '../shared/brand.js';
  import { C, statusHex } from '../grove/palette.js';
  import { FRONT_ROWS } from './sprites.js';
  import { AGENTS } from './data.js';

  /** @type {{ class?: string, title?: boolean }} */
  let { class: className = '', title = true } = $props();

  const look = AGENTS[0].look;
  const colours = { h: look.hair, s: C.skin, S: C.skinShade, e: '#1e1e1e', b: look.hoodie, B: look.hoodie, p: C.pants, f: C.shoes };
  const agentRects = FRONT_ROWS.flatMap((row, y) =>
    [...row].flatMap((ch, x) => (ch === '.' || !colours[ch] ? [] : [{ x, y, fill: colours[ch] }])),
  );
</script>

<div class="key {className}">
  {#if title}<p class="title">Key</p>{/if}
  <ul>
    <li>
      <svg class="icon" viewBox="0 0 21 24" width="18" height="21" aria-hidden="true" shape-rendering="crispEdges">
        {#each treeGreens as p}<rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />{/each}
      </svg>
      <span><b>Tree</b> a git worktree on its own branch</span>
    </li>
    <li>
      <svg class="icon" viewBox="0 0 9 15" width="12" height="20" aria-hidden="true" shape-rendering="crispEdges">
        {#each agentRects as r}<rect x={r.x} y={r.y} width="1" height="1" fill={r.fill} />{/each}
      </svg>
      <span><b>Character</b> one AI conversation, with its own terminal</span>
    </li>
    <li>
      <span class="icon lamps" aria-hidden="true">
        <i style="background: {statusHex.working}"></i>
        <i style="background: {statusHex.permission}"></i>
        <i style="background: {statusHex.ready}"></i>
      </span>
      <span>
        <b>Lamp</b> status:
        <span class="st" style="--c: #7fb2ff">blue</span> working,
        <span class="st" style="--c: {statusHex.permission}">amber</span> needs you,
        <span class="st" style="--c: {statusHex.ready}">green</span> ready
      </span>
    </li>
  </ul>
</div>

<style>
  .key {
    --edge: #0b1224;
    padding: 10px 14px 12px;
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
    font-size: 14px;
    line-height: 1.3;
    color: #dfe5f2;
    background: rgb(11 18 36 / 0.9);
    box-shadow:
      inset 0 0 0 1px rgb(217 223 240 / 0.2),
      0 -3px 0 0 var(--edge),
      0 3px 0 0 var(--edge),
      -3px 0 0 0 var(--edge),
      3px 0 0 0 var(--edge);
  }
  .title {
    margin-bottom: 8px;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #93a0c0;
  }
  ul {
    display: grid;
    gap: 8px;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: 26px 1fr;
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
</style>
