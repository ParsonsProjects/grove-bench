<script>
  import { fly } from 'svelte/transition';
  import { statusColors } from '../shared/brand.js';
  import { lanes, AMBER } from './lanes.js';

  /**
   * A conversation paused on a permission prompt. Allow and Always allow let
   * the lane carry on; Deny makes the agent take another route, so the lane
   * bends into a new column. Replay puts the prompt back.
   *
   * @type {{ status?: 'pending' | 'allow' | 'always' | 'deny', reduced?: boolean }}
   */
  let { status = $bindable('pending'), reduced = false } = $props();

  const blue = lanes.auth.stroke;
  const ROW = 36;
  const X = [12, 28];

  /** @typedef {{ id: string, col: number, from?: number | null, kind: string, tool?: string, arg?: string, add?: number, del?: number, text?: string, tag?: string, color?: string }} Row */

  /** @type {Record<string, Row[]>} */
  const paths = {
    allow: [
      { id: 'a1', col: 0, from: 0, kind: 'tool', tool: 'Read', arg: 'src/middleware/auth.test.ts' },
      { id: 'a2', col: 0, from: 0, kind: 'say', text: 'Done. Tokens last an hour and refresh 30s early.' },
      { id: 'a3', col: 0, from: 0, kind: 'end', text: 'ready for your next message', color: statusColors.ready },
    ],
    always: [
      { id: 'w1', col: 0, from: 0, kind: 'tool', tool: 'Edit', arg: 'src/auth/session.ts', add: 6, del: 2, tag: 'no prompt' },
      { id: 'w2', col: 0, from: 0, kind: 'say', text: 'Done. Both files updated.' },
      { id: 'w3', col: 0, from: 0, kind: 'end', text: 'ready for your next message', color: statusColors.ready },
    ],
    deny: [
      { id: 'd1', col: 1, from: 1, kind: 'say', text: 'OK, I will keep the expiry and refresh tokens early instead.' },
      { id: 'd2', col: 1, from: 1, kind: 'tool', tool: 'Read', arg: 'src/auth/session.ts' },
      { id: 'd3', col: 1, from: 1, kind: 'say', text: 'Plan: refresh 30s before expiry. Go ahead?' },
      { id: 'd4', col: 1, from: 1, kind: 'end', text: 'waiting for your reply', color: statusColors.ready },
    ],
  };

  let shown = $state(0);
  /** @type {ReturnType<typeof setTimeout>[]} */
  let timers = [];

  function clear() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  /** @param {'allow' | 'always' | 'deny'} choice */
  function decide(choice) {
    clear();
    status = choice;
    const rows = paths[choice];
    if (reduced) {
      shown = rows.length;
      return;
    }
    shown = 0;
    rows.forEach((_, i) => timers.push(setTimeout(() => (shown = i + 1), 380 + i * 650)));
  }

  function replay() {
    clear();
    shown = 0;
    status = 'pending';
  }

  $effect(() => () => clear());

  const rows = $derived(status === 'pending' ? [] : paths[status].slice(0, shown));
  const finished = $derived(status !== 'pending' && shown >= paths[status].length);
  const working = $derived(status !== 'pending' && !finished);
  const denied = $derived(status === 'deny');
  const dot = $derived(status === 'pending' ? AMBER : working ? statusColors.working : statusColors.ready);
  const stateText = $derived(status === 'pending' ? 'waiting for permission' : working ? 'working' : 'ready');
  const lastRow = $derived(rows.at(-1));
</script>

<div class="bx-card perm">
  <div class="bx-card-head">
    <span class="bx-dot" class:pulse={status === 'pending' || working} style="--dot: {dot}" aria-hidden="true"></span>
    <span class="branch">feat/auth</span>
    <span class="model">Opus 5.5</span>
    <span class="state" style="color: {dot}" aria-live="polite">{stateText}</span>
  </div>

  <ol class="log">
    <li class="row">
      <svg class="lane" width="40" height={ROW} aria-hidden="true">
        <line x1={X[0]} y1={ROW / 2} x2={X[0]} y2={ROW} stroke={blue} stroke-width="2" />
        <rect x={X[0] - 5} y={ROW / 2 - 5} width="10" height="10" fill={blue} />
      </svg>
      <span class="tool">Read</span>
      <span class="arg">src/middleware/auth.ts</span>
    </li>

    <li class="row">
      <svg class="lane" width="40" height={ROW} aria-hidden="true">
        <line x1={X[0]} y1="0" x2={X[0]} y2={ROW / 2} stroke={blue} stroke-width="2" />
        {#if status === 'pending'}
          <line class="wait" x1={X[0]} y1={ROW / 2} x2={X[0]} y2={ROW} stroke={AMBER} stroke-width="2" stroke-dasharray="4 4" />
          <rect class="ring" x={X[0] - 9} y={ROW / 2 - 9} width="18" height="18" fill="none" stroke={AMBER} stroke-width="1.5" />
          <rect x={X[0] - 5} y={ROW / 2 - 5} width="10" height="10" fill={AMBER} />
        {:else if denied}
          <path
            d="M {X[0]} {ROW / 2} C {X[0]} {ROW * 0.85} {X[1]} {ROW * 0.75} {X[1]} {ROW}"
            fill="none"
            stroke={blue}
            stroke-width="2"
          />
          <rect x={X[0] - 5} y={ROW / 2 - 5} width="10" height="10" fill="var(--color-card)" stroke={statusColors.stopped} stroke-width="2" />
          <path d="M {X[0] - 3} {ROW / 2 - 3} l 6 6 m 0 -6 l -6 6" stroke="#f87171" stroke-width="1.5" />
        {:else}
          <line x1={X[0]} y1={ROW / 2} x2={X[0]} y2={ROW} stroke={blue} stroke-width="2" />
          <rect x={X[0] - 5} y={ROW / 2 - 5} width="10" height="10" fill={blue} />
        {/if}
      </svg>
      <span class="tool">Edit</span>
      <span class="arg" class:struck={denied}>src/middleware/auth.ts</span>
      {#if status === 'pending'}
        <span class="tag amber">needs you</span>
      {:else if denied}
        <span class="tag red">denied</span>
      {:else}
        <span class="nums"><span class="bx-add">+2</span> <span class="bx-del">-1</span></span>
        <span class="tag">{status === 'always' ? 'always allowed' : 'allowed'}</span>
      {/if}
    </li>

    {#if status === 'pending'}
      <li class="prompt-row">
        <svg class="lane tall" width="40" aria-hidden="true">
          <line class="wait" x1={X[0]} y1="0" x2={X[0]} y2="100%" stroke={AMBER} stroke-width="2" stroke-dasharray="4 4" opacity="0.6" />
        </svg>
        <div class="prompt" role="group" aria-labelledby="bx-perm-title">
          <p id="bx-perm-title" class="prompt-title">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M8 1.5 15 14.5H1z" /><path d="M8 6v4" /><path d="M8 11.5v1.2" />
            </svg>
            Permission needed
          </p>
          <p class="prompt-what"><span class="tool">Edit</span> src/middleware/auth.ts</p>
          <pre class="prompt-diff"><span class="bx-del">- const TOKEN_EXPIRY = 300</span>
<span class="bx-add">+ const TOKEN_EXPIRY = 3600</span>
<span class="bx-add">+ const REFRESH_BUFFER = 30</span></pre>
          <div class="prompt-actions">
            <button type="button" class="bx-btn allow" onclick={() => decide('allow')}>Allow</button>
            <button type="button" class="bx-btn deny" onclick={() => decide('deny')}>Deny</button>
            <button type="button" class="bx-btn" onclick={() => decide('always')}>Always allow</button>
          </div>
        </div>
      </li>
    {/if}

    {#each rows as row, i (row.id)}
      {@const last = i === rows.length - 1 && finished}
      <li class="row" in:fly={{ y: reduced ? 0 : -8, duration: reduced ? 0 : 280 }}>
        <svg class="lane" width="40" height={ROW} aria-hidden="true">
          {#if row.from != null}
            {#if row.from === row.col}
              <line x1={X[row.col]} y1="0" x2={X[row.col]} y2={ROW / 2} stroke={blue} stroke-width="2" />
            {:else}
              <path
                d="M {X[row.from]} 0 C {X[row.from]} {ROW * 0.25} {X[row.col]} {ROW * 0.1} {X[row.col]} {ROW / 2}"
                fill="none"
                stroke={blue}
                stroke-width="2"
              />
            {/if}
          {/if}
          {#if !last}
            <line x1={X[row.col]} y1={ROW / 2} x2={X[row.col]} y2={ROW} stroke={blue} stroke-width="2" opacity={row === lastRow ? 0.35 : 1} stroke-dasharray={row === lastRow ? '3 4' : undefined} />
          {/if}
          <rect
            x={X[row.col] - 5}
            y={ROW / 2 - 5}
            width="10"
            height="10"
            fill={row.color ?? blue}
            class="pop"
          />
        </svg>
        {#if row.kind === 'tool'}
          <span class="tool">{row.tool}</span>
          <span class="arg">{row.arg}</span>
          {#if row.add !== undefined}
            <span class="nums"><span class="bx-add">+{row.add}</span> <span class="bx-del">-{row.del}</span></span>
          {/if}
          {#if row.tag}<span class="tag">{row.tag}</span>{/if}
        {:else if row.kind === 'say'}
          <span class="say">{row.text}</span>
        {:else}
          <span class="end" style="color: {row.color}">{row.text}</span>
        {/if}
      </li>
    {/each}
  </ol>

  <div class="foot">
    <span class="mode">mode: <b>Default</b></span>
    {#if status !== 'pending'}
      <button type="button" class="bx-btn" onclick={replay}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <rect x="3" y="2" width="2" height="12" /><rect x="7" y="4" width="2" height="8" /><rect x="11" y="6" width="2" height="4" />
        </svg>
        Replay prompt
      </button>
    {:else}
      <span class="hint">Pick one. You can replay it.</span>
    {/if}
  </div>
</div>

<style>
  .perm {
    width: 100%;
  }
  .branch {
    color: oklch(0.74 0.13 254.6);
    font-weight: 700;
    font-size: 13px;
  }
  .perm :global(.bx-card-head) {
    flex-wrap: wrap;
    row-gap: 2px;
  }
  .model {
    color: oklch(0.62 0 0);
    white-space: nowrap;
  }
  .state {
    margin-left: auto;
    font-size: 12px;
    white-space: nowrap;
  }

  .log {
    list-style: none;
    padding: 10px 10px 6px 4px;
    font-size: 13px;
    min-height: 330px;
  }
  @media (min-width: 640px) {
    .log {
      padding-right: 14px;
    }
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    white-space: nowrap;
    min-width: 0;
  }
  .lane {
    flex: 0 0 40px;
    display: block;
    overflow: visible;
  }
  .lane.tall {
    align-self: stretch;
    height: auto;
  }
  .tool {
    color: oklch(0.92 0 0);
    font-weight: 700;
    flex-shrink: 0;
  }
  .arg {
    color: oklch(0.72 0 0);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .arg.struck {
    text-decoration: line-through;
    text-decoration-color: oklch(0.55 0 0);
    color: oklch(0.55 0 0);
  }
  .nums {
    flex-shrink: 0;
  }
  .tag {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 11px;
    padding: 1px 6px;
    color: oklch(0.74 0.13 254.6);
    border: 1px solid oklch(0.541 0.181 254.624 / 0.5);
  }
  .tag.amber {
    color: #fbbf24;
    border-color: rgb(245 158 11 / 0.5);
  }
  .tag.red {
    color: #f87171;
    border-color: rgb(239 68 68 / 0.45);
  }
  .say {
    color: oklch(0.86 0 0);
    white-space: normal;
    line-height: 1.35;
    font-size: 13px;
  }
  .end {
    font-size: 12px;
  }

  .prompt-row {
    display: flex;
    gap: 8px;
  }
  .prompt {
    flex: 1;
    min-width: 0;
    margin: 6px 0 10px;
    padding: 12px;
    background: rgb(245 158 11 / 0.06);
    border: 1px solid rgb(245 158 11 / 0.3);
    box-shadow: inset 3px 0 0 #f59e0b;
  }
  .prompt-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #fbbf24;
    font-weight: 700;
    font-size: 13px;
  }
  .prompt-what {
    margin-top: 8px;
    color: oklch(0.8 0 0);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .prompt-diff {
    margin: 10px 0 0;
    padding: 8px 10px;
    font-family: inherit;
    font-size: 12px;
    line-height: 20px;
    background: var(--color-background);
    border: 1px solid var(--color-border);
    overflow-x: auto;
  }
  .prompt-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .allow {
    color: #4ade80;
    border-color: rgb(34 197 94 / 0.55);
  }
  .allow:hover:not(:disabled) {
    background: rgb(34 197 94 / 0.12) !important;
    border-color: rgb(34 197 94 / 0.8) !important;
  }
  .deny {
    color: #f87171;
    border-color: rgb(239 68 68 / 0.5);
  }
  .deny:hover:not(:disabled) {
    background: rgb(239 68 68 / 0.12) !important;
    border-color: rgb(239 68 68 / 0.8) !important;
  }

  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 58px;
    padding: 10px 14px;
    border-top: 1px solid var(--color-border);
    font-size: 12px;
    color: oklch(0.62 0 0);
  }
  .mode b {
    color: oklch(0.85 0 0);
    font-weight: 500;
  }

  .wait {
    animation: bx-march 0.8s linear infinite;
  }
  @keyframes bx-march {
    to {
      stroke-dashoffset: -8;
    }
  }
  .ring {
    transform-box: fill-box;
    transform-origin: center;
    animation: bx-perm-ring 1.4s ease-out infinite;
  }
  @keyframes bx-perm-ring {
    from {
      transform: scale(0.6);
      opacity: 1;
    }
    to {
      transform: scale(1.5);
      opacity: 0;
    }
  }
  .pop {
    transform-box: fill-box;
    transform-origin: center;
    animation: bx-perm-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  @keyframes bx-perm-pop {
    from {
      transform: scale(0.1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .wait,
    .ring,
    .pop {
      animation: none;
    }
  }
</style>
