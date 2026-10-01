<script>
  import { onMount } from 'svelte';
  import '../day/day.css';
  import Nav from '../day/Nav.svelte';
  import Hero from '../day/Hero.svelte';
  import Founder from '../day/Founder.svelte';
  import Features from '../day/Features.svelte';
  import Steps from '../day/Steps.svelte';
  import Free from '../day/Free.svelte';
  import Sunset from '../day/Sunset.svelte';
  import Faq from '../day/Faq.svelte';
  import Closing from '../day/Closing.svelte';
  import Footer from '../day/Footer.svelte';
  import Rail from './Rail.svelte';
  import { trackScroll } from '../day/scroll.svelte.js';

  let page = $state();
  let k = $state(3);
  onMount(() => {
    const stop = trackScroll();
    // Pixel scale of the trail art: bigger on wide screens, smaller on phones.
    const small = window.matchMedia('(max-width: 760px)');
    const wide = window.matchMedia('(min-width: 1280px)');
    const fit = () => (k = small.matches ? 2 : wide.matches ? 4 : 3);
    fit();
    small.addEventListener('change', fit);
    wide.addEventListener('change', fit);
    return () => {
      stop();
      small.removeEventListener('change', fit);
      wide.removeEventListener('change', fit);
    };
  });

  // Where the walker sits down, and how it looks there: one conversation's day.
  const STOPS = [
    { at: '.b-hero', state: 'ready' },
    { at: '.b-founder', state: 'working' },
    { at: '.b-features', state: 'working' },
    { at: '.b-steps', state: 'permission' },
    { at: '.b-free', state: 'unread' },
    { at: '.b-dusk', state: 'asking' },
    { at: '.b-night', state: 'sleeping' },
  ];
</script>

<div class="day trail" style="--rail: {{ 2: 56, 3: 132, 4: 168 }[k]}px">
  <a class="skip" href="#main">Skip to content</a>
  <Nav />
  <div class="page" bind:this={page}>
    <Rail {page} stops={STOPS} {k} />
    <main id="main">
      <Hero title={['Plant a task.', 'Grow a branch.']} lede="Grove Bench is a free Windows app for running several AI coding agents on one project at once, starting with Claude Code. Every task gets its own git worktree, branch and terminal, so the agents never trip over each other." />
      <Founder />
      <Features />
      <Steps />
      <Free />
      <Sunset />
      <Faq />
      <Closing />
    </main>
  </div>
  <Footer />
</div>

<style>
  .skip {
    position: absolute;
    left: 16px;
    top: -60px;
    z-index: 100;
    padding: 8px 12px;
    font-size: 14px;
    color: #fff;
    background: var(--blue);
  }
  .skip:focus {
    top: 8px;
  }
  .page {
    position: relative;
  }
  /* Content keeps clear of the path on the left; the nav and footer share
     its column so their edges line up. */
  .trail :global(.inner) {
    width: min(1120px, 100% - var(--rail));
    margin-left: max(var(--rail), calc((100% - 1120px) / 2));
    margin-right: auto;
  }
  @media (max-width: 760px) {
    .trail :global(.inner) {
      padding-left: 12px;
      padding-right: 16px;
    }
  }
</style>
