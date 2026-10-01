<script>
  import { FILTERS, filterFor } from '../colors.js';

  /**
   * The sidebar's filter chips with their counts: Needs you, Working, Unread.
   *
   * @type {{ states: string[] }}
   */
  let { states } = $props();

  const counts = $derived.by(() => {
    const n = { needs: 0, working: 0, unread: 0 };
    for (const s of states) {
      const f = filterFor(s);
      if (f) n[f]++;
    }
    return n;
  });
</script>

<div class="chips">
  {#each FILTERS as f}
    <span class="chip" class:zero={!counts[f.key]} style="--c: {f.color}"><i></i>{f.label} {counts[f.key]}</span>
  {/each}
</div>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    font-size: 10.5px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: color-mix(in oklch, var(--c) 80%, white);
  }
  .chip i {
    width: 6px;
    height: 6px;
    background: var(--c);
  }
  .chip.zero {
    color: var(--faint-fg);
  }
  .chip.zero i {
    opacity: 0.5;
  }
</style>
