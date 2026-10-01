<script>
  import { onMount } from 'svelte';
  import Shell from '../shared/Shell.svelte';
  import Sprite from '../shared/Sprite.svelte';
  import GroveScene from '../shared/GroveScene.svelte';
  import { links } from '../../src/lib/brand.js';
  import { DownloadIcon } from '../../src/lib/icons.js';
  import Scene from './Scene.svelte';
  import { CHAPTERS } from './chapters.js';

  // The chapter in the middle of the screen drives the sticky stage.
  let active = $state(0);
  let wide = $state(true);
  let els = $state([]);

  onMount(() => {
    const mq = window.matchMedia('(min-width: 980px)');
    const fit = () => (wide = mq.matches);
    fit();
    mq.addEventListener('change', fit);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) active = Number(e.target.dataset.i);
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    els.forEach((el) => el && io.observe(el));
    return () => {
      io.disconnect();
      mq.removeEventListener('change', fit);
    };
  });
</script>

<Shell current="story">
  <section class="wrap hero">
    <div class="hero-copy">
      <p class="eyebrow">Prototype · one conversation, start to finish</p>
      <h1>A day in the life of a conversation</h1>
      <p class="lede">
        Grove Bench runs several AI coding agents on one project, each on its own branch. Here’s what happens to one of
        them, from the first message to a pull request. Scroll to follow along.
      </p>
    </div>
    <div class="hero-art" aria-hidden="true"><GroveScene state="ready" seed="a3f8b2c1" scale={5} /></div>
  </section>

  <div class="wrap story">
    <ol class="chapters">
      {#each CHAPTERS as ch, i}
        <li class="ch" class:on={i === active} data-i={i} bind:this={els[i]}>
          <div class="mark" aria-hidden="true"><Sprite state={ch.state} seed="a3f8b2c1" scale={3} label="" /></div>
          <div class="text">
            <time class="pixel">{ch.at}</time>
            <h2>{ch.title}</h2>
            <p>{ch.body}</p>
            <p class="app"><span>In the app</span> {ch.app}</p>
          </div>
          {#if !wide}
            <div class="inline-stage"><Scene scene={ch.scene} /></div>
          {/if}
        </li>
      {/each}
    </ol>

    {#if wide}
      <div class="stage-col">
        <div class="stage">
          <p class="stage-label pixel" aria-hidden="true">{CHAPTERS[active].at} · {CHAPTERS[active].title}</p>
          {#key active}
            <div class="stage-in"><Scene scene={CHAPTERS[active].scene} /></div>
          {/key}
        </div>
      </div>
    {/if}
  </div>

  <section class="wrap end">
    <div class="panel paper end-card">
      <h2 class="pixel">Then you start the next one</h2>
      <p>Most days there are a few of these going at once, each in its own worktree. That’s the whole idea.</p>
      <a class="btn primary" href={links.releases} target="_blank" rel="noopener">{@html DownloadIcon} Download for Windows</a>
    </div>
  </section>
</Shell>

<style>
  .hero {
    display: grid;
    gap: 24px;
    align-items: end;
    padding-block: 48px 40px;
  }
  @media (min-width: 900px) {
    .hero {
      grid-template-columns: minmax(0, 1.2fr) auto;
    }
  }
  h1 {
    margin-top: 8px;
    font-family: var(--font-pixel);
    font-size: clamp(34px, 3vw + 20px, 58px);
    color: #f6f7fb;
  }
  .lede {
    margin-top: 14px;
    max-width: 60ch;
    color: #c7cfe0;
  }
  .hero-art {
    justify-self: center;
    border-bottom: 4px solid var(--leaf-4);
  }
  @media (max-width: 420px) {
    .hero-art {
      zoom: 0.6;
    }
  }

  .story {
    display: grid;
    gap: 48px;
  }
  @media (min-width: 980px) {
    .story {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    }
  }
  .chapters {
    list-style: none;
    position: relative;
  }
  /* The day's timeline, a dotted pixel line down the left. */
  .chapters::before {
    content: '';
    position: absolute;
    left: 15px;
    top: 10px;
    bottom: 10px;
    width: 2px;
    background: repeating-linear-gradient(180deg, rgb(110 200 122 / 0.5) 0 4px, transparent 4px 8px);
  }
  .ch {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 4px 18px;
    padding-block: 18px;
  }
  @media (min-width: 980px) {
    .ch {
      min-height: 62vh;
      align-content: center;
    }
    .ch:first-child {
      min-height: 50vh;
      align-content: start;
    }
  }
  .mark {
    position: relative;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    background: var(--night);
    box-shadow: 0 0 0 2px rgb(110 200 122 / 0.35);
  }
  .ch.on .mark {
    box-shadow: 0 0 0 2px var(--leaf-1);
  }
  .text {
    min-width: 0;
    opacity: 0.55;
    transition: opacity 0.3s;
  }
  .ch.on .text,
  .ch:not(:has(+ .ch)) .text {
    opacity: 1;
  }
  @media (max-width: 979px) {
    .text {
      opacity: 1;
    }
  }
  time {
    font-size: 18px;
    color: var(--leaf-1);
    font-variant-numeric: tabular-nums;
  }
  .text h2 {
    margin-top: 4px;
    font-family: var(--font-pixel);
    font-size: clamp(24px, 1vw + 18px, 32px);
    color: #f3f5fa;
  }
  .text p {
    margin-top: 10px;
    max-width: 52ch;
    color: #c7cfe0;
  }
  .text .app {
    font-size: 13px;
    color: var(--muted);
  }
  .app span {
    margin-right: 6px;
    padding: 1px 6px;
    font-size: 11px;
    color: var(--leaf-1);
    border: 1px solid rgb(110 200 122 / 0.45);
  }
  .inline-stage {
    grid-column: 1 / -1;
    margin-top: 16px;
  }
  .stage-col {
    position: relative;
  }
  .stage {
    position: sticky;
    top: max(84px, calc(50vh - 240px));
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 460px;
  }
  .stage-label {
    font-size: 14px;
    color: var(--muted);
  }
  .stage-in {
    animation: rise 0.35s steps(5);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }
  .end {
    padding-top: 48px;
  }
  .end-card {
    display: grid;
    gap: 12px;
    justify-items: start;
    max-width: 620px;
  }
  .end-card h2 {
    font-size: 30px;
  }
  .end-card p {
    color: var(--paper-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .stage-in {
      animation: none;
    }
  }
</style>
