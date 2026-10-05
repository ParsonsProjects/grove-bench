<script>
  import Tree from '../shared/Tree.svelte';
  import BenchSeat from '../shared/BenchSeat.svelte';
  import Chips from '../shared/app/Chips.svelte';
  import Row from '../shared/app/Row.svelte';
  import '../shared/app/app.css';
  import '../sections/day.css';
  import { treeGreens } from '../lib/brand.js';
  import { heroWorld } from '../sections/heroWorld.js';

  /**
   * The share image (public/og-image.png), 1200x630: the page's opening line
   * beside the trail, and the app's sidebar with the sample conversations.
   */
  const convs = heroWorld().convs;
  const TREES = [
    { y: 150, side: -1, s: 4, tint: null },
    { y: 270, side: 1, s: 3, tint: '#3b82f6' },
    { y: 520, side: 1, s: 4, tint: null },
    { y: 600, side: -1, s: 3, tint: '#f59e0b' },
  ];
</script>

<div class="og day">
  <div class="trail" aria-hidden="true">
    <div class="path"></div>
    {#each TREES as t}
      <span class="tree" style="top: {t.y}px; --side: {t.side}"><Tree scale={t.s} tint={t.tint} /></span>
    {/each}
    <span class="bench"><BenchSeat state="working" seed="a3f8b2c1" scale={5} still label="" /></span>
  </div>

  <div class="copy">
    <p class="brand">
      <svg width="27" height="30" viewBox="0 0 21 24" aria-hidden="true">{#each treeGreens as p}<rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />{/each}</svg>
      grove bench
    </p>
    <h1 class="h1 prompt"><span class="gt">&gt;</span>Plant a task.<br />Grow a branch.<span class="caret"></span></h1>
    <p class="lede">Run several AI coding agents on one project at once. Each gets its own git worktree, branch and terminal.</p>
    <p class="meta">Free · Windows 10 or later · Source-available</p>
  </div>

  <div class="gb card">
    <div class="chips"><Chips states={convs.map((c) => c.state)} /></div>
    <p class="sec">Threads</p>
    {#each convs as c (c.id)}<Row {c} selected={c.state === 'permission'} />{/each}
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
  }
  .og {
    position: relative;
    width: 1200px;
    height: 630px;
    overflow: hidden;
    background: linear-gradient(var(--c0), var(--c2) 70%, var(--c3));
  }
  .trail {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 44px;
    width: 120px;
  }
  .path {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(50% - 12px);
    width: 25px;
    background: #a8845e;
    box-shadow:
      inset 4px 0 0 #8a6a4a,
      inset -4px 0 0 #8a6a4a;
    opacity: 0.85;
  }
  .tree {
    position: absolute;
    left: 50%;
    transform: translate(calc(-50% + var(--side) * 52px), -100%);
  }
  .bench {
    position: absolute;
    top: 420px;
    left: 50%;
    transform: translate(-42%, -100%);
  }
  .copy {
    position: absolute;
    top: 84px;
    left: 200px;
    width: 560px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.04em;
  }
  .h1 {
    margin-top: 44px;
    font-size: 56px;
    white-space: nowrap;
  }
  .lede {
    max-width: 30ch;
    margin-top: 30px;
    font-size: 22px;
    line-height: 1.5;
  }
  .meta {
    margin-top: 26px;
    font-size: 17px;
    color: var(--green-ink);
  }
  .card {
    position: absolute;
    top: 118px;
    right: 44px;
    width: 300px;
    padding: 6px 0 8px;
    zoom: 1.2;
    background: var(--side);
    box-shadow:
      0 0 0 1px rgb(58 42 28 / 0.2),
      0 30px 60px -20px rgb(58 42 28 / 0.5);
  }
  .card .chips {
    padding: 8px 12px 4px;
  }
  .sec {
    padding: 8px 12px 4px;
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted-fg);
  }
</style>
