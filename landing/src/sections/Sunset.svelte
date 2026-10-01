<script>
  import Pixels from '../shared/Pixels.svelte';
  import Tree from '../shared/Tree.svelte';
  import { SUN, SUN_COLORS } from './sky.js';
  import { scroll } from './scroll.svelte.js';

  /**
   * The band where the afternoon turns to dusk. The sun sinks below the
   * horizon as the band scrolls up the window.
   */
  let el = $state();
  const k = $derived.by(() => {
    scroll.y;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    // 0 when the band enters at the bottom, 1 when it reaches the top.
    return Math.min(1, Math.max(0, 1 - r.top / scroll.vh));
  });
</script>

<div class="sunset b-sunset" bind:this={el} aria-hidden="true">
  <span class="sun" style="transform: translate(-50%, {k * 120}px)"><Pixels map={SUN} palette={SUN_COLORS} scale={7} /></span>
  <div class="treeline">
    {#each [3, 5, 2, 4, 3, 6, 2, 4, 3, 5, 3, 2, 4, 5, 3, 4] as s, i}<Tree scale={s} />{/each}
  </div>
</div>

<style>
  .sunset {
    position: relative;
    height: 240px;
    overflow: hidden;
    background: linear-gradient(var(--c5), #c97a7a 45%, var(--c6));
  }
  .sun {
    position: absolute;
    left: 70%;
    bottom: 40px;
    filter: drop-shadow(0 0 24px rgb(255 207 110 / 0.7));
  }
  /* The grove against the sunset: dark silhouettes. */
  .treeline {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    overflow: hidden;
    filter: brightness(0);
    opacity: 0.62;
    border-bottom: 6px solid #3a3066;
  }
</style>
