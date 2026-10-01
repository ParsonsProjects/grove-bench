<script>
  import { untrack } from 'svelte';
  import Sprite from '../shared/Sprite.svelte';
  import Tree from '../shared/Tree.svelte';
  import BenchSeat from '../shared/BenchSeat.svelte';
  import Pixels from '../shared/Pixels.svelte';
  import { LAMP, SCENERY_PALETTE } from '../shared/app-art.js';
  import { scroll } from '../day/scroll.svelte.js';

  /**
   * A path down the left of the page. One agent walks down it as you scroll
   * (it only steps while the page moves), trees sprout as it nears them, and
   * at each section it sits on a bench in that section's pose.
   *
   * @type {{ page: HTMLElement | undefined, stops: { at: string, state: string }[], k: number }}
   */
  let { page, stops, k } = $props();

  const SEED = 'a3f8b2c1';
  const LIT = { ...SCENERY_PALETTE, o: '#ffe7a8' };
  let height = $state(0);
  let pageTop = $state(0);
  let benches = $state([]);
  let trees = $state([]);
  // Trees stay grown once the walker has been near them.
  let reached = $state(0);

  function measure() {
    if (!page) return;
    const top = page.getBoundingClientRect().top + window.scrollY;
    pageTop = top;
    // The path ends where the night grove begins.
    const grove = page.querySelector('.b-night .grove');
    height = grove ? grove.getBoundingClientRect().top + window.scrollY - top + 40 : page.offsetHeight;
    benches = stops
      .map((s) => {
        const el = page.querySelector(s.at);
        if (!el) return null;
        return { ...s, y: el.getBoundingClientRect().top + window.scrollY - top + 70 };
      })
      .filter(Boolean);
    // The first bench sits where the walker starts, half way down the window,
    // so the agent is sitting there when the page opens.
    if (benches[0]) benches[0].y = Math.max(benches[0].y, window.innerHeight * 0.5 - top);
    // The last bench sits at the end of the path, as far down as the walker
    // can get, so the agent is asleep there when you reach the bottom.
    const last = benches.at(-1);
    if (last) {
      const lowest = document.documentElement.scrollHeight - window.innerHeight * 0.5 - top;
      last.y = Math.min(height - 24, lowest - 8);
    }
    // A tree every so often, alternating sides, skipping the benches.
    const list = [];
    let side = 1;
    for (let y = 140; y < height - 60; y += 84 + ((y * 7) % 50)) {
      if (benches.some((b) => Math.abs(b.y - y) < 70)) continue;
      side = -side;
      const n = list.length;
      list.push({ y, side, s: n % 4 === 1 ? 3 : 2, tint: ['#3b82f6', '#6ec87a', '#f59e0b', '#a78bfa', null, null][n % 6] });
    }
    trees = list;
    tufts = Array.from({ length: Math.floor(height / 46) }, (_, i) => ({ y: 60 + i * 46, side: i % 2 ? 1 : -1 }));
  }
  let tufts = $state([]);
  const TUFT = ['g.g', '.g.'];
  const TUFT_COLORS = { g: '#4aaa58' };

  // The page element arrives after this mounts (it's bound in the parent).
  $effect(() => {
    if (!page) return;
    untrack(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(page);
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  // Where the walker is, in page pixels: half way down the window.
  const walkerY = $derived(scroll.y + scroll.vh * 0.5 - pageTop);
  $effect(() => {
    if (walkerY > reached) reached = walkerY;
  });
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const growth = (y) => (reduced ? 1 : Math.min(1, Math.max(0, (reached - y + 260) / 160)));
  // Sitting on a bench when close to one. Before the first bench and past the
  // last it stays put, so it never walks off either end of the path.
  const seated = $derived.by(() => {
    if (!benches.length) return null;
    if (walkerY <= benches[0].y + 56) return benches[0];
    const last = benches.at(-1);
    if (walkerY >= last.y - 56) return last;
    return benches.find((b) => Math.abs(b.y - walkerY) < 56) ?? null;
  });
  // On arriving at a bench it sits down first (the plain seated pose), then
  // takes up that section's pose.
  let settled = $state(true);
  $effect(() => {
    seated;
    if (reduced) return;
    settled = false;
    const t = setTimeout(() => (settled = true), 450);
    return () => clearTimeout(t);
  });
  // Lamps along the last stretch, lit at night.
  const lampsFrom = $derived(height * 0.78);
</script>

<div class="rail" style="height: {height}px; --k: {k}px" aria-hidden="true">
  <div class="path"></div>
  {#each tufts as tf, i (i)}
    <span class="tuft" style="top: {tf.y}px; --side: {tf.side}"><Pixels map={TUFT} palette={TUFT_COLORS} scale={k} /></span>
  {/each}
  {#each trees as t, i (i)}
    <span class="tree" style="top: {t.y}px; --side: {t.side}">
      <Tree scale={Math.max(1, t.s - (3 - k))} growth={growth(t.y)} tint={t.tint} />
    </span>
    {#if t.y > lampsFrom && i % 2 === 0}
      <span class="lamp" style="top: {t.y + 40}px; --side: {-t.side}" class:lit={reached > t.y - 200}>
        <Pixels map={LAMP} palette={reached > t.y - 200 ? LIT : SCENERY_PALETTE} scale={k} />
      </span>
    {/if}
  {/each}
  {#each benches as b (b.at)}
    <span class="bench" style="top: {b.y}px">
      {#if seated === b}
        <BenchSeat state={settled ? b.state : 'ready'} seed={SEED} scale={k} label="" />
      {:else}
        <BenchSeat empty scale={k} />
      {/if}
    </span>
  {/each}
  <div class="track">
    <span class="walker" class:away={!!seated}>
      <Sprite state="starting" seed={SEED} scale={k} still={!scroll.moving} label="" />
    </span>
  </div>
</div>

<style>
  .rail {
    position: absolute;
    top: 0;
    left: max(0px, calc((100% - 1120px) / 2 - var(--rail) + 24px));
    width: var(--rail);
    pointer-events: none;
    z-index: 3;
  }
  .path {
    position: absolute;
    top: 40px;
    bottom: 0;
    left: calc(50% - var(--k) * 2.5);
    width: calc(var(--k) * 5);
    background: #a8845e;
    box-shadow:
      inset calc(var(--k) * 0.7) 0 0 #8a6a4a,
      inset calc(var(--k) * -0.7) 0 0 #8a6a4a;
    opacity: 0.85;
  }
  .tuft {
    position: absolute;
    left: 50%;
    transform: translate(calc(-50% + var(--side) * var(--k) * 4.5), -100%);
    opacity: 0.8;
  }
  .tree,
  .lamp {
    position: absolute;
    left: 50%;
    transform: translate(calc(-50% + var(--side) * var(--k) * 11), -100%);
  }
  .lamp.lit {
    filter: drop-shadow(0 0 8px rgb(255 231 168 / 0.9));
  }
  .bench {
    position: absolute;
    left: 50%;
    transform: translate(calc(-50% + var(--k) * 1.5), -100%);
    z-index: 2;
  }
  .track {
    position: absolute;
    inset: 0;
  }
  .walker {
    position: sticky;
    top: calc(50vh - var(--k) * 9);
    display: block;
    width: calc(var(--k) * 10);
    margin-left: calc(50% - var(--k) * 3);
    z-index: 3;
  }
  .walker.away {
    visibility: hidden;
  }
</style>
