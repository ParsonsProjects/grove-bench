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
    const mq = window.matchMedia('(max-width: 760px)');
    const fit = () => (k = mq.matches ? 2 : 3);
    fit();
    mq.addEventListener('change', fit);
    return () => {
      stop();
      mq.removeEventListener('change', fit);
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

<div class="day trail" style="--rail: {k === 3 ? 132 : 56}px">
  <Nav />
  <div class="page" bind:this={page}>
    <Rail {page} stops={STOPS} {k} />
    <main>
      <Hero title={['plant a task.', 'grow a branch.']} lede="Grove Bench is a free Windows app that runs several AI coding agents on one project at once. Every task gets its own git worktree, branch and terminal, so the agents never trip over each other." />
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
  .page {
    position: relative;
  }
  /* Content keeps clear of the path on the left. */
  .trail :global(main .inner) {
    width: min(1120px, 100% - var(--rail));
    margin-left: max(var(--rail), calc((100% - 1120px) / 2));
    margin-right: auto;
  }
  @media (max-width: 760px) {
    .trail :global(main .inner) {
      padding-left: 12px;
      padding-right: 16px;
    }
  }
</style>
