<script>
  import { fade, slide } from 'svelte/transition';
  import { prefersReducedMotion } from '../../shared/motion.js';
  import { timeline } from '../timeline.js';

  const FOLDERS = ['repo/', 'conventions/', 'architecture/', 'sessions/'];

  /** @typedef {{ id: number, f: number, text: string }} Note */

  /** @type {Note[]} */
  const BASE = [
    { id: 1, f: 0, text: 'Express API in src/' },
    { id: 2, f: 1, text: 'Validate input with zod' },
    { id: 3, f: 2, text: 'Auth runs as /api middleware' },
    { id: 4, f: 3, text: 'Auth: JWT with refresh, 1h TTL' },
  ];
  /** @type {(Note & { cost: number })[]} */
  const INCOMING = [
    { id: 5, f: 3, text: 'profile-api: routes and tests', cost: 12 },
    { id: 6, f: 1, text: 'Tests sit next to routes', cost: 10 },
    { id: 7, f: 3, text: 'dark-mode: theme store added', cost: 11 },
    { id: 8, f: 0, text: 'Docs live in README.md', cost: 10 },
  ];
  /** @type {Note[]} */
  const COMPACTED = [
    { id: 11, f: 0, text: 'Express API in src/, docs in README' },
    { id: 12, f: 1, text: 'zod for input, tests next to routes' },
    { id: 13, f: 2, text: 'Auth runs as /api middleware' },
    { id: 14, f: 3, text: 'Shipped: auth, profile API, dark mode' },
  ];
  const BASE_BUDGET = 44;

  // At rest: memory has grown close to its budget, just before a compaction.
  const FULL = [...BASE, ...INCOMING.map(({ id, f, text }) => ({ id, f, text }))];
  const FULL_BUDGET = INCOMING.reduce((n, note) => n + note.cost, BASE_BUDGET);

  let lines = $state(FULL.slice());
  let budget = $state(FULL_BUDGET);
  let lit = $state(-1);
  let compacting = $state(false);
  /** @type {{ id: number, text: string, x0: number, y0: number, x1: number, y1: number } | null} */
  let packet = $state(null);

  /** @type {HTMLDivElement | undefined} */
  let root = $state();
  /** @type {HTMLDivElement | undefined} */
  let box = $state();

  /** @param {Note & { cost: number }} note */
  function emit(note) {
    lit = note.f;
    const chip = root?.querySelectorAll('.folder')[note.f];
    if (!root || !box || !chip) return;
    const r = root.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    packet = {
      id: note.id,
      text: note.text,
      x0: c.left - r.left + 6,
      y0: c.top - r.top + 4,
      x1: b.left - r.left + 16,
      y1: b.top - r.top + 40 + lines.length * 21,
    };
  }

  /** @param {Note & { cost: number }} note */
  function land(note) {
    packet = null;
    lit = -1;
    lines.push({ id: note.id, f: note.f, text: note.text });
    budget = Math.min(96, budget + note.cost);
  }

  function build() {
    /** @type {{ wait: number, run: () => void }[]} */
    const steps = [
      { wait: 1800, run: () => (compacting = true) },
      { wait: 1300, run: () => ((lines = COMPACTED.slice()), (budget = 58), (compacting = false)) },
      { wait: 3000, run: () => ((lines = BASE.slice()), (budget = BASE_BUDGET)) },
    ];
    for (const note of INCOMING) {
      steps.push({ wait: 1100, run: () => emit(note) }, { wait: 750, run: () => land(note) });
    }
    return steps;
  }

  $effect(() => {
    if (!root || prefersReducedMotion.current) return;
    const stop = timeline(root, build());
    return () => {
      stop();
      packet = null;
      lit = -1;
    };
  });

  /** @param {HTMLElement} node @param {{ x0: number, y0: number, x1: number, y1: number }} p */
  function fly(node, p) {
    const anim = node.animate(
      [
        { transform: `translate(${p.x0}px, ${p.y0}px) scale(1)`, opacity: 1 },
        { transform: `translate(${p.x1}px, ${p.y1}px) scale(0.9)`, opacity: 0.35 },
      ],
      { duration: 720, easing: 'cubic-bezier(0.5, 0, 0.25, 1)', fill: 'forwards' },
    );
    return { destroy: () => anim.cancel() };
  }

  const ms = (/** @type {number} */ n) => (prefersReducedMotion.current ? 0 : n);
</script>

<div class="mem" bind:this={root}>
  <ul class="folders" aria-label="Memory folders">
    {#each FOLDERS as folder, i (folder)}
      <li class="folder" class:lit={lit === i}>
        <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true"><path fill="currentColor" d="M0 0h5v2h7v8H0z" /></svg>
        {folder}
      </li>
    {/each}
  </ul>

  <div class="box" bind:this={box} class:compacting>
    <div class="bhead">
      <span>System prompt</span>
      <span class="meter" role="meter" aria-label="Memory budget" aria-valuenow={budget} aria-valuemin="0" aria-valuemax="100">
        <span class="mlabel">{compacting ? 'compacting' : 'budget'}</span>
        <span class="mbar"><span class="mfill" class:high={budget > 80} style="width: {budget}%"></span></span>
        <span class="pct">{budget}%</span>
      </span>
    </div>
    <ul class="notes" aria-label="Notes read at the start of each conversation">
      {#each lines as line (line.id)}
        <li in:slide={{ duration: ms(260) }} out:fade={{ duration: ms(200) }}>
          <span class="dash" aria-hidden="true">-</span>
          <span class="ntext">{line.text}</span>
          <span class="tag">{FOLDERS[line.f]}</span>
        </li>
      {/each}
    </ul>
  </div>

  {#if packet}
    {#key packet.id}
      <span class="packet" use:fly={packet} aria-hidden="true">{packet.text}</span>
    {/key}
  {/if}
</div>

<style>
  .mem {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    height: 100%;
    font-size: 12px;
  }
  .folders {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .folder {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--color-border);
    background: var(--color-background);
    color: oklch(0.78 0 0);
    transition:
      border-color 0.2s ease,
      background-color 0.2s ease,
      color 0.2s ease;
  }
  .folder svg {
    color: #c09a6c;
  }
  .folder.lit {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 16%, var(--color-background));
    color: var(--color-foreground);
  }
  .box {
    border: 1px solid var(--color-border);
    background: var(--color-background);
    transition: border-color 0.3s ease;
  }
  .box.compacting {
    border-color: color-mix(in srgb, var(--color-primary) 60%, transparent);
  }
  .bhead {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-foreground);
    font-weight: 700;
  }
  .meter {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 400;
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
  .mlabel {
    min-width: 10ch;
    text-align: right;
  }
  .compacting .mlabel {
    color: color-mix(in srgb, var(--color-primary) 70%, white);
  }
  .mbar {
    width: 72px;
    height: 5px;
    background: var(--color-muted);
  }
  .mfill {
    display: block;
    height: 100%;
    background: #22c55e;
    transition:
      width 0.6s cubic-bezier(0.65, 0, 0.35, 1),
      background-color 0.3s ease;
  }
  .mfill.high {
    background: #f59e0b;
  }
  .pct {
    width: 3.5ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--color-foreground);
  }
  .notes {
    list-style: none;
    padding: 0.5rem 0.75rem 0.625rem;
    min-height: calc(8 * 21px + 1.125rem);
  }
  .notes li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 21px;
    color: oklch(0.8 0 0);
    min-width: 0;
  }
  .dash {
    color: var(--color-muted-foreground);
  }
  .ntext {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    font-size: 11px;
    color: var(--color-muted-foreground);
    flex-shrink: 0;
  }
  .packet {
    position: absolute;
    left: 0;
    top: 0;
    padding: 0.2rem 0.5rem;
    font-size: 11px;
    white-space: nowrap;
    color: white;
    background: var(--color-primary);
    box-shadow: 0 6px 18px oklch(0.541 0.181 254.624 / 0.45);
    pointer-events: none;
    z-index: 2;
  }
  @media (max-width: 480px) {
    .tag {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .folder,
    .mfill,
    .box {
      transition: none;
    }
  }
</style>
