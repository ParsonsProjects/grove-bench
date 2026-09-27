<script>
  import { Tween } from 'svelte/motion';
  import { cubicInOut } from 'svelte/easing';
  import { inView } from '../shared/motion.js';
  import { lanes } from './lanes.js';
  import { turns } from './data.js';

  /**
   * Checkpoints for one conversation. Five turn dots on a lane, a scrubber to
   * pick a checkpoint, a diff panel ("This turn" / "Since here") and a Rewind
   * All button that retracts the lane back to the chosen checkpoint.
   *
   * @type {{ reduced?: boolean }}
   */
  let { reduced = false } = $props();

  const SLOTS = turns.length + 1; // five checkpoints plus HEAD (current files)
  const THUMB = 18;
  const PAD = 18;

  let kept = $state(turns.length); // turns still in the conversation
  let sel = $state(turns.length); // selected checkpoint (1-based)
  let mode = $state('turn');
  let busy = $state(false);
  let note = $state('');
  let landed = $state(false);
  let width = $state(560);
  let touched = false;
  /** @type {ReturnType<typeof setTimeout>[]} */
  let timers = [];

  const head = new Tween(SLOTS, { duration: 900, easing: cubicInOut });

  const x = (slot) => PAD + ((width - PAD * 2) * (slot - 1)) / (SLOTS - 1);

  const blue = lanes.auth.stroke;
  const blueText = lanes.auth.text;

  const current = $derived(kept > 0 ? turns[sel - 1] : null);
  const since = $derived.by(() => {
    if (!kept) return { files: [], add: 0, del: 0, count: 0 };
    /** @type {Map<string, { path: string, add: number, del: number }>} */
    const map = new Map();
    for (const turn of turns.slice(sel - 1, kept)) {
      for (const f of turn.files) {
        const prev = map.get(f.path) ?? { path: f.path, add: 0, del: 0 };
        map.set(f.path, { path: f.path, add: prev.add + f.add, del: prev.del + f.del });
      }
    }
    const files = [...map.values()];
    return {
      files,
      add: files.reduce((s, f) => s + f.add, 0),
      del: files.reduce((s, f) => s + f.del, 0),
      count: kept - sel + 1,
    };
  });

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function userPick() {
    touched = true;
    clearTimers();
  }

  // First time the widget is seen: drift back two checkpoints to show the idea.
  function onSeen(visible) {
    if (!visible || touched || reduced || busy) return;
    touched = true;
    timers.push(setTimeout(() => (sel = Math.min(sel, 4)), 700));
    timers.push(setTimeout(() => (sel = Math.min(sel, 3)), 1400));
  }

  async function rewindAll() {
    if (busy || !kept) return;
    userPick();
    busy = true;
    note = '';
    const k = sel;
    await head.set(k, { duration: reduced ? 0 : 450 + 220 * (kept + 1 - k) });
    kept = k - 1;
    sel = Math.max(1, kept);
    landed = true;
    timers.push(setTimeout(() => (landed = false), 600));
    note =
      kept === 0
        ? 'Rewound to checkpoint 1. Files and conversation are back to where they started.'
        : `Rewound to checkpoint ${k}. Files and conversation are back to just before “${turns[k - 1].msg}”.`;
    busy = false;
  }

  async function replay() {
    if (busy) return;
    userPick();
    busy = true;
    note = '';
    kept = turns.length;
    if (sel < 1) sel = 1;
    await head.set(SLOTS, { duration: reduced ? 0 : 900 });
    busy = false;
  }

  $effect(() => () => clearTimers());

  const inputLeft = $derived(x(1) - THUMB / 2);
  const inputWidth = $derived(x(Math.max(1, kept)) - x(1) + THUMB);
</script>

<div class="bx-card rewind" use:inView={{ threshold: 0.5, onchange: onSeen }}>
  <div class="bx-card-head">
    <span class="bx-dot" style="--dot: #22c55e" aria-hidden="true"></span>
    <span class="branch">feat/auth</span>
    <span class="tab">Checkpoints</span>
  </div>

  <div class="lane-wrap" bind:clientWidth={width}>
    <svg class="lane" width={width} height="64" viewBox="0 0 {width} 64" aria-hidden="true">
      {#if kept > 0}
        <line x1={x(1)} y1="30" x2={x(Math.min(sel, head.current))} y2="30" stroke={blue} stroke-width="2" />
      {/if}
      <line
        x1={x(kept > 0 ? Math.min(sel, head.current) : 1)}
        y1="30"
        x2={x(head.current)}
        y2="30"
        stroke={blue}
        stroke-width="2"
        stroke-dasharray="4 5"
        opacity="0.45"
      />
      {#each turns as _, i}
        {@const slot = i + 1}
        {@const alive = slot <= kept && slot < head.current - 0.02}
        {@const state = slot < sel ? 'kept' : slot === sel ? 'sel' : 'gone'}
        <g
          class="dot"
          class:alive
          style="transform: translate({x(slot)}px, 30px)"
        >
          <g class="dot-scale">
            {#if state === 'sel' && alive}
              <rect x="-10" y="-10" width="20" height="20" fill="none" stroke={blueText} stroke-width="1.5" />
            {/if}
            <rect
              x="-6"
              y="-6"
              width="12"
              height="12"
              fill={state === 'gone' ? 'var(--color-card)' : blue}
              stroke={blue}
              stroke-width="2"
              opacity={state === 'gone' ? 0.55 : 1}
            />
          </g>
          <text y="28" text-anchor="middle" class="num" class:on={state === 'sel'}>{slot}</text>
        </g>
      {/each}
      <g class="head" class:landed style="transform: translate({x(head.current)}px, 30px)">
        <rect x="-7" y="-7" width="14" height="14" fill="var(--color-card)" stroke="oklch(0.88 0 0)" stroke-width="2" />
        <text y="-14" text-anchor="middle" class="head-label">HEAD</text>
      </g>
    </svg>

    <label for="bx-checkpoint" class="sr-only">Checkpoint</label>
    <input
      id="bx-checkpoint"
      class="scrub"
      type="range"
      min="1"
      max={Math.max(1, kept)}
      step="1"
      bind:value={sel}
      oninput={userPick}
      disabled={busy || kept <= 1}
      aria-valuetext={current ? `Checkpoint ${sel}: ${current.msg}` : 'No checkpoints'}
      style="left: {inputLeft}px; width: {inputWidth}px"
    />
  </div>

  <div class="panel">
    {#if current}
      <div class="panel-head">
        <div class="title">
          <span class="cp">Checkpoint {sel}</span>
          <span class="msg">“{current.msg}”</span>
        </div>
        <div class="toggle" role="group" aria-label="Diff range">
          <button type="button" aria-pressed={mode === 'turn'} onclick={() => (mode = 'turn')}>This turn</button>
          <button type="button" aria-pressed={mode === 'since'} onclick={() => (mode = 'since')}>Since here</button>
        </div>
      </div>

      <div class="diff">
        {#if mode === 'turn'}
          {#each current.files as f (f.path)}
            <div class="file">
              <span class="path">{f.path}</span>
              <span class="bx-add">+{f.add}</span><span class="bx-del">-{f.del}</span>
            </div>
          {/each}
          <pre class="lines">{#each current.diff as [sign, text]}<span class="dl" data-sign={sign}><span class="sign">{sign}</span>{text}</span>{/each}</pre>
        {:else}
          {#each since.files as f (f.path)}
            <div class="file">
              <span class="path">{f.path}</span>
              <span class="bx-add">+{f.add}</span><span class="bx-del">-{f.del}</span>
            </div>
          {/each}
          <p class="undo">
            Rewind all undoes {since.count}
            {since.count === 1 ? 'turn' : 'turns'}:
            <span class="bx-add">+{since.add}</span>
            <span class="bx-del">-{since.del}</span>
          </p>
        {/if}
      </div>
    {:else}
      <div class="diff empty">
        <p>Back at the start. Nothing left to rewind.</p>
      </div>
    {/if}

    <div class="actions">
      <button type="button" class="bx-btn primary" onclick={rewindAll} disabled={busy || !kept}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <rect x="1" y="7" width="2" height="2" /><rect x="3" y="5" width="2" height="2" /><rect x="3" y="9" width="2" height="2" /><rect x="5" y="3" width="2" height="2" /><rect x="5" y="11" width="2" height="2" /><rect x="3" y="7" width="12" height="2" />
        </svg>
        Rewind all
      </button>
      {#if kept < turns.length}
        <button type="button" class="bx-btn" onclick={replay} disabled={busy}>Replay turns</button>
      {:else}
        <span class="hint">or <b>Conv. only</b> to reset just the conversation</span>
      {/if}
    </div>
    <p class="note" aria-live="polite">{note}</p>
  </div>
</div>

<style>
  .rewind {
    width: 100%;
  }
  .branch {
    color: var(--lane-text, oklch(0.74 0.13 254.6));
    font-weight: 700;
    font-size: 13px;
    --lane-text: oklch(0.74 0.13 254.6);
  }
  .tab {
    margin-left: auto;
    color: oklch(0.66 0 0);
  }

  .lane-wrap {
    position: relative;
    height: 104px;
    padding-top: 12px;
    border-bottom: 1px solid var(--color-border);
  }
  .lane {
    display: block;
    overflow: visible;
  }
  .dot {
    transition: opacity 0.2s ease;
  }
  .dot-scale {
    transform: scale(0);
    transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .dot.alive .dot-scale {
    transform: scale(1);
  }
  .dot:not(.alive) .num {
    opacity: 0.25;
  }
  .num {
    font-size: 12px;
    fill: oklch(0.6 0 0);
    font-family: inherit;
  }
  .num.on {
    fill: oklch(0.92 0 0);
    font-weight: 700;
  }
  .head-label {
    font-size: 11px;
    fill: oklch(0.8 0 0);
    font-weight: 700;
    letter-spacing: 0.04em;
    font-family: inherit;
  }
  .head .head-label,
  .head rect {
    transition: transform 0.3s ease;
  }
  .head.landed rect {
    animation: bx-land 0.5s ease-out;
    transform-box: fill-box;
    transform-origin: center;
  }
  @keyframes bx-land {
    0% {
      transform: scale(1.8);
      stroke: oklch(0.74 0.13 254.6);
    }
    100% {
      transform: scale(1);
    }
  }

  .scrub {
    position: absolute;
    top: 68px;
    height: 24px;
    margin: 0;
    background: transparent;
    appearance: none;
    -webkit-appearance: none;
    cursor: grab;
  }
  .scrub:disabled {
    cursor: default;
  }
  .scrub::-webkit-slider-runnable-track {
    height: 2px;
    background: oklch(0.34 0 0);
  }
  .scrub::-moz-range-track {
    height: 2px;
    background: oklch(0.34 0 0);
  }
  .scrub::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    margin-top: -8px;
    background: var(--color-primary);
    border: 2px solid oklch(0.95 0 0);
    border-radius: 0;
  }
  .scrub::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: var(--color-primary);
    border: 2px solid oklch(0.95 0 0);
    border-radius: 0;
  }
  .scrub:disabled::-webkit-slider-thumb {
    background: oklch(0.4 0 0);
  }
  .scrub:focus-visible {
    outline: 2px solid oklch(0.74 0.13 254.6);
    outline-offset: 4px;
  }

  .panel {
    padding: 16px;
  }
  .panel-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .title {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .cp {
    font-size: 12px;
    color: oklch(0.6 0 0);
  }
  .msg {
    font-size: 14px;
    color: oklch(0.92 0 0);
  }
  .toggle {
    display: inline-flex;
    border: 1px solid oklch(0.34 0 0);
  }
  .toggle button {
    min-height: 32px;
    padding: 4px 12px;
    font-size: 12px;
    color: oklch(0.7 0 0);
    background: transparent;
    cursor: pointer;
  }
  .toggle button[aria-pressed='true'] {
    background: var(--color-accent);
    color: oklch(0.95 0 0);
  }
  .toggle button:hover:not([aria-pressed='true']) {
    color: oklch(0.9 0 0);
  }

  .diff {
    margin-top: 14px;
    min-height: 150px;
    font-size: 12px;
    background: var(--color-background);
    border: 1px solid var(--color-border);
    padding: 10px 12px;
  }
  .diff.empty {
    display: grid;
    place-items: center;
    color: oklch(0.65 0 0);
    font-size: 13px;
  }
  .file {
    display: flex;
    gap: 8px;
    align-items: baseline;
    line-height: 22px;
  }
  .path {
    color: oklch(0.86 0 0);
    margin-right: auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lines {
    margin: 8px 0 0;
    font-family: inherit;
    font-size: 12px;
    line-height: 20px;
    overflow: hidden;
  }
  .dl {
    display: block;
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
    color: oklch(0.7 0 0);
  }
  .dl[data-sign='+'] {
    color: #4ade80;
    background: rgb(34 197 94 / 0.07);
  }
  .dl[data-sign='-'] {
    color: #f87171;
    background: rgb(239 68 68 / 0.07);
  }
  .sign {
    display: inline-block;
    width: 18px;
    padding-left: 4px;
    user-select: none;
  }
  .undo {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed oklch(0.32 0 0);
    color: oklch(0.78 0 0);
  }

  .actions {
    margin-top: 14px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
  }
  .hint {
    font-size: 12px;
    color: oklch(0.6 0 0);
  }
  .hint b {
    color: oklch(0.8 0 0);
    font-weight: 500;
  }
  .note {
    min-height: 40px;
    margin-top: 10px;
    font-size: 13px;
    color: oklch(0.78 0.13 254.6);
  }

  @media (prefers-reduced-motion: reduce) {
    .dot-scale,
    .dot,
    .head rect,
    .head .head-label {
      transition: none;
    }
    .head.landed rect {
      animation: none;
    }
  }
</style>
