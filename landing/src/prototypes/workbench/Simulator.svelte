<script>
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { animationLoop, prefersReducedMotion } from '../shared/motion.js';
  import PixelTree from '../shared/PixelTree.svelte';
  import { PRESETS } from './scripts.js';
  import { MAX_PANES } from './sim.svelte.js';
  import Pane from './Pane.svelte';
  import GraphStrip from './GraphStrip.svelte';
  import StatusDot from './StatusDot.svelte';

  /** @type {{ sim: import('./sim.svelte.js').Sim }} */
  let { sim } = $props();

  /** @type {HTMLDivElement | undefined} */
  let win = $state();
  let width = $state(1100);

  const compact = $derived(width < 760);
  const full = $derived(sim.panes.length >= MAX_PANES);
  const focused = $derived(sim.panes.find((p) => p.id === sim.focusId) ?? sim.panes[0]);
  const ms = (/** @type {number} */ n) => (prefersReducedMotion.current ? 0 : n);

  // The simulated clock only runs while the window is on screen and the tab is visible.
  $effect(() => {
    if (!win) return;
    return animationLoop(win, (dt) => sim.tick(dt * 1000));
  });

  // Any click inside the window hands control to the visitor.
  $effect(() => {
    if (!win) return;
    const el = win;
    /** @param {MouseEvent} e */
    const onClick = (e) => {
      const target = /** @type {Element | null} */ (e.target);
      if (target?.closest?.('[data-keep-autoplay]')) return;
      sim.takeOver();
    };
    el.addEventListener('click', onClick, true);
    return () => el.removeEventListener('click', onClick, true);
  });

  /** Pane slots grow in and shrink out, so merges feel like the pane folds away. */
  function grow(/** @type {Element} */ node) {
    return {
      duration: ms(480),
      easing: cubicOut,
      css: (/** @type {number} */ t) => `flex-grow: ${t}; opacity: ${t}`,
    };
  }
</script>

<div class="window" bind:this={win} bind:clientWidth={width} role="region" aria-label="Interactive Grove Bench demo">
  <!-- Title bar -->
  <div class="titlebar">
    <PixelTree width={13} />
    <span class="app">Grove Bench</span>
    <span class="sep" aria-hidden="true">/</span>
    <span class="proj">my-project</span>
    <div class="auto">
      {#if sim.autoplay}
        <span class="live"><span class="rec" aria-hidden="true"></span>Autoplay</span>
        <span class="hint">Click anything to take over</span>
      {:else}
        <span class="you">{sim.reduced ? 'Autoplay is off' : "You're driving"}</span>
        <button class="replay" data-keep-autoplay onclick={() => sim.replay()}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M3 2h2v8H3zM5 3h2v6H5zM7 4h2v4H7zM9 5h1v2H9z" /></svg>
          {sim.reduced ? 'Play' : 'Replay'}<span class="wide">&nbsp;demo</span>
        </button>
      {/if}
    </div>
    <div class="winctl" aria-hidden="true">
      <span><svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 5h8" stroke="currentColor" /></svg></span>
      <span><svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" /></svg></span>
      <span><svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" /></svg></span>
    </div>
  </div>

  <!-- Task launcher -->
  <div class="launcher">
    <div class="lhead">
      <div class="qwrap">
        <p class="q" id="wb-launch">What should your agents build?</p>
        <p class="cap" aria-live="polite">
          {#if full}Four at once in this demo. Merge or close one first.{:else}Pick a task, or press + Agent.{/if}
        </p>
      </div>
      <button class="agent mob" disabled={full} onclick={() => sim.addAgent()}>+ Agent</button>
    </div>
    <div class="chips" role="group" aria-labelledby="wb-launch">
      {#each PRESETS as preset (preset.id)}
        {@const open = sim.panes.find((p) => p.preset.id === preset.id)}
        <button
          class="chip"
          class:open={!!open}
          style={open ? `--lane: ${open.color}` : undefined}
          disabled={!open && full}
          onclick={() => sim.launch(preset.id)}
          aria-label={open ? `${preset.label}: running, show it` : `Start a conversation: ${preset.label}`}
        >
          {#if open}
            <StatusDot status={open.status} size={7} />
          {:else}
            <span class="plus" aria-hidden="true">+</span>
          {/if}
          {preset.label}
        </button>
      {/each}
      <button class="agent desk" disabled={full} onclick={() => sim.addAgent()}>+ Agent</button>
    </div>
  </div>

  <!-- Phone: one pane at a time, branches as tabs -->
  {#if compact && sim.panes.length}
    <div class="tabs" role="tablist" aria-label="Conversations">
      {#each sim.panes as p (p.id)}
        <button
          role="tab"
          class="tab"
          class:sel={p === focused}
          style="--lane: {p.color}"
          aria-selected={p === focused}
          aria-controls="wb-pane-{p.id}"
          onclick={() => sim.focus(p.id)}
        >
          <StatusDot status={p.status} size={7} label />
          {p.branch}
        </button>
      {/each}
    </div>
  {/if}

  <div class="panes" class:compact>
    {#if compact}
      {#if focused}
        {#key focused.id}
          <div class="slot" role="tabpanel" in:fly={{ x: 16, duration: ms(240) }}>
            <Pane pane={focused} {sim} id="wb-pane-{focused.id}" />
          </div>
        {/key}
      {/if}
    {:else}
      {#each sim.panes as pane (pane.id)}
        <div class="slot" transition:grow>
          <Pane {pane} {sim} />
        </div>
      {/each}
    {/if}
    {#if sim.panes.length === 0}
      <div class="empty">
        <PixelTree width={40} opacity={0.8} />
        <p>All merged. Pick a task above to start another conversation.</p>
      </div>
    {/if}
  </div>

  <GraphStrip {sim} {compact} />

  <div class="counters">
    <span class="c">
      <StatusDot status={sim.running ? 'working' : 'stopped'} size={7} />
      {#key sim.running}<b in:fly={{ y: -6, duration: ms(260) }}>{sim.running}</b>{/key}
      <span><span class="wide">{sim.running === 1 ? 'conversation' : 'conversations'}&nbsp;</span>running</span>
    </span>
    <span class="c">
      {#key sim.filesChanged}<b in:fly={{ y: -6, duration: ms(260) }}>{sim.filesChanged}</b>{/key}
      <span>files changed</span>
    </span>
    <span class="c ok">
      <span>conflicts:</span>
      <b>0</b>
    </span>
  </div>
</div>

<style>
  .window {
    position: relative;
    background: var(--color-card);
    border: 1px solid oklch(0.3 0 0);
    box-shadow:
      0 40px 100px -30px oklch(0.541 0.181 254.624 / 0.35),
      0 20px 50px -20px oklch(0 0 0 / 0.6);
    text-align: left;
    font-size: 12px;
  }

  .titlebar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 36px;
    white-space: nowrap;
    padding: 0 0 0 0.75rem;
    background: var(--color-sidebar);
    border-bottom: 1px solid var(--color-border);
    font-size: 12px;
    color: var(--color-muted-foreground);
    user-select: none;
  }
  .app {
    color: var(--color-foreground);
  }
  .sep {
    opacity: 0.5;
  }
  .auto {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-width: 0;
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.15rem 0.5rem;
    color: var(--color-foreground);
    border: 1px solid color-mix(in oklch, var(--color-primary) 45%, transparent);
    background: color-mix(in oklch, var(--color-primary) 12%, transparent);
    font-size: 11px;
  }
  .rec {
    width: 6px;
    height: 6px;
    background: var(--color-primary);
    animation: rec 1.2s ease-in-out infinite;
  }
  @keyframes rec {
    50% {
      opacity: 0.3;
    }
  }
  .hint,
  .you {
    font-size: 11px;
    white-space: nowrap;
  }
  .replay {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font: inherit;
    font-size: 11px;
    padding: 0.2rem 0.55rem;
    color: var(--color-foreground);
    background: var(--color-muted);
    border: 1px solid var(--color-border);
    cursor: pointer;
  }
  .replay:hover {
    filter: brightness(1.2);
  }
  .winctl {
    display: flex;
    height: 100%;
    margin-left: 0.5rem;
  }
  .winctl span {
    display: grid;
    place-items: center;
    width: 40px;
    height: 100%;
    color: var(--color-muted-foreground);
  }

  .launcher {
    padding: 0.75rem 0.875rem 0.875rem;
    border-bottom: 1px solid var(--color-border);
  }
  .lhead {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.625rem;
  }
  .qwrap {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }
  .agent.mob {
    display: none;
  }
  .q {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-foreground);
  }
  .cap {
    font-size: 11px;
    color: var(--color-muted-foreground);
    text-align: right;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .chip,
  .agent {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font: inherit;
    font-size: 12px;
    padding: 0.4rem 0.75rem;
    color: var(--color-foreground);
    background: var(--color-background);
    border: 1px solid var(--color-border);
    cursor: pointer;
    white-space: nowrap;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease,
      transform 0.15s ease;
  }
  .chip:hover:not(:disabled) {
    border-color: color-mix(in oklch, var(--color-primary) 60%, transparent);
    transform: translateY(-1px);
  }
  .chip .plus {
    color: var(--color-primary);
    font-weight: 700;
  }
  .chip.open {
    border-color: color-mix(in oklch, var(--lane) 55%, transparent);
    background: color-mix(in oklch, var(--lane) 10%, var(--color-background));
    box-shadow: inset 2px 0 0 var(--lane);
  }
  .chip:disabled,
  .agent:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .agent {
    margin-left: auto;
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
    font-weight: 700;
  }
  .agent:hover:not(:disabled) {
    filter: brightness(1.15);
  }

  .tabs {
    display: flex;
    overflow-x: auto;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-sidebar);
    scrollbar-width: none;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    flex-shrink: 0;
    padding: 0.55rem 0.75rem;
    font: inherit;
    font-size: 12px;
    color: var(--color-muted-foreground);
    background: none;
    border: 0;
    border-right: 1px solid var(--color-border);
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .tab.sel {
    color: var(--color-foreground);
    background: var(--color-background);
    border-bottom-color: var(--lane);
  }

  .panes {
    display: flex;
    gap: 1px;
    height: 470px;
    background: var(--color-border);
    position: relative;
    overflow: hidden;
  }
  .panes.compact {
    height: 480px;
  }
  .slot {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1.5rem;
    background: var(--color-background);
    color: var(--color-muted-foreground);
    font-size: 13px;
    text-align: center;
  }

  .counters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.5rem;
    padding: 0.55rem 0.875rem;
    border-top: 1px solid var(--color-border);
    font-size: 12px;
    color: var(--color-muted-foreground);
  }
  .c {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }
  .c b {
    color: var(--color-foreground);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    display: inline-block;
    min-width: 1ch;
  }
  .ok {
    margin-left: auto;
  }
  .ok b {
    color: #4ade80;
  }

  @media (max-width: 640px) {
    .hint,
    .winctl,
    .wide,
    .you,
    .agent.desk {
      display: none;
    }
    .agent.mob {
      display: inline-flex;
    }
    .qwrap {
      flex-direction: column;
      gap: 0.125rem;
    }
    .cap {
      text-align: left;
    }
    .chips {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
      margin: 0 -0.875rem;
      padding: 0 0.875rem 0.125rem;
    }
    .titlebar {
      padding-right: 0.5rem;
    }
    .counters {
      gap: 0.5rem 1rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .rec {
      animation: none;
    }
    .chip {
      transition: none;
    }
  }
</style>
