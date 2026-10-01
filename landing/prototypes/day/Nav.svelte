<script>
  import { treeGreens } from '../../src/lib/brand.js';
  import { DownloadIcon } from '../../src/lib/icons.js';
  import { onMount } from 'svelte';
  import { mix, hexToRgb, rgbToOklab } from '../../src/pixel/palette.js';
  import { BANDS } from './sky.js';
  import { scroll, clockText, isEvening } from './scroll.svelte.js';
  import { links } from './content.js';

  /**
   * The top bar. It takes on the sky's colour as you scroll, and its clock
   * runs from morning to night with the page.
   */
  // The bar takes the colour of the sky right behind it, and switches to
  // light text when that sky is dark.
  let bands = [];
  function measure() {
    bands = BANDS.map(([cls, top, bottom]) => {
      const el = document.querySelector('.' + cls);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { y0: r.top + window.scrollY, y1: r.bottom + window.scrollY, top, bottom };
    }).filter(Boolean);
  }
  onMount(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => ro.disconnect();
  });
  const bg = $derived.by(() => {
    const y = scroll.y + 31;
    const b = bands.find((x) => y >= x.y0 && y < x.y1);
    if (!b) return scroll.progress > 0.5 ? '#090e1c' : '#fffdf7';
    return mix(b.top, b.bottom, (y - b.y0) / Math.max(1, b.y1 - b.y0));
  });
  const evening = $derived(rgbToOklab(hexToRgb(bg))[0] < 0.6);
  const night = $derived(isEvening(scroll.progress));
  // The sun sinks through the afternoon; the moon rises after it.
  const sunY = $derived(Math.min(8, Math.max(0, (scroll.progress - 0.35) * 26)));
</script>

<header class="nav" class:evening style="--nav-bg: {bg}">
  <div class="inner bar">
    <a class="brand" href="#top">
      <svg width="18" height="20" viewBox="0 0 21 24" aria-hidden="true" style="image-rendering: pixelated">
        {#each treeGreens as p}<rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />{/each}
      </svg>
      <span>grove bench</span>
    </a>
    <nav class="links" aria-label="Sections">
      <a href="#why">why</a>
      <a href="#features">features</a>
      <a href="#how">how it works</a>
      <a href="#faq">faq</a>
    </nav>
    <span class="clock" aria-hidden="true" title="The page turns from morning to night as you scroll">
      <svg width="14" height="14" viewBox="0 0 7 7" shape-rendering="crispEdges">
        {#if night}
          <path d="M2 0h3v1h1v1H4v1H3v2h1v1h2v1H1V6H0V1h1V0z" fill="#e8e3ff" />
        {:else}
          <g transform="translate(0 {sunY * 0.25})"><rect x="2" y="1" width="3" height="5" fill="#f2b84b" /><rect x="1" y="2" width="5" height="3" fill="#f2b84b" /></g>
        {/if}
      </svg>
      {clockText(scroll.progress)}
    </span>
    <a class="d-btn get" href={links.releases} target="_blank" rel="noopener">{@html DownloadIcon} <span>download</span></a>
  </div>
</header>

<style>
  .nav {
    position: sticky;
    top: 0;
    z-index: 50;
    background: color-mix(in srgb, var(--nav-bg) 88%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid rgb(58 42 28 / 0.08);
    transition: color 0.3s;
  }
  .nav.evening {
    --ink: #f4f1ff;
    --soft: #c9c3e6;
    color: #f4f1ff;
    border-bottom-color: rgb(201 195 230 / 0.14);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 22px;
    min-height: 62px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding-block: 8px;
    white-space: nowrap;
    font-size: 17px;
    font-weight: 800;
    letter-spacing: -0.04em;
    color: inherit;
    text-decoration: none;
  }
  .links {
    display: flex;
    gap: 20px;
    margin-left: auto;
    font-size: 13px;
  }
  .links a {
    color: var(--soft);
    text-decoration: none;
    white-space: nowrap;
  }
  .links a:hover {
    color: inherit;
  }
  .clock {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--soft);
    font-variant-numeric: tabular-nums;
    image-rendering: pixelated;
  }
  .get {
    min-height: 36px;
    padding: 6px 14px;
    font-size: 13px;
  }
  /* The section links need about 900px; below that the bar keeps the
     brand, the clock and the download button. */
  @media (max-width: 899px) {
    .links {
      display: none;
    }
    .clock {
      margin-left: auto;
    }
  }
  /* On phones the bar spans the full width rather than the column beside
     the trail. */
  @media (max-width: 760px) {
    .nav .bar {
      width: 100%;
      margin-left: 0;
      padding-inline: 16px;
    }
  }
  @media (max-width: 400px) {
    .bar {
      gap: 12px;
    }
    .get span {
      display: none;
    }
  }
  @media (max-width: 359px) {
    .bar {
      gap: 8px;
    }
    .brand {
      gap: 7px;
      font-size: 15px;
    }
  }
</style>
