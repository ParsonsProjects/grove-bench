<script>
  import Sprite from '../shared/Sprite.svelte';
  import { arrive } from './scroll.svelte.js';
  import { FAQ } from './content.js';

  // The character beside the heading asks while nothing is open, and holds
  // a speech bubble once you've opened an answer (the app's question poses).
  let opened = $state(0);
</script>

<section class="band b-dusk" id="faq" aria-labelledby="faq-h">
  <div class="inner grid">
    <div class="side rise" use:arrive>
      <h2 class="h2" id="faq-h">yes, it’s really<br /><span class="tone-2">free.</span></h2>
      <div class="asker" aria-hidden="true">
        <Sprite state={opened ? 'answered' : 'asking'} seed="7c19e0d4" scale={6} label="" />
      </div>
    </div>
    <div class="list rise" use:arrive>
      {#each FAQ as item, i}
        <details ontoggle={(e) => (opened += e.currentTarget.open ? 1 : -1)}>
          <summary>{item.q}<span class="plus" aria-hidden="true">+</span></summary>
          <p>{item.a}</p>
        </details>
      {/each}
    </div>
  </div>
</section>

<style>
  .grid {
    display: grid;
    gap: 36px;
    padding-block: 104px;
  }
  @media (min-width: 900px) {
    .grid {
      grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
      gap: 64px;
    }
  }
  .asker {
    margin-top: 28px;
  }
  details {
    border-bottom: 1px solid var(--line);
  }
  summary {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 0;
    font-size: 14px;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .plus {
    margin-left: auto;
    font-size: 18px;
    color: var(--faint);
    transition: transform 0.2s steps(3);
  }
  details[open] .plus {
    transform: rotate(45deg);
  }
  details p {
    max-width: 62ch;
    padding: 0 0 18px;
    font-size: 13.5px;
    color: var(--soft);
  }
</style>
