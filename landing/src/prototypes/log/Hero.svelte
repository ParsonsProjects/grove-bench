<script>
  import Stage from './Stage.svelte';
  import Commit from './Commit.svelte';
  import Bubble from './Bubble.svelte';
  import Legend from '../grove/Legend.svelte';
  import { heroScene } from './scenes/hero.js';
  import { links } from '../shared/brand.js';
  import { trackLandingEvent } from '../../lib/analytics.js';
  import { agents, hashes } from './data.js';
  import { story } from './story.svelte.js';
  import { DownloadIcon, GithubIcon } from '../branches/icons.js';

  /** @type {{ reduced?: boolean }} */
  let { reduced = false } = $props();

  const INSET = 430;
  const opts = { inset: 0 };
  let colW = $state(0);
  /** @type {any} */
  let stage = $state();
  const wide = $derived(colW >= 980);

  $effect(() => {
    const next = wide ? INSET : 0;
    if (opts.inset !== next) {
      opts.inset = next;
      stage?.relayout();
    }
  });

  const factory = (env) => heroScene(env, opts);

  const callouts = [
    { key: 'tree', label: 'git worktree' },
    { key: 'agent', label: 'AI conversation' },
    { key: 'lamp', label: 'status' },
  ];

  function talk(key) {
    const a = agents[key];
    if (key === 'auth') return { status: 'working', text: `${a.task} Each edit lands in my own worktree, not yours.` };
    if (key === 'api') {
      return story.permission === 'pending'
        ? { status: 'permission', text: `I want to run \`${a.ask}\`. Scroll down to Permissions and tell me yes or no.` }
        : { status: 'working', text: `${a.task} Thanks for answering.` };
    }
    return { status: 'ready', text: `${a.task.replace('Fixing', 'Fixed')} 5 tests pass, 2 files changed. Ready for your review.` };
  }
</script>

<section class="lg-hero" aria-labelledby="hero-title">
  <div class="lg-wrap">
    <div class="lg-col" bind:clientWidth={colW}>
      <div class="hero" class:wide style="--inset: {INSET}px">
        <div class="hero-text">
          <Commit id="hero" hash={hashes.hero} title="Run several AI agents on one project at once." level={1} headingId="hero-title">
            <p>
              Grove Bench is a Windows app for AI coding agents. Each conversation works in its own git worktree, on
              its own branch, with its own terminal.
            </p>
          </Commit>
          <div class="actions">
            <a
              href={links.releases}
              target="_blank"
              rel="noopener"
              class="btn-primary"
              onclick={() => trackLandingEvent('download_click', { location: 'log-hero' })}
            >
              {@html DownloadIcon}
              Download for Windows
            </a>
            <a
              href={links.github}
              target="_blank"
              rel="noopener"
              class="btn-secondary"
              onclick={() => trackLandingEvent('github_click', { location: 'log-hero' })}
            >
              {@html GithubIcon}
              View source
            </a>
          </div>
          <p class="note">Windows 10+ <span aria-hidden="true">·</span> Free and open source (MIT)</p>
        </div>

        <div class="hero-scene">
          <Stage
            bind:this={stage}
            id="hero"
            {factory}
            {reduced}
            {talk}
            dataTod={0}
            class="lg-frame"
            label="A pixel grove at night. Three trees stand side by side, each a git worktree. Under each tree an agent sits on a bench with a laptop: three AI conversations. Beside each bench a lamp shows status: blue working, amber waiting for you, green ready."
          >
            {#snippet overlays(pin, snap)}
              {#each ['auth', 'api', 'fix'] as key (key)}
                <div class="pin" use:pin={`sign:${key}`} aria-hidden="true">
                  <span class="lg-sign">{agents[key].branch}</span>
                </div>
                <div class="pin" use:pin={`bubble:${key}`} aria-hidden="true">
                  <Bubble b={snap?.[key]} />
                </div>
              {/each}
              {#each callouts as c (c.key)}
                <div class="pin" use:pin={`callout:${c.key}`}>
                  <span class="lg-callout">{c.label}</span>
                </div>
              {/each}
            {/snippet}
          </Stage>
          <div class="legend-slot">
            <Legend compact={colW < 560} />
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .lg-hero {
    padding-top: 36px;
    padding-bottom: 40px;
  }
  @media (min-width: 768px) {
    .lg-hero {
      padding-top: 48px;
      padding-bottom: 56px;
    }
  }
  .hero {
    position: relative;
  }
  .hero-text :global(.lg-sub) {
    max-width: 46ch;
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
  .note {
    margin-top: 14px;
    font-size: 13px;
    color: oklch(0.62 0 0);
  }
  .hero-scene {
    margin-top: 28px;
    position: relative;
  }
  .legend-slot {
    margin-top: 18px;
    max-width: 420px;
  }

  /* Wide: the title sits in the sky on the left, the grove on the right. */
  .hero.wide .hero-text {
    position: absolute;
    z-index: 3;
    left: 28px;
    top: 30px;
    width: calc(var(--inset) - 44px);
    text-shadow: 0 1px 0 #0b1224;
  }
  .hero.wide .hero-scene {
    margin-top: 0;
  }
  .hero.wide :global(.lg-h1) {
    font-size: 38px;
  }
  .hero.wide :global(.lg-sub) {
    color: oklch(0.82 0.02 260);
  }
  .hero.wide .note {
    color: oklch(0.72 0.02 260);
  }
  .hero.wide .legend-slot {
    position: absolute;
    z-index: 2;
    right: 18px;
    top: 18px;
    margin: 0;
    width: 400px;
  }
</style>
