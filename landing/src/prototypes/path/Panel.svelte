<script>
  import { LANES, laneStyle } from './data.js';

  /**
   * A commit's text beside its stop on the path: short hash, branch chip,
   * the feature name as the heading, then a line or two. Framed like an RPG
   * text window so it reads over night or day.
   *
   * @type {{
   *   hash: string,
   *   lane?: 'main' | 'auth' | 'api' | 'fix',
   *   label?: string,
   *   head?: boolean,
   *   title?: string,
   *   id?: string,
   *   children?: import('svelte').Snippet,
   *   class?: string,
   * }}
   */
  let { hash, lane = 'main', label, head = false, title, id, children, class: className = '' } = $props();
</script>

<div class="panel {className}" data-panel>
  <div class="meta">
    <code class="hash">{hash}</code>
    <span class="chip" style={laneStyle(lane)}>
      ({#if head}<b>HEAD -&gt;</b>{' '}{/if}{label ?? LANES[lane].name})
    </span>
  </div>
  {#if title}
    <h2 {id}>{title}</h2>
  {/if}
  {@render children?.()}
</div>

<style>
  .panel {
    --edge: #0b1224;
    position: relative;
    z-index: 1;
    min-width: 0;
    max-width: 560px;
    padding: 18px 22px 20px;
    color: #dfe5f2;
    background: linear-gradient(180deg, rgb(26 43 85 / 0.96) 0%, rgb(19 32 63 / 0.96) 60%, rgb(15 26 54 / 0.97) 100%);
    box-shadow:
      inset 0 0 0 var(--px) rgb(217 223 240 / 0.28),
      0 calc(var(--px) * -1) 0 0 var(--edge),
      0 var(--px) 0 0 var(--edge),
      calc(var(--px) * -1) 0 0 0 var(--edge),
      var(--px) 0 0 0 var(--edge),
      0 calc(var(--px) * 3) 0 0 rgb(0 0 0 / 0.3);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    font-size: 13px;
    line-height: 1.4;
  }
  .hash {
    font-family: inherit;
    color: #93a0c0;
    letter-spacing: 0.02em;
  }
  .chip {
    display: inline-block;
    padding: 1px 8px;
    color: var(--lane-text);
    background: color-mix(in oklch, var(--lane) 16%, transparent);
    border: 1px solid color-mix(in oklch, var(--lane) 55%, transparent);
    white-space: nowrap;
  }
  .chip b {
    font-weight: 700;
  }
  h2 {
    margin-top: 10px;
    font-size: clamp(24px, 1.2vw + 16px, 34px);
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: #f4f6fb;
  }
  .panel :global(p) {
    margin-top: 10px;
    font-size: 15px;
    line-height: 1.65;
    color: #c3cbe0;
    text-wrap: pretty;
  }
  .panel :global(p.aside) {
    font-size: 14px;
    color: #93a0c0;
  }
  .panel :global(code) {
    font-family: inherit;
    font-size: 0.94em;
    color: #ffe7a8;
    background: rgb(0 0 0 / 0.28);
    padding: 1px 5px;
    white-space: nowrap;
  }
  @media (min-width: 900px) {
    .panel {
      padding: 22px 26px 24px;
    }
    .panel :global(p) {
      font-size: 16px;
    }
  }
</style>
