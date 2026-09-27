<script>
  import { links } from '../shared/brand.js';
  import PixelTree from '../shared/PixelTree.svelte';
  import { trackLandingEvent } from '../../lib/analytics.js';
  import Icon from './Icon.svelte';

  /** @type {{ sim: import('./sim.svelte.js').Sim }} */
  let { sim } = $props();

  // The grove grows one sapling for every branch merged in the demo above.
  // Trees alternate sides and shrink towards the edges, so new ones appear outermost.
  const MAX = 10;
  const saplings = $derived(Array.from({ length: Math.min(sim.trees, MAX) }, (_, k) => k));
  const left = $derived(saplings.filter((k) => k % 2 === 0).reverse());
  const right = $derived(saplings.filter((k) => k % 2 === 1));
  const size = (/** @type {number} */ k) => Math.max(18, 40 - Math.floor(k / 2) * 5);
  const fade = (/** @type {number} */ k) => Math.max(0.45, 0.85 - Math.floor(k / 2) * 0.1);
</script>

<section class="cta relative overflow-hidden border-t border-border">
  <div class="glow" aria-hidden="true"></div>
  <div class="relative max-w-[1140px] mx-auto px-4 sm:px-6 py-24 md:py-32 text-center">
    <div class="grove" aria-hidden="true">
      {#each left as k (k)}
        <PixelTree width={size(k)} grow opacity={fade(k)} />
      {/each}
      <PixelTree width={64} />
      {#each right as k (k)}
        <PixelTree width={size(k)} grow opacity={fade(k)} />
      {/each}
    </div>
    <p class="grove-note" aria-live="polite">
      {#if sim.trees > 0}
        {sim.trees} {sim.trees === 1 ? 'branch' : 'branches'} merged in the demo, {sim.trees === 1 ? 'one tree' : 'one tree each'}.
      {:else}
        Open a PR in the demo and a tree grows here.
      {/if}
    </p>

    <h2 class="mt-10 text-2xl md:text-4xl font-bold tracking-tight">Try it on your own project</h2>
    <div class="mt-8 flex flex-wrap justify-center gap-3">
      <a
        href={links.releases}
        target="_blank"
        rel="noopener"
        class="btn-primary"
        onclick={() => trackLandingEvent('download_click', { location: 'workbench-cta' })}
      >
        <Icon name="download" />
        Download for Windows
      </a>
      <a
        href={links.github}
        target="_blank"
        rel="noopener"
        class="btn-secondary"
        onclick={() => trackLandingEvent('github_click', { location: 'workbench-cta' })}
      >
        <Icon name="github" />
        View source
      </a>
    </div>
    <p class="mt-6 text-sm text-muted-foreground">
      Windows 10+, needs git 2.17+ and Claude Code CLI. Free and open source (MIT).
    </p>
  </div>
</section>

<style>
  .glow {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 50% 60% at 50% 30%, oklch(0.5 0.15 145 / 0.1), transparent 70%);
    pointer-events: none;
  }
  .grove {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 0.5rem;
    min-height: 74px;
    filter: drop-shadow(0 0 22px oklch(0.5 0.15 145 / 0.3));
  }
  .grove-note {
    margin-top: 1rem;
    font-size: 14px;
    color: var(--color-muted-foreground);
  }
</style>
