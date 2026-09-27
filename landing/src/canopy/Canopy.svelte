<script>
  import './canopy.css';
  import { onMount } from 'svelte';
  import { links, treeGreens } from '../lib/brand.js';
  import { prefersReducedMotion, animationLoop } from '../lib/motion.js';
  import { trackLandingEvent } from '../lib/analytics.js';
  import Dialogue from '../pixel/Dialogue.svelte';
  import { DownloadIcon, GithubIcon } from '../lib/icons.js';
  import Panel from './Panel.svelte';
  import Permission from './Permission.svelte';
  import Rewind from './Rewind.svelte';
  import Key from './Key.svelte';
  import { createScene } from './scene.js';
  import { buildLayout } from './layout.js';
  import { AGENTS, CHECKPOINTS, COMMITS, LANES, MEMORY_FOLDERS, STEPS, FOOTER_LINKS, TOOL_TONE } from './data.js';

  const WIDE = 960;

  let pageEl = $state();
  let canvasEl = $state();
  let dialogueRef = $state();
  /** @type {ReturnType<typeof createScene> | null} */
  let scene = null;
  let ready = $state(false);

  let k = $state(3);
  let vw = $state(1440);
  let wide = $state(true);
  let labels = $state(null);
  let views = $state([]);
  let calloutA = $state(1);
  let hitEls = $state([]);

  let permission = $state('pending');
  let turn = $state(CHECKPOINTS.length);
  let rewound = $state(null);
  let open = $state(null);
  let keyOpen = $state(false);

  const reduced = $derived(prefersReducedMotion.current);
  const byLane = Object.fromEntries(AGENTS.map((a) => [a.lane, a]));

  // ---------------------------------------------------------------------------
  // Measuring the page and building the world

  let lastW = 0;
  let lastH = 0;
  let measureQueued = false;

  function scheduleMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    requestAnimationFrame(() => {
      measureQueued = false;
      measure();
    });
  }

  function measure() {
    if (!scene || !pageEl) return;
    const w = document.documentElement.clientWidth;
    const h = window.innerHeight;
    if (w !== lastW || h !== lastH) {
      scene.resize(w, h);
      lastW = w;
      lastH = h;
    }
    const v = scene.view;
    const isWide = w >= WIDE;
    const sy = window.scrollY;
    const anchors = {};
    const read = (el, name, frac) => {
      const r = el.getBoundingClientRect();
      anchors[name] = { top: r.top + sy, bottom: r.bottom + sy, y: r.top + sy + r.height * frac };
    };
    if (isWide) {
      for (const el of pageEl.querySelectorAll('[data-anchor-wide]')) read(el, el.dataset.anchorWide, Number(el.dataset.fracWide ?? 0.5));
    }
    for (const el of pageEl.querySelectorAll('[data-anchor]')) {
      if (!anchors[el.dataset.anchor]) read(el, el.dataset.anchor, Number(el.dataset.frac ?? 0.5));
    }
    const areaEl = pageEl.querySelector('[data-area]');
    const ar = areaEl.getBoundingClientRect();
    const area = isWide ? { x0: ar.left, x1: w - 24 } : { x0: 16, x1: w - 16 };
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - h);
    const layout = buildLayout({ anchors, area, W: v.W, H: v.H, k: v.k, vh: h, wide: isWide, maxScroll });
    scene.setScroll(sy);
    scene.setLayout(layout);
    k = v.k;
    vw = w;
    wide = isWide;
    labels = scene.labels();
    sync();
    scene.render();
  }

  function sync() {
    if (!scene) return;
    views = scene.views();
    calloutA = scene.calloutAlpha();
  }

  let drawQueued = false;
  function draw() {
    if (drawQueued || !scene) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      scene.setScroll(window.scrollY);
      scene.render();
      calloutA = scene.calloutAlpha();
    });
  }

  function onScroll() {
    if (!scene) return;
    scene.setScroll(window.scrollY);
    calloutA = scene.calloutAlpha();
    if (reduced) draw();
  }

  function onPointer(e) {
    if (!scene) return;
    if (e.pointerType === 'touch') return;
    scene.setPointer(e.clientX, e.clientY);
  }

  function onPointerOut() {
    scene?.setPointer(null);
  }

  onMount(() => {
    scene = createScene(canvasEl, { reduced: prefersReducedMotion.current, onchange: sync });
    measure();
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(pageEl);
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerOut);
    document.fonts?.ready.then(scheduleMeasure);
    // Dev only: lets the one-direction check read the camera.
    if (import.meta.env.DEV) window.__canopy = scene;
    ready = true;
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', onPointerOut);
      scene = null;
    };
  });

  // The loop runs unless the visitor prefers reduced motion; then the scene is
  // redrawn only when the scroll or the story changes.
  $effect(() => {
    if (!ready || !scene) return;
    scene.setReduced(reduced);
    if (reduced) {
      draw();
      return;
    }
    return animationLoop(canvasEl, (dt) => {
      scene?.setScroll(window.scrollY);
      scene?.frame(dt);
    });
  });

  // ---------------------------------------------------------------------------
  // Interactions

  function answer(choice) {
    permission = choice ?? 'pending';
    scene?.answer(choice);
    if (reduced) draw();
  }

  function setTurn(n) {
    turn = n;
    rewound = null;
    scene?.setTurn(n);
    if (reduced) draw();
  }

  function rewind(mode) {
    rewound = mode ? { mode, turn } : null;
    scene?.rewind(mode);
    if (reduced) draw();
  }

  const statusWord = { working: 'working', permission: 'waiting for you', ready: 'ready', stopped: 'stopped' };

  function describe(v) {
    const b = v.bubble;
    if (v.phase === 'climb' || v.phase === 'walk') return 'Done here, and climbing down to the gate to main. Open a PR from the app, or merge the branch your usual way.';
    if (v.phase === 'gate') return 'My branch is ready for main. Open a PR from the app, or merge it your usual way.';
    if (v.lane === 'api') {
      if (v.status === 'permission') return `I'd like to run \`${v.ask}\` to validate the profile input. Is that okay?`;
      if (!v.answered) return `${v.task} My terminal is running \`npm run dev\`.`;
      if (v.answered === 'deny') return "No problem. I'll check the input by hand instead.";
      if (v.status === 'ready') return 'The profile endpoints are ready. 7 tests passed.';
      return `Thanks. ${b?.tool && b.tool !== 'done' ? `Right now: \`${b.tool} ${b.detail}\`.` : ''}`;
    }
    if (v.lane === 'fix') {
      if (rewound?.mode === 'all') return `Back at turn ${rewound.turn}, files and conversation. Tell me what to try next.`;
      if (rewound?.mode === 'conv') return `Our chat is back at turn ${rewound.turn}. The files still have every change.`;
      if (turn < CHECKPOINTS.length) return `You are looking at turn ${turn}: \`${b.tool} ${b.detail}\`. Every message you send saves a checkpoint.`;
      return `${v.task} 5 tests passed, 2 files changed.`;
    }
    if (b && b.tool !== 'done') return `${v.task} Right now: \`${b.tool} ${b.detail}\`.`;
    return v.task;
  }

  const openView = $derived(open != null ? views[open] : null);
  const openText = $derived(openView ? describe(openView) : '');
  const openChoices = $derived(
    openView && openView.lane === 'api' && openView.status === 'permission' && permission === 'pending'
      ? [
          { label: 'Allow', value: 'allow' },
          { label: 'Always Allow', value: 'always' },
          { label: 'Deny', value: 'deny' },
        ]
      : [],
  );

  function openAgent(i) {
    open = i;
    trackLandingEvent('canopy_agent_open', { lane: views[i]?.lane });
    queueMicrotask(() => dialogueRef?.focus());
  }

  function closeAgent() {
    const i = open;
    open = null;
    if (i != null) queueMicrotask(() => hitEls[i]?.focus());
  }

  function chooseInDialogue(value) {
    answer(value);
    queueMicrotask(() => dialogueRef?.focus());
  }

  function hover(i) {
    scene?.setHover(i);
    if (reduced) draw();
  }

  // ---------------------------------------------------------------------------
  // Overlay helpers

  /** Keeps a bubble on screen by sliding it sideways (its tail stays put). */
  function keepOnScreen(node, _deps) {
    const fit = () => {
      node.style.setProperty('--shift', '0px');
      const r = node.getBoundingClientRect();
      const vwNow = document.documentElement.clientWidth;
      let shift = 0;
      if (r.left < 12) shift = 12 - r.left;
      else if (r.right > vwNow - 12) shift = vwNow - 12 - r.right;
      node.style.setProperty('--shift', `${shift}px`);
    };
    fit();
    return { update: fit };
  }

  const px = (v) => `${(v * k).toFixed(1)}px`;
  const pin = (x, y) => `transform: translate(${px(x)}, ${px(y)})`;

  let keyBtn = $state();
  function onKey(e) {
    if (e.key === 'Escape' && keyOpen) {
      keyOpen = false;
      keyBtn?.focus();
    }
  }

  function track(event, location) {
    trackLandingEvent(event, { location });
  }
</script>

<svelte:window onkeydown={onKey} />

{#snippet logo(size)}
  <svg width={size} height={Math.round((size * 24) / 21)} viewBox="0 0 21 24" fill="none" aria-hidden="true" style="image-rendering: pixelated">
    {#each treeGreens as p}
      <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />
    {/each}
  </svg>
{/snippet}

{#snippet bubbleBody(v)}
  {@const b = v.bubble}
  {#if b.term}
    <span class="t-prompt">{b.term[0]}</span><span class="t-out">{b.term[1]}</span>
  {:else if b.say}
    {b.say}
  {:else if b.note}
    {b.note}
  {:else if b.tool === '?'}
    ?
  {:else if b.tool === 'done'}
    <span class="check" aria-hidden="true"></span>{b.detail}
  {:else}
    {#if b.turn}<span class="turn">T{b.turn}</span>{/if}
    <b class="tool {TOOL_TONE[b.tool] ?? ''}">{b.tool}</b>
    {b.detail}
  {/if}
{/snippet}

<div class="cn-page" bind:this={pageEl}>
  <a class="skip" href="#cn-main">Skip to content</a>

  <div class="cn-world-wrap" role="img" aria-label="A giant pixel-art tree at night, seen from its crown down to the ground. Its trunk is main. It splits into three limbs, one per git worktree: feat/auth, feat/api and fix/login-bug. Each limb holds a small treehouse where an AI agent sits with a laptop and a status lamp. Lower down, a hollow in the trunk holds the project memory notes. At the bottom, at dawn, the limbs rejoin the trunk and the agents walk to a gate marked main.">
    <canvas bind:this={canvasEl} class="cn-world" aria-hidden="true"></canvas>
  </div>

  <!-- Labels, signs and bubbles pinned to the world. Decorative: the same facts are in the panels. -->
  <div class="cn-overlays" aria-hidden="true" style="--px: {Math.max(2, Math.round(k))}px">
    {#if labels}
      {#each labels.callouts as c (c.key)}
        <div class="cn-pin" style="{pin(c.x, c.y)}; opacity: {calloutA.toFixed(2)}; visibility: {calloutA < 0.02 ? 'hidden' : 'visible'}">
          <span class="cn-callout {c.align}" class:narrow={c.narrow}>
            {#if c.narrow}{#each c.text.split(', ') as line, j}{#if j}<br />{/if}{line}{j === 0 ? ',' : ''}{/each}{:else}{c.text}{/if}
          </span>
        </div>
      {/each}

      {#each labels.signs as sg (sg.lane)}
        {@const a = byLane[sg.lane]}
        <div class="cn-pin" style={pin(sg.x, sg.y)}>
          <div class="cn-sign {sg.side > 0 ? 'right' : 'left'}" style="--lane-text: {LANES[sg.lane].text}">
            <i class="beam"></i>
            <div class="cn-board"><b>{a.branch}</b><span>.grove-wt/{a.id}</span></div>
          </div>
        </div>
      {/each}

      {#each labels.plates as pl (pl.lane)}
        <div class="cn-pin" style={pin(pl.x, pl.y)}>
          <span class="cn-plate" style="--lane-text: {LANES[pl.lane].text}" use:keepOnScreen={[pl.x, vw]}><b>{byLane[pl.lane].branch}</b><span>.grove-wt/{byLane[pl.lane].id}</span></span>
        </div>
      {/each}

      {#each labels.notches as n (n.turn)}
        <div class="cn-pin" style={pin(n.x, n.y)}>
          <span class="cn-notch">T{n.turn}</span>
        </div>
      {/each}

      {#each MEMORY_FOLDERS as name, i (name)}
        {@const h = labels.hollow}
        {@const right = i % 2 === 1}
        <div class="cn-pin" style={pin(h.x + (right ? labels.trunkHalf + 6 : -labels.trunkHalf - 6), h.y - 14 + i * 9)}>
          <span class="cn-note" class:flip={!right}>{name}</span>
        </div>
      {/each}

      <div class="cn-pin" style={pin(labels.gate.x, labels.gate.y)}>
        <span class="cn-gate" class:lit={views.length && views.every((v) => v.phase === 'gate')}>main</span>
      </div>
    {/if}

    {#each views as v (v.id)}
      {#if v.bubble}
        <div class="cn-pin" style={pin(v.head[0], v.head[1])}>
          <span
            class="cn-bubble"
            class:ask={v.bubble.tool === '?'}
            class:term={!!v.bubble.term}
            class:say={!!v.bubble.say}
            use:keepOnScreen={[v.bubble, v.head[0], vw]}
          >
            {@render bubbleBody(v)}
          </span>
        </div>
      {/if}
    {/each}
  </div>

  <div class="cn-hits">
    {#each views as v, i (v.id)}
      <button
        type="button"
        class="cn-hit"
        bind:this={hitEls[i]}
        style="left: {px(v.hit[0])}; top: {px(v.hit[1])}; width: {px(v.hit[2])}; height: {px(v.hit[3])}"
        aria-label="{v.branch} conversation, {statusWord[v.status] ?? v.status}. Show details"
        aria-haspopup="dialog"
        onclick={() => openAgent(i)}
        onmouseenter={() => hover(i)}
        onmouseleave={() => hover(-1)}
        onfocus={() => hover(i)}
        onblur={() => hover(-1)}
      ></button>
    {/each}
  </div>

  <nav class="cn-nav" aria-label="Main">
    <div class="cn-wrap nav-inner">
      <a href="#top" class="brand" aria-label="Grove Bench, back to top">
        {@render logo(16)}
        <span>Grove Bench</span>
      </a>
      <button type="button" class="nav-key" bind:this={keyBtn} aria-expanded={keyOpen} aria-controls="cn-key" onclick={() => (keyOpen = !keyOpen)}>
        <span class="key-glyph" aria-hidden="true"></span>
        Key
      </button>
      <a href={links.github} target="_blank" rel="noopener" class="nav-gh" onclick={() => track('github_click', 'canopy-nav')}>
        {@html GithubIcon}
        GitHub
      </a>
    </div>
    {#if keyOpen}
      <div class="cn-wrap key-pop-wrap">
        <Key id="cn-key" class="key-pop" />
      </div>
    {/if}
  </nav>

  <main id="cn-main" class="cn-main">
    <span id="top" class="top-anchor"></span>

    <!-- Hero: the plain description over the night sky, the crown beside it. -->
    <section class="cn-hero" aria-labelledby="cn-title">
      <div class="cn-wrap hero-grid">
        <div class="cn-hero-copy">
          <h1 id="cn-title">Run AI agents side by side, each on its own branch.</h1>
          <p class="lede">
            Grove Bench is a Windows app that runs several AI coding agents on one project at once. Each works in its own
            git worktree, on its own branch, with its own terminal.
          </p>
          <div class="ctas">
            <a href={links.releases} target="_blank" rel="noopener" class="btn-primary" onclick={() => track('download_click', 'canopy-hero')}>
              {@html DownloadIcon}
              Download for Windows
            </a>
            <a href={links.github} target="_blank" rel="noopener" class="btn-secondary" onclick={() => track('github_click', 'canopy-hero')}>
              {@html GithubIcon}
              View source
            </a>
          </div>
          <p class="small">Free and open source (MIT). Scroll down to climb through the tree.</p>
          {#if wide}<Key class="hero-key" />{/if}
        </div>
        <div class="cn-hero-stage" data-anchor="hero" data-area></div>
      </div>
    </section>

    <div class="cn-wrap cn-story">
      <Panel id="wt" hash={COMMITS.worktrees.hash} lane="main" title="Worktrees" anchor="signs" frac={0.55}>
        <p class="cn-text">
          Each conversation gets its own git worktree in <code>.grove-wt/&lt;id&gt;</code>, on its own branch. Agents never
          write over each other's files.
        </p>
        <p class="cn-metaphor">Each limb is one worktree.</p>
      </Panel>
      <div class="cn-gap g-signs" data-anchor="signs"></div>

      <Panel id="term" hash={COMMITS.terminals.hash} lane="auth" title="Terminals">
        <p class="cn-text">
          Each conversation has its own terminal, a real PTY opened in its worktree. Run tests in one while another runs
          a dev server.
        </p>
        <p class="cn-metaphor">Bubbles show what each agent is doing now.</p>
      </Panel>
      <div class="cn-gap g-api" data-anchor="api" data-frac="0.64"></div>

      <Panel id="perm" hash={COMMITS.permissions.hash} lane="api" title="Permissions" anchor="api" frac={0.2}>
        <p class="cn-text">
          When an agent wants to run a command or edit a file, its lamp turns amber and it waits for you. Pick a mode per
          conversation: Default, Accept Edits or Plan.
        </p>
        <Permission status={permission} onanswer={answer} />
      </Panel>
      <div class="cn-gap g-fix" data-anchor="fix" data-frac="0.8"></div>

      <Panel id="cp" hash={COMMITS.checkpoints.hash} lane="fix" title="Checkpoints" anchor="fix" frac={0.42}>
        <p class="cn-text">A checkpoint is saved each time you send a message. Drag back to any turn, then pick what to put back.</p>
        <p class="cn-metaphor">Each ring on the limb is one turn.</p>
        <Rewind {turn} {rewound} onturn={setTurn} onrewind={rewind} />
      </Panel>
      <div class="cn-gap g-mem" data-anchor="memory"></div>

      <Panel id="mem" hash={COMMITS.memory.hash} lane="main" title="Project memory" anchor="memory" frac={0.5}>
        <p class="cn-text">
          Markdown notes per project, in <code>repo/</code>, <code>conventions/</code>, <code>architecture/</code> and
          <code>sessions/</code>. Every conversation reads them first. A budget meter and auto-compaction keep them in check.
        </p>
        <p class="cn-metaphor">The hollow in the trunk keeps them.</p>
      </Panel>
      <div class="cn-gap g-ground" data-anchor="ground" data-frac="0.74"></div>

      <Panel id="review" hash={COMMITS.review.hash} lane="main" head title="Review and ship" anchor="ground" frac={0.86}>
        <p class="cn-text">
          Check each conversation's diffs in the Changes tab, unified or side by side. Revert single files or open them in
          your editor.
        </p>
        <p class="cn-text">Then open a PR from the app, or merge the branch your usual way.</p>
        <p class="cn-metaphor">At the gate, every lamp turns green.</p>
      </Panel>
      <div class="cn-gap g-meadow"></div>

      <section class="cn-how" id="how" data-anchor="how" data-frac="0" aria-labelledby="how-h">
        <div class="cn-panel day how-panel">
          <h2 class="cn-h2" id="how-h">How it works</h2>
          <ol class="steps">
            {#each STEPS as step, i}
              <li>
                <span class="n" aria-hidden="true">{i + 1}</span>
                <div>
                  <h3><span class="ui">{step.ui}</span> {step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            {/each}
          </ol>
        </div>
      </section>

      <section class="cn-cta" aria-labelledby="cta-h">
        <div class="cn-panel day cta-panel">
          <h2 class="cn-h2" id="cta-h">Try it on your next task</h2>
          <div class="ctas">
            <a href={links.releases} target="_blank" rel="noopener" class="btn-primary" onclick={() => track('download_click', 'canopy-cta')}>
              {@html DownloadIcon}
              Download for Windows
            </a>
            <a href={links.github} target="_blank" rel="noopener" class="btn-secondary dark" onclick={() => track('github_click', 'canopy-cta')}>
              {@html GithubIcon}
              View source
            </a>
          </div>
          <p class="req">Windows 10 or later, git 2.17+ and the Claude Code CLI. Free and open source (MIT).</p>
        </div>
      </section>
    </div>
  </main>

  <footer class="cn-footer">
    <div class="cn-wrap foot-inner">
      <div class="foot-brand">
        {@render logo(12)}
        <span>Grove Bench</span>
        <span class="mit">Open source under MIT</span>
      </div>
      <ul class="foot-links">
        {#each FOOTER_LINKS as l}
          <li>
            <a href={l.href} target="_blank" rel="noopener" onclick={() => trackLandingEvent('footer_click', { location: 'canopy-footer', link: l.label })}>
              {l.label}
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </footer>

  {#if openView}
    <div class="cn-dialog" style="--px: 3px">
      <Dialogue
        bind:this={dialogueRef}
        id="cn-dlg"
        mode="agent"
        speaker={openView.branch}
        tag={openView.model}
        status={openView.status === 'stopped' ? null : openView.status}
        text={openText}
        instant={reduced}
        meta={[
          { label: 'Branch', value: openView.branch },
          { label: 'Worktree', value: `.grove-wt/${openView.id}` },
          { label: 'Model', value: openView.model },
        ]}
        choices={openChoices}
        onchoose={chooseInDialogue}
        onclose={closeAgent}
      />
    </div>
  {/if}
</div>

<style>
  .skip {
    position: absolute;
    left: 16px;
    top: -60px;
    z-index: 100;
    padding: 8px 12px;
    background: var(--color-primary);
    color: #fff;
    font-size: 14px;
  }
  .skip:focus {
    top: 8px;
  }
  .top-anchor {
    position: absolute;
    top: 0;
  }

  /* Nav */
  .cn-nav {
    position: sticky;
    top: 0;
    z-index: 40;
    background: rgb(8 12 24 / 0.78);
    border-bottom: 1px solid rgb(217 223 240 / 0.1);
  }
  .nav-inner {
    height: 56px;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 700;
    color: #eef1f8;
  }
  .nav-gh {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    background: var(--color-primary);
    color: #fff;
    transition: filter 0.15s ease;
  }
  .nav-gh:hover {
    filter: brightness(1.15);
  }

  /* Hero */
  .hero-grid {
    display: grid;
    gap: 0;
  }
  .cn-hero-copy {
    padding-top: 36px;
  }
  .cn-hero-copy h1 {
    font-size: clamp(30px, 2.4vw + 18px, 50px);
    font-weight: 800;
    line-height: 1.06;
    letter-spacing: -0.03em;
    color: #f6f7fb;
    text-wrap: balance;
    text-shadow: 0 2px 0 rgb(0 0 0 / 0.4);
  }
  .lede {
    margin-top: 18px;
    max-width: 44ch;
    font-size: 16px;
    line-height: 1.65;
    color: #d3d9e8;
    text-wrap: pretty;
  }
  .ctas {
    margin-top: 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .ctas a {
    min-height: 44px;
  }
  .small {
    margin-top: 14px;
    font-size: 14px;
    color: #a4aec6;
  }
  .cn-hero-copy :global(.hero-key) {
    margin-top: 22px;
    max-width: 400px;
  }
  .cn-hero-stage {
    height: 44vh;
    min-height: 300px;
  }
  @media (max-width: 959px) {
    .cn-hero-copy {
      position: relative;
      padding: 22px 16px 20px;
      margin-inline: -16px;
      background: linear-gradient(180deg, rgb(8 12 24 / 0.55), rgb(8 12 24 / 0.72) 70%, rgb(8 12 24 / 0));
    }
    .cn-hero-copy h1 {
      font-size: 29px;
    }
    .lede {
      margin-top: 12px;
      font-size: 15px;
    }
    .ctas {
      margin-top: 16px;
      gap: 10px;
    }
    .small {
      display: none;
    }
  }
  @media (min-width: 960px) {
    .hero-grid {
      grid-template-columns: 440px minmax(0, 1fr);
      column-gap: 32px;
      min-height: calc(100svh - 56px);
    }
    .cn-hero-copy {
      align-self: center;
      padding: 32px 0 48px;
    }
    .cn-hero-stage {
      height: auto;
      min-height: 0;
    }
  }

  /* Story column */
  .cn-story {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .cn-gap {
    width: 100%;
    flex: none;
  }
  .g-signs {
    height: max(300px, 44vh);
  }
  .g-api {
    height: max(260px, 38vh);
  }
  .g-fix {
    height: max(320px, 46vh);
  }
  .g-mem {
    height: max(260px, 38vh);
  }
  .g-ground {
    height: max(360px, 56vh);
  }
  .g-meadow {
    height: 40px;
  }
  @media (min-width: 960px) {
    .cn-story {
      padding-top: 8vh;
    }
    .g-signs,
    .g-api,
    .g-fix,
    .g-mem {
      height: 16vh;
    }
    .g-api {
      height: 10vh;
    }
    .g-ground {
      height: 22vh;
    }
    .g-meadow {
      height: 26vh;
    }
  }

  /* How it works and the CTA, out on the meadow in daylight. */
  .cn-how,
  .cn-cta {
    width: 100%;
  }
  .how-panel,
  .cta-panel {
    width: 100%;
  }
  @media (min-width: 960px) {
    .how-panel,
    .cta-panel {
      width: 600px;
    }
  }
  .cn-cta {
    margin-top: 36px;
    padding-bottom: 64px;
  }
  .steps {
    list-style: none;
    margin-top: 16px;
    display: grid;
    gap: 14px;
  }
  .steps li {
    display: grid;
    grid-template-columns: 30px 1fr;
    gap: 12px;
    align-items: start;
  }
  .steps .n {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
    font-size: 16px;
    font-weight: 700;
    color: #f4ecdd;
    background: #3a9a48;
    box-shadow: 0 0 0 2px #3a2a1c;
  }
  .steps h3 {
    font-size: 16px;
    font-weight: 700;
    color: #1d150e;
    line-height: 1.35;
  }
  .steps .ui {
    display: inline-block;
    margin-right: 6px;
    padding: 0 6px;
    font-size: 13px;
    font-weight: 600;
    color: #f4ecdd;
    background: #2b3a55;
  }
  .steps p {
    margin-top: 3px;
    font-size: 15px;
    line-height: 1.55;
    color: #3d3024;
  }
  .cta-panel .ctas {
    margin-top: 18px;
  }
  .cta-panel :global(.btn-secondary.dark) {
    color: #f4ecdd;
    background: #2a2a2a;
    border-color: #3a3a3a;
  }
  .req {
    margin-top: 16px;
    font-size: 14px;
    line-height: 1.55;
    color: #4a3b2c;
  }

  /* Footer */
  .cn-footer {
    background: rgb(20 28 18 / 0.94);
    border-top: 3px solid #3a2a1c;
  }
  .foot-inner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 14px 24px;
    padding-block: 26px;
  }
  .foot-brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 700;
    color: #eef1f8;
  }
  .mit {
    font-weight: 400;
    color: #a4aec6;
  }
  .foot-links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 20px;
    list-style: none;
  }
  .foot-links a {
    display: inline-block;
    padding-block: 6px;
    font-size: 14px;
    color: #cfd6e6;
  }
  .foot-links a:hover {
    color: #fff;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  /* Key, in the sticky nav so it is always one click away. */
  .nav-key {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 6px 12px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    color: #eef1f8;
    background: #13203f;
    box-shadow: inset 0 0 0 1px rgb(217 223 240 / 0.22);
    cursor: pointer;
  }
  .nav-key[aria-expanded='true'] {
    background: #22325c;
  }
  .nav-key + .nav-gh {
    margin-left: 0;
  }
  .key-pop-wrap {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 8px);
    display: flex;
    justify-content: flex-end;
    pointer-events: none;
  }
  .key-pop-wrap :global(.key-pop) {
    width: min(340px, 100%);
    pointer-events: auto;
  }
  .key-glyph {
    width: 10px;
    height: 10px;
    background:
      linear-gradient(90deg, #6aa8ff 33%, #f59e0b 33% 66%, #22c55e 66%);
    box-shadow: 0 0 0 2px #0b1224;
  }

  /* Dialogue */
  .cn-dialog {
    position: fixed;
    left: 50%;
    bottom: 16px;
    z-index: 60;
    width: min(760px, calc(100vw - 32px));
    transform: translateX(-50%);
    --dlg-h: 132px;
    --dlg-font: 17px;
  }
</style>
