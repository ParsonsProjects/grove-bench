<script>
  import Pixels from '../shared/Pixels.svelte';
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

<div class="sunset" bind:this={el} aria-hidden="true">
  <span class="sun" style="transform: translate(-50%, {k * 120}px)"><Pixels map={SUN} palette={SUN_COLORS} scale={7} /></span>
  <div class="hills"></div>
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
  .hills {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 46px;
    background:
      linear-gradient(transparent 0 0),
      repeating-linear-gradient(90deg, #3f3466 0 40px, #3a3060 40px 80px);
    clip-path: polygon(0 60%, 8% 40%, 16% 55%, 26% 30%, 36% 50%, 48% 25%, 58% 45%, 70% 20%, 80% 45%, 90% 30%, 100% 50%, 100% 100%, 0 100%);
  }
</style>
