<script>
  import { onMount, untrack } from 'svelte';
  import { animationLoop } from '../shared/motion.js';
  import Dialogue from '../grove/Dialogue.svelte';
  import { createEngine } from './scenes/engine.js';
  import { story } from './story.svelte.js';
  import { agents } from './data.js';

  /**
   * One pixel scene: a small canvas scaled by whole pixels, HTML overlays
   * pinned to points in the art, clickable characters and their dialogue.
   * The scene animates only while it is on screen, and draws a still frame
   * (that still follows the time of day) under reduced motion.
   *
   * @type {{
   *   id: string,
   *   factory: (env: any) => any,
   *   label: string,
   *   reduced?: boolean,
   *   talk?: (key: string) => { status?: string, text: string } | null,
   *   overlays?: import('svelte').Snippet<[any, any]>,
   *   engine?: any,
   *   snap?: any,
   *   dataTod?: number,
   *   class?: string,
   * }}
   */
  let {
    id,
    factory,
    label,
    reduced = false,
    talk,
    overlays,
    engine = $bindable(null),
    snap = $bindable(null),
    dataTod,
    class: className = '',
  } = $props();

  /** @type {HTMLDivElement | undefined} */
  let stageEl = $state();
  /** @type {HTMLCanvasElement | undefined} */
  let canvasEl = $state();
  let k = $state(3);
  let cssW = $state(0);
  let cssH = $state(0);
  let visible = false;
  let running = false;
  /** @type {string[]} */
  let hitKeys = $state([]);
  /** @type {any} */
  let dlgRef = $state();
  const hitEls = $state(/** @type {Record<string, HTMLButtonElement>} */ ({}));

  const placed = new Map();

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /** Svelte action: pins an overlay to a point in the scene. */
  function pin(node, key) {
    placed.set(node, key);
    positionOne(node, key);
    return {
      update(next) {
        placed.set(node, next);
        positionOne(node, next);
      },
      destroy() {
        placed.delete(node);
      },
    };
  }

  function positionOne(el, key) {
    if (!engine || !stageEl) return;
    const pos = engine.pin(key);
    if (!pos) {
      el.style.visibility = 'hidden';
      return;
    }
    el.style.visibility = '';
    let [x, y, w, h] = pos;
    const child = el.firstElementChild;
    if (w != null) {
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    } else if (child && !el.hasAttribute('data-free')) {
      // Labels stay inside the scene; a bubble's tail keeps pointing home.
      const sw = stageEl.clientWidth;
      const half = child.offsetWidth / 2;
      const cx = clamp(x, half + 4, sw - half - 4);
      child.style.setProperty('--tail', `${clamp(x - cx, -half + 8, half - 8).toFixed(1)}px`);
      x = cx;
    }
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }

  function placeAll() {
    for (const [el, key] of placed) positionOne(el, key);
  }

  function draw() {
    if (!engine) return;
    engine.render();
    placeAll();
  }

  function resize() {
    if (!engine || !stageEl) return;
    const w = stageEl.parentElement?.clientWidth ?? stageEl.clientWidth;
    engine.resize(Math.max(120, w));
    const changed = engine.k !== k || engine.env.W * engine.k !== cssW || engine.env.H * engine.k !== cssH;
    k = engine.k;
    cssW = engine.env.W * k;
    cssH = engine.env.H * k;
    snap = engine.scene.snapshot?.() ?? null;
    draw();
    // The page graph measures anchors inside scenes, so tell it.
    if (changed) requestAnimationFrame(() => window.dispatchEvent(new Event('log:layout')));
  }

  /** Lays the scene out again, for when its options change. */
  export function relayout() {
    resize();
  }

  // Answers elsewhere on the page (the permission prompt) change what
  // characters say in every scene.
  $effect(() => {
    story.permission;
    if (engine) untrack(() => (snap = engine.scene.snapshot?.() ?? null));
  });

  onMount(() => {
    engine = createEngine(canvasEl, factory, {
      reduced,
      tod: story.tod,
      onchange: () => {
        snap = engine.scene.snapshot?.() ?? null;
      },
    });
    hitKeys = engine.scene.hitKeys ?? [];
    snap = engine.scene.snapshot?.() ?? null;
    resize();

    const ro = new ResizeObserver(() => resize());
    ro.observe(stageEl.parentElement ?? stageEl);

    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        if (visible && !running) draw();
      },
      { rootMargin: '80px' },
    );
    io.observe(stageEl);
    document.fonts?.ready.then(() => placeAll());
    // Fireflies drift toward the pointer.
    stageEl.addEventListener('pointermove', onpointermove);
    stageEl.addEventListener('pointerleave', onpointerleave);

    return () => {
      ro.disconnect();
      io.disconnect();
      stageEl?.removeEventListener('pointermove', onpointermove);
      stageEl?.removeEventListener('pointerleave', onpointerleave);
    };
  });

  // Ambient loop while on screen, never under reduced motion.
  $effect(() => {
    if (!engine || !stageEl) return;
    engine.setReduced(reduced);
    if (reduced) {
      untrack(draw);
      return;
    }
    const stop = animationLoop(stageEl, (dt) => {
      running = true;
      engine.frame(dt);
      placeAll();
    });
    return () => {
      running = false;
      stop();
    };
  });

  // The time of day follows the scroll position, frame loop or not.
  $effect(() => {
    const t = story.tod;
    if (!engine) return;
    engine.setTod(t);
    if (visible && (reduced || !running)) untrack(draw);
  });

  // Interactions change the scene: redraw at once under reduced motion.
  $effect(() => {
    snap;
    if (engine && reduced) untrack(draw);
  });

  function onpointermove(e) {
    if (!canvasEl || e.pointerType === 'touch') return;
    const r = canvasEl.getBoundingClientRect();
    engine?.setPointer(e.clientX - r.left, e.clientY - r.top);
  }
  function onpointerleave() {
    engine?.setPointer(null, null);
  }

  // ---------------------------------------------------------------------------
  // Talking to a character

  const openKey = $derived(story.talking?.startsWith(id + ':') ? story.talking.slice(id.length + 1) : null);
  const lines = $derived.by(() => {
    snap;
    if (!openKey || !talk) return null;
    return talk(openKey);
  });

  function open(key) {
    story.talking = `${id}:${key}`;
    requestAnimationFrame(() => dlgRef?.focus());
  }

  function close() {
    const key = openKey;
    story.talking = null;
    if (key) requestAnimationFrame(() => hitEls[key]?.focus());
  }

  const statusWord = { working: 'working', permission: 'waiting for you', ready: 'ready', off: 'stopped' };
</script>

<div
  class="stage {className}"
  bind:this={stageEl}
  style="--px: {k}px; width: {cssW ? `${cssW}px` : '100%'}; height: {cssH ? `${cssH}px` : 'auto'};"
  data-tod={dataTod}
  data-scene={id}
>
  <div class="art" role="img" aria-label={label}>
    <canvas bind:this={canvasEl} class="canvas" aria-hidden="true"></canvas>
  </div>

  <div class="overlays">
    {@render overlays?.(pin, snap)}

    {#each hitKeys as key (key)}
      {@const a = agents[key]}
      <div class="pin hit-pin" use:pin={`hit:${key}`}>
        <button
          type="button"
          class="hit"
          bind:this={hitEls[key]}
          aria-label="Talk to the {a.branch} agent"
          aria-expanded={openKey === key}
          onclick={() => (openKey === key ? close() : open(key))}
        ></button>
      </div>
    {/each}
  </div>

  {#if openKey && lines}
    {@const a = agents[openKey]}
    <div class="dlg-slot">
      <Dialogue
        bind:this={dlgRef}
        id="dlg-{id}"
        mode="agent"
        speaker={a.branch}
        tag="conversation"
        status={lines.status && lines.status !== 'off' ? lines.status : null}
        text={lines.text}
        instant={reduced}
        meta={[
          { label: 'Worktree', value: `.grove-wt/${a.id}` },
          { label: 'Model', value: a.model },
          ...(lines.status ? [{ label: 'Status', value: statusWord[lines.status] ?? lines.status }] : []),
        ]}
        onclose={close}
      />
    </div>
  {/if}
</div>

<style>
  .stage {
    position: relative;
    max-width: 100%;
    line-height: 0;
    touch-action: pan-y;
  }
  .canvas {
    display: block;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    user-select: none;
  }
  .overlays {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    line-height: 1.25;
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
  }
  .overlays :global(.pin) {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
  }
  .overlays :global(.pin > *) {
    position: absolute;
    left: 0;
    bottom: 0;
    transform: translateX(-50%);
  }
  .overlays :global(.pin > .below) {
    bottom: auto;
    top: 0;
  }
  .hit-pin {
    pointer-events: none;
  }
  .overlays .hit-pin > .hit {
    position: absolute;
    inset: 0;
    transform: none;
    width: 100%;
    height: 100%;
    pointer-events: auto;
    cursor: pointer;
    background: transparent;
  }
  .hit:hover,
  .hit[aria-expanded='true'] {
    box-shadow:
      0 0 0 1px rgb(255 231 168 / 0.85),
      0 0 0 3px rgb(11 18 36 / 0.6);
  }
  .hit:focus-visible {
    outline: 2px dashed #ffe7a8;
    outline-offset: 2px;
  }

  .dlg-slot {
    position: absolute;
    z-index: 3;
    left: calc(var(--px) * 6);
    right: calc(var(--px) * 6);
    top: calc(var(--px) * 8);
    line-height: 1.3;
    --dlg-h: 0px;
    --dlg-font: 16px;
  }
  @media (min-width: 900px) {
    .dlg-slot {
      right: auto;
      width: min(620px, calc(100% - var(--px) * 12));
    }
  }
  /* Phones: the box opens under the scene, so the character stays in view. */
  @media (max-width: 639px) {
    .dlg-slot {
      left: 0;
      right: 0;
      top: calc(100% + 18px);
      --dlg-font: 15px;
    }
  }
</style>
