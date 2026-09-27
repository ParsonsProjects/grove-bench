<script>
  import { fly, fade } from 'svelte/transition';
  import { prefersReducedMotion } from '../../shared/motion.js';
  import { LANE_COLORS } from '../scripts.js';
  import { timeline, typeSteps } from '../timeline.js';

  const TITLE = 'Add JWT auth middleware';
  const COMMITS = ['Add requireAuth middleware', 'Refresh tokens before expiry', 'Cover auth with tests'];
  const CLI = 'gh pr create --base main --head feat/jwt-auth';

  // Finished at rest; the loop rebuilds it.
  let title = $state(TITLE.length);
  let commits = $state(COMMITS.length);
  let pressed = $state(false);
  let cli = $state(CLI.length);
  let opened = $state(true);

  const ms = (/** @type {number} */ n) => (prefersReducedMotion.current ? 0 : n);

  /** @type {HTMLDivElement | undefined} */
  let root = $state();

  function build() {
    return [
      { wait: 3600, run: () => ((opened = false), (cli = 0), (commits = 0), (title = 0)) },
      { wait: 500, run: () => {} },
      ...typeSteps(TITLE, 45, (n) => (title = n)),
      ...COMMITS.map((_, i) => ({ wait: i ? 280 : 420, run: () => (commits = i + 1) })),
      { wait: 700, run: () => (pressed = true) },
      { wait: 200, run: () => (pressed = false) },
      ...typeSteps(CLI, 22, (n) => (cli = n)),
      { wait: 500, run: () => (opened = true) },
    ];
  }

  $effect(() => {
    if (!root || prefersReducedMotion.current) return;
    return timeline(root, build());
  });
</script>

<div class="pr" bind:this={root} role="img" aria-label="A Create Pull Request form fills itself in from the feat/jwt-auth branch, then gh pr create opens the pull request.">
  <div class="card" aria-hidden="true">
    <p class="ctitle">Create Pull Request</p>
    <div class="field">
      <span class="lbl">Title</span>
      <span class="input">{TITLE.slice(0, title)}{#if title < TITLE.length}<span class="caret"></span>{/if}</span>
    </div>
    <div class="field top">
      <span class="lbl">Description</span>
      <div class="desc">
        <span class="hint">Pre-filled from the branch's commits.</span>
        {#each COMMITS.slice(0, commits) as c (c)}
          <span class="commit" in:fly={{ y: -6, duration: ms(220) }}><span class="sq" style="background: {LANE_COLORS[0]}"></span>{c}</span>
        {/each}
      </div>
    </div>
    <div class="field">
      <span class="lbl">Base</span>
      <span class="branches"><span class="base">main</span><span class="arrow">&lt;-</span><span class="head">feat/jwt-auth</span></span>
    </div>
    <div class="actions">
      <span class="draft"><span class="box"></span>Draft</span>
      <span class="btn" class:pressed>Create PR</span>
    </div>
  </div>
  <div class="cli" aria-hidden="true">
    <div><span class="dollar">$</span> {CLI.slice(0, cli)}{#if cli > 0 && cli < CLI.length}<span class="caret"></span>{/if}</div>
    {#if opened}
      <div class="done" in:fade={{ duration: ms(200) }}><span class="tick">✓</span> Pull request opened for feat/jwt-auth</div>
    {/if}
  </div>
</div>

<style>
  .pr {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    height: 100%;
    font-size: 12px;
  }
  .card {
    border: 1px solid var(--color-border);
    background: var(--color-background);
    padding: 0.875rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }
  .ctitle {
    font-weight: 700;
    color: var(--color-foreground);
  }
  .field {
    display: grid;
    grid-template-columns: 9.5em 1fr;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }
  .field.top {
    align-items: start;
  }
  .lbl {
    color: var(--color-muted-foreground);
    font-size: 11px;
  }
  .input {
    min-height: 2em;
    display: flex;
    align-items: center;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--color-border);
    background: var(--color-card);
    color: var(--color-foreground);
    white-space: nowrap;
    overflow: hidden;
  }
  .desc {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-height: 5.9em;
  }
  .hint {
    color: var(--color-muted-foreground);
    font-size: 11px;
  }
  .commit {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: oklch(0.8 0 0);
  }
  .sq {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
  }
  .branches {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 11px;
  }
  .base,
  .head {
    padding: 0.1rem 0.45rem;
    background: var(--color-muted);
    color: var(--color-foreground);
  }
  .head {
    color: oklch(0.66 0.16 254.6);
    background: color-mix(in oklch, var(--color-primary) 14%, transparent);
  }
  .arrow {
    color: var(--color-muted-foreground);
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.125rem;
  }
  .draft {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--color-muted-foreground);
    font-size: 11px;
  }
  .box {
    width: 11px;
    height: 11px;
    border: 1px solid var(--color-muted-foreground);
  }
  .btn {
    padding: 0.35rem 0.75rem;
    background: var(--color-primary);
    color: white;
    font-weight: 700;
    font-size: 11px;
    transition:
      transform 0.12s ease,
      box-shadow 0.2s ease;
  }
  .btn.pressed {
    transform: scale(0.94);
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-primary) 40%, transparent);
  }
  .cli {
    min-height: 3.4em;
    font-size: 11px;
    line-height: 1.6;
    color: var(--color-muted-foreground);
    overflow-wrap: anywhere;
  }
  .dollar {
    color: #22d3ee;
    font-weight: 700;
  }
  .done {
    color: #4ade80;
  }
  .tick {
    font-weight: 700;
  }
  .caret {
    display: inline-block;
    width: 0.5em;
    height: 1.05em;
    margin-left: 1px;
    vertical-align: -0.15em;
    background: currentColor;
  }
  @media (max-width: 480px) {
    .field {
      grid-template-columns: 1fr;
      gap: 0.3rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .btn {
      transition: none;
    }
  }
</style>
