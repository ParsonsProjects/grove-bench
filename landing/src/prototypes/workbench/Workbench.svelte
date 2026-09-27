<script>
  import { onMount } from 'svelte';
  import { prefersReducedMotion } from '../shared/motion.js';
  import { links } from '../shared/brand.js';
  import PixelTree from '../shared/PixelTree.svelte';
  import { initLandingAnalytics, trackLandingEvent } from '../../lib/analytics.js';
  import { Sim } from './sim.svelte.js';
  import Simulator from './Simulator.svelte';
  import Features from './Features.svelte';
  import HowItWorks from './HowItWorks.svelte';
  import Cta from './Cta.svelte';
  import Icon from './Icon.svelte';

  const sim = new Sim({ reduced: prefersReducedMotion.current });

  onMount(() => {
    initLandingAnalytics();
  });

  const footerLinks = [
    { label: 'GitHub', href: links.github },
    { label: 'Releases', href: links.releases },
    { label: 'Contributing', href: links.contributing },
    { label: 'License', href: links.license },
    { label: 'Issues', href: links.issues },
  ];
</script>

<div class="wb min-h-screen bg-background text-foreground">
  <nav class="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md">
    <div class="max-w-[1140px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
      <a href="#top" class="flex items-center gap-2.5" aria-label="Grove Bench, back to top">
        <PixelTree width={16} />
        <span class="text-sm font-bold tracking-tight">Grove Bench</span>
      </a>
      <div class="flex items-center gap-6">
        <a href="#bench" class="navlink hidden md:block">What's inside</a>
        <a href="#how" class="navlink hidden md:block">How it works</a>
        <a
          href={links.github}
          target="_blank"
          rel="noopener"
          class="text-xs bg-primary text-primary-foreground px-4 py-2 font-medium hover:brightness-110 transition-all inline-flex items-center gap-2"
          onclick={() => trackLandingEvent('github_click', { location: 'workbench-nav' })}
        >
          <Icon name="github" />
          GitHub
        </a>
      </div>
    </div>
  </nav>

  <main id="top">
    <!-- Hero: the product itself -->
    <section class="hero relative">
      <div class="hero-bg" aria-hidden="true"></div>
      <div class="relative max-w-[1140px] mx-auto px-4 sm:px-6 pt-12 md:pt-16 pb-20 md:pb-28">
        <div class="text-center mx-auto">
          <h1 class="text-[28px] leading-[1.15] sm:text-4xl lg:text-[44px] font-bold tracking-tight">
            Run AI agents <span class="text-gradient whitespace-nowrap">side by side.</span>
          </h1>
          <p class="mt-4 text-sm sm:text-base text-muted-foreground leading-relaxed">
            Every conversation gets its own git worktree, branch and terminal.
          </p>
          <div class="mt-7 flex flex-wrap justify-center gap-3">
            <a
              href={links.releases}
              target="_blank"
              rel="noopener"
              class="btn-primary"
              onclick={() => trackLandingEvent('download_click', { location: 'workbench-hero' })}
            >
              <Icon name="download" />
              Download for Windows
            </a>
            <a
              href={links.github}
              target="_blank"
              rel="noopener"
              class="btn-secondary"
              onclick={() => trackLandingEvent('github_click', { location: 'workbench-hero' })}
            >
              <Icon name="github" />
              View source
            </a>
          </div>
        </div>

        <div class="mt-10 md:mt-12 max-w-[1100px] mx-auto">
          <Simulator {sim} />
        </div>
      </div>
    </section>

    <Features />
    <HowItWorks />
    <Cta {sim} />
  </main>

  <footer class="border-t border-border bg-card">
    <div class="max-w-[1140px] mx-auto px-4 sm:px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-5">
      <div class="flex items-center gap-2.5">
        <PixelTree width={12} />
        <span class="text-sm text-foreground">Grove Bench</span>
        <span class="text-sm text-muted-foreground ml-2">Open source under MIT</span>
      </div>
      <ul class="flex flex-wrap justify-center gap-x-6 gap-y-2">
        {#each footerLinks as link (link.label)}
          <li>
            <a href={link.href} target="_blank" rel="noopener" class="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {link.label}
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </footer>
</div>

<style>
  .wb {
    overflow-x: clip;
  }
  .wb :global(:focus-visible) {
    outline: 2px solid oklch(0.66 0.16 254.6);
    outline-offset: 2px;
  }
  .wb :global(button),
  .wb :global(a) {
    -webkit-tap-highlight-color: transparent;
  }
  .navlink {
    font-size: 0.8125rem;
    color: var(--color-muted-foreground);
    transition: color 0.15s ease;
  }
  .navlink:hover {
    color: var(--color-foreground);
  }
  .hero-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(ellipse 70% 45% at 50% 58%, oklch(0.541 0.181 254.624 / 0.12), transparent 70%),
      radial-gradient(ellipse 50% 30% at 50% 0%, oklch(0.541 0.181 254.624 / 0.08), transparent 70%);
  }
  .hero-bg::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(oklch(1 0 0 / 0.025) 1px, transparent 1px),
      linear-gradient(90deg, oklch(1 0 0 / 0.025) 1px, transparent 1px);
    background-size: 24px 24px;
    -webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 45%, #000, transparent 75%);
    mask-image: radial-gradient(ellipse 80% 70% at 50% 45%, #000, transparent 75%);
  }
</style>
