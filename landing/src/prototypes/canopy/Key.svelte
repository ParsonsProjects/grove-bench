<script>
  // The key to the metaphor. Shown in the hero, and always one click away
  // from the button in the corner.
  import { SITTING } from '../grove/sprites.js';
  import { C, looks, statusHex } from '../grove/palette.js';

  /** @type {{ class?: string, id?: string, title?: boolean }} */
  let { class: className = '', id, title = true } = $props();

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
  const agentRects = SITTING.flatMap((row, y) =>
    [...row].flatMap((ch, x) => (ch === '.' || !colours[ch] ? [] : [{ x: x + 3, y, fill: colours[ch] }])),
  );
</script>

<div class="key {className}" {id}>
  {#if title}<p class="title">Key</p>{/if}
  <ul>
    <li>
      <svg class="icon" viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" shape-rendering="crispEdges">
        <rect x="6" y="0" width="5" height="16" fill="#8a6a4a" />
        <rect x="6" y="0" width="1" height="16" fill="#a88a6a" />
        <rect x="10" y="0" width="1" height="16" fill="#6a5040" />
        <rect x="8" y="0" width="1" height="16" fill="#6aa8ff" />
      </svg>
      <span><b>Limb</b> a git worktree on its own branch</span>
    </li>
    <li>
      <svg class="icon" viewBox="0 0 15 16" width="19" height="20" aria-hidden="true" shape-rendering="crispEdges">
        {#each agentRects as r}<rect x={r.x} y={r.y} width="1" height="1" fill={r.fill} />{/each}
      </svg>
      <span><b>Agent</b> one AI conversation, with its own terminal</span>
    </li>
    <li>
      <span class="icon lamps" aria-hidden="true">
        <i style="background: {statusHex.working}"></i>
        <i style="background: {statusHex.permission}"></i>
        <i style="background: {statusHex.ready}"></i>
      </span>
      <span>
        <b>Lamp</b> status:
        <span class="st" style="--c: #6aa8ff">blue</span> working,
        <span class="st" style="--c: {statusHex.permission}">amber</span> needs you,
        <span class="st" style="--c: {statusHex.ready}">green</span> ready
      </span>
    </li>
    <li>
      <svg class="icon" viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" shape-rendering="crispEdges">
        <rect x="3" y="0" width="10" height="16" fill="#8a6a4a" />
        <rect x="3" y="0" width="1" height="16" fill="#a88a6a" />
        <rect x="12" y="0" width="1" height="16" fill="#6a5040" />
      </svg>
      <span><b>Trunk</b> main</span>
    </li>
  </ul>
</div>

<style>
  .key {
    --edge: #0b1224;
    padding: 9px 12px 11px;
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
    font-size: 14px;
    line-height: 1.3;
    color: #dfe5f2;
    background: rgb(11 18 36 / 0.9);
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
    grid-template-columns: 24px 1fr;
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
    width: 5px;
    height: 9px;
    box-shadow: 0 0 0 1px #0b1224;
  }
  .st {
    color: var(--c);
    font-weight: 700;
  }
</style>
