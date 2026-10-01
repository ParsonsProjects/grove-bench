<script>
  import { trackLandingEvent } from '../lib/analytics.js';
  import { treeGreens } from '../lib/brand.js';
  import { DownloadIcon } from '../lib/icons.js';
  import { FOOTER, links } from './content.js';
</script>

<footer class="band b-foot">
  <div class="inner foot">
    <div class="brand">
      <span class="logo">
        <svg width="18" height="20" viewBox="0 0 21 24" aria-hidden="true">{#each treeGreens as p}<rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />{/each}</svg>
        grove bench
      </span>
      <p>run AI agents side by side, each on its own branch.</p>
      <ul class="links">
        {#each FOOTER as l}
          <li><a href={l.href} target="_blank" rel="noopener" onclick={() => trackLandingEvent('footer_click', { location: 'trail-footer', link: l.label })}>{l.label}</a></li>
        {/each}
      </ul>
    </div>
    <div class="right">
      <a class="d-btn" href={links.releases} target="_blank" rel="noopener" onclick={() => trackLandingEvent('download_click', { location: 'trail-footer' })}>{@html DownloadIcon} Download</a>
      <p>Source-available under <span class="nowrap">FSL-1.1-MIT</span></p>
    </div>
  </div>
</footer>

<style>
  .foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 24px;
    padding-block: 40px 56px;
  }
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 17px;
    font-weight: 800;
    letter-spacing: -0.04em;
  }
  .brand p {
    margin-top: 6px;
    font-size: 12.5px;
    color: var(--soft);
  }
  .links {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0 20px;
    margin-top: 10px;
    font-size: 13px;
  }
  .links a {
    display: inline-block;
    padding-block: 6px;
    color: var(--soft);
    text-decoration: none;
  }
  .links a:hover {
    color: var(--ink);
    text-decoration: underline;
  }
  .right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }
  .right p {
    font-size: 12px;
    color: var(--faint);
  }
  .nowrap {
    white-space: nowrap;
  }
  /* Once it wraps under the links, line it up on the left. */
  @media (max-width: 900px) {
    .right {
      align-items: flex-start;
    }
  }
</style>
