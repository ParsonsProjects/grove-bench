<script>
  import { trackLandingEvent } from '../lib/analytics.js';
  import BenchSeat from '../shared/BenchSeat.svelte';
  import Branch from './Branch.svelte';
  import { arrive } from './scroll.svelte.js';
  import { HONEST, links } from './content.js';

  /**
   * A plain heads-up after the founder note: it's a vibe-coded side project,
   * so expect bugs and changes. The agent sits in the app's error pose.
   */
</script>

<section class="band b-honest" id="heads-up" aria-labelledby="honest-h">
  <div class="inner">
    <div class="note rise" use:arrive>
      <div class="copy">
        <Branch name="wip/side-project" />
        <h2 class="h2" id="honest-h">{HONEST.title}</h2>
        <p class="lede">{HONEST.lede}</p>
        <ul>
          {#each HONEST.points as p}
            <li><b>{p.title}</b> {p.text}</li>
          {/each}
        </ul>
        <p class="links">
          <a href={links.issues} target="_blank" rel="noopener" onclick={() => trackLandingEvent('github_click', { location: 'trail-honest' })}>report a bug ↗</a>
        </p>
      </div>
      <div class="pic" aria-hidden="true">
        <BenchSeat state="error" seed="e41d6b07" scale={6} label="" />
        <span class="cap">it happens</span>
      </div>
    </div>
  </div>
</section>

<style>
  .inner {
    padding-block: 0 96px;
  }
  .note {
    display: grid;
    gap: 28px;
    align-items: center;
    max-width: 920px;
    padding: 28px 28px 24px;
    border: 1px dashed color-mix(in srgb, var(--ink) 28%, transparent);
    background: rgb(255 255 255 / 0.35);
  }
  @media (min-width: 860px) {
    .note {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 48px;
      padding: 36px 40px 30px;
    }
  }
  .lede {
    max-width: 60ch;
    margin-top: 14px;
  }
  ul {
    list-style: none;
    max-width: 60ch;
    margin-top: 18px;
    font-size: 13.5px;
    color: var(--soft);
  }
  /* Wrapped lines hang after the dash. */
  li {
    padding-left: 2ch;
    text-indent: -2ch;
  }
  li + li {
    margin-top: 6px;
  }
  li::before {
    content: '- ';
    color: var(--faint);
  }
  b {
    color: var(--ink);
  }
  .links {
    margin-top: 14px;
    font-size: 13px;
  }
  .links a {
    display: inline-block;
    padding-block: 6px;
    color: var(--blue-ink);
  }
  .pic {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    justify-self: center;
  }
  .cap {
    font-family: var(--pixel);
    font-size: 14px;
    color: var(--faint);
  }
  @media (max-width: 760px) {
    .note {
      padding: 22px 18px 18px;
    }
  }
</style>
