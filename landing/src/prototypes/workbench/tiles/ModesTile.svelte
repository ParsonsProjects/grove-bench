<script>
  import { fly } from 'svelte/transition';
  import { prefersReducedMotion } from '../../shared/motion.js';
  import { timeline } from '../timeline.js';

  const ACTIONS = [
    { tool: 'Read', target: 'src/routes/index.ts' },
    { tool: 'Edit', target: 'src/middleware/auth.ts' },
    { tool: 'Bash', target: 'npm test' },
  ];

  /** @typedef {'runs' | 'asks' | 'applied' | 'planned'} Outcome */
  const MODES = [
    { id: 'default', label: 'Default', line: 'Asks before edits and commands.', out: /** @type {Outcome[]} */ (['runs', 'asks', 'asks']) },
    { id: 'plan', label: 'Plan', line: 'Explores and plans. Edits nothing.', out: /** @type {Outcome[]} */ (['runs', 'planned', 'planned']) },
    { id: 'acceptEdits', label: 'AcceptEdits', line: 'Applies edits. Commands still ask.', out: /** @type {Outcome[]} */ (['runs', 'applied', 'asks']) },
  ];
  const WORDS = { runs: 'runs', asks: 'asks you', applied: 'applied', planned: 'in the plan' };

  let mode = $state(0);
  let row = $state(1);
  let auto = $state(true);

  const current = $derived(MODES[mode]);
  const ms = (/** @type {number} */ n) => (prefersReducedMotion.current ? 0 : n);

  /** @param {number} i */
  function pick(i) {
    auto = false;
    mode = i;
    row = -1;
  }

  /** @param {KeyboardEvent} e */
  function onkeydown(e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (mode + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length;
    pick(next);
    /** @type {HTMLElement | null} */ (root?.querySelector(`[data-mode="${next}"]`) ?? null)?.focus();
  }

  /** @type {HTMLDivElement | undefined} */
  let root = $state();

  // An agent "cursor" walks down the actions; the mode changes every lap
  // until the visitor picks one.
  $effect(() => {
    if (!root || prefersReducedMotion.current) return;
    const steps = [];
    for (let lap = 0; lap < 2; lap++) {
      for (let r = 0; r < ACTIONS.length; r++) steps.push({ wait: 650, run: () => (row = r) });
    }
    steps.push({ wait: 900, run: () => (row = -1) });
    steps.push({
      wait: 500,
      run: () => {
        if (auto) mode = (mode + 1) % MODES.length;
      },
    });
    return timeline(root, steps);
  });
</script>

<div class="modes" bind:this={root}>
  <div class="seg" role="radiogroup" aria-label="Permission mode" tabindex="-1" {onkeydown}>
    {#each MODES as m, i (m.id)}
      <button
        role="radio"
        aria-checked={mode === i}
        tabindex={mode === i ? 0 : -1}
        data-mode={i}
        class:on={mode === i}
        onclick={() => pick(i)}
      >
        {m.label}
      </button>
    {/each}
  </div>

  <p class="line" aria-live="polite">
    {#key current.id}<span in:fly={{ y: 6, duration: ms(240) }}>{current.line}</span>{/key}
  </p>

  <ul class="acts">
    {#each ACTIONS as a, i (a.tool)}
      {@const out = current.out[i]}
      <li class:active={row === i}>
        <span class="tool">{a.tool}</span>
        <span class="target">{a.target}</span>
        {#key current.id + out}
          <span class="out {out}" in:fly={{ x: 10, duration: ms(260), delay: ms(i * 70) }}>{WORDS[out]}</span>
        {/key}
      </li>
    {/each}
  </ul>
</div>

<style>
  .modes {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    height: 100%;
    font-size: 12px;
  }
  .seg {
    display: flex;
    border: 1px solid var(--color-border);
    background: var(--color-background);
    align-self: flex-start;
    max-width: 100%;
  }
  .seg button {
    font: inherit;
    font-size: 12px;
    padding: 0.4rem 0.7rem;
    color: var(--color-muted-foreground);
    background: none;
    border: 0;
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      color 0.2s ease;
  }
  .seg button:hover {
    color: var(--color-foreground);
  }
  .seg button.on {
    background: var(--color-primary);
    color: white;
    font-weight: 700;
  }
  .line {
    min-height: 1.5em;
    color: var(--color-foreground);
  }
  .line span {
    display: inline-block;
  }
  .acts {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .acts li {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.45rem 0.625rem;
    border: 1px solid var(--color-border);
    border-left: 3px solid var(--color-border);
    background: var(--color-background);
    min-width: 0;
    transition:
      border-color 0.2s ease,
      background-color 0.2s ease;
  }
  .acts li.active {
    border-left-color: var(--color-primary);
    background: color-mix(in oklch, var(--color-primary) 8%, var(--color-background));
  }
  .tool {
    font-weight: 700;
    color: var(--color-foreground);
    width: 4ch;
    flex-shrink: 0;
  }
  .target {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-muted-foreground);
  }
  .out {
    flex-shrink: 0;
    font-size: 11px;
    padding: 0.1rem 0.4rem;
  }
  .out.runs {
    color: oklch(0.78 0 0);
    background: var(--color-muted);
  }
  .out.asks {
    color: #fbbf24;
    background: color-mix(in oklch, #f59e0b 14%, transparent);
  }
  .out.applied {
    color: #4ade80;
    background: color-mix(in oklch, #22c55e 14%, transparent);
  }
  .out.planned {
    color: var(--color-muted-foreground);
    border: 1px dashed var(--color-border);
  }
  @media (prefers-reduced-motion: reduce) {
    .seg button,
    .acts li {
      transition: none;
    }
  }
</style>
