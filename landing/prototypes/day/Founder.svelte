<script>
  import { arrive } from './scroll.svelte.js';
  import { FOUNDER, README, links } from './content.js';
</script>

<section class="band b-founder" aria-labelledby="founder-h">
  <div class="inner grid">
    <h2 class="h2 rise" id="founder-h" use:arrive>{FOUNDER.title[0]}<br /><span class="tone-g">{FOUNDER.title[1]}</span></h2>
    <div class="note rise" use:arrive>
      {#if FOUNDER.draft}<p class="draft">Draft: rewrite in your own words</p>{/if}
      {#each FOUNDER.paragraphs as p}<p>{p}</p>{/each}
      <p class="sig">{FOUNDER.name}</p>
      <p class="links">
        <a href={README} target="_blank" rel="noopener">read the readme ↗</a>
        <a href={links.github} target="_blank" rel="noopener">see the source ↗</a>
      </p>
    </div>
  </div>
</section>

<style>
  .grid {
    display: grid;
    gap: 28px;
    padding-block: 96px;
  }
  @media (min-width: 900px) {
    .grid {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      gap: 64px;
    }
  }
  .note p {
    max-width: 60ch;
    color: var(--soft);
  }
  .note p + p {
    margin-top: 14px;
  }
  .draft {
    display: inline-block;
    padding: 2px 8px;
    font-size: 12px;
    font-weight: 700;
    color: #6b4a00 !important;
    background: var(--p-amber);
  }
  .sig {
    margin-top: 20px !important;
    font-family: var(--pixel);
    font-size: 30px;
    color: var(--blue) !important;
    transform: rotate(-4deg);
    transform-origin: left;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 22px;
    font-size: 13px;
  }
  .links a {
    color: var(--blue-ink);
  }
</style>
