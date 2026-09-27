<script>
  import { inView } from '../shared/motion.js';
  import { LANE_COLORS } from './scripts.js';
  import { statusColors } from '../shared/brand.js';

  const steps = [
    { n: '01', title: 'Add a project', text: 'Point Grove Bench at any git project on your machine.' },
    { n: '02', title: 'Press + Agent', text: 'Each conversation gets a fresh worktree, branch and terminal.' },
    { n: '03', title: 'Review and merge', text: 'Check the diffs, rewind a turn if needed, then merge or open a PR.' },
  ];
</script>

<section id="how" class="how border-t border-border bg-sidebar/40 scroll-mt-14" use:inView={{ threshold: 0.2 }}>
  <div class="max-w-[1140px] mx-auto px-4 sm:px-6 py-20 md:py-28">
    <header class="mb-12 md:mb-16 max-w-2xl">
      <p class="text-xs text-primary font-medium uppercase tracking-wider mb-3">How it works</p>
      <h2 class="text-2xl md:text-3xl font-bold tracking-tight">From project to merged branch</h2>
    </header>

    <ol class="steps">
      {#each steps as step, i (step.n)}
        <li class="step">
          <div class="icon" aria-hidden="true">
            {#if i === 0}
              <!-- Folder with a plus -->
              <svg viewBox="0 0 12 12" width="64" height="64" shape-rendering="crispEdges">
                <g class="folder anim">
                  <rect x="1" y="2" width="4" height="1" fill="#c09a6c" />
                  <rect x="1" y="3" width="10" height="7" fill="#8a6a4a" />
                  <rect x="1" y="4" width="10" height="1" fill="#c09a6c" />
                </g>
                <g class="plus anim">
                  <rect x="8" y="6" width="1" height="5" fill={statusColors.working} />
                  <rect x="6" y="8" width="5" height="1" fill={statusColors.working} />
                </g>
              </svg>
            {:else if i === 1}
              <!-- A trunk sprouting three branches -->
              <svg viewBox="0 0 12 12" width="64" height="64" shape-rendering="crispEdges">
                <rect x="1" y="1" width="1" height="10" fill="oklch(0.62 0 0)" />
                {#each [statusColors.working, statusColors.permission, statusColors.ready] as colour, b (b)}
                  <g class="sprout anim" style="animation-delay: {b * 0.35}s">
                    <rect x="2" y={2 + b * 3.5} width="6" height="1" fill={LANE_COLORS[b]} />
                  </g>
                  <rect class="tip anim" x="8" y={1.5 + b * 3.5} width="2" height="2" fill={colour} style="animation-delay: {b * 0.35}s" />
                {/each}
              </svg>
            {:else}
              <!-- A branch merging back into main -->
              <svg viewBox="0 0 12 12" width="64" height="64" shape-rendering="crispEdges">
                <rect x="0" y="9" width="12" height="1" fill="oklch(0.62 0 0)" />
                <rect x="2" y="4" width="1" height="5" fill={LANE_COLORS[1]} />
                <rect x="2" y="3" width="7" height="1" fill={LANE_COLORS[1]} />
                <rect x="9" y="3" width="1" height="6" fill={LANE_COLORS[1]} />
                <rect class="runner anim" x="1.5" y="2.5" width="2" height="2" fill="#6ec87a" />
                <rect class="pop anim" x="8.5" y="8.5" width="2" height="2" fill="#6ec87a" />
              </svg>
            {/if}
          </div>
          <p class="n">{step.n}</p>
          <h3 class="text-base md:text-lg font-bold tracking-tight">{step.title}</h3>
          <p class="text">{step.text}</p>
        </li>
      {/each}
    </ol>
  </div>
</section>

<style>
  .steps {
    list-style: none;
    display: grid;
    gap: 2.5rem;
  }
  @media (min-width: 768px) {
    .steps {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 2rem;
    }
  }
  .step {
    position: relative;
  }
  /* Dashed track joining the icons on wide screens, with a pixel running along it */
  @media (min-width: 768px) {
    .step:not(:last-child)::after {
      content: '';
      position: absolute;
      top: 48px;
      left: 112px;
      right: 0;
      height: 2px;
      background-image: linear-gradient(90deg, oklch(0.36 0 0) 50%, transparent 50%);
      background-size: 8px 2px;
    }
    .step:not(:last-child)::before {
      content: '';
      position: absolute;
      top: 45px;
      left: 112px;
      width: 8px;
      height: 8px;
      background: var(--color-primary);
      box-shadow: 0 0 10px oklch(0.541 0.181 254.624 / 0.7);
      animation: travel 3s steps(24, jump-none) infinite;
      animation-play-state: paused;
    }
    .step:nth-child(2)::before {
      animation-delay: 1.5s;
      background: #6ec87a;
      box-shadow: 0 0 10px oklch(0.7 0.15 145 / 0.6);
    }
    :global(.how[data-inview='true']) .step::before {
      animation-play-state: running;
    }
  }
  @keyframes travel {
    from {
      left: 112px;
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    90% {
      opacity: 1;
    }
    to {
      left: calc(100% - 8px);
      opacity: 0;
    }
  }
  .icon {
    display: grid;
    place-items: center;
    width: 96px;
    height: 96px;
    border: 1px solid var(--color-border);
    background: var(--color-card);
    margin-bottom: 1.25rem;
  }
  .n {
    font-size: 12px;
    color: var(--color-primary);
    font-weight: 700;
    margin-bottom: 0.375rem;
  }
  .text {
    margin-top: 0.5rem;
    font-size: 14px;
    line-height: 1.6;
    color: var(--color-muted-foreground);
    max-width: 32ch;
  }

  svg :global(rect),
  svg g {
    transform-box: fill-box;
  }
  .anim {
    animation-play-state: paused;
  }
  :global(.how[data-inview='true']) .anim {
    animation-play-state: running;
  }
  .folder {
    transform-origin: bottom;
    animation: bob 2.4s steps(2, jump-none) infinite;
  }
  .plus {
    transform-origin: center;
    animation: plus 2.4s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
  }
  .sprout {
    transform-origin: left;
    animation: sprout 3s steps(6, jump-none) infinite;
  }
  .tip {
    animation: tip 3s steps(1) infinite;
  }
  .runner {
    animation: run 3s steps(12, jump-none) infinite;
  }
  .pop {
    transform-origin: center;
    animation: land 3s ease-out infinite;
  }
  @keyframes bob {
    0%,
    60%,
    100% {
      transform: translateY(0);
    }
    70% {
      transform: translateY(-1px);
    }
  }
  @keyframes plus {
    0%,
    100% {
      transform: scale(1);
    }
    45% {
      transform: scale(1);
    }
    55% {
      transform: scale(0.4) rotate(90deg);
    }
    70% {
      transform: scale(1.25);
    }
    80% {
      transform: scale(1);
    }
  }
  @keyframes sprout {
    0%,
    100% {
      transform: scaleX(1);
    }
    8% {
      transform: scaleX(0.17);
    }
    40% {
      transform: scaleX(1);
    }
  }
  @keyframes tip {
    0%,
    100% {
      opacity: 1;
    }
    8%,
    36% {
      opacity: 0.25;
    }
  }
  /* Up the branch, along, and down into main */
  @keyframes run {
    0% {
      transform: translate(0, 6px);
    }
    25% {
      transform: translate(0, 0);
    }
    70% {
      transform: translate(7px, 0);
    }
    100% {
      transform: translate(7px, 6px);
    }
  }
  @keyframes land {
    0%,
    90% {
      opacity: 0;
      transform: scale(0.5);
    }
    95% {
      opacity: 1;
      transform: scale(1.6);
    }
    100% {
      opacity: 0;
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .anim,
    .step::before {
      animation: none !important;
    }
    .step::before {
      display: none;
    }
    .pop {
      opacity: 0;
    }
  }
</style>
