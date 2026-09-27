<script>
  import './log.css';
  import { prefersReducedMotion } from '../shared/motion.js';
  import { links, treeGreens } from '../shared/brand.js';
  import { trackLandingEvent } from '../../lib/analytics.js';
  import { GithubIcon } from '../branches/icons.js';
  import Graph from './Graph.svelte';
  import Hero from './Hero.svelte';
  import Key from './Key.svelte';
  import Worktrees from './sections/Worktrees.svelte';
  import Terminals from './sections/Terminals.svelte';
  import Isolation from './sections/Isolation.svelte';
  import Permissions from './sections/Permissions.svelte';
  import Checkpoints from './sections/Checkpoints.svelte';
  import Memory from './sections/Memory.svelte';
  import Ship from './sections/Ship.svelte';
  import HowItWorks from './sections/HowItWorks.svelte';
  import Cta from './sections/Cta.svelte';

  /** @type {HTMLElement | undefined} */
  let logEl = $state();
  const reduced = $derived(prefersReducedMotion.current);

  const footerLinks = [
    { label: 'GitHub', href: links.github },
    { label: 'Releases', href: links.releases },
    { label: 'Contributing', href: links.contributing },
    { label: 'License', href: links.license },
    { label: 'Issues', href: links.issues },
  ];
</script>

{#snippet logo(size)}
  <svg width={size} height={Math.round((size * 24) / 21)} viewBox="0 0 21 24" fill="none" aria-hidden="true" shape-rendering="crispEdges">
    {#each treeGreens as p}
      <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />
    {/each}
  </svg>
{/snippet}

<div class="lg-page">
  <a class="skip" href="#lg-main">Skip to content</a>

  <nav class="nav" aria-label="Main">
    <div class="lg-wrap nav-inner">
      <a href="#top" class="brand" aria-label="Grove Bench, back to top">
        {@render logo(16)}
        <span>Grove Bench</span>
      </a>
      <span class="nav-log" aria-hidden="true">git log --graph</span>
      <div class="nav-right">
        <Key />
        <a
          href={links.github}
          target="_blank"
          rel="noopener"
          class="nav-gh"
          onclick={() => trackLandingEvent('github_click', { location: 'log-nav' })}
        >
          {@html GithubIcon}
          GitHub
        </a>
      </div>
    </div>
  </nav>

  <main id="lg-main" class="lg-log" bind:this={logEl}>
    <span id="top" class="top-anchor"></span>
    {#if logEl}
      <Graph container={logEl} {reduced} />
    {/if}

    <Hero {reduced} />
    <Worktrees {reduced} />
    <Terminals {reduced} />
    <Isolation {reduced} />
    <Permissions {reduced} />
    <Checkpoints {reduced} />
    <Memory {reduced} />
    <Ship {reduced} />
    <HowItWorks />
    <Cta {reduced} />
  </main>

  <footer class="footer">
    <div class="lg-wrap foot-inner">
      <div class="foot-brand">
        {@render logo(12)}
        <span>Grove Bench</span>
        <span class="mit">Open source under MIT</span>
      </div>
      <ul class="foot-links">
        {#each footerLinks as l}
          <li>
            <a
              href={l.href}
              target="_blank"
              rel="noopener"
              onclick={() => trackLandingEvent('footer_click', { location: 'log-footer', link: l.label })}
            >
              {l.label}
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </footer>
</div>

<style>
  .skip {
    position: absolute;
    left: 16px;
    top: -60px;
    z-index: 100;
    padding: 8px 12px;
    background: var(--color-primary);
    color: #fff;
    font-size: 14px;
  }
  .skip:focus {
    top: 8px;
  }
  .nav {
    position: sticky;
    top: 0;
    z-index: 50;
    border-bottom: 1px solid var(--color-border);
    background: oklch(0.233 0 0 / 0.86);
    backdrop-filter: blur(12px);
  }
  .nav-inner {
    height: 56px;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 700;
    color: oklch(0.92 0 0);
  }
  .nav-log {
    display: none;
    font-size: 12px;
    color: oklch(0.5 0 0);
  }
  @media (min-width: 768px) {
    .nav-log {
      display: inline;
    }
  }
  .nav-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .nav-gh {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    background: var(--color-primary);
    color: #fff;
  }
  .nav-gh:hover {
    filter: brightness(1.15);
  }
  .top-anchor {
    position: absolute;
    top: 0;
  }

  .footer {
    border-top: 1px solid var(--color-border);
    background: var(--color-card);
  }
  .foot-inner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px 32px;
    padding-block: 28px;
  }
  .foot-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: oklch(0.75 0 0);
  }
  .mit {
    color: oklch(0.6 0 0);
    margin-left: 6px;
  }
  .foot-links {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 22px;
  }
  .foot-links a {
    display: inline-block;
    padding-block: 4px;
    font-size: 13px;
    color: oklch(0.68 0 0);
  }
  .foot-links a:hover {
    color: oklch(0.92 0 0);
  }
</style>
