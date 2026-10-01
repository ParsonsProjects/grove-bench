<script>
  import { links, treeGreens } from '../../src/lib/brand.js';
  import { DownloadIcon, GithubIcon } from '../../src/lib/icons.js';
  import { PROTOTYPES } from './protos.js';

  /**
   * The frame around each prototype: a bar with the other prototypes, and a
   * footer with the download. The prototype fills the middle.
   *
   * @type {{ current: string, children?: import('svelte').Snippet }}
   */
  let { current, children } = $props();
</script>

{#snippet logo(size)}
  <svg width={size} height={Math.round((size * 24) / 21)} viewBox="0 0 21 24" aria-hidden="true" style="image-rendering: pixelated">
    {#each treeGreens as p}
      <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />
    {/each}
  </svg>
{/snippet}

<header class="bar">
  <div class="wrap bar-inner">
    <a class="brand" href="./index.html">
      {@render logo(16)}
      <span>Grove Bench</span>
      <span class="tag">prototypes</span>
    </a>
    <nav class="protos" aria-label="Prototypes">
      {#each PROTOTYPES as p}
        <a href="./{p.slug}.html" aria-current={p.slug === current ? 'page' : undefined}>{p.name}</a>
      {/each}
    </nav>
    <a class="btn primary small get" href={links.releases} target="_blank" rel="noopener">
      {@html DownloadIcon}
      <span>Download</span>
    </a>
  </div>
</header>

<main id="main">
  {@render children?.()}
</main>

<footer class="foot">
  <div class="wrap foot-inner">
    <div class="foot-cta">
      <p class="pixel foot-h">Try it on your next task</p>
      <p class="req">Windows 10 or later, git 2.17+ and the Claude Code CLI. Free and source-available (FSL-1.1-MIT).</p>
    </div>
    <div class="foot-btns">
      <a class="btn primary" href={links.releases} target="_blank" rel="noopener">{@html DownloadIcon} Download for Windows</a>
      <a class="btn ghost" href={links.github} target="_blank" rel="noopener">{@html GithubIcon} View source</a>
    </div>
  </div>
  <div class="wrap fine">
    <span>{@render logo(10)} Prototype. Agents, tasks and timings on this page are simulated; the characters are the app's own sprites.</span>
  </div>
</footer>

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 50;
    background: rgb(8 12 24 / 0.86);
    border-bottom: 1px solid rgb(217 223 240 / 0.1);
    backdrop-filter: blur(10px);
  }
  .bar-inner {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 54px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-size: 14px;
    font-weight: 700;
    color: #eef1f8;
    text-decoration: none;
    white-space: nowrap;
  }
  .tag {
    font-family: var(--font-pixel);
    font-weight: 400;
    font-size: 13px;
    color: var(--leaf-1);
  }
  .protos {
    display: flex;
    gap: 2px;
    margin-left: auto;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .protos a {
    padding: 6px 10px;
    font-size: 13px;
    color: var(--muted);
    text-decoration: none;
    white-space: nowrap;
  }
  .protos a:hover {
    color: #fff;
  }
  .protos a[aria-current='page'] {
    color: #fff;
    background: rgb(255 255 255 / 0.08);
    box-shadow: inset 0 -2px 0 var(--leaf-1);
  }
  @media (max-width: 860px) {
    .bar-inner {
      flex-wrap: wrap;
      gap: 4px 12px;
      padding-block: 8px;
    }
    .protos {
      order: 3;
      width: 100%;
      margin-left: -10px;
    }
    .get {
      margin-left: auto;
    }
  }

  .foot {
    margin-top: 64px;
    background: rgb(20 28 18 / 0.94);
    border-top: 3px solid var(--bark);
  }
  .foot-inner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 18px 32px;
    padding-block: 30px 18px;
  }
  .foot-h {
    font-size: 24px;
    color: #f3f5fa;
  }
  .req {
    margin-top: 4px;
    font-size: 13px;
    color: var(--muted);
    max-width: 60ch;
  }
  .foot-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .fine {
    padding-block: 10px 26px;
    font-size: 12px;
    color: var(--faint);
  }
  .fine span {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
</style>
