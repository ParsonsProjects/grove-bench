<script>
  import { onMount } from 'svelte';
  import Tree from '../shared/Tree.svelte';
  import BenchSeat from '../shared/BenchSeat.svelte';
  import Walker from '../shared/Walker.svelte';
  import Pixels from '../shared/Pixels.svelte';
  import ContextStrip from '../shared/ContextStrip.svelte';
  import { LAMP, SCENERY_PALETTE } from '../shared/app-art.js';
  import { SUN, SUN_COLORS } from '../day/sky.js';
  import { arrive } from '../day/scroll.svelte.js';

  /**
   * A strip of grove between two sections. Items already there stand from the
   * start; `new` ones play in when the strip scrolls into view: trees grow,
   * agents walk in to their bench and sit, lamps light.
   *
   * @type {{
   *   items: { k: 'tree' | 'bench' | 'lamp', x: number, s?: number, tint?: string, tag?: string, state?: string, id?: string, new?: boolean, from?: 'left' | 'right' }[],
   *   top: string, bottom: string, ground?: string, note?: string, sun?: boolean, height?: number,
   *   grass?: [number, number],
   * }}
   *
   * `grass` is the undergrowth along the ground, from and to, as a percent:
   * the app's context grove code, filling in a little more each strip.
   */
  let { items, top, bottom, ground = '#4aaa58', note = '', sun = false, height = 170, grass = [0, 0] } = $props();
  let grassNow = $state(grass[0]);

  const LIT = { ...SCENERY_PALETTE, o: '#ffe7a8' };
  let t = $state(0);
  let raf = 0;
  function start(reduced) {
    grassNow = grass[1];
    if (reduced) {
      t = 20;
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      t = (now - t0) / 1000;
      if (t < 20) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  onMount(() => () => cancelAnimationFrame(raf));

  // When each new item plays: trees first, one after another, then walkers.
  const newTrees = $derived(items.filter((i) => i.new && i.k === 'tree'));
  const newBenches = $derived(items.filter((i) => i.new && i.k === 'bench'));
  const treeAt = (it) => 0.2 + newTrees.indexOf(it) * 0.35;
  const walkStart = (it) => 0.4 + newTrees.length * 0.35 + newBenches.indexOf(it) * 0.45;
  const WALK = 2.2;
  const grow = (it) => (it.new ? Math.min(1, Math.max(0, (t - treeAt(it)) / 0.9)) : 1);
  function benchView(it) {
    if (!it.new) return { sit: true };
    const s = walkStart(it);
    if (t < s) return { empty: true };
    if (t < s + WALK) {
      const k = (t - s) / WALK;
      const fromX = it.from === 'right' ? 104 : -4;
      return { walk: true, x: fromX + (it.x - fromX) * k, flip: it.from === 'right' };
    }
    return { sit: true, fresh: t < s + WALK + 0.6 };
  }
  const lampsLit = $derived(t > 0.6 + newTrees.length * 0.35 + newBenches.length * 0.45 + WALK);
</script>

<div class="div" style="--top: {top}; --bottom: {bottom}; --ground: {ground}; height: {height}px" use:arrive={{ onenter: start, margin: '-10% 0px -20% 0px' }} aria-hidden="true">
  {#if sun}<span class="sun" style="--set: {Math.min(1, t / 6)}"><Pixels map={SUN} palette={SUN_COLORS} scale={6} /></span>{/if}
  <div class="grass"><ContextStrip seed="meadow-{note}" percent={grassNow} width={540} scale={3} /></div>
  <div class="scene">
    {#each items as it, i (i)}
      <span class="it k-{it.k}" style="left: {it.x}%">
        {#if it.k === 'tree'}
          <Tree scale={it.s ?? 3} growth={grow(it)} tint={it.tint ?? null} />
          {#if it.tag && grow(it) >= 1}<span class="tag">{it.tag}</span>{/if}
        {:else if it.k === 'lamp'}
          <span class="lamp" class:lit={it.lit || (it.lightUp && lampsLit)}><Pixels map={LAMP} palette={it.lit || (it.lightUp && lampsLit) ? LIT : SCENERY_PALETTE} scale={4} /></span>
        {:else}
          {@const v = benchView(it)}
          {#if v.sit}
            <BenchSeat state={v.fresh ? 'ready' : it.state} seed={it.id} scale={3} label="" />
          {:else}
            <BenchSeat empty scale={3} />
          {/if}
        {/if}
      </span>
    {/each}
    {#each items.filter((x) => x.k === 'bench') as it (it.id)}
      {@const v = benchView(it)}
      {#if v.walk}
        <span class="walker" style="left: {v.x}%"><Walker seed={it.id} scale={3} flip={v.flip} /></span>
      {/if}
    {/each}
  </div>
  {#if note}<p class="note">{note}</p>{/if}
</div>

<style>
  .div {
    position: relative;
    overflow: hidden;
    background: linear-gradient(var(--top), var(--bottom));
  }
  .grass {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 14px;
    display: flex;
    justify-content: center;
    overflow: hidden;
    line-height: 0;
  }
  .grass :global(svg) {
    max-width: none;
    flex: none;
  }
  .scene {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 14px;
    height: 100%;
    max-width: 1280px;
    margin-inline: auto;
  }
  .div::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 14px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--ground) 80%, white) 0 4px, var(--ground) 4px);
  }
  .it {
    position: absolute;
    bottom: 0;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .it.k-bench {
    z-index: 1;
  }
  .tag {
    position: absolute;
    bottom: -13px;
    padding: 0 5px;
    font-size: 10px;
    line-height: 1.4;
    white-space: nowrap;
    color: #f4ecdd;
    background: #5a4130;
    z-index: 2;
  }
  .walker {
    position: absolute;
    bottom: 0;
    z-index: 2;
    transform: translateX(-50%);
  }
  .lamp {
    display: block;
    transition: filter 0.4s;
  }
  .lamp.lit {
    filter: drop-shadow(0 0 9px rgb(255 231 168 / 0.9));
  }
  .note {
    position: absolute;
    left: 50%;
    top: 14px;
    transform: translateX(-50%);
    font-family: var(--pixel);
    font-size: 13px;
    white-space: nowrap;
    color: var(--faint);
  }
  .sun {
    position: absolute;
    left: 72%;
    bottom: calc(14px + (1 - var(--set)) * 70px - 40px);
    filter: drop-shadow(0 0 18px rgb(255 207 110 / 0.6));
  }
  @media (max-width: 720px) {
    .scene {
      zoom: 0.62;
      height: 161%;
    }
    .note {
      font-size: 11px;
    }
  }
</style>
