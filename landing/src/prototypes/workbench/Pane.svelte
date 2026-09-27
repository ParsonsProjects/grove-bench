<script>
  import { fly, slide, fade } from 'svelte/transition';
  import { Tween } from 'svelte/motion';
  import { prefersReducedMotion } from '../shared/motion.js';
  import StatusDot from './StatusDot.svelte';
  import Message from './Message.svelte';

  /** @type {{ pane: import('./sim.svelte.js').Pane, sim: import('./sim.svelte.js').Sim, id?: string }} */
  let { pane, sim, id } = $props();

  const ms = (/** @type {number} */ n) => (prefersReducedMotion.current ? 0 : n);

  /** @type {HTMLDivElement | undefined} */
  let body = $state();
  /** @type {HTMLDivElement | undefined} */
  let inner = $state();
  let stick = true;
  /** @type {number | null} */
  let confirmAt = $state(null);
  /** @type {{ id: number, text: string } | null} */
  let notice = $state(null);

  // Roll the +/- counts instead of jumping, so a rewind visibly runs backwards.
  const addT = Tween.of(() => pane.add, { duration: prefersReducedMotion.current ? 0 : 600 });
  const delT = Tween.of(() => pane.del, { duration: prefersReducedMotion.current ? 0 : 600 });

  const usedPct = $derived(Math.min(100, (pane.tokens / pane.model.contextWindow) * 100));
  const since = $derived.by(() => {
    if (confirmAt === null) return null;
    const later = pane.turns.slice(confirmAt - 1);
    return { add: later.reduce((n, t) => n + t.add, 0), del: later.reduce((n, t) => n + t.del, 0) };
  });

  // Keep the newest message in view unless the visitor scrolled up to read.
  $effect(() => {
    if (!body || !inner) return;
    const el = body;
    const ro = new ResizeObserver(() => {
      if (stick) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    el.scrollTop = el.scrollHeight;
    return () => ro.disconnect();
  });

  $effect(() => {
    const n = pane.notice;
    if (!n) return;
    notice = n;
    const t = setTimeout(() => {
      if (notice === n) notice = null;
    }, 3200);
    return () => clearTimeout(t);
  });

  // Drop a stale confirm if its checkpoint disappears.
  $effect(() => {
    if (confirmAt !== null && !pane.turns.some((t) => t.n === confirmAt)) confirmAt = null;
  });

  function onscroll() {
    if (!body) return;
    stick = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  }

  /** @param {'all' | 'conv'} mode */
  function rewind(mode) {
    if (confirmAt === null) return;
    stick = true;
    sim.rewind(pane, confirmAt, mode);
    confirmAt = null;
  }

  const clock = (/** @type {number} */ s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const k = (/** @type {number} */ n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
</script>

<section class="pane" style="--lane: {pane.color}" aria-label="Conversation on {pane.branch}" {id}>
  <header class="head">
    <div class="r1">
      <StatusDot status={pane.status} label />
      <span class="branch" title={pane.branch}>{pane.branch}</span>
      <span class="model">{pane.model.label}</span>
      <button class="x" onclick={() => sim.close(pane)} aria-label="Close the {pane.branch} conversation" title="Close conversation">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" /></svg>
      </button>
    </div>
    <div class="r2">
      <span class="wt" title="Worktree folder">.grove-wt/{pane.wt}</span>
      <span class="timer" title="Elapsed">{clock(pane.secs)}</span>
    </div>
  </header>

  <div class="body-wrap">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="body" bind:this={body} {onscroll} tabindex="0" aria-label="Messages">
      <div class="inner" bind:this={inner}>
        {#each pane.messages as m (m.id)}
          <div class="msg" in:fly={{ y: 8, duration: ms(260) }} out:slide={{ duration: ms(380) }}>
            <Message {m} {pane} {sim} />
          </div>
        {/each}
        {#if pane.status === 'working'}
          <div class="working" transition:fade={{ duration: ms(150) }}><span class="sq" aria-hidden="true"></span>working</div>
        {/if}
      </div>
    </div>
    {#if notice}
      {#key notice.id}
        <div class="notice" role="status" in:fly={{ y: 8, duration: ms(220) }} out:fade={{ duration: ms(300) }}>{notice.text}</div>
      {/key}
    {/if}
  </div>

  {#if pane.composer !== null}
    <div class="strip composer" transition:slide={{ duration: ms(240) }}>
      <span class="gt" aria-hidden="true">&gt;</span>
      <span class="ctext" title={pane.composer}>{pane.composer}</span>
      <button class="mini primary" onclick={() => sim.resend(pane)}>Send</button>
    </div>
  {:else if pane.status === 'ready'}
    <div class="strip ready" transition:slide={{ duration: ms(240) }}>
      <StatusDot status="ready" size={7} />
      <span class="rtext">Ready <span class="dim">·</span> <span class="plus">+{Math.round(addT.current)}</span> <span class="minus">-{Math.round(delT.current)}</span> <span class="dim">in {pane.files.length} {pane.files.length === 1 ? 'file' : 'files'}</span></span>
      <button class="mini primary merge" class:pressing={pane.pressing} onclick={() => sim.mergeNow(pane)} disabled={pane.files.length === 0} title="Opens a PR with the GitHub CLI. In this demo it merges straight away.">Open PR</button>
    </div>
  {/if}

  <footer class="foot">
    <div class="meter">
      <span class="bar" aria-hidden="true"><span style="width: max(2px, {usedPct}%)"></span></span>
      <span class="tok">{k(pane.tokens)} / {pane.contextLabel}</span>
      <span class="chg"><span class="plus">+{Math.round(addT.current)}</span> <span class="minus">-{Math.round(delT.current)}</span></span>
    </div>
    <div class="cps" role="group" aria-label="Checkpoints">
      <span class="cpl">Checkpoints</span>
      <div class="track">
        {#each pane.turns as t, i (t.n)}
          {#if i > 0}<span class="link" aria-hidden="true"></span>{/if}
          <button
            class="cp"
            class:now={i === pane.turns.length - 1}
            class:sel={confirmAt === t.n}
            onclick={() => (confirmAt = confirmAt === t.n ? null : t.n)}
            aria-label="Checkpoint {t.n}: {t.text}. This turn +{t.add} -{t.del}. Rewind here"
            aria-expanded={confirmAt === t.n}
            title="#{t.n} {t.text} (this turn +{t.add} -{t.del})"
          >
            <span class="sq" aria-hidden="true"></span>#{t.n}
          </button>
        {/each}
      </div>
    </div>
    {#if confirmAt !== null && since}
      <div class="confirm" transition:slide={{ duration: ms(200) }}>
        <p>Rewind to #{confirmAt}? Since here: <span class="plus">+{since.add}</span> <span class="minus">-{since.del}</span></p>
        <div class="cbtns">
          <button class="mini primary" onclick={() => rewind('all')} title="Restore files and conversation">Rewind All</button>
          <button class="mini" onclick={() => rewind('conv')} title="Reset only the conversation, keep files">Conv. Only</button>
          <button class="mini ghost" onclick={() => (confirmAt = null)}>Cancel</button>
        </div>
      </div>
    {/if}
  </footer>
</section>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--color-background);
    border-top: 2px solid var(--lane);
  }
  .head {
    padding: 0.5rem 0.75rem 0.5rem;
    background: var(--color-card);
    border-bottom: 1px solid var(--color-border);
  }
  .r1,
  .r2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .r2 {
    margin-top: 0.125rem;
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
  .branch {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-foreground);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .model {
    margin-left: auto;
    font-size: 11px;
    color: var(--color-muted-foreground);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .x {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-right: -0.375rem;
    color: var(--color-muted-foreground);
    background: none;
    border: 0;
    cursor: pointer;
    flex-shrink: 0;
  }
  .x:hover {
    color: var(--color-foreground);
    background: var(--color-muted);
  }
  .wt {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .timer {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .body-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .body {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.75rem 0.75rem 0.25rem;
  }
  .body:focus-visible {
    outline-offset: -2px;
  }
  .msg {
    padding-bottom: 0.625rem;
  }
  .working {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 11px;
    color: color-mix(in srgb, var(--color-primary) 75%, white);
    padding: 0 0.125rem 0.625rem;
  }
  .working .sq {
    width: 6px;
    height: 6px;
    background: var(--color-primary);
    animation: breathe 1.1s ease-in-out infinite;
  }
  @keyframes breathe {
    50% {
      opacity: 0.25;
    }
  }
  .notice {
    position: absolute;
    left: 0.75rem;
    right: 0.75rem;
    bottom: 0.5rem;
    padding: 0.4rem 0.625rem;
    font-size: 11px;
    color: var(--color-foreground);
    background: var(--color-accent);
    border: 1px solid color-mix(in srgb, var(--color-primary) 45%, transparent);
    box-shadow: 0 6px 20px oklch(0 0 0 / 0.35);
  }

  .strip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    font-size: 12px;
    border-top: 1px solid var(--color-border);
    min-width: 0;
  }
  .strip.ready {
    background: color-mix(in srgb, #22c55e 7%, var(--color-card));
  }
  .strip.composer {
    background: var(--color-card);
  }
  .rtext,
  .ctext {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gt {
    color: var(--color-primary);
  }
  .dim {
    color: var(--color-muted-foreground);
  }
  .plus {
    color: #4ade80;
  }
  .minus {
    color: #f87171;
  }

  .mini {
    font: inherit;
    font-size: 11px;
    padding: 0.3rem 0.625rem;
    background: var(--color-muted);
    border: 1px solid var(--color-border);
    color: var(--color-foreground);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition:
      filter 0.15s ease,
      transform 0.15s ease,
      box-shadow 0.2s ease;
  }
  .mini:hover:not(:disabled) {
    filter: brightness(1.2);
  }
  .mini:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .mini.primary {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
    font-weight: 700;
  }
  .mini.ghost {
    background: transparent;
    color: var(--color-muted-foreground);
  }
  .merge.pressing {
    transform: scale(0.94);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 40%, transparent);
  }

  .foot {
    border-top: 1px solid var(--color-border);
    background: var(--color-card);
    padding: 0.5rem 0.75rem 0.5rem;
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
  .meter {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .bar {
    width: 44px;
    height: 4px;
    background: var(--color-muted);
    flex-shrink: 0;
  }
  .bar span {
    display: block;
    height: 100%;
    background: #22c55e;
    opacity: 0.75;
    transition: width 0.4s ease;
  }
  .tok {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .chg {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .cps {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    margin-top: 0.375rem;
    min-height: 24px;
  }
  .cpl {
    flex-shrink: 0;
  }
  .track {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .link {
    width: 10px;
    height: 1px;
    background: var(--color-border);
    flex-shrink: 0;
  }
  .cp {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.3rem;
    font: inherit;
    font-size: 11px;
    color: var(--color-muted-foreground);
    background: none;
    border: 1px solid transparent;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  .cp:hover,
  .cp.sel {
    color: var(--color-foreground);
    border-color: var(--color-border);
    background: var(--color-muted);
  }
  .cp .sq {
    width: 7px;
    height: 7px;
    background: var(--lane);
    opacity: 0.65;
  }
  .cp.now .sq {
    opacity: 1;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--lane) 35%, transparent);
  }
  .confirm {
    margin-top: 0.375rem;
    padding: 0.5rem;
    background: var(--color-background);
    border: 1px solid var(--color-border);
    color: var(--color-foreground);
  }
  .confirm p {
    margin: 0 0 0.4rem;
  }
  .cbtns {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .working .sq {
      animation: none;
    }
    .mini,
    .bar span {
      transition: none;
    }
  }
</style>
