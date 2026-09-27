<script>
  import { branchLanes, laneStyle } from './lanes.js';

  // The panel is the "bus" anchor: the git graph sends light from its left
  // edge into every lane, one pulse per conversation start.
  const folders = [
    { name: 'repo/', files: ['overview.md', 'stack.md'] },
    { name: 'conventions/', files: ['naming.md', 'testing.md'] },
    { name: 'architecture/', files: ['ipc.md', 'data-flow.md'] },
    { name: 'sessions/', files: ['feat-auth.md', 'fix-login.md'] },
  ];
</script>

<div class="bx-card memory" data-anchor="memory-bus" data-kind="bus" role="group" aria-label="Project memory folders">
  <div class="bx-card-head">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" class="brain">
      <path d="M12 2c-1.5 0-3 .8-4 2s-1.5 3-2.5 3.5C4 8.5 3 10 3 12c0 1.5.5 3 1.5 4s1 2.5.5 3.5c.5 1.5 2 2.5 3.5 2.5H12" />
      <path d="M12 2c1.5 0 3 .8 4 2s1.5 2.5 2.5 3c1.5 1 2 2.5 2 4" />
      <path d="M12 2v20" />
    </svg>
    <span class="title">Project memory</span>
    <span class="budget">
      <span class="budget-label">budget</span>
      <span class="meter" aria-hidden="true"><span></span></span>
    </span>
  </div>

  <ul class="folders">
    {#each folders as folder, i}
      <li class="folder" style="--d: {i * 0.35}s">
        <span class="fname">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 3h5l1 1h8v9H1z" /></svg>
          {folder.name}
        </span>
        <ul class="files">
          {#each folder.files as file}
            <li>{file}</li>
          {/each}
        </ul>
      </li>
    {/each}
  </ul>

  <div class="foot">
    <span class="read">read when a conversation starts</span>
    <span class="who">
      {#each branchLanes as lane, i}
        <span class="who-chip" style="{laneStyle(lane.key)} --d: {0.6 + i * 0.45}s">{lane.name}</span>
      {/each}
    </span>
  </div>
</div>

<style>
  .memory {
    margin-top: 40px;
    max-width: 880px;
  }
  .brain {
    color: oklch(0.8 0 0);
  }
  .title {
    font-size: 13px;
    color: oklch(0.9 0 0);
    font-weight: 700;
  }
  .budget {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: oklch(0.62 0 0);
  }
  .meter {
    width: 72px;
    height: 6px;
    background: oklch(0.3 0 0);
    overflow: hidden;
  }
  .meter span {
    display: block;
    width: 42%;
    height: 100%;
    background: #4aaa58;
  }

  .folders {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    background: var(--color-border);
  }
  @media (min-width: 768px) {
    .folders {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .folder {
    position: relative;
    padding: 14px 14px 16px;
    background: var(--color-card);
    min-width: 0;
  }
  .folder::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(90deg, oklch(0.541 0.181 254.624 / 0.16), transparent 80%);
    opacity: 0;
    animation: bx-read 3.4s ease-in-out infinite;
    animation-delay: var(--d);
  }
  @keyframes bx-read {
    0%,
    100% {
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    45% {
      opacity: 0;
    }
  }
  .fname {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
    color: oklch(0.9 0 0);
  }
  .fname svg {
    color: oklch(0.62 0 0);
    flex-shrink: 0;
  }
  .files {
    list-style: none;
    margin-top: 8px;
    padding-left: 20px;
    font-size: 12px;
    line-height: 22px;
    color: oklch(0.66 0 0);
  }
  .files li {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    padding: 12px 14px;
    border-top: 1px solid var(--color-border);
    font-size: 12px;
  }
  .read {
    color: oklch(0.62 0 0);
  }
  .who {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .who-chip {
    padding: 1px 7px;
    color: var(--lane-text);
    border: 1px solid color-mix(in oklch, var(--lane) 45%, transparent);
    animation: bx-who 3.4s ease-in-out infinite;
    animation-delay: var(--d);
  }
  @keyframes bx-who {
    0%,
    100% {
      background: transparent;
    }
    20% {
      background: color-mix(in oklch, var(--lane) 28%, transparent);
    }
    50% {
      background: transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .folder::after,
    .who-chip {
      animation: none;
    }
  }
</style>
