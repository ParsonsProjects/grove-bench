<script>
  import { trackLandingEvent } from '../lib/analytics.js';
  import { DownloadIcon, GithubIcon } from '../lib/icons.js';
  import Branch from './Branch.svelte';
  import { arrive } from './scroll.svelte.js';
  import { INCLUDED, DOCS, links } from './content.js';
  import '../shared/app/app.css';

  /**
   * Price and licence, with what you get shown as a file added in the app's
   * Changes tab: one green line per thing.
   */
</script>

<section class="band b-free" aria-labelledby="free-h">
  <div class="inner">
    <div class="grid">
      <div class="copy rise" use:arrive>
        <Branch name="docs/license" />
        <h2 class="h2" id="free-h">Free. The whole grove in one download.</h2>
        <p class="lede">
          Source-available under <span class="nowrap">FSL-1.1-MIT</span>, and each release becomes available under the MIT
          License two years after it comes out.
        </p>
        <p class="lede">You bring the AI: a Claude plan (Pro, Max, Team or Enterprise) with Claude Code, or an Anthropic API key.</p>
        <div class="btn">
          <a class="d-btn" href={links.releases} target="_blank" rel="noopener" onclick={() => trackLandingEvent('download_click', { location: 'trail-free' })}>{@html DownloadIcon} Download for Windows</a>
          <p class="btn-note">Windows 10 or later</p>
        </div>
      </div>
      <div class="gb diff rise" use:arrive>
        <div class="tabs" aria-hidden="true"><span class="on">Changes <i class="t-faint">Alt+2</i></span></div>
        <p class="file"><b class="t-green">A</b> what-you-get.md <span class="add">+{INCLUDED.length}</span></p>
        <ul aria-label="What you get">
          <li class="hunk" aria-hidden="true">@@ -0,0 +1,{INCLUDED.length} @@</li>
          {#each INCLUDED as item}
            <li><span aria-hidden="true">{'+ '}</span>{item}</li>
          {/each}
        </ul>
      </div>
    </div>
    <div class="look rise" use:arrive>
      <div>
        <h3>Want to look around first?</h3>
        <p>Read the source, or the same help pages the app ships with.</p>
      </div>
      <div class="btns">
        <a class="d-btn ghost" href={links.github} target="_blank" rel="noopener" onclick={() => trackLandingEvent('github_click', { location: 'trail-free' })}>{@html GithubIcon} View source</a>
        <a class="d-btn ghost" href={DOCS} target="_blank" rel="noopener" onclick={() => trackLandingEvent('docs_click', { location: 'trail-free' })}>Read the help ↗</a>
      </div>
    </div>
  </div>
</section>

<style>
  .inner {
    padding-block: 96px 120px;
  }
  .grid {
    display: grid;
    gap: 36px;
    align-items: center;
  }
  @media (min-width: 900px) {
    .grid {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 56px;
    }
  }
  .copy .lede {
    max-width: 52ch;
    margin-top: 14px;
  }
  .nowrap {
    white-space: nowrap;
  }
  .btn {
    display: inline-block;
    margin-top: 26px;
  }
  .diff {
    box-shadow:
      0 0 0 1px rgb(90 50 20 / 0.2),
      0 24px 50px -24px rgb(90 50 20 / 0.5);
  }
  .tabs {
    display: flex;
    background: var(--side);
    border-bottom: 1px solid var(--border);
  }
  .tabs span {
    margin-bottom: -1px;
    padding: 7px 14px;
    font-size: 12px;
    border-bottom: 1px solid var(--primary);
  }
  .tabs i {
    margin-left: 6px;
    font-style: normal;
  }
  .file {
    display: flex;
    gap: 8px;
    padding: 9px 14px;
    font-size: 12.5px;
    border-bottom: 1px solid var(--border);
  }
  ul {
    list-style: none;
    padding: 10px 0 14px;
    font-size: 13px;
    line-height: 1.75;
  }
  /* Wrapped lines hang after the + mark. */
  li {
    padding: 0 14px 0 calc(14px + 2ch);
    text-indent: -2ch;
    color: oklch(0.85 0.12 151);
    background: oklch(0.792 0.209 151.711 / 0.1);
  }
  li span {
    white-space: pre;
  }
  li.hunk {
    margin-bottom: 4px;
    padding-left: 14px;
    text-indent: 0;
    color: var(--cyan);
    background: none;
  }
  .look {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    margin-top: 64px;
    padding-top: 26px;
    border-top: 1px solid var(--line);
  }
  h3 {
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.02em;
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
