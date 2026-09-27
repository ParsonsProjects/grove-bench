<script>
  import { slide } from 'svelte/transition';
  import { prefersReducedMotion } from '../../shared/motion.js';
  import { LANE_COLORS } from '../scripts.js';
  import { timeline, typeSteps } from '../timeline.js';
  import StatusDot from '../StatusDot.svelte';

  const ROWS = [
    { id: 'a3f8b2c1', branch: 'feat/jwt-auth', color: LANE_COLORS[0], status: /** @type {const} */ ('working') },
    { id: '7c1e94d0', branch: 'feat/profile-api', color: LANE_COLORS[1], status: /** @type {const} */ ('permission') },
    { id: 'e52b0f7a', branch: 'fix/login-timeout', color: LANE_COLORS[2], status: /** @type {const} */ ('ready') },
  ];
  const MODES = [
    { label: 'New Worktree', note: 'new branch' },
    { label: 'Existing Worktree', note: 'already on disk' },
    { label: 'Direct', note: 'no worktree' },
  ];
  const LEGEND = [
    { status: /** @type {const} */ ('ready'), label: 'Ready' },
    { status: /** @type {const} */ ('working'), label: 'Working' },
    { status: /** @type {const} */ ('permission'), label: 'Waiting for you' },
    { status: /** @type {const} */ ('stopped'), label: 'Stopped' },
  ];
  const cmdFor = (/** @type {typeof ROWS[number]} */ r) => `git worktree add .grove-wt/${r.id} -b ${r.branch}`;

  // At rest the tile shows the finished state; the loop replays it.
  let count = $state(3);
  let hover = $state(0);
  let pressed = $state(false);
  let cmdRow = $state(2);
  let typed = $state(cmdFor(ROWS[2]).length);

  const cmd = $derived(cmdFor(ROWS[cmdRow]));
  const ms = (/** @type {number} */ n) => (prefersReducedMotion.current ? 0 : n);

  /** @type {HTMLDivElement | undefined} */
  let root = $state();

  function build() {
    /** @type {{ wait: number, run: () => void }[]} */
    const steps = [
      { wait: 3200, run: () => ((count = 0), (typed = 0), (hover = -1)) },
    ];
    ROWS.forEach((row, i) => {
      steps.push(
        { wait: 500, run: () => (hover = 2) },
        { wait: 160, run: () => (hover = 1) },
        { wait: 160, run: () => (hover = 0) },
        { wait: 260, run: () => (pressed = true) },
        { wait: 180, run: () => ((pressed = false), (cmdRow = i), (typed = 0)) },
        ...typeSteps(cmdFor(row), 16, (n) => (typed = n)),
        { wait: 220, run: () => (count = i + 1) },
      );
    });
    return steps;
  }

  $effect(() => {
    if (!root || prefersReducedMotion.current) return;
    return timeline(root, build());
  });
</script>

<div class="wt" bind:this={root}>
  <div class="picker" aria-hidden="true">
    <p class="plabel"><span class="agent">+ Agent</span> New conversation</p>
    <div class="opts">
      {#each MODES as mode, i (mode.label)}
        <span class="opt" class:hover={hover === i} class:pressed={pressed && i === 0}>
          <span class="radio" class:on={i === 0}></span>
          <span class="olabel">{mode.label}</span>
          <span class="onote">{mode.note}</span>
        </span>
      {/each}
    </div>
  </div>

  <div class="tree" role="img" aria-label="Folder tree: my-project/.grove-wt/ holds one folder per conversation, each on its own branch">
    <div class="line dir">my-project/</div>
    <div class="line"><span class="g">{'├── '}</span>src/</div>
    <div class="line"><span class="g">{'├── '}</span>package.json</div>
    <div class="line dir"><span class="g">{'└── '}</span>.grove-wt/</div>
    {#each ROWS.slice(0, count) as row, i (row.id)}
      {@const last = i === count - 1}
      <div class="wtrow" transition:slide={{ duration: ms(320) }}>
        <div class="line">
          <span class="g">{'    '}{last ? '└── ' : '├── '}</span><span class="id">{row.id}/</span>
          <span class="br" style="--lane: {row.color}"><StatusDot status={row.status} size={7} />{row.branch}</span>
        </div>
        <div class="line sub"><span class="g">{'    '}{last ? '    ' : '│   '}{'├── '}</span>src/</div>
        <div class="line sub"><span class="g">{'    '}{last ? '    ' : '│   '}{'└── '}</span>package.json</div>
      </div>
    {/each}
  </div>

  <div class="cmd" aria-hidden="true">
    <span class="dollar">$</span>
    {cmd.slice(0, typed)}{#if typed < cmd.length}<span class="caret"></span>{/if}
  </div>

  <ul class="legend" aria-label="Status dots">
    {#each LEGEND as item (item.label)}
      <li><StatusDot status={item.status} size={8} />{item.label}</li>
    {/each}
  </ul>
</div>

<style>
  .wt {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    height: 100%;
    font-size: 12px;
  }
  .picker {
    border: 1px solid var(--color-border);
    background: var(--color-background);
    padding: 0.625rem;
  }
  .plabel {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--color-muted-foreground);
    font-size: 11px;
    margin-bottom: 0.5rem;
  }
  .agent {
    color: white;
    background: var(--color-primary);
    padding: 0.1rem 0.4rem;
    font-weight: 700;
  }
  .opts {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 12px;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--color-border);
    color: var(--color-muted-foreground);
    transition:
      border-color 0.15s ease,
      color 0.15s ease,
      background-color 0.15s ease,
      transform 0.12s ease;
  }
  .opt.hover {
    border-color: color-mix(in srgb, var(--color-primary) 70%, transparent);
    color: var(--color-foreground);
  }
  .opt.pressed {
    background: color-mix(in srgb, var(--color-primary) 30%, var(--color-background));
    color: white;
    transform: scale(0.98);
  }
  .radio {
    width: 8px;
    height: 8px;
    border: 1px solid var(--color-muted-foreground);
    flex-shrink: 0;
  }
  .radio.on {
    background: var(--color-primary);
    border-color: var(--color-primary);
  }
  .olabel {
    white-space: nowrap;
  }
  .onote {
    margin-left: auto;
    font-size: 11px;
    color: var(--color-muted-foreground);
    white-space: nowrap;
  }
  .tree {
    line-height: 1.9;
    color: oklch(0.78 0 0);
  }
  .line {
    white-space: pre;
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .dir {
    color: var(--color-foreground);
    font-weight: 700;
  }
  .g {
    color: oklch(0.45 0 0);
  }
  .id {
    color: var(--color-foreground);
  }
  .sub {
    color: var(--color-muted-foreground);
  }
  .br {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: 0.75rem;
    padding: 0 0.4rem;
    font-size: 11px;
    line-height: 1.7;
    color: var(--lane);
    background: color-mix(in srgb, var(--lane) 12%, transparent);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cmd {
    min-height: 3.2em;
    font-size: 11px;
    line-height: 1.6;
    color: var(--color-muted-foreground);
    overflow-wrap: anywhere;
  }
  .dollar {
    color: #22d3ee;
    font-weight: 700;
    margin-right: 0.25rem;
  }
  .caret {
    display: inline-block;
    width: 0.5em;
    height: 1em;
    vertical-align: -0.12em;
    background: var(--color-muted-foreground);
  }
  .legend {
    margin-top: auto;
    list-style: none;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem 1rem;
    padding-top: 1rem;
    border-top: 1px dashed var(--color-border);
    color: var(--color-muted-foreground);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  @media (prefers-reduced-motion: reduce) {
    .opt {
      transition: none;
    }
  }
</style>
