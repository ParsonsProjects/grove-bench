<script>
  import Shell from '../shared/Shell.svelte';
  import Sprite from '../shared/Sprite.svelte';
  import Pixels from '../shared/Pixels.svelte';
  import Tree from '../shared/Tree.svelte';
  import BenchSeat from '../shared/BenchSeat.svelte';
  import { LAMP } from '../shared/app-art.js';
  import { PROTOTYPES } from '../shared/protos.js';

  // Hovering a card makes its agent wave, the app's "finished a turn" pose.
  let hovered = $state(null);
  const seeds = ['c4a1f9e2', '0b7d3e51', '9e2f64ac', '5d18b0f7'];
</script>

<Shell current="">
  <section class="wrap hero">
    <div class="copy">
      <p class="eyebrow">Landing page prototypes</p>
      <h1>Four ways to meet the grove</h1>
      <p class="lede">
        Canopy shows what Grove Bench is. These four show how it feels to use, through the little agents that live in the
        app. Each one is something you can play with, not just scroll past.
      </p>
    </div>
    <div class="scene" aria-hidden="true">
      <div class="trees">
        <Tree scale={5} dim />
        <Tree scale={8} />
        <Tree scale={5} dim />
      </div>
      <div class="benches">
        <span class="lamp"><Pixels map={LAMP} scale={6} /></span>
        {#each PROTOTYPES as p, i}
          <BenchSeat state={hovered === p.slug ? 'unread' : p.state} seed={seeds[i]} scale={6} label="" />
        {/each}
        <span class="lamp"><Pixels map={LAMP} scale={6} /></span>
      </div>
      <div class="ground"></div>
    </div>
  </section>

  <section class="wrap grid" aria-label="Prototypes">
    {#each PROTOTYPES as p, i}
      <a
        class="panel card"
        href="./{p.slug}.html"
        onmouseenter={() => (hovered = p.slug)}
        onmouseleave={() => (hovered = null)}
        onfocus={() => (hovered = p.slug)}
        onblur={() => (hovered = null)}
      >
        <div class="card-top">
          <Sprite state={hovered === p.slug ? 'unread' : p.state} seed={seeds[i]} scale={5} label="" />
          <h2 class="pixel">{p.name}</h2>
        </div>
        <p class="pitch">{p.pitch}</p>
        <p class="shows"><span>Shows</span> {p.shows}</p>
        <span class="open">Open {p.name} <span aria-hidden="true">→</span></span>
      </a>
    {/each}
  </section>
</Shell>

<style>
  .hero {
    display: grid;
    gap: 28px;
    padding-block: 48px 24px;
    align-items: end;
  }
  @media (min-width: 960px) {
    .hero {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
      padding-block: 72px 32px;
    }
  }
  h1 {
    margin-top: 10px;
    font-family: var(--font-pixel);
    font-size: clamp(36px, 3vw + 22px, 60px);
    font-weight: 700;
    color: #f6f7fb;
  }
  .lede {
    margin-top: 16px;
    max-width: 52ch;
    color: #c7cfe0;
  }
  .scene {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
  }
  .trees {
    display: flex;
    align-items: flex-end;
    gap: 24px;
    margin-bottom: -30px;
  }
  .benches {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    max-width: 100%;
  }
  .ground {
    width: 100%;
    height: 6px;
    background: var(--leaf-4);
    box-shadow: 0 6px 0 #22301f;
  }
  @media (max-width: 560px) {
    .lamp {
      display: none;
    }
    .benches {
      gap: 2px;
      zoom: 0.62;
    }
    .trees {
      zoom: 0.7;
    }
  }

  .grid {
    display: grid;
    gap: 24px;
    padding-block: 32px;
  }
  @media (min-width: 720px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-decoration: none;
    transition: transform 0.12s steps(3);
  }
  .card:hover {
    transform: translateY(-3px);
  }
  .card-top {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  h2 {
    font-size: 28px;
    font-weight: 600;
    color: #f3f5fa;
  }
  .pitch {
    color: #c7cfe0;
  }
  .shows {
    font-size: 13px;
    color: var(--muted);
  }
  .shows span {
    margin-right: 6px;
    padding: 1px 6px;
    font-size: 12px;
    color: var(--leaf-1);
    border: 1px solid rgb(110 200 122 / 0.45);
  }
  .open {
    margin-top: auto;
    font-weight: 700;
    color: var(--gold);
  }
</style>
