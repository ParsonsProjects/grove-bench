<script>
  import { prefersReducedMotion } from '../../shared/motion.js';
  import { timeline, typeSteps } from '../timeline.js';

  const PROMPT = 'C:\\my-project\\.grove-wt\\e52b0f7a>';
  const RUNS = [
    {
      cmd: 'npm test',
      out: [
        { t: '> vitest run', c: 'dim' },
        { t: '', c: '' },
        { t: ' ✓ src/auth/session.test.ts (2 tests)', c: 'ok' },
        { t: ' ✓ src/middleware/auth.test.ts (4 tests)', c: 'ok' },
        { t: '', c: '' },
        { t: ' Test Files  2 passed (2)', c: '' },
        { t: '      Tests  6 passed (6)', c: 'okb' },
      ],
    },
    {
      // "+" marks branches checked out in the other worktrees.
      cmd: 'git branch',
      out: [
        { t: '+ feat/jwt-auth', c: 'other' },
        { t: '+ feat/profile-api', c: 'other' },
        { t: '* fix/login-timeout', c: 'ok' },
        { t: '  main', c: '' },
      ],
    },
  ];

  let run = $state(0);
  let typed = $state(RUNS[0].cmd.length);
  let shown = $state(RUNS[0].out.length);

  const current = $derived(RUNS[run]);
  const busy = $derived(typed < current.cmd.length || shown < current.out.length);

  /** @type {HTMLDivElement | undefined} */
  let root = $state();

  function build() {
    /** @type {{ wait: number, run: () => void }[]} */
    const steps = [];
    for (const next of [1, 0]) {
      const r = RUNS[next];
      steps.push(
        { wait: 3200, run: () => ((run = next), (typed = 0), (shown = 0)) },
        { wait: 400, run: () => {} },
        ...typeSteps(r.cmd, 75, (n) => (typed = n)),
        { wait: 350, run: () => {} },
        ...r.out.map((_, i) => ({ wait: i === 0 ? 200 : 130, run: () => (shown = i + 1) })),
      );
    }
    return steps;
  }

  $effect(() => {
    if (!root || prefersReducedMotion.current) return;
    return timeline(root, build());
  });
</script>

<div class="term" bind:this={root} role="img" aria-label="A terminal in the fix/login-timeout worktree running npm test: 6 tests pass. Then git branch lists the branches, with the other conversations' branches marked as checked out elsewhere.">
  <div class="bar" aria-hidden="true">
    <span>Terminal</span>
    <span class="dim">fix/login-timeout</span>
    <span class="pty">PTY</span>
  </div>
  <div class="screen" aria-hidden="true">
    <div><span class="p">{PROMPT}</span>{current.cmd.slice(0, typed)}{#if typed < current.cmd.length}<span class="caret"></span>{/if}</div>
    {#each current.out.slice(0, shown) as line, i (i)}
      <div class={line.c}>{line.t || ' '}</div>
    {/each}
    {#if !busy}
      <div><span class="p">{PROMPT}</span><span class="caret blink"></span></div>
    {/if}
  </div>
</div>

<style>
  .term {
    border: 1px solid var(--color-border);
    background: #1a1a1a;
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-sidebar);
    font-size: 11px;
    color: var(--color-foreground);
  }
  .dim {
    color: var(--color-muted-foreground);
  }
  .pty {
    margin-left: auto;
    color: var(--color-muted-foreground);
    border: 1px solid var(--color-border);
    padding: 0 0.3rem;
  }
  .screen {
    flex: 1;
    min-height: 16.5em;
    padding: 0.625rem 0.75rem;
    font-size: 11px;
    line-height: 1.6;
    color: #cccccc;
    white-space: pre-wrap;
  }
  .p {
    color: #6ec87a;
  }
  .screen .dim {
    color: #888;
  }
  .ok {
    color: #6ec87a;
  }
  .okb {
    color: #6ec87a;
    font-weight: 700;
  }
  .other {
    color: #22d3ee;
  }
  .caret {
    display: inline-block;
    width: 0.55em;
    height: 1.1em;
    vertical-align: -0.2em;
    background: #cccccc;
  }
  .blink {
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .blink {
      animation: none;
    }
  }
</style>
