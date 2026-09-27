<script>
  import { lanes, laneStyle } from './lanes.js';
  import { merges, mergedFiles } from './data.js';

  // Each row is a merge commit on main; the git graph curves the branch lane
  // into the node beside it. The summary card totals what came back. While
  // feat/auth still waits for permission, its row links back to the prompt.

  /** @type {{ pending?: boolean }} */
  let { pending = false } = $props();
  const add = merges.reduce((s, m) => s + m.add, 0);
  const del = merges.reduce((s, m) => s + m.del, 0);
</script>

<div class="merge">
  <ol class="rows" aria-label="Merge commits on main">
    {#each merges as m}
      <li class="row" style={laneStyle(m.lane)}>
        <span class="head" data-anchor="merge-{m.lane}" data-lane="main" data-kind="merge" data-merges={m.lane}>
          <code class="bx-hash">{m.hash}</code>
          <span class="msg">Merge branch <span class="br">'{lanes[m.lane].name}'</span></span>
        </span>
        <span class="stat">
          {#if pending && m.lane === 'auth'}
            <a class="waiting" href="#h-perm">waiting on you</a>
          {/if}
          <span class="files">{m.files} files</span>
          <span class="bx-add">+{m.add}</span>
          <span class="bx-del">-{m.del}</span>
        </span>
      </li>
    {/each}
  </ol>

  <div class="bx-card pr" role="group" aria-label="Summary of merged branches">
    <div class="bx-card-head">
      <span class="badge">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <rect x="3" y="1" width="2" height="14" /><rect x="11" y="9" width="2" height="6" /><rect x="5" y="5" width="2" height="2" /><rect x="7" y="7" width="2" height="2" /><rect x="9" y="9" width="2" height="2" />
        </svg>
        Merged
      </span>
      <span class="into">3 branches into <b>main</b></span>
    </div>
    <ul class="list">
      {#each merges as m}
        <li style={laneStyle(m.lane)}>
          <span class="sq" aria-hidden="true"></span>
          <span class="name">{lanes[m.lane].name}</span>
          <span class="n">{m.files} files</span>
        </li>
      {/each}
    </ul>
    <div class="total">
      <span>{mergedFiles} files changed</span>
      <span><span class="bx-add">+{add}</span> <span class="bx-del">-{del}</span></span>
    </div>
    <div class="bar" aria-hidden="true">
      {#each merges as m}
        <span style="{laneStyle(m.lane)} flex: {m.add + m.del}"></span>
      {/each}
    </div>
  </div>
</div>

<style>
  .merge {
    margin-top: 40px;
    display: grid;
    gap: 32px;
    align-items: start;
  }
  @media (min-width: 1024px) {
    .merge {
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
      gap: 48px;
    }
  }
  .rows {
    list-style: none;
    display: grid;
    gap: 14px;
    padding-top: 4px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px 16px;
    padding: 12px 0;
    border-bottom: 1px dashed oklch(0.3 0 0);
    font-size: 14px;
  }
  .head {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    align-items: baseline;
    min-width: 0;
  }
  .msg {
    color: oklch(0.88 0 0);
  }
  .br {
    color: var(--lane-text);
  }
  .stat {
    display: inline-flex;
    gap: 10px;
    font-size: 13px;
  }
  .files {
    color: oklch(0.6 0 0);
  }
  .waiting {
    padding: 0 6px;
    font-size: 12px;
    color: #fbbf24;
    border: 1px solid rgb(245 158 11 / 0.5);
    text-decoration: none;
  }
  .waiting:hover {
    background: rgb(245 158 11 / 0.12);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    color: #fff;
    background: #3a9a48;
    font-size: 12px;
    font-weight: 700;
  }
  .into {
    color: oklch(0.75 0 0);
  }
  .into b {
    color: oklch(0.92 0 0);
  }
  .list {
    list-style: none;
    padding: 12px 16px 4px;
    font-size: 13px;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 10px;
    line-height: 30px;
  }
  .sq {
    width: 8px;
    height: 8px;
    background: var(--lane);
  }
  .name {
    color: var(--lane-text);
  }
  .n {
    margin-left: auto;
    color: oklch(0.62 0 0);
  }
  .total {
    display: flex;
    justify-content: space-between;
    padding: 10px 16px 14px;
    font-size: 13px;
    color: oklch(0.85 0 0);
    border-top: 1px solid var(--color-border);
    margin-top: 8px;
  }
  .bar {
    display: flex;
    height: 6px;
  }
  .bar span {
    background: var(--lane);
  }
</style>
