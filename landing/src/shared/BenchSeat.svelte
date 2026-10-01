<script>
  import Sprite from './Sprite.svelte';
  import Pixels from './Pixels.svelte';
  import { BENCH, SPRITE_W, SPRITE_H } from './app-art.js';

  /**
   * An agent on its park bench, placed the way the app's empty state does:
   * both on the same ground line, the agent's body centred on the seat.
   *
   * @type {{ state?: string, seed?: string, look?: Record<string, string> | null, projectColor?: string | null, scale?: number, still?: boolean, label?: string | null, empty?: boolean }}
   */
  let { state = 'ready', seed, look = null, projectColor = null, scale = 4, still = false, label = null, empty = false } = $props();

  const BENCH_W = BENCH[0].length;
  const SEAT_X = (BENCH_W - 6) / 2;
  const W = Math.max(BENCH_W, SEAT_X + SPRITE_W);
</script>

<div class="seat" style="width: {W * scale}px; height: {SPRITE_H * scale}px">
  <div class="bench" style="left: 0"><Pixels map={BENCH} {scale} /></div>
  {#if !empty}
    <div class="agent" style="left: {SEAT_X * scale}px">
      <Sprite {state} {seed} {look} {projectColor} {scale} {still} {label} />
    </div>
  {/if}
</div>

<style>
  .seat {
    position: relative;
    flex: none;
  }
  .bench,
  .agent {
    position: absolute;
    bottom: 0;
  }
</style>
