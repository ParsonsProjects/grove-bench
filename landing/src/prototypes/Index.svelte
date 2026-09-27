<script>
  import PixelTree from './shared/PixelTree.svelte';

  const prototypes = [
    {
      href: './branches.html',
      name: 'Branches',
      pitch: 'The page is a git log. A graph draws down the page as you scroll, forks into agent lanes and merges back into a growing tree.',
      try: 'Scrub the checkpoints, answer the permission prompt.',
      lanes: ['var(--color-primary)', 'oklch(0.65 0.15 200)', '#6ec87a'],
    },
    {
      href: './workbench.html',
      name: 'Workbench',
      pitch: 'The hero is a playable copy of the app. Agents run by themselves until you take over, then you drive.',
      try: 'Start agents, approve edits, rewind a turn, open a PR.',
      lanes: ['var(--color-primary)', '#f59e0b', '#22c55e'],
    },
    {
      href: './grove.html',
      name: 'Night Grove',
      pitch: 'The name made literal. Each agent works at its own bench under its own tree, and night turns to day as you scroll.',
      try: 'Click an agent, plant a tree, drag the sundial.',
      lanes: ['#6ec87a', '#8a6a4a', 'var(--color-primary)'],
    },
    {
      href: './path.html',
      name: 'Grove Path',
      pitch: 'Branches meets Night Grove. The git lanes are pixel paths, and the agents walk down them with you as you scroll.',
      try: 'Answer the agent at the gate, drag the sundial to walk one back.',
      lanes: ['var(--color-primary)', 'oklch(0.65 0.15 200)', '#6ec87a'],
    },
    {
      href: './log.html',
      name: 'Grove Log',
      pitch: 'The Branches git log, with a small pixel scene for every commit. One night passes as you scroll.',
      try: 'Answer the permission prompt, drag the sundial, click a character.',
      lanes: ['#6ec87a', 'var(--color-primary)', '#f59e0b'],
    },
    {
      href: './canopy.html',
      name: 'Canopy',
      pitch: 'A tall grove behind the page. Scroll down from the night sky, past the agents on their branches, to the ground at dawn.',
      try: 'Answer the agent on its branch, wind a branch back, click a character.',
      lanes: ['#8a6a4a', '#6ec87a', 'var(--color-primary)'],
    },
  ];
</script>

<main class="min-h-screen bg-background text-foreground">
  <div class="max-w-4xl mx-auto px-4 sm:px-6 py-16 md:py-24">
    <header class="flex items-end gap-4 mb-12">
      <PixelTree width={42} grow label="Grove Bench" />
      <div>
        <p class="text-xs text-primary uppercase tracking-wider mb-1">Landing page prototypes</p>
        <h1 class="text-2xl md:text-3xl font-bold tracking-tight">Pick a direction</h1>
      </div>
    </header>

    <ol class="grid gap-4">
      {#each prototypes as p, i}
        <li>
          <a href={p.href} class="proto group block border border-border bg-card p-5 md:p-6">
            <div class="flex items-baseline gap-3 mb-3">
              <span class="text-xs text-muted-foreground tabular-nums">{String.fromCharCode(65 + i)}</span>
              <h2 class="text-lg md:text-xl font-bold tracking-tight">{p.name}</h2>
              <span class="ml-auto flex gap-1" aria-hidden="true">
                {#each p.lanes as colour, j}
                  <span class="lane" style="background: {colour}; animation-delay: {j * 0.2}s"></span>
                {/each}
              </span>
            </div>
            <p class="text-sm text-muted-foreground leading-relaxed max-w-prose">{p.pitch}</p>
            <p class="text-sm mt-3"><span class="text-primary">Try:</span> {p.try}</p>
          </a>
        </li>
      {/each}
    </ol>

    <p class="mt-10 text-sm text-muted-foreground">
      Compare with the <a href="https://parsonsprojects.github.io/grove-bench/" target="_blank" rel="noopener" class="text-foreground underline underline-offset-4">current landing page</a>.
    </p>
  </div>
</main>

<style>
  .proto {
    transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
  }
  .proto:hover {
    border-color: oklch(0.541 0.181 254.624 / 0.5);
    background-color: oklch(0.245 0.005 250);
    transform: translateY(-2px);
  }
  .proto:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 3px;
  }
  .lane {
    width: 6px;
    height: 18px;
    animation: lane-grow 1.6s ease-in-out infinite alternate;
    transform-origin: bottom;
  }
  @keyframes lane-grow {
    from {
      transform: scaleY(0.35);
    }
    to {
      transform: scaleY(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lane,
    .proto {
      animation: none;
      transition: none;
    }
  }
</style>
