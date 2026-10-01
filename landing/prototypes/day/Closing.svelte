<script>
  import Tree from '../shared/Tree.svelte';
  import BenchSeat from '../shared/BenchSeat.svelte';
  import Pixels from '../shared/Pixels.svelte';
  import { LAMP, SCENERY_PALETTE } from '../shared/app-art.js';
  import { MOON, MOON_COLORS } from './sky.js';
  import { DownloadIcon, GithubIcon } from '../../src/lib/icons.js';
  import { arrive } from './scroll.svelte.js';
  import { links } from './content.js';

  const LIT = { ...SCENERY_PALETTE, o: '#ffe7a8' };
  let lit = $state(false);
  // A night grove: trees, lamps that light as it arrives, agents asleep.
  const ROW = [
    { k: 'tree', s: 5 },
    { k: 'lamp' },
    { k: 'bench', st: 'sleeping', id: 'a3f8b2c1' },
    { k: 'tree', s: 7 },
    { k: 'tree', s: 4 },
    { k: 'bench', st: 'unread', id: '1d6f4c08' },
    { k: 'lamp' },
    { k: 'tree', s: 6 },
    { k: 'bench', st: 'sleeping', id: '9b0e27f5' },
    { k: 'tree', s: 5 },
    { k: 'lamp' },
    { k: 'tree', s: 4 },
  ];
</script>

<section class="band b-night" aria-labelledby="close-h">
  <div class="stars" aria-hidden="true"></div>
  <span class="moon" aria-hidden="true"><Pixels map={MOON} palette={MOON_COLORS} scale={5} /></span>
  <div class="inner copy">
    <h2 class="h1 rise" id="close-h" use:arrive>every grove started<br />with one tree.<br /><span class="tone-gold">plant yours.</span></h2>
    <div class="btns rise" use:arrive>
      <div>
        <a class="d-btn gold" href={links.releases} target="_blank" rel="noopener">{@html DownloadIcon} Download for Windows</a>
        <p class="btn-note">free · Windows 10 or later</p>
      </div>
      <div>
        <a class="d-btn ghost" href={links.github} target="_blank" rel="noopener">{@html GithubIcon} View source</a>
        <p class="btn-note">git 2.17+ and the Claude Code CLI</p>
      </div>
    </div>
  </div>
  <div class="grove" use:arrive={{ onenter: () => setTimeout(() => (lit = true), 500) }} aria-hidden="true">
    {#each ROW as r, i}
      {#if r.k === 'tree'}
        <Tree scale={r.s} />
      {:else if r.k === 'lamp'}
        <span class="lamp" class:lit style="transition-delay: {i * 0.08}s"><Pixels map={LAMP} palette={lit ? LIT : SCENERY_PALETTE} scale={5} /></span>
      {:else}
        <BenchSeat state={r.st} seed={r.id} scale={4} label="" />
      {/if}
    {/each}
  </div>
</section>

<style>
  .b-night {
    overflow: hidden;
  }
  .stars {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(1px 1px at 8% 18%, #fff, transparent),
      radial-gradient(1px 1px at 17% 42%, #fffa, transparent),
      radial-gradient(2px 2px at 26% 12%, #ffe7a8, transparent),
      radial-gradient(1px 1px at 38% 30%, #fff9, transparent),
      radial-gradient(1px 1px at 52% 8%, #fff, transparent),
      radial-gradient(1px 1px at 61% 36%, #fff8, transparent),
      radial-gradient(2px 2px at 73% 20%, #fff, transparent),
      radial-gradient(1px 1px at 84% 44%, #fffa, transparent),
      radial-gradient(1px 1px at 92% 14%, #fff, transparent);
    animation: twinkle 4s steps(2) infinite;
  }
  @keyframes twinkle {
    50% {
      opacity: 0.7;
    }
  }
  .moon {
    position: absolute;
    top: 90px;
    right: 12%;
    filter: drop-shadow(0 0 22px rgb(244 241 255 / 0.35));
  }
  .copy {
    position: relative;
    padding-top: 120px;
  }
  .btns {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin-top: 34px;
  }
  .grove {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 8px;
    margin-top: 72px;
    padding-inline: 3%;
    border-bottom: 10px solid #22301f;
    overflow: hidden;
  }
  .lamp {
    position: relative;
    transition: filter 0.4s;
  }
  .lamp.lit {
    filter: drop-shadow(0 0 10px rgb(255 231 168 / 0.85));
  }
  @media (max-width: 640px) {
    .grove {
      zoom: 0.55;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .stars {
      animation: none;
    }
  }
</style>
