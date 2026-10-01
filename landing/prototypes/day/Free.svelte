<script>
  import { DownloadIcon, GithubIcon } from '../../src/lib/icons.js';
  import { arrive } from './scroll.svelte.js';
  import { INCLUDED, DOCS, links } from './content.js';
</script>

<section class="band b-free" aria-labelledby="free-h">
  <div class="inner">
    <h2 class="h2 rise center" id="free-h" use:arrive>a whole grove of agents.<br /><span class="tone-g">free.</span></h2>
    <div class="card rise" use:arrive>
      <div class="left">
        <p class="big">free.</p>
        <p class="sub">Free and source-available, under FSL-1.1-MIT.</p>
        <a class="d-btn" href={links.releases} target="_blank" rel="noopener">{@html DownloadIcon} Download for Windows</a>
      </div>
      <div class="right">
        <h3>what you get</h3>
        <ul>
          {#each INCLUDED as item, i}
            <li style="transition-delay: {0.1 + i * 0.08}s"><i aria-hidden="true"></i>{item}</li>
          {/each}
        </ul>
      </div>
    </div>
    <p class="fine rise" use:arrive>
      You bring the AI: a Claude plan (Pro, Max, Team or Enterprise) with Claude Code, or an Anthropic API key. Each
      release becomes available under the MIT License two years after it comes out.
    </p>
    <div class="look rise" use:arrive>
      <div>
        <h3>want to look around first?</h3>
        <p>Read the source, or the same help pages the app ships with.</p>
      </div>
      <div class="btns">
        <a class="d-btn ghost" href={links.github} target="_blank" rel="noopener">{@html GithubIcon} View source</a>
        <a class="d-btn ghost" href={DOCS} target="_blank" rel="noopener">Read the help ↗</a>
      </div>
    </div>
  </div>
</section>

<style>
  .inner {
    padding-block: 96px 120px;
  }
  .center {
    text-align: center;
  }
  .card {
    display: grid;
    max-width: 860px;
    margin: 36px auto 0;
    background: #fffdf8;
    box-shadow:
      0 0 0 1px var(--line),
      0 24px 50px -24px rgb(90 50 20 / 0.45);
  }
  @media (min-width: 760px) {
    .card {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    }
  }
  .left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    padding: 28px;
    background: var(--p-amber);
  }
  .big {
    font-size: clamp(54px, 5vw + 20px, 84px);
    font-weight: 800;
    letter-spacing: -0.06em;
    line-height: 1;
  }
  .sub {
    font-size: 13px;
    color: var(--soft);
  }
  .left .d-btn {
    margin-top: auto;
  }
  .right {
    padding: 28px;
  }
  h3 {
    font-size: 16px;
    font-weight: 800;
    letter-spacing: -0.03em;
  }
  ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 16px;
  }
  li {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    font-size: 13.5px;
    color: var(--soft);
  }
  li i {
    flex: none;
    width: 18px;
    height: 18px;
    margin-top: 2px;
    background: var(--p-green);
    box-shadow: inset 0 0 0 1px rgb(58 154 72 / 0.4);
    /* A pixel tick. */
    background-image: linear-gradient(#2a7a36, #2a7a36), linear-gradient(#2a7a36, #2a7a36), linear-gradient(#2a7a36, #2a7a36);
    background-size: 2px 2px, 2px 2px, 6px 2px;
    background-repeat: no-repeat;
    background-position: 4px 9px, 6px 11px, 8px 7px;
  }
  .fine {
    max-width: 640px;
    margin: 18px auto 0;
    font-size: 12px;
    color: var(--faint);
    text-align: center;
  }
  .look {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    max-width: 860px;
    margin: 48px auto 0;
    padding-top: 26px;
    border-top: 1px solid var(--line);
  }
  .look p {
    margin-top: 4px;
    font-size: 13px;
    color: var(--soft);
  }
  .btns {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
</style>
