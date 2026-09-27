<script>
  import { lanes, laneStyle } from './lanes.js';

  /**
   * A section header drawn as a commit: the meta row (hash + branch chips) is
   * the anchor the gutter graph hangs a lamp beside. `status` colours the
   * lamp: neutral on main, blue working, amber needs you, green ready.
   *
   * @type {{
   *   id: string,
   *   hash: string,
   *   lanes?: import('./lanes.js').LaneKey[],
   *   status?: 'neutral' | 'working' | 'permission' | 'ready',
   *   head?: boolean,
   *   title?: string,
   *   headingId?: string,
   *   level?: 1 | 2,
   *   children?: import('svelte').Snippet,
   * }}
   */
  let {
    id,
    hash,
    lanes: laneKeys = ['main'],
    status = 'neutral',
    head = false,
    title,
    headingId,
    level = 2,
    children,
  } = $props();
</script>

<div class="lg-commit">
  <div class="lg-meta" data-anchor={id} data-lanes={laneKeys.join(',')} data-status={status} data-kind="header">
    <code class="lg-hash">{hash}</code>
    {#each laneKeys as key, i (key)}
      <span class="lg-chip" style={laneStyle(key)}>
        {#if i === 0}({/if}{#if head && i === 0}<b>HEAD -&gt;</b>{' '}{/if}{lanes[key].name}{#if i === laneKeys.length - 1}){:else},{/if}
      </span>
    {/each}
  </div>
  {#if title}
    {#if level === 1}
      <h1 class="lg-h1" id={headingId}>{title}</h1>
    {:else}
      <h2 class="lg-h2" id={headingId}>{title}</h2>
    {/if}
  {/if}
  {#if children}
    <div class="lg-sub">{@render children()}</div>
  {/if}
</div>
