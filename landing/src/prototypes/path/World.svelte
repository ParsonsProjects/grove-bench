<script>
  import { onMount, tick } from 'svelte';
  import { animationLoop } from '../shared/motion.js';
  import { buildWorld, evalKnots, clamp, S, GAP, ORDER } from './world.js';
  import { createRenderer, TILE } from './render.js';
  import { agentFrames } from './sprites.js';
  import { AGENTS, LANES, BRANCH_KEYS, MEMORY_FOLDERS, laneStyle } from './data.js';

  /**
   * The pixel world behind the page: a stack of small canvases that scroll
   * with the page, labels pinned into it, and the three agents, whose place
   * on the path is a function of the scroll position.
   *
   * @type {{
   *   page: HTMLElement,
   *   k: number,
   *   wide: boolean,
   *   reduced: boolean,
   *   permission: 'pending' | 'allow' | 'always' | 'deny',
   *   turn: number,
   *   rewindMode: null | 'all' | 'conv',
   *   hitEls?: HTMLElement[],
   *   ongeo?: (geo: any) => void,
   *   onstatus?: (statuses: Record<string, string>) => void,
   *   ondebug?: (api: any) => void,
   * }}
   */
  let { page, k, wide, reduced, permission, turn, rewindMode, hitEls = [], ongeo, onstatus, ondebug } = $props();

  // Focus line: the share of the viewport the agents walk at.
  const F = 0.62;

  let worldEl = $state();
  let tilesEl = $state();
  let labelsEl = $state();
  /** @type {ReturnType<typeof buildWorld> | null} */
  let geo = $state(null);
  let heightPx = $state(0);
  /** @type {ReturnType<typeof createRenderer> | null} */
  let renderer = null;
  let tiles = [];
  let sig = '';

  const frames = Object.fromEntries(AGENTS.map((a) => [a.key, agentFrames(a.look)]));

  // Per agent motion bookkeeping (plain, not reactive).
  const motion = Object.fromEntries(
    BRANCH_KEYS.map((key) => [key, { y: 0, lastY: null, moved: -1, dir: 1, passedGate: false, passedLamp: false }]),
  );

  let clock = 0;
  let pointer = null;
  // feat/api: after you answer, it walks on to catch up with the others.
  let apiCap = null;
  // fix/login-bug: how far back up its lane the rewind has taken it.
  let rewindShown = 0;
  let turnShown = 4;
  let cpGrowth = 1;
  let gateGlow = 0;

  // Reactive bits the overlays need.
  let bubbles = $state({ auth: -1, api: -1, fix: -1 });
  let calloutAlpha = $state(1);
  let gateLit = $state(false);
  let askEl = $state();
  let askOn = $state(false);
  let statuses = $state({ auth: 'working', api: 'working', fix: 'working' });

  const STONE_STEP = 18;
  const growthForTurn = (n) => [0.6, 0.72, 0.86, 1][n - 1];

  // -------------------------------------------------------------------------
  // Measure

  function measure() {
    if (!page || !worldEl) return;
    const pr = page.getBoundingClientRect();
    const pageTop = pr.top + window.scrollY;
    const toArt = (v) => v / k;
    const zones = {};
    let region = null;
    for (const el of page.querySelectorAll('[data-scene]')) {
      const r = el.getBoundingClientRect();
      const top = r.top + window.scrollY - pageTop;
      zones[/** @type {HTMLElement} */ (el).dataset.scene] = { top: toArt(top), bottom: toArt(top + r.height) };
      region ??= { x: toArt(r.left - pr.left), w: toArt(r.width) };
    }
    const panels = [];
    for (const el of page.querySelectorAll('[data-panel]')) {
      const r = el.getBoundingClientRect();
      const top = r.top + window.scrollY - pageTop;
      panels.push({ top: toArt(top), bottom: toArt(top + r.height) });
    }
    const footer = page.querySelector('footer');
    const worldBottom = footer ? footer.getBoundingClientRect().top + window.scrollY - pageTop : pr.height;
    const need = ['hero', 'worktrees', 'terminals', 'permissions', 'checkpoints', 'memory', 'review', 'how', 'cta'];
    if (!region || need.some((n) => !zones[n])) return;

    const W = Math.ceil(page.clientWidth / k) + 1;
    const H = Math.ceil(worldBottom / k);
    const vh = window.innerHeight;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    const m = {
      k,
      W,
      H,
      wide,
      R: region.x,
      RW: wide ? region.w : Math.min(region.w, 240),
      zones,
      panels,
      vhArt: vh / k,
      uTop: (F * vh) / k,
      uMax: (maxScroll + F * vh) / k,
    };
    const next = JSON.stringify([m, reduced]);
    if (next === sig) return;
    sig = next;
    geo = buildWorld(m);
    ongeo?.(geo);
    renderer = createRenderer(geo, { reduced });
    renderer.setDetour(permission === 'deny');
    heightPx = H * k;
    buildTiles(W, H);
    for (const key of BRANCH_KEYS) motion[key].lastY = null;
    draw(0);
    tick().then(clampLabels);
  }

  // Keep in-scene labels inside the page on narrow screens.
  function clampLabels() {
    if (!labelsEl) return;
    const max = page.clientWidth - 4;
    for (const el of labelsEl.querySelectorAll('.pin > *')) {
      const node = /** @type {HTMLElement} */ (el);
      node.style.translate = '';
      const r = node.getBoundingClientRect();
      let dx = 0;
      if (r.right > max) dx = max - r.right;
      if (r.left + dx < 4) dx = 4 - r.left;
      if (dx) node.style.translate = `${dx.toFixed(1)}px 0`;
    }
  }

  function buildTiles(W, H) {
    if (!tilesEl) return;
    tilesEl.replaceChildren();
    tiles = [];
    const n = Math.ceil(H / TILE);
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = TILE;
      c.style.top = `${i * TILE * k}px`;
      c.style.width = `${W * k}px`;
      c.style.height = `${TILE * k}px`;
      const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
      ctx.imageSmoothingEnabled = false;
      tilesEl.appendChild(c);
      tiles.push({ canvas: c, ctx, i, y0: i * TILE, drawn: false });
    }
  }

  // -------------------------------------------------------------------------
  // Frame state

  function focus() {
    return (window.scrollY + F * window.innerHeight) / k;
  }

  function rewindWeight(u) {
    const hd = geo.holdInfo.fix.sun;
    if (hd.uS == null) return 0;
    if (u < hd.uS - 60) return 0;
    if (u < hd.uS) return S((u - (hd.uS - 60)) / 60);
    if (u <= hd.uE) return 1;
    return 1 - S((u - hd.uE) / geo.C);
  }

  function agentState(dt) {
    const u = focus();
    const out = [];
    for (const def of AGENTS) {
      const key = def.key;
      const mo = motion[key];
      let y = evalKnots(geo.tracks[key], u);
      if (key === 'api') {
        const wait = geo.gateY - 9;
        if (permission === 'pending') y = Math.min(y, wait);
        else if (apiCap != null) {
          y = Math.min(y, apiCap);
          if (apiCap >= evalKnots(geo.tracks.api, u) - 0.01) apiCap = null;
        }
      }
      if (key === 'fix') y -= rewindShown * rewindWeight(u);
      const detour = key === 'api' && permission === 'deny';
      const x = geo.agentX(key, y, detour);

      // Walking frame from the distance walked, idle once the scroll rests.
      if (mo.lastY == null) mo.lastY = y;
      const dy = y - mo.lastY;
      if (Math.abs(dy) > 0.01) {
        mo.moved = clock;
        mo.dir = dy > 0 ? 1 : -1;
      }
      mo.lastY = y;
      const walking = !reduced && clock - mo.moved < 0.16;
      const frame = walking ? Math.floor(Math.abs(y) / 4) % 4 : 0;

      const bh = geo.holdInfo[key].bench;
      const sitting = bh.uS != null && u >= bh.uS - 0.01 && u <= bh.uE + 0.01 && Math.abs(y - bh.h) < 0.5;
      const bench = geo.benches[key];
      out.push({
        key,
        x,
        y,
        u,
        dir: walking ? mo.dir : mo.dir < 0 && clock - mo.moved < 1.2 ? -1 : 1,
        frame,
        pose: sitting ? 'sit' : 'walk',
        seat: { x: bench.seatX, y: bench.seatY },
        frames: frames[key],
        sitProgress: sitting ? clamp((u - bh.uS) / Math.max(1, bh.uE - bh.uS), 0, 0.999) : -1,
      });
      mo.y = y;
    }
    return out;
  }

  function statusOf(a) {
    if (a.key === 'api' && permission === 'pending' && a.y >= geo.gateY - 40) return 'permission';
    if (a.y > geo.mergeLamps[a.key].base) return 'ready';
    return 'working';
  }

  function memoryLevel(u) {
    const t = geo.memTop;
    return S((u - (t - 30)) / 70) * (1 - S((u - (t + 250)) / 80));
  }

  function memoryNotes(agents, level) {
    if (level < 0.03) return [];
    const ms = geo.memStone;
    const notes = [];
    const y0 = ms.base - 12;
    const yJ = ms.base - 2;
    agents.forEach((a, li) => {
      const lx = geo.laneX(a.key, yJ) ?? geo.mainX(yJ);
      const yEnd = Math.max(yJ + 12, a.y - 18);
      const arc = Math.hypot(lx - ms.x, yJ - y0) + 12;
      const down = yEnd - yJ;
      const total = arc + down;
      const phases = reduced ? [0.35, 0.75] : [0, 1 / 3, 2 / 3].map((j) => (clock * 0.22 + j + li * 0.17) % 1);
      for (const p of phases) {
        const d = p * total;
        let x;
        let y;
        if (d < arc) {
          const s = d / arc;
          const cx = (ms.x + lx) / 2;
          const cy = Math.min(y0, yJ) - 20;
          x = (1 - s) ** 2 * ms.x + 2 * (1 - s) * s * cx + s * s * lx;
          y = (1 - s) ** 2 * y0 + 2 * (1 - s) * s * cy + s * s * yJ;
        } else {
          y = yJ + (d - arc);
          x = geo.laneX(a.key, y) ?? geo.mainX(y);
        }
        const fade = Math.min(1, p * 8) * (1 - S((p - 0.86) / 0.14));
        notes.push({ x, y, a: fade * level });
      }
    });
    return notes;
  }

  function growthFor(agents, u) {
    const ys = Object.fromEntries(agents.map((a) => [a.key, a.y]));
    return (p) => {
      if (p.id?.startsWith('wt-')) return clamp((ys[p.lane] - (p.base - 120)) / 64, 0.1, 1);
      if (p.id === 'cp-fix') return cpGrowth;
      if (p.id === 'cta') return clamp((u - geo.ctaGrow.from) / (geo.ctaGrow.to - geo.ctaGrow.from), 0.06, 1);
      return 1;
    };
  }

  // -------------------------------------------------------------------------
  // Draw

  function draw(dt) {
    if (!geo || !renderer) return;
    clock += dt;
    const u = focus();

    // Visitor-driven motion eases (instant with reduced motion).
    const rewindTarget = (4 - turn) * STONE_STEP;
    const growTarget = rewindMode === 'conv' ? 1 : growthForTurn(turn);
    if (reduced || dt === 0) {
      rewindShown = rewindTarget;
      cpGrowth = growTarget;
      turnShown = turn;
      if (reduced) apiCap = null;
    } else {
      rewindShown += Math.sign(rewindTarget - rewindShown) * Math.min(Math.abs(rewindTarget - rewindShown), dt * 34);
      cpGrowth += Math.sign(growTarget - cpGrowth) * Math.min(Math.abs(growTarget - cpGrowth), dt * 0.5);
      turnShown += Math.sign(turn - turnShown) * Math.min(Math.abs(turn - turnShown), dt * 3);
      if (apiCap != null) apiCap += dt * 64;
    }

    const agents = agentState(dt);
    const status = {};
    for (const a of agents) status[a.key] = statusOf(a);

    // Leaves when an agent walks through the gate on main, or passes its green lamp.
    for (const a of agents) {
      const mo = motion[a.key];
      const pastGate = a.y > geo.mainGateY;
      if (pastGate && !mo.passedGate && dt > 0) renderer.burst(geo.gateX, geo.mainGateY - 18, 16, 1.1);
      mo.passedGate = pastGate;
      const lamp = geo.mergeLamps[a.key];
      const pastLamp = a.y > lamp.base;
      if (pastLamp && !mo.passedLamp && dt > 0) renderer.burst(lamp.x + 1, lamp.base - 20, 6, 0.6);
      mo.passedLamp = pastLamp;
    }
    const home = agents.filter((a) => a.y > geo.mainGateY).length / 3;
    gateGlow = reduced ? home : gateGlow + (home - gateGlow) * (1 - Math.exp(-dt * 3));
    if (gateGlow > 0.3 !== gateLit) gateLit = gateGlow > 0.3;

    const todv = geo.tod(u);
    const night = 1 - S((todv - 0.3) / 0.55);
    const view = { top: window.scrollY / k, bottom: (window.scrollY + window.innerHeight) / k };
    if (!reduced && dt > 0) renderer.update(dt, view, pointer && night > 0.1 ? pointer : null);

    const level = memoryLevel(u);
    const heroEnd = geo.holdInfo.auth.hero.uE ?? 0;
    const callout = 1 - S((u - heroEnd) / 30);
    const f = {
      agents,
      tod: todv,
      night,
      turn: turnShown,
      gateOpen: permission === 'pending' || permission === 'deny' ? 0 : 1,
      growth: growthFor(agents, u),
      lampStatus: (p) => {
        if (p.id === 'gate') return permission === 'pending' ? 'permission' : 'working';
        if (p.id?.startsWith('merge-')) return status[p.lane] === 'ready' ? 'ready' : 'working';
        return p.status;
      },
      memory: level,
      notes: memoryNotes(agents, level),
      gateGlow,
      callout,
    };

    const first = Math.max(0, Math.floor((view.top - TILE * 0.5) / TILE));
    const last = Math.min(tiles.length - 1, Math.floor((view.bottom + TILE * 0.5) / TILE));
    for (let i = first; i <= last; i++) {
      renderer.drawTile(tiles[i], f);
      tiles[i].drawn = true;
    }

    // Overlays.
    if (Math.abs(callout - calloutAlpha) > 0.01 || (callout === 0 && calloutAlpha !== 0)) calloutAlpha = callout;
    const nextBubbles = {};
    for (const a of agents) {
      const def = AGENTS.find((d) => d.key === a.key);
      nextBubbles[a.key] = a.sitProgress >= 0 ? Math.floor(a.sitProgress * def.work.length) : -1;
    }
    if (BRANCH_KEYS.some((key) => nextBubbles[key] !== bubbles[key])) bubbles = nextBubbles;
    if (BRANCH_KEYS.some((key) => status[key] !== statuses[key])) {
      statuses = status;
      onstatus?.(status);
    }

    agents.forEach((a, i) => {
      const el = hitEls[i];
      if (!el) return;
      const x = a.pose === 'sit' ? a.seat.x + 4.5 : a.x;
      const y = a.pose === 'sit' ? a.seat.y + 16 : a.y + 1;
      el.style.transform = `translate(${(x * k).toFixed(1)}px, ${(y * k).toFixed(1)}px)`;
    });
    const api = agents.find((a) => a.key === 'api');
    const showAsk = permission === 'pending' && api.y >= geo.gateY - 12;
    if (showAsk !== askOn) askOn = showAsk;
    if (askEl) askEl.style.transform = `translate(${(api.x * k).toFixed(1)}px, ${((api.y - 17) * k).toFixed(1)}px)`;
    lastAgents = agents;
  }

  let lastAgents = [];
  let pending = 0;
  function requestDraw() {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      draw(0);
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle

  let measurePending = 0;
  function requestMeasure() {
    cancelAnimationFrame(measurePending);
    measurePending = requestAnimationFrame(() => {
      measurePending = 0;
      measure();
    });
  }

  onMount(() => {
    measure();
    const ro = new ResizeObserver(requestMeasure);
    ro.observe(page);
    const onScroll = () => {
      if (reduced) requestDraw();
    };
    const onPointer = (e) => {
      if (e.pointerType === 'touch') {
        pointer = null;
        return;
      }
      pointer = { x: e.clientX / k, y: (window.scrollY + e.clientY) / k };
    };
    const onLeave = () => (pointer = null);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', requestMeasure);
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.fonts?.ready.then(requestMeasure);
    ondebug?.({
      sample: () => lastAgents.map((a) => ({ key: a.key, x: a.x, y: a.y, pose: a.pose })),
      agents: () => lastAgents,
      focus,
      geo: () => geo,
      fireflies: () => renderer?.fireflies().map((f) => [Math.round(f.x), Math.round(f.y)]),
      pointer: () => pointer,
    });
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', requestMeasure);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(pending);
      cancelAnimationFrame(measurePending);
    };
  });

  // Re-measure when the scale or layout mode changes.
  $effect(() => {
    void k;
    void wide;
    void reduced;
    requestMeasure();
  });

  // The loop: every frame while the world is on screen, unless reduced motion.
  $effect(() => {
    if (reduced || !worldEl) return;
    return animationLoop(worldEl, (dt) => draw(dt));
  });

  // New bubbles appear while the agents sit: keep them on the page too.
  $effect(() => {
    void bubbles;
    tick().then(clampLabels);
  });

  // Answers and rewinds.
  /** @type {string} */
  let prevPermission = 'pending';
  $effect(() => {
    const p = permission;
    if (p === prevPermission) return;
    if (prevPermission === 'pending' && p !== 'pending' && geo) {
      apiCap = reduced ? null : Math.min(evalKnots(geo.tracks.api, focus()), geo.gateY - 9);
    }
    prevPermission = p;
    renderer?.setDetour(p === 'deny');
    requestDraw();
  });

  $effect(() => {
    void turn;
    void rewindMode;
    if (reduced) requestDraw();
  });

  // -------------------------------------------------------------------------
  // Overlay helpers

  const px = (v) => `${(v * k).toFixed(1)}px`;
  const pin = (x, y) => `transform: translate(${px(x)}, ${px(y)})`;

</script>

<div class="world" bind:this={worldEl} style="height: {heightPx}px; --px: {Math.max(2, Math.min(4, k)).toFixed(2)}px">
  <div class="tiles" bind:this={tilesEl} aria-hidden="true"></div>

  {#if geo}
    <div class="labels" aria-hidden="true" bind:this={labelsEl}>
      <!-- Hero callouts -->
      {#each geo.callouts as c (c.key)}
        <span class="pin" style="{pin(c.x, c.y)}; opacity: {calloutAlpha}; visibility: {calloutAlpha < 0.02 ? 'hidden' : 'visible'}">
          <span class="callout">{c.label}</span>
        </span>
      {/each}

      <!-- Branch signs at the fork -->
      {#each geo.signs as s (s.key)}
        <span class="pin" style={pin(s.x, s.y)}>
          <span class="board" style={laneStyle(s.key)}>{LANES[s.key].name}</span>
        </span>
      {/each}
      <span class="pin" style={pin(geo.wtSign.x, geo.wtSign.y)}>
        <span class="board wt">.grove-wt/<br />&lt;id&gt;/</span>
      </span>

      <!-- Tool calls while they work -->
      {#each AGENTS as a (a.key)}
        {@const b = bubbles[a.key]}
        {@const bench = geo.benches[a.key]}
        {#if b >= 0}
          {@const step = a.work[b]}
          <span class="pin" style={pin(bench.seatX + 4.5, bench.seatY - 2)}>
            {#if step.term}
              <span class="bubble term"><span class="t-prompt">{step.term}</span><span class="t-out">{step.out}</span></span>
            {:else}
              <span class="bubble"><b class="tool {step.tool.toLowerCase()}">{step.tool}</b> {step.detail}</span>
            {/if}
          </span>
        {/if}
      {/each}

      <!-- Waiting at the gate -->
      <span class="pin ask-pin" bind:this={askEl} style="visibility: {askOn ? 'visible' : 'hidden'}">
        <span class="bubble ask">?</span>
      </span>

      <!-- Checkpoint stones -->
      {#each geo.stoneMarks as s (s.n)}
        <span class="pin" style={pin(s.x - 2, s.y + 5)}>
          <span class="stone-n" class:lit={s.n <= turn}>{s.n}</span>
        </span>
      {/each}
      <span class="pin" style={pin(geo.sundial.x, geo.sundial.base + 3)}>
        <span class="hint">drag the shadow</span>
      </span>

      <!-- Memory folders -->
      {#each geo.chips as c, i (i)}
        <span class="pin" style={pin(c.x, c.y)}>
          <span class="chip-note">{MEMORY_FOLDERS[i]}</span>
        </span>
      {/each}

      <!-- The gate on main -->
      <span class="pin" style={pin(geo.gateX, geo.mainGateY - 33)}>
        <span class="gate-board" class:lit={gateLit}>main</span>
      </span>
    </div>

  {/if}
</div>

<style>
  .world {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    overflow: hidden;
    z-index: 0;
  }
  .tiles :global(canvas) {
    position: absolute;
    left: 0;
    display: block;
    image-rendering: pixelated;
  }
  .labels {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2;
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
  }
  .pin {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
  }
  .pin > * {
    position: absolute;
    left: 0;
    bottom: 0;
    transform: translateX(-50%);
  }

  /* Pixel frames with notched corners, sized to the art pixel. */
  .board,
  .gate-board,
  .bubble,
  .chip-note,
  .callout {
    --edge: #2a1f1a;
    box-shadow:
      0 calc(var(--px) * -1) 0 0 var(--edge),
      0 var(--px) 0 0 var(--edge),
      calc(var(--px) * -1) 0 0 0 var(--edge),
      var(--px) 0 0 0 var(--edge);
    white-space: nowrap;
  }
  .board {
    padding: 1px 7px 2px;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.25;
    color: var(--lane-text, #f4ecdd);
    background: #3b2c22;
    border-bottom: var(--px) solid #6a5040;
  }
  .board.wt {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
    text-align: left;
    color: #f4ecdd;
    background: #8a6a4a;
  }
  .callout {
    --edge: #0b1224;
    left: 0;
    bottom: auto;
    top: 0;
    transform: translateY(-50%);
    padding: 2px 8px 3px;
    font-size: 14px;
    font-weight: 600;
    color: #0b1224;
    background: #f4ecdd;
  }
  .gate-board {
    display: block;
    padding: 2px 10px 3px;
    font-size: 15px;
    font-weight: 700;
    color: #f4ecdd;
    background: #6a5040;
    transition:
      background-color 0.4s steps(4),
      color 0.4s steps(4);
  }
  .gate-board.lit {
    color: #0f2a16;
    background: #22c55e;
  }
  .bubble {
    --edge: #1b1f2a;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-bottom: calc(var(--px) * 3);
    padding: 2px 8px 3px;
    font-size: 13px;
    line-height: 1.25;
    color: #1b1f2a;
    background: #f4ecdd;
  }
  .bubble::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 100%;
    width: calc(var(--px) * 2);
    height: calc(var(--px) * 2);
    margin-left: calc(var(--px) * -1);
    background: inherit;
    box-shadow:
      var(--px) 0 0 0 var(--edge),
      calc(var(--px) * -1) 0 0 0 var(--edge),
      0 var(--px) 0 0 var(--edge);
  }
  .tool {
    font-weight: 700;
  }
  .tool.read {
    color: #0b5cb8;
  }
  .tool.edit {
    color: #a3570a;
  }
  .tool.write {
    color: #22803a;
  }
  .bubble.term {
    --edge: #05070d;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    padding: 2px 8px 3px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: #c9d2e8;
    background: #111111;
  }
  .t-prompt {
    color: #7fb2ff;
  }
  .t-out {
    color: #6ec87a;
  }
  .bubble.ask {
    --edge: #3a2204;
    min-width: calc(var(--px) * 7);
    justify-content: center;
    font-size: 18px;
    font-weight: 700;
    color: #3a2204;
    background: #f59e0b;
  }
  .ask-pin {
    will-change: transform;
  }
  .stone-n {
    left: auto;
    right: 0;
    bottom: auto;
    top: 0;
    transform: translateY(-50%);
    font-size: 12px;
    font-weight: 700;
    color: #d9dff0;
    text-shadow:
      0 1px 0 #0b1224,
      0 -1px 0 #0b1224,
      1px 0 0 #0b1224,
      -1px 0 0 #0b1224;
  }
  .stone-n.lit {
    color: #ffe7a8;
  }
  .hint {
    bottom: auto;
    top: 0;
    font-size: 12px;
    color: #f4ecdd;
    white-space: nowrap;
    text-shadow:
      0 1px 0 #0b1224,
      0 -1px 0 #0b1224,
      1px 0 0 #0b1224,
      -1px 0 0 #0b1224;
  }
  .chip-note {
    --edge: #0b1a3a;
    padding: 1px 7px 2px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: #eaf1ff;
    background: #1c3a7a;
    transform: translate(-50%, 0);
  }

</style>
