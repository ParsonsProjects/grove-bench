<script>
  import { links } from '../shared/brand.js';
  import { trackLandingEvent } from '../../lib/analytics.js';
  import Commit from './Commit.svelte';
  import HeroGraph from './HeroGraph.svelte';
  import { DownloadIcon, GithubIcon } from './icons.js';

  /** @type {{ reduced?: boolean }} */
  let { reduced = false } = $props();

  /** @type {HTMLElement | undefined} */
  let heroEl = $state();

  // Headline typed on in about 0.9s. The real text lives in an sr-only span;
  // the per-character copy is aria-hidden. Reduced motion shows it at once.
  const lines = ['Parallel AI agents.', 'Zero conflicts.'];
  const STEP = 0.026;
  const START = 0.15;

  let i = 0;
  const typed = lines.map((line) => {
    let k = 0;
    return line.split(' ').map((word) => {
      const chars = word.split('').map((ch) => {
        const n = i++;
        return { ch, delay: START + n * STEP, n: k++ };
      });
      i++; // the space between words takes a beat too
      k++;
      return chars;
    });
  });
  const total = i;
  const endDelay = START + total * STEP;

  // Second line runs from primary blue to teal, per character.
  function charColor(li, k) {
    if (li === 0) return undefined;
    const u = k / Math.max(1, lines[1].length - 1);
    const L = 0.7 + 0.08 * u;
    const C = 0.16 - 0.03 * u;
    const h = 254.6 - 54.6 * u;
    return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)})`;
  }
</script>

<section class="hero" bind:this={heroEl} aria-labelledby="hero-title">
  <HeroGraph host={heroEl} {reduced} />
  <div class="bx-wrap hero-wrap">
    <div class="bx-col hero-col">
      <Commit id="hero" hash="4b825dc" lane="main" />
      <h1 id="hero-title" class="hero-title">
        <span class="sr-only">Parallel AI agents. Zero conflicts.</span>
        <span aria-hidden="true" class="typed" style="--end: {endDelay}s">
          {#each typed as line, li}
            <span class="line">{#each line as word, wi}{#if wi > 0}{' '}{/if}<span class="word">{#each word as c}<span class="ch" style="animation-delay: {c.delay}s; color: {charColor(li, c.n)}">{c.ch}</span>{/each}</span>{/each}{#if li === typed.length - 1}<span class="caret"></span>{/if}</span>
          {/each}
        </span>
      </h1>
      <p class="hero-sub">
        Run several AI agents on one project. Each gets its own git worktree, branch and terminal.
      </p>
      <div class="hero-actions">
        <a
          href={links.releases}
          target="_blank"
          rel="noopener"
          class="btn-primary"
          onclick={() => trackLandingEvent('download_click', { location: 'branches-hero' })}
        >
          {@html DownloadIcon}
          Download for Windows
        </a>
        <a
          href={links.github}
          target="_blank"
          rel="noopener"
          class="btn-secondary"
          onclick={() => trackLandingEvent('github_click', { location: 'branches-hero' })}
        >
          {@html GithubIcon}
          View source
        </a>
      </div>
      <p class="hero-note">Windows 10+ <span aria-hidden="true">·</span> Free and open source (MIT)</p>
    </div>
  </div>
</section>

<style>
  .hero {
    position: relative;
    overflow: hidden;
    isolation: auto;
    background: radial-gradient(ellipse 55% 45% at 76% 42%, oklch(0.541 0.181 254.624 / 0.07), transparent 70%);
  }
  .hero-wrap {
    position: relative;
    min-height: min(780px, calc(100svh - 56px));
    display: flex;
    align-items: center;
    padding-top: 56px;
    padding-bottom: 220px;
  }
  @media (min-width: 700px) {
    .hero-wrap {
      padding-top: 72px;
      padding-bottom: 96px;
    }
  }
  .hero-col {
    width: 100%;
  }

  .hero-title {
    margin-top: 22px;
    font-size: clamp(38px, 5.6vw, 80px);
    font-weight: 800;
    line-height: 1.02;
    letter-spacing: -0.035em;
    color: oklch(0.95 0 0);
  }
  .line {
    display: block;
  }
  .word {
    white-space: nowrap;
  }
  .ch {
    animation: bx-type 0.01s linear both;
  }
  @keyframes bx-type {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .caret {
    display: inline-block;
    width: 0.5em;
    height: 0.8em;
    margin-left: 0.06em;
    vertical-align: -0.04em;
    background: oklch(0.78 0.13 200);
    animation: bx-blink 1.1s steps(1) var(--end) infinite;
  }
  @keyframes bx-blink {
    50% {
      opacity: 0;
    }
  }

  .hero-sub {
    margin-top: 26px;
    max-width: 50ch;
    font-size: 16px;
    line-height: 1.65;
    color: oklch(0.72 0 0);
  }
  @media (min-width: 768px) {
    .hero-sub {
      font-size: 18px;
    }
  }
  .hero-actions {
    margin-top: 34px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .hero-actions :global(svg) {
    flex-shrink: 0;
  }
  .hero-note {
    margin-top: 18px;
    font-size: 13px;
    color: oklch(0.6 0 0);
  }

  @media (prefers-reduced-motion: reduce) {
    .ch {
      animation: none;
    }
    .caret {
      animation: none;
    }
  }
</style>
