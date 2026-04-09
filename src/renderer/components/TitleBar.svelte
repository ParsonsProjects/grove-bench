<script lang="ts">
  import UpdateNotification from './UpdateNotification.svelte';
  import HelpPanel from './HelpPanel.svelte';

  let showHelp = $state(false);

  let isMaximized = $state(false);

  async function checkMaximized() {
    isMaximized = await window.groveBench.winIsMaximized();
  }

  $effect(() => {
    checkMaximized();
    const onResize = () => checkMaximized();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // Match pixel-bg: 4px rects on a 6px grid (4px pixel + 2px gap).
  const GRID = 6;        // 6px cell (matches pixel-bg's 6x6 tiling)
  const PX_SIZE = 4;     // 4px pixel size
  const TB_HEIGHT = 32;  // titlebar height in px
  const TB_WIDTH = 1600; // generate enough columns for wide screens
  const DISSOLVE_START_PX = TB_WIDTH * 0.28;
  const DISSOLVE_END_PX = TB_WIDTH * 0.58;

  function hash(a: number, b: number): number {
    let h = (a * 2654435761) ^ (b * 340573321);
    h = ((h >>> 16) ^ h) * 0x45d9f3b;
    h = ((h >>> 16) ^ h) * 0x45d9f3b;
    return ((h >>> 16) ^ h) >>> 0;
  }
  function rand(a: number, b: number): number {
    return (hash(a, b) % 10000) / 10000;
  }

  // Blue pixels — snapped to the same 6px grid, dissolve left to right
  const bluePixels: { left: number; top: number; opacity: number; delay: number }[] = [];
  for (let i = 0; i < 40; i++) {
    const raw = (i / 40);
    const leftPx = Math.round((raw * raw * 0.65 * TB_WIDTH) / GRID) * GRID;
    const topPx = Math.round((((i * 17 + 3) % 80 + 10) / 100 * TB_HEIGHT) / GRID) * GRID;
    const opacity = 0.35 - raw * raw * 0.25;
    const delay = (i * 0.7) % 5;
    bluePixels.push({ left: leftPx, top: topPx, opacity, delay });
  }

  // All grey pixels generated on one grid — no tiling pattern in titlebar.
  // Solid on the left, disintegrating to the right. Single system = no seam.
  const greyPixels: { left: number; top: number; opacity: number; color: string }[] = [];

  for (let x = 0; x < DISSOLVE_END_PX; x += GRID) {
    for (let y = 0; y < TB_HEIGHT; y += GRID) {
      const dist = Math.max(0, (x - DISSOLVE_START_PX) / (DISSOLVE_END_PX - DISSOLVE_START_PX));

      // Before dissolve zone: all pixels survive
      // In dissolve zone: cubic dropout
      if (dist > 0) {
        const survive = 1 - dist * dist * dist;
        if (rand(x, y) > survive) continue;
      }

      // Displacement: only in dissolve zone, increases with distance
      let dx = 0, dy = 0;
      if (dist > 0) {
        const driftAmount = dist * dist * 40;
        dx = (rand(y * 7, x * 13) - 0.5) * driftAmount;
        dy = (rand(x * 11, y * 3) - 0.5) * driftAmount;
      }

      const isBlue = rand(x * 3, y * 7) > 0.75;
      const color = isBlue ? '#6888aa' : '#ffffff';
      const opacity = isBlue ? 0.02 : 0.025;

      greyPixels.push({
        left: x + dx,
        top: Math.max(0, Math.min(TB_HEIGHT - PX_SIZE, y + dy)),
        opacity,
        color,
      });
    }
  }

  // Lone scattered outlier pixels drifting far from the body
  for (let i = 0; i < 12; i++) {
    const left = DISSOLVE_END_PX + rand(i, 999) * TB_WIDTH * 0.15;
    const top = rand(i * 7, 333) * (TB_HEIGHT - PX_SIZE);
    const isBlue = rand(i, 77) > 0.6;
    greyPixels.push({
      left,
      top,
      opacity: isBlue ? 0.015 : 0.02,
      color: isBlue ? '#6888aa' : '#ffffff',
    });
  }
</script>

<div class="titlebar flex items-center h-8 bg-card border-b border-border select-none shrink-0 relative overflow-hidden">
  <!-- Individual pixels: solid grid on left, dissolving to scattered on right -->
  {#each greyPixels as g}
    <span
      class="absolute"
      style="width:4px;height:4px;left:{g.left}px;top:{g.top}px;background:{g.color};opacity:{g.opacity};"
    ></span>
  {/each}

  <!-- Dissolving blue pixel trail -->
  {#each bluePixels as p}
    <span
      class="titlebar-pixel absolute"
      style="
        width: 4px; height: 4px;
        left: {p.left}px;
        top: {p.top}px;
        --peak-opacity: {p.opacity};
        animation-delay: {p.delay}s;
      "
    ></span>
  {/each}

  <div class="flex-1 app-drag px-3 flex items-center h-full relative z-10">
    <svg width="11" height="13" viewBox="0 0 21 24" fill="none" class="mr-1.5 shrink-0">
      <!-- Pixel art tree: 2px pixels with 1px gaps on a 3px grid -->
      <rect x="9" y="0" width="2" height="2" fill="#6ec87a"/>
      <rect x="6" y="3" width="2" height="2" fill="#5ab868"/>
      <rect x="9" y="3" width="2" height="2" fill="#5ab868"/>
      <rect x="12" y="3" width="2" height="2" fill="#5ab868"/>
      <rect x="3" y="6" width="2" height="2" fill="#4aaa58"/>
      <rect x="6" y="6" width="2" height="2" fill="#4aaa58"/>
      <rect x="9" y="6" width="2" height="2" fill="#4aaa58"/>
      <rect x="12" y="6" width="2" height="2" fill="#4aaa58"/>
      <rect x="15" y="6" width="2" height="2" fill="#4aaa58"/>
      <rect x="0" y="9" width="2" height="2" fill="#3a9a48"/>
      <rect x="3" y="9" width="2" height="2" fill="#3a9a48"/>
      <rect x="6" y="9" width="2" height="2" fill="#3a9a48"/>
      <rect x="9" y="9" width="2" height="2" fill="#3a9a48"/>
      <rect x="12" y="9" width="2" height="2" fill="#3a9a48"/>
      <rect x="15" y="9" width="2" height="2" fill="#3a9a48"/>
      <rect x="18" y="9" width="2" height="2" fill="#3a9a48"/>
      <rect x="3" y="12" width="2" height="2" fill="#3a9a48"/>
      <rect x="6" y="12" width="2" height="2" fill="#3a9a48"/>
      <rect x="9" y="12" width="2" height="2" fill="#3a9a48"/>
      <rect x="12" y="12" width="2" height="2" fill="#3a9a48"/>
      <rect x="15" y="12" width="2" height="2" fill="#3a9a48"/>
      <rect x="9" y="15" width="2" height="2" fill="#8a6a4a"/>
      <rect x="9" y="18" width="2" height="2" fill="#8a6a4a"/>
      <rect x="6" y="21" width="2" height="2" fill="#6a5040"/>
      <rect x="9" y="21" width="2" height="2" fill="#6a5040"/>
      <rect x="12" y="21" width="2" height="2" fill="#6a5040"/>
    </svg>
    <span class="text-xs text-muted-foreground">Grove Bench</span>
    <UpdateNotification />
  </div>
  <div class="flex items-center h-full relative z-10">
    <button
      onclick={() => showHelp = true}
      class="win-btn h-full px-3 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      title="Help"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
    </button>
    <button
      onclick={() => window.groveBench.winMinimize()}
      class="win-btn h-full px-3 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      title="Minimize"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M1 5h8" stroke="currentColor" stroke-width="1.2"/>
      </svg>
    </button>
    <button
      onclick={() => { window.groveBench.winMaximize(); setTimeout(checkMaximized, 50); }}
      class="win-btn h-full px-3 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      title={isMaximized ? 'Restore' : 'Maximize'}
    >
      {#if isMaximized}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="0.5" y="2.5" width="7" height="7" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
          <path d="M2.5 2.5V1.5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H7.5" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      {:else}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      {/if}
    </button>
    <button
      onclick={() => window.groveBench.winClose()}
      class="win-btn h-full px-3 flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-white transition-colors"
      title="Close"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2"/>
      </svg>
    </button>
  </div>
</div>

<HelpPanel open={showHelp} onclose={() => showHelp = false} />

<style>
  .app-drag {
    -webkit-app-region: drag;
  }
  .win-btn {
    -webkit-app-region: no-drag;
  }
  .titlebar-pixel {
    background: #4a7aaa;
    opacity: 0;
    animation: titlebar-glow 5s ease-in-out infinite;
  }
  @keyframes titlebar-glow {
    0%, 100% { opacity: 0; }
    50% { opacity: var(--peak-opacity, 0.1); }
  }
</style>
