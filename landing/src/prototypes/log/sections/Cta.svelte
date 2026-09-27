<script>
  import Stage from '../Stage.svelte';
  import Commit from '../Commit.svelte';
  import Bubble from '../Bubble.svelte';
  import { ctaScene } from '../scenes/cta.js';
  import { agents, hashes } from '../data.js';
  import { links } from '../../shared/brand.js';
  import { trackLandingEvent } from '../../../lib/analytics.js';
  import { DownloadIcon, GithubIcon } from '../../branches/icons.js';

  /** @type {{ reduced?: boolean }} */
  let { reduced = false } = $props();

  const keys = /** @type {const} */ (['auth', 'api', 'fix']);

  function talk(key) {
    const a = agents[key];
    return { status: 'ready', text: `\`${a.branch}\` is done and ready for review. Next task?` };
  }
</script>

<section class="lg-section cta" aria-labelledby="h-cta">
  <div class="lg-wrap">
    <div class="lg-col">
      <Commit id="cta" hash={hashes.cta} head title="Try it on your next task" headingId="h-cta">
        <p>Give each task its own conversation, and keep an eye on all of them from one window.</p>
      </Commit>
      <div class="actions">
        <a
          href={links.releases}
          target="_blank"
          rel="noopener"
          class="btn-primary"
          onclick={() => trackLandingEvent('download_click', { location: 'log-cta' })}
        >
          {@html DownloadIcon}
          Download for Windows
        </a>
        <a
          href={links.github}
          target="_blank"
          rel="noopener"
          class="btn-secondary"
          onclick={() => trackLandingEvent('github_click', { location: 'log-cta' })}
        >
          {@html GithubIcon}
          View source
        </a>
      </div>
      <p class="req">Windows 10 or later, git 2.17+ and the Claude Code CLI. Free and open source (MIT).</p>
      <div class="lg-scene">
        <Stage
          id="cta"
          factory={ctaScene}
          {reduced}
          {talk}
          dataTod={0.95}
          class="lg-frame"
          label="Daylight. The main line of the log runs along the ground and a big tree grows where it ends. The three agents rest on benches beside it, their lamps green."
        >
          {#snippet overlays(pin)}
            <div class="pin" use:pin={'ground'} data-anchor="ground" data-kind="ground" aria-hidden="true"></div>
            {#each keys as key (key)}
              <div class="pin" use:pin={`bubble:${key}`} aria-hidden="true">
                <Bubble b={{ tool: 'done', detail: 'Ready' }} />
              </div>
            {/each}
          {/snippet}
        </Stage>
      </div>
    </div>
  </div>
</section>

<style>
  .cta {
    padding-bottom: 72px;
  }
  .cta :global(.lg-h2) {
    font-size: clamp(30px, 2vw + 18px, 48px);
  }
  .actions {
    margin-top: 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .actions :global(svg) {
    flex-shrink: 0;
  }
  .req {
    margin-top: 16px;
    font-size: 13px;
    line-height: 1.6;
    color: oklch(0.65 0 0);
  }
</style>
