<script>
  import { onMount } from 'svelte';
  import { arrive } from './scroll.svelte.js';

  /**
   * Gives its contents a clock that starts when it scrolls into view: the
   * seconds since then, capped at `max`. With reduced motion it starts at the
   * end. Contents render through the `children` snippet, given `t`.
   *
   * @type {{ max?: number, class?: string, children: import('svelte').Snippet<[number]> }}
   */
  let { max = 14, class: cls = '', children } = $props();

  let t = $state(0);
  let raf = 0;
  let el = $state();

  function start(reduced) {
    if (reduced) {
      t = max;
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      // A frame time can be a hair before t0, so clamp at zero.
      t = Math.min(max, Math.max(0, (now - t0) / 1000));
      if (t < max) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  onMount(() => () => cancelAnimationFrame(raf));
</script>

<div class={cls} bind:this={el} use:arrive={{ onenter: start, margin: '-18% 0px -18% 0px' }}>
  {@render children(t)}
</div>
