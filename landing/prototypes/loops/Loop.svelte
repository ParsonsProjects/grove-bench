<script>
  import { onMount } from 'svelte';

  /**
   * Plays a short scene on a loop, one frame after another. Hovering or
   * focusing the card pauses it; the buttons pause, step back and forward.
   * It only runs while on screen. With reduced motion it starts paused, on
   * the last frame, and steps by hand.
   *
   * The scene is a snippet given the frame index and the seconds spent in it.
   *
   * @type {{ frames: { dur: number, caption: string }[], label: string, scene: import('svelte').Snippet<[number, number]> }}
   */
  let { frames, label, scene } = $props();

  let f = $state(0);
  let t = $state(0);
  let paused = $state(false);
  let hover = $state(false);
  let visible = $state(false);
  let el = $state();

  onMount(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      paused = true;
      f = frames.length - 1;
      t = 99;
    }
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  });

  $effect(() => {
    if (paused || hover || !visible) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      t += Math.min(0.05, (now - last) / 1000);
      last = now;
      if (t >= frames[f].dur) {
        t = 0;
        f = (f + 1) % frames.length;
      }
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  });

  function go(d) {
    f = (f + d + frames.length) % frames.length;
    t = 99;
    paused = true;
  }
</script>

<figure class="loop" bind:this={el}>
  <div
    class="screen"
    role="img"
    aria-label="{label}: {frames[f].caption}"
    onmouseenter={() => (hover = true)}
    onmouseleave={() => (hover = false)}
  >
    {@render scene(f, t)}
    {#if hover && !paused}<span class="held pixel" aria-hidden="true">paused</span>{/if}
  </div>
  <figcaption>
    <div class="ctl">
      <button type="button" onclick={() => go(-1)} aria-label="Previous step">◀</button>
      <button type="button" onclick={() => (paused = !paused)} aria-label={paused ? 'Play' : 'Pause'}>{paused ? '▶' : '❚❚'}</button>
      <button type="button" onclick={() => go(1)} aria-label="Next step">▶</button>
      <span class="dots" aria-hidden="true">{#each frames as _, i}<i class:on={i === f}></i>{/each}</span>
    </div>
    <p class="cap" aria-live="polite">{frames[f].caption}</p>
  </figcaption>
</figure>

<style>
  .loop {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
  }
  .screen {
    position: relative;
    aspect-ratio: 16 / 10;
    max-width: 100%;
    overflow: hidden;
    background:
      radial-gradient(1px 1px at 18% 22%, #fff7, transparent),
      radial-gradient(1px 1px at 72% 14%, #fff5, transparent),
      radial-gradient(1px 1px at 88% 38%, #fff4, transparent),
      linear-gradient(180deg, #0f1730, #18223f);
    box-shadow:
      inset 0 0 0 1px var(--edge),
      0 0 0 3px var(--ink),
      0 8px 0 0 rgb(0 0 0 / 0.28);
  }
  .held {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 0 6px;
    font-size: 12px;
    color: #0b1224;
    background: var(--gold);
  }
  figcaption {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ctl {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .ctl button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 24px;
    font-size: 10px;
    color: var(--muted);
    background: rgb(255 255 255 / 0.05);
    border: 0;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1);
    cursor: pointer;
  }
  .ctl button:hover {
    color: #fff;
  }
  .dots {
    display: flex;
    gap: 5px;
    margin-left: 8px;
  }
  .dots i {
    width: 6px;
    height: 6px;
    background: rgb(255 255 255 / 0.18);
  }
  .dots i.on {
    background: var(--leaf-1);
  }
  .cap {
    min-height: 2.9em;
    font-size: 13px;
    line-height: 1.45;
    color: var(--muted);
  }
</style>
