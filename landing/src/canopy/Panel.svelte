<script>
  import { LANES } from './data.js';

  /**
   * A section drawn as a commit: short hash, branch chip, the plain feature
   * name as the heading, then the body. On wide screens the panel can be the
   * anchor the scene puts its art beside (`anchor`, `frac`).
   *
   * @type {{
   *   id: string,
   *   hash: string,
   *   lane?: 'main' | 'auth' | 'api' | 'fix',
   *   title: string,
   *   head?: boolean,
   *   day?: boolean,
   *   anchor?: string,
   *   frac?: number,
   *   children?: import('svelte').Snippet,
   * }}
   */
  let { id, hash, lane = 'main', title, head = false, day = false, anchor, frac, children } = $props();
  const l = $derived(LANES[lane]);
</script>

<article class="cn-panel" class:day aria-labelledby="{id}-h" data-anchor-wide={anchor} data-frac-wide={frac}>
  <div class="cn-meta">
    <code class="cn-hash">{hash}</code>
    <span class="cn-chip" style="--lane: {l.stroke}; --lane-text: {l.text}">
      ({#if head}<b>HEAD -&gt;</b>{' '}{/if}{l.name})
    </span>
  </div>
  <h2 class="cn-h2" id="{id}-h">{title}</h2>
  {@render children?.()}
</article>
