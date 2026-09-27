<script>
  import { lanes, laneStyle } from './lanes.js';

  /**
   * A section header drawn as a commit: the meta row (hash + branch chip) is
   * the anchor the git graph puts a node beside. Omit `children` to render
   * only the meta row (the hero supplies its own h1).
   *
   * @type {{
   *   id: string,
   *   hash: string,
   *   lane?: import('./lanes.js').LaneKey,
   *   label?: string,
   *   head?: boolean,
   *   kind?: string,
   *   children?: import('svelte').Snippet,
   *   sub?: import('svelte').Snippet,
   *   headingId?: string,
   * }}
   */
  let { id, hash, lane = 'main', label, head = false, kind = 'header', children, sub, headingId } = $props();
</script>

<div class="commit" style={laneStyle(lane)}>
  <div class="bx-meta" data-anchor={id} data-lane={lane} data-kind={kind}>
    <code class="bx-hash">{hash}</code>
    <span class="bx-chip">
      ({#if head}<b>HEAD -&gt;</b>{' '}{/if}{label ?? lanes[lane].name})
    </span>
  </div>
  {#if children}
    <h2 class="bx-h2" id={headingId}>{@render children()}</h2>
  {/if}
  {#if sub}
    <p class="bx-sub">{@render sub()}</p>
  {/if}
</div>
