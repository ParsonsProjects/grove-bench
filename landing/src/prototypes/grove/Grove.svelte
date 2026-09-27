<script>
  import { onMount } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import PixelTree from '../shared/PixelTree.svelte';
  import { links, treeGreens } from '../shared/brand.js';
  import { prefersReducedMotion, animationLoop, inView } from '../shared/motion.js';
  import { trackLandingEvent } from '../../lib/analytics.js';
  import Dialogue from './Dialogue.svelte';
  import AppPanel from './AppPanel.svelte';
  import Legend from './Legend.svelte';
  import { createScene } from './scene.js';
  import { MAX_TREES, STARTING_AGENTS, statusLabel } from './agents.js';

  // ---------------------------------------------------------------------------
  // Story

  const CHAPTERS = [
    { name: 'Welcome', text: '' },
    {
      name: 'Worktrees',
      text: 'Each conversation gets its own git worktree and branch, in `.grove-wt/<id>`, so agents never overwrite each other. Each tree is one worktree.',
    },
    {
      name: 'Terminals',
      text: 'Each conversation has its own terminal, a real PTY opened in its worktree. Run tests in one while another runs a dev server.',
    },
    {
      name: 'Project memory',
      text: 'Project memory is markdown notes in `repo/`, `conventions/`, `architecture/` and `sessions/`, read at the start of every conversation. The old tree holds them.',
    },
    {
      name: 'Checkpoints',
      text: 'Every message you send saves a checkpoint. Rewind all restores files and conversation, Conv. only resets just the conversation. The sundial is your checkpoint list.',
    },
    {
      name: 'Review and ship',
      text: "Review each conversation's changes in the Changes tab, then open a PR from the app or merge the branch your usual way. At dawn the branches head home to main.",
    },
  ];
  const PANEL_VIEWS = ['sidebar', 'worktrees', 'terminal', 'memory', 'checkpoints', 'changes'];
  const CALLOUTS = ['git worktree', 'AI conversation', 'status lamp'];
  const SEGMENTS = CHAPTERS.length;
  const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];
  const MEMORY_FOLDERS = ['repo/', 'conventions/', 'architecture/', 'sessions/'];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smoothstep = (t) => {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  };

  // ---------------------------------------------------------------------------
  // State

  let storyEl = $state();
  let stageEl = $state();
  let canvasEl = $state();
  let bottomEl = $state();
  let titleEl = $state();
  let dialogueRef = $state();
  /** @type {ReturnType<typeof createScene> | null} */
  let scene = null;
  let ready = $state(false);

  let progress = $state(0);
  let chapter = $state(0);
  let agents = $state([]);
  let k = $state(4);
  let turn = $state(4);
  let rewindNote = $state(null);
  let open = $state(null);
  let openText = $state('');
  let event = $state(null);
  let wide = $state(true);
  let hitEls = $state([]);
  let merged = $state(false);
  let colEl = $state();
  let legendEl = $state();
  let panelMax = $state(400);

  const reduced = $derived(prefersReducedMotion.current);
  // Below laptop width the title sits above the scene instead of over it.
  const narrow = new MediaQuery('max-width: 1199px');
  const titleOut = $derived(smoothstep((progress - 0.02) / 0.07));
  const count = $derived(agents.length);
  const full = $derived(count >= MAX_TREES);
  // Wide screens put the key in the meadow beside the dialogue, others stack it with the panel.
  let stageW = $state(1440);
  const legendLeft = $derived(wide);
  const panelView = $derived(open != null && agents[open] ? 'activity' : event ? 'sidebar' : PANEL_VIEWS[chapter]);

  // The checkpoints of the conversation next to the sundial.
  const CHECKPOINTS = STARTING_AGENTS.find((a) => a.history).history;
  const HISTORY = CHECKPOINTS.map((h) => h.you);

  // ---------------------------------------------------------------------------
  // Overlays positioned from the scene every frame

  const placed = new Map();

  /** Svelte action: keeps an overlay pinned to a point in the scene. */
  function place(node, key) {
    placed.set(node, key);
    positionOne(node, key, scene?.layout());
    return {
      update(next) {
        placed.set(node, next);
      },
      destroy() {
        placed.delete(node);
      },
    };
  }

  let obstacles = [];
  const obstacleKeys = (key) =>
    (key.startsWith('callout') && chapter === 0) || (key.startsWith('tag') && chapter === 3) || (key === 'hint' && chapter === 4);

  function lookup(L, key) {
    const [kind, i] = key.split(':');
    if (kind === 'callout') return L.callouts[i];
    if (kind === 'hint') return L.sundial;
    if (kind === 'sign') return L.plots[i]?.sign;
    if (kind === 'bubble') return L.plots[i]?.bubble;
    if (kind === 'hit') return L.plots[i]?.hit;
    if (kind === 'tag') return L.tags[i];
    return L[kind];
  }

  function positionOne(el, key, L) {
    if (!L) return;
    const pos = lookup(L, key);
    if (!pos) return;
    let [x, y] = pos;
    const child = el.firstElementChild;
    if (key.startsWith('callout')) {
      const a = L.calloutAlpha;
      el.style.opacity = a.toFixed(2);
      el.style.visibility = a < 0.02 ? 'hidden' : '';
    }
    if (child && stageEl && !key.startsWith('hit') && key !== 'dial') {
      const w = stageEl.clientWidth;
      const half = child.offsetWidth / 2;
      const labelled = key !== 'sundial';
      const cx = clamp(x, half + 8, w - half - 8);
      // Labels stay fully on screen. An agent's label that would have to slide
      // far from its agent (and onto a neighbour's) is hidden instead.
      const agentLabel = key.startsWith('bubble') || key.startsWith('sign');
      const off = x < 0 || x > w || (agentLabel && Math.abs(x - cx) > 30);
      if (labelled && !key.startsWith('callout')) el.style.visibility = off ? 'hidden' : '';
      // Labels in the sky count as obstacles for the app panel.
      if (obstacleKeys(key) && el.style.visibility !== 'hidden') {
        obstacles.push([cx - half, y - child.offsetHeight, cx + half, y]);
      }
      if (key.startsWith('bubble')) child.style.setProperty('--tail', `${clamp(x - cx, -half + 8, half - 8).toFixed(1)}px`);
      x = cx;
    }
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    if (pos.length > 2) {
      el.style.width = `${pos[2]}px`;
      el.style.height = `${pos[3]}px`;
    }
  }

  function placeOverlays() {
    if (!scene) return;
    const L = scene.layout();
    obstacles = [...L.blocks];
    for (const [el, key] of placed) positionOne(el, key, L);
    if (Math.abs(L.k - k) > 0.001) k = L.k;
    fitPanel();
  }

  // The app panel lives in the empty sky: it gets whatever height is left
  // above the highest tree, label or note under it, and never covers them.
  function fitPanel() {
    if (!colEl || !stageEl) return;
    const left = colEl.offsetLeft;
    const right = left + colEl.offsetWidth;
    const top = colEl.offsetTop;
    let floor = stageEl.clientHeight;
    for (const [x0, y0, x1] of obstacles) {
      if (x1 > left && x0 < right && y0 > top) floor = Math.min(floor, y0);
    }
    const legendH = legendEl && !legendLeft ? legendEl.offsetHeight + 10 : 0;
    const next = Math.floor(floor - top - legendH - 14);
    if (next !== panelMax) panelMax = next;
  }

  function redraw() {
    if (!scene) return;
    scene.render();
    placeOverlays();
  }

  // ---------------------------------------------------------------------------
  // Scroll and size

  function todFor(p, ch) {
    if (reduced) return [0, 0, 0, 0, 0.25, 0.72][ch];
    const ch5 = 5 / 6;
    if (p < 0.6) return 0;
    if (p < ch5) return 0.45 * smoothstep((p - 0.6) / (ch5 - 0.6));
    return 0.45 + 0.55 * smoothstep((p - ch5) / 0.13);
  }

  function onScroll() {
    if (!storyEl || !stageEl || !scene) return;
    const rect = storyEl.getBoundingClientRect();
    const total = Math.max(1, storyEl.offsetHeight - stageEl.offsetHeight);
    // The stage sticks 56px down, under the nav.
    const p = clamp((56 - rect.top) / total, 0, 1);
    progress = p;
    const ch = Math.min(SEGMENTS - 1, Math.floor(p * SEGMENTS));
    const loc = p * SEGMENTS - ch;
    if (ch !== chapter) {
      chapter = ch;
      if (open != null) closeAgent(false);
      event = null;
    }
    scene.setStory(ch, loc, todFor(p, ch));
    updateInset();
    if (reduced) redraw();
  }

  function updateInset() {
    if (!scene) return;
    // The room kept for the title shrinks as it fades, so the camera slides
    // right with the scroll instead of jumping.
    const out = smoothstep((progress - 0.02) / 0.07);
    const inset = titleEl && wide ? (titleEl.offsetLeft + titleEl.offsetWidth + 8) * (1 - out) : 0;
    scene.setInsetLeft(inset);
  }

  function sizeStage() {
    if (!scene || !stageEl) return;
    wide = stageEl.clientWidth >= 1200;
    stageW = stageEl.clientWidth;
    const reserve = (bottomEl?.offsetHeight ?? 0) + 18;
    scene.resize(stageEl.clientWidth, stageEl.clientHeight, reserve);
    updateInset();
    redraw();
  }

  function scrollToChapter(i) {
    if (!storyEl || !stageEl) return;
    const top = storyEl.getBoundingClientRect().top + window.scrollY - 56;
    const total = storyEl.offsetHeight - stageEl.offsetHeight;
    const target = top + ((i + (i === 0 ? 0 : 0.3)) / SEGMENTS) * total;
    window.scrollTo({ top: target, behavior: reduced ? 'instant' : 'smooth' });
  }

  function nextChapter() {
    if (chapter < SEGMENTS - 1) scrollToChapter(chapter + 1);
    else document.getElementById('how')?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth' });
  }

  // ---------------------------------------------------------------------------
  // Interactions

  function describe(a) {
    const b = a.bubble;
    if (a.realStatus === 'permission') return `wants to run ${a.ask}`;
    if (!b) return '';
    if (b.tool === 'done') return b.detail;
    if (b.tool === 'merge') return 'ready for main';
    return `${b.tool} ${b.detail}`;
  }

  function openAgent(i) {
    const a = agents[i];
    if (!a || !a.seated) return;
    event = null;
    open = i;
    if (a.realStatus === 'permission') {
      openText = `I'd like to run \`${a.ask}\` to validate the profile input. Is that okay?`;
    } else if (a.bubble?.tool === 'merge') {
      openText = 'My branch is ready to come home to main. Open a PR, or merge it the way you usually do.';
    } else if (a.realStatus === 'working' && a.bubble) {
      openText = `${a.task} Right now: \`${a.bubble.tool} ${a.bubble.detail}\`.`;
    } else {
      openText = a.task;
    }
    queueMicrotask(() => dialogueRef?.focus());
  }

  function closeAgent(restoreFocus = true) {
    const i = open;
    open = null;
    if (restoreFocus && i != null) queueMicrotask(() => hitEls[i]?.focus());
  }

  function choose(value) {
    if (open == null || !scene) return;
    const allow = value === 'allow';
    scene.answer(open, allow);
    openText = allow
      ? 'Thanks! Installing `zod` now, then back to the profile endpoints.'
      : "No problem. I'll try another approach and check the input by hand.";
    if (reduced) redraw();
    queueMicrotask(() => dialogueRef?.focus());
  }

  function plant() {
    if (!scene || full) return;
    const index = scene.plant();
    if (index == null) return;
    open = null;
    const a = scene.snapshot()[index];
    event = {
      speaker: '+ Conversation',
      text: `New conversation on \`${a.branch}\`. Grove Bench makes its worktree in \`.grove-wt/${a.id}\` and opens its terminal. A new tree grows.`,
    };
    if (reduced) redraw();
  }

  function setTurn(v) {
    scene?.setTurn(Number(v));
    if (reduced) redraw();
  }

  function rewind(mode) {
    scene?.rewind(mode);
    if (reduced) redraw();
  }

  function onStagePointer(e) {
    if (!scene) return;
    if (e.type === 'pointerleave' || e.type === 'pointercancel') {
      scene.setPointer(null);
      return;
    }
    const r = stageEl.getBoundingClientRect();
    scene.setPointer(e.clientX - r.left, e.clientY - r.top);
  }

  function hover(i) {
    scene?.setHover(i);
    if (reduced) redraw();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle

  onMount(() => {
    scene = createScene(canvasEl, {
      reduced: prefersReducedMotion.current,
      onchange: () => {
        agents = scene.snapshot();
        turn = scene.turn;
        rewindNote = scene.rewindNote;
        merged = scene.merged;
        // Without the loop, redraw once the change has settled.
        if (prefersReducedMotion.current) queueMicrotask(redraw);
      },
    });
    agents = scene.snapshot();
    ready = true;
    sizeStage();
    onScroll();
    const ro = new ResizeObserver(() => sizeStage());
    ro.observe(stageEl);
    ro.observe(bottomEl);
    return () => ro.disconnect();
  });

  $effect(() => {
    if (!ready || !scene || !stageEl) return;
    const r = reduced;
    scene.setReduced(r);
    if (r) {
      onScroll();
      redraw();
      return;
    }
    return animationLoop(stageEl, (dt) => {
      scene.frame(dt);
      placeOverlays();
    });
  });

  // ---------------------------------------------------------------------------
  // Derived copy

  const introText = $derived(
    `${NUMBER_WORDS[count] ?? count} AI agents are working on one project. Click one to see its conversation, or press + Conversation to plant a new tree.`,
  );

  const dlg = $derived.by(() => {
    const a = open != null ? agents[open] : null;
    if (a) {
      return {
        mode: 'agent',
        speaker: a.branch,
        status: a.status,
        text: openText,
        tag: statusLabel(a.status),
        meta: [
          { label: 'Worktree', value: `.grove-wt/${a.id}` },
          { label: 'Model', value: a.model },
        ],
        choices:
          a.realStatus === 'permission'
            ? [
                { label: 'Allow', value: 'allow' },
                { label: 'Deny', value: 'deny' },
              ]
            : [],
        onnext: () => closeAgent(),
        nextLabel: 'Close',
        onclose: () => closeAgent(),
      };
    }
    if (event) {
      return {
        mode: 'agent',
        speaker: event.speaker,
        tag: '',
        status: null,
        text: event.text,
        meta: [],
        choices: [],
        onnext: () => (event = null),
        nextLabel: 'Back to the tour',
        onclose: () => (event = null),
      };
    }
    const c = CHAPTERS[chapter];
    return {
      mode: 'story',
      speaker: c.name,
      tag: chapter ? `${chapter} of 5` : '',
      status: null,
      text: chapter === 0 ? introText : c.text,
      meta: [],
      choices: [],
      onnext: nextChapter,
      nextLabel: chapter < SEGMENTS - 1 ? `Next: ${CHAPTERS[chapter + 1].name}` : 'How it works',
      onclose: undefined,
    };
  });

  const sceneLabel = $derived(
    `Pixel art grove at ${chapter >= 5 ? 'dawn' : 'night'}. Each tree is a git worktree, each agent on a bench is one AI conversation, and each lamp shows its status. ${NUMBER_WORDS[count] ?? count} conversations: ` +
      agents.map((a) => `${a.branch} (${statusLabel(a.status).toLowerCase()})`).join(', ') +
      '. Further along the path: an old tree with a glowing stone, a sundial, and a gate marked main.',
  );

  const toolTone = {
    Read: 'read',
    Grep: 'read',
    Glob: 'read',
    Edit: 'edit',
    Write: 'write',
    Bash: 'bash',
  };

  function onDownload(location) {
    trackLandingEvent('download_click', { location });
  }
  function onGithub(location) {
    trackLandingEvent('github_click', { location });
  }

  let ctaSeen = $state(false);
</script>

{#snippet logo(size = 16)}
  <svg width={size} height={Math.round((size * 24) / 21)} viewBox="0 0 21 24" fill="none" aria-hidden="true" style="image-rendering: pixelated">
    {#each treeGreens as p}
      <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />
    {/each}
  </svg>
{/snippet}

{#snippet downloadIcon()}
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" shape-rendering="crispEdges">
    <rect x="7" y="1" width="2" height="8" /><rect x="5" y="7" width="2" height="2" /><rect x="9" y="7" width="2" height="2" /><rect x="3" y="9" width="2" height="2" /><rect x="11" y="9" width="2" height="2" /><rect x="1" y="13" width="14" height="2" />
  </svg>
{/snippet}

{#snippet githubIcon()}
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
{/snippet}

{#snippet titleContent()}
  <p class="kicker">{@render logo(14)} Grove Bench for Windows</p>
  <h1>AI agents, side by side.</h1>
  <p class="lede">
    Grove Bench is a Windows app that runs several AI coding agents on one project at once. Each works in its own git
    worktree, on its own branch, with its own terminal.
  </p>
  <div class="actions">
    <a href={links.releases} target="_blank" rel="noopener" class="pix-btn primary" onclick={() => onDownload('grove-hero')}>
      {@render downloadIcon()} Download for Windows
    </a>
    <a href={links.github} target="_blank" rel="noopener" class="pix-btn" onclick={() => onGithub('grove-hero')}>View source</a>
  </div>
{/snippet}

{#snippet bubbleBody(a)}
  {#if chapter === 1}
    <span class="b-folder" aria-hidden="true"></span><span class="mono">.grove-wt/{a.id}</span>
  {:else if chapter === 2}
    <span class="t-line"><span class="t-prompt">$</span> {a.term[0].slice(2)}</span>
    <span class="t-line t-out">{a.term[1]}</span>
  {:else if a.bubble?.tool === '?'}
    ?
  {:else if a.bubble?.tool === 'done'}
    <span class="b-check" aria-hidden="true"></span>{a.bubble.detail}
  {:else if a.bubble?.tool === 'merge'}
    <span class="b-check" aria-hidden="true"></span>Ready for main
  {:else if a.bubble?.tool === 'rewind'}
    Rewound to {a.bubble.detail}
  {:else if a.bubble?.tool === 'conv'}
    Chat at {a.bubble.detail}, files kept
  {:else if a.bubble}
    {#if a.bubble.turn}<span class="b-turn">T{a.bubble.turn}</span>{/if}
    <b class="tool {toolTone[a.bubble.tool] ?? ''}">{a.bubble.tool}</b>
    {a.bubble.detail}
  {/if}
{/snippet}

<svelte:window onscroll={onScroll} />

<div class="page min-h-screen bg-background text-foreground">
  <nav class="sticky top-0 z-50 h-14 border-b border-border bg-card/85">
    <div class="nav-inner flex h-full items-center justify-between">
      <a href="#top" class="flex items-center gap-2.5" aria-label="Grove Bench, back to top">
        {@render logo(16)}
        <span class="text-sm font-semibold tracking-tight">Grove Bench</span>
      </a>
      <a
        href={links.github}
        target="_blank"
        rel="noopener"
        class="nav-gh inline-flex items-center gap-2 bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        onclick={() => onGithub('grove-nav')}
      >
        {@render githubIcon()}
        GitHub
      </a>
    </div>
  </nav>

  <main id="top">
    {#if narrow.current}
      <!-- On phones the title sits above the scene, in the same night sky -->
      <header class="title-card stacked">
        {@render titleContent()}
      </header>
    {/if}

    <!-- The grove: a tall section with a sticky scene -->
    <section class="story" bind:this={storyEl} aria-label="A walk through the grove" style="--segments: {SEGMENTS}">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="stage"
        class:wide
        bind:this={stageEl}
        style="--px: {Math.max(2, Math.min(4, k)).toFixed(2)}px; --k: {k}px"
        onpointermove={onStagePointer}
        onpointerdown={onStagePointer}
        onpointerleave={onStagePointer}
        onpointercancel={onStagePointer}
      >
        <div class="scene-wrap" role="img" aria-label={sceneLabel}>
          <canvas bind:this={canvasEl} class="scene" aria-hidden="true"></canvas>
        </div>

        {#if !narrow.current}
          <!-- Title screen, laid over the sky -->
          <header
            class="title-card"
            bind:this={titleEl}
            style="opacity: {1 - titleOut}; transform: translateY({-titleOut * 28}px); visibility: {titleOut > 0.98 ? 'hidden' : 'visible'}"
          >
            {@render titleContent()}
          </header>
        {/if}

        <div class="overlays">
          <!-- Memory folders around the old tree -->
          {#each MEMORY_FOLDERS as folder, i}
            <div class="pin" use:place={`tag:${i}`} aria-hidden="true">
              <span class="tag-note" class:show={chapter === 3} style="--d: {i * 0.12}s">{folder}</span>
            </div>
          {/each}

          <!-- Gate sign -->
          <div class="pin" use:place={'gate'} aria-hidden="true">
            <span class="gate-board" class:lit={chapter === 5 && agents.some((a) => a.bubble?.tool === 'merge')}>main</span>
          </div>

          {#each agents as a (a.id)}
            {#if a.phase === 'walk' || a.phase === 'sit'}
              <div class="pin" use:place={`sign:${a.index}`} aria-hidden="true">
                <span class="sign-board" class:bounce={chapter === 1}>{a.branch}</span>
              </div>
            {/if}
            {#if a.seated && (a.bubble || chapter === 1 || chapter === 2)}
              <div class="pin" use:place={`bubble:${a.index}`} aria-hidden="true">
                <span
                  class="bubble"
                  class:ask={a.bubble?.tool === '?' && chapter !== 1 && chapter !== 2}
                  class:term={chapter === 2}
                  class:folder={chapter === 1}
                >
                  {@render bubbleBody(a)}
                </span>
              </div>
            {/if}
          {/each}

          {#each agents as a, i (a.id)}
            {#if a.seated}
              <button
                type="button"
                class="hit"
                bind:this={hitEls[i]}
                use:place={`hit:${a.index}`}
                aria-label="{a.branch} conversation, {statusLabel(a.status).toLowerCase()}{describe(a) ? `: ${describe(a)}` : ''}. Open details"
                aria-haspopup="dialog"
                onclick={() => openAgent(i)}
                onfocus={() => {
                  hover(i);
                  scene?.focusPlot(i);
                }}
                onblur={() => hover(-1)}
                onmouseenter={() => hover(i)}
                onmouseleave={() => hover(-1)}
              ></button>
            {/if}
          {/each}

          <!-- Welcome callouts: what a tree, an agent and a lamp are -->
          {#each CALLOUTS as label, i}
            <div class="pin" use:place={`callout:${i}`} aria-hidden="true">
              <span class="callout">{label}</span>
            </div>
          {/each}

          {#if chapter === 4}
            <!-- The sundial's shadow is a range input laid over the dial -->
            <div class="pin" use:place={'hint'} aria-hidden="true">
              <span class="dial-hint">
                <svg width="6" height="10" viewBox="0 0 3 5" shape-rendering="crispEdges"><path fill="currentColor" d="M2 0h1v5H2zM1 1h1v3H1zM0 2h1v1H0z" /></svg>
                Drag the shadow
                <svg width="6" height="10" viewBox="0 0 3 5" shape-rendering="crispEdges"><path fill="currentColor" d="M0 0h1v5H0zM1 1h1v3H1zM2 2h1v1H2z" /></svg>
              </span>
            </div>
            <input
              class="dial-range"
              use:place={'dial'}
              type="range"
              min="1"
              max="4"
              step="1"
              value={turn}
              aria-label="Sundial: checkpoint"
              aria-valuetext="Checkpoint {turn} of 4: {HISTORY[turn - 1]}"
              oninput={(e) => setTurn(e.currentTarget.value)}
            />
          {/if}
        </div>

        <!-- The same thing in the real app, plus the key to the grove -->
        <div class="app-col" class:wide bind:this={colEl}>
          {#if !legendLeft}
            <div class="legend-slot" bind:this={legendEl}><Legend compact={!wide} /></div>
          {/if}
          <AppPanel
            view={panelView}
            {agents}
            focus={open}
            {turn}
            maxTurn={4}
            {rewindNote}
            history={CHECKPOINTS}
            {merged}
            {reduced}
            onturn={setTurn}
            onrewind={rewind}
            onanswer={(allow) => choose(allow ? 'allow' : 'deny')}
            style="max-height: {Math.max(0, panelMax)}px; visibility: {panelMax < 70 ? 'hidden' : 'visible'}"
          />
        </div>
        {#if legendLeft}
          <div class="legend-left"><Legend /></div>
        {/if}

        <!-- HUD and dialogue -->
        <div class="bottom-ui" class:talking={dlg.mode === 'agent'} bind:this={bottomEl}>
          <div class="hud">
            <nav class="pips" aria-label="Chapters">
              {#each CHAPTERS as c, i}
                <button
                  type="button"
                  class="pip"
                  class:on={chapter === i}
                  class:past={chapter > i}
                  aria-label="Chapter: {c.name}"
                  aria-current={chapter === i ? 'step' : undefined}
                  onclick={() => scrollToChapter(i)}
                >
                  <span></span>
                </button>
              {/each}
            </nav>
            <button
              type="button"
              class="pix-btn plant"
              onclick={plant}
              disabled={full}
              aria-label={full ? 'The grove is full' : 'Start a new conversation (plants a tree)'}
              aria-describedby="plant-count"
            >
              <svg width="14" height="16" viewBox="0 0 7 8" aria-hidden="true" shape-rendering="crispEdges">
                <rect x="3" y="3" width="1" height="5" fill="#8a6a4a" /><rect x="1" y="1" width="2" height="2" fill="#6ec87a" /><rect x="4" y="0" width="2" height="2" fill="#5ab868" /><rect x="3" y="2" width="1" height="1" fill="#4aaa58" />
              </svg>
              {full ? 'Grove is full' : '+ Conversation'}
              <span class="plant-count" id="plant-count"><span class="sr-only">Trees:</span> {count}/{MAX_TREES}</span>
            </button>
          </div>
          <div class="dlg-wrap">
            <Dialogue
              bind:this={dialogueRef}
              id="grove-dlg"
              mode={dlg.mode}
              speaker={dlg.speaker}
              tag={dlg.tag}
              status={dlg.status}
              text={dlg.text}
              meta={dlg.meta}
              choices={dlg.choices}
              instant={reduced}
              nextLabel={dlg.nextLabel}
              onnext={dlg.onnext}
              onchoose={choose}
              onclose={dlg.onclose}
            />
          </div>
        </div>
      </div>
    </section>

    <!-- How it works -->
    <section id="how" class="how border-t border-border">
      <div class="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <p class="eyebrow">How it works</p>
        <h2 class="section-title">Three steps from project to pull request</h2>
        <ol class="steps">
          <li class="step">
            <span class="step-num" aria-hidden="true">1</span>
            <svg class="step-icon" viewBox="0 0 12 10" width="48" height="40" aria-hidden="true" shape-rendering="crispEdges">
              <rect x="0" y="1" width="5" height="1" fill="#8a6a4a" /><rect x="0" y="2" width="12" height="8" fill="#8a6a4a" /><rect x="1" y="3" width="10" height="6" fill="#b08c68" /><rect x="1" y="3" width="10" height="1" fill="#c9a882" /><rect x="5" y="5" width="2" height="2" fill="#6ec87a" />
            </svg>
            <h3>Add a project</h3>
            <p>Click <span class="kbd">+ Project</span> and pick a folder that uses git.</p>
          </li>
          <li class="step">
            <span class="step-num" aria-hidden="true">2</span>
            <svg class="step-icon" viewBox="0 0 21 24" width="40" height="46" aria-hidden="true" shape-rendering="crispEdges">
              {#each treeGreens as p}
                <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />
              {/each}
            </svg>
            <h3>Start conversations</h3>
            <p>Press <span class="kbd">+ Conversation</span> for each task. Pick New branch, Existing branch or Direct.</p>
          </li>
          <li class="step">
            <span class="step-num" aria-hidden="true">3</span>
            <svg class="step-icon" viewBox="0 0 12 10" width="48" height="40" aria-hidden="true" shape-rendering="crispEdges">
              <rect x="1" y="0" width="1" height="10" fill="#6ec87a" /><rect x="1" y="0" width="1" height="1" fill="#c9f0cf" />
              <rect x="9" y="0" width="1" height="3" fill="#5aa0ff" /><rect x="8" y="3" width="1" height="1" fill="#5aa0ff" /><rect x="7" y="4" width="1" height="1" fill="#5aa0ff" /><rect x="6" y="5" width="1" height="1" fill="#5aa0ff" /><rect x="5" y="6" width="1" height="1" fill="#5aa0ff" /><rect x="4" y="7" width="1" height="1" fill="#5aa0ff" /><rect x="3" y="7" width="1" height="1" fill="#5aa0ff" /><rect x="2" y="7" width="1" height="1" fill="#6ec87a" />
              <rect x="0" y="9" width="3" height="1" fill="#22c55e" />
            </svg>
            <h3>Review and bring it home</h3>
            <p>Read the diffs in the Changes tab and revert what you don't want. Then open a PR from the app, or merge the way you always do.</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- Call to action: a small pixel grove at night -->
    <section class="cta" use:inView={{ once: true, threshold: 0.3, onchange: (v) => v && (ctaSeen = true) }}>
      <div class="cta-sky" aria-hidden="true">
        {#each Array(30) as _, i}
          {@const side = i % 2 ? 0 : 76}
          <span class="cta-star" style="left: {side + ((i * 37 + 11) % 22)}%; top: {(i * 53 + 7) % 88}%; animation-delay: {(i * 0.7) % 4}s"></span>
        {/each}
      </div>
      <div class="cta-head mx-auto max-w-6xl px-4 sm:px-6">
        <p class="eyebrow">Free and open source</p>
        <h2 class="cta-title">Plant your own grove</h2>
        <p class="cta-sub">Give every task its own tree, and keep an eye on all of them from one window.</p>
      </div>
      <div class="cta-grove" aria-hidden="true">
        {#key ctaSeen}
          {#each [28, 42, 63, 84, 63, 42, 28] as w, i}
            <div class="cta-plot" style="--w: {w}px">
              <PixelTree width={w} grow={ctaSeen && !reduced} delay={Math.abs(3 - i) * 0.15} opacity={0.5 + (w / 84) * 0.5} />
              {#if i >= 2 && i <= 4}
                <span class="cta-lamp {['working', 'permission', 'ready'][i - 2]}"></span>
              {/if}
            </div>
          {/each}
        {/key}
      </div>
      <div class="cta-meadow">
        <div class="mx-auto max-w-6xl px-4 sm:px-6">
          <div class="actions center">
            <a href={links.releases} target="_blank" rel="noopener" class="pix-btn primary" onclick={() => onDownload('grove-cta')}>
              {@render downloadIcon()} Download for Windows
            </a>
            <a href={links.github} target="_blank" rel="noopener" class="pix-btn" onclick={() => onGithub('grove-cta')}>
              {@render githubIcon()} View source
            </a>
          </div>
          <p class="req">Windows 10+, needs git 2.17+ and Claude Code CLI. Free and open source (MIT).</p>
        </div>
      </div>
    </section>
  </main>

  <footer class="border-t border-border bg-card">
    <div class="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
      <div class="flex items-center gap-2.5">
        {@render logo(12)}
        <span class="text-sm text-muted-foreground">Grove Bench</span>
        <span class="ml-2 text-sm text-muted-foreground/70">Open source under MIT</span>
      </div>
      <ul class="footer-links">
        <li><a href={links.github} target="_blank" rel="noopener">GitHub</a></li>
        <li><a href={links.releases} target="_blank" rel="noopener">Releases</a></li>
        <li><a href={links.contributing} target="_blank" rel="noopener">Contributing</a></li>
        <li><a href={links.license} target="_blank" rel="noopener">License</a></li>
        <li><a href={links.issues} target="_blank" rel="noopener">Issues</a></li>
      </ul>
    </div>
  </footer>
</div>

<style>
  :global(html) {
    overflow-x: clip;
  }
  .page {
    overflow-x: clip;
  }
  nav.sticky {
    backdrop-filter: blur(10px);
  }
  /* Same gutter as the title screen, so the two line up. */
  .nav-inner {
    padding-inline: 16px;
  }
  @media (min-width: 640px) {
    .nav-inner {
      padding-inline: clamp(24px, 5vw, 72px);
    }
  }
  .nav-gh {
    transition: filter 0.15s ease;
  }
  .nav-gh:hover {
    filter: brightness(1.15);
  }
  a:focus-visible,
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 3px;
  }

  /* ------------------------------------------------------------------------
     Story stage */

  .story {
    position: relative;
    height: calc(100svh - 3.5rem + var(--segments) * 78svh);
    background: #0b1020;
  }
  .stage {
    position: sticky;
    top: 3.5rem;
    height: calc(100svh - 3.5rem);
    min-height: 480px;
    overflow: hidden;
    background: #0d1228;
  }
  .scene-wrap {
    position: absolute;
    inset: 0;
  }
  .scene {
    position: absolute;
    left: 0;
    top: 0;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    user-select: none;
  }
  .overlays {
    position: absolute;
    z-index: 1;
    inset: 0;
    pointer-events: none;
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
  }
  .pin {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    will-change: transform;
  }
  .pin > * {
    position: absolute;
    left: 0;
    bottom: 0;
    transform: translateX(-50%);
  }

  /* Pixel frames with notched corners, sized to the canvas pixel. */
  .sign-board,
  .gate-board,
  .bubble,
  .tag-note {
    --edge: #2a1f1a;
    box-shadow:
      0 calc(var(--px) * -1) 0 0 var(--edge),
      0 var(--px) 0 0 var(--edge),
      calc(var(--px) * -1) 0 0 0 var(--edge),
      var(--px) 0 0 0 var(--edge);
    white-space: nowrap;
  }

  .sign-board {
    display: block;
    padding: 1px 7px 2px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    color: #f4ecdd;
    background: #8a6a4a;
    border-bottom: var(--px) solid #6a5040;
  }
  .sign-board.bounce {
    animation: sign-bounce 0.6s steps(3) 1;
  }
  @keyframes sign-bounce {
    40% {
      transform: translate(-50%, calc(var(--px) * -2));
    }
  }

  .gate-board {
    bottom: auto;
    top: 0;
    display: block;
    padding: 2px 10px 3px;
    font-size: 15px;
    font-weight: 700;
    color: #f4ecdd;
    background: #6a5040;
    transition: background-color 0.4s steps(4), color 0.4s steps(4);
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
    left: calc(50% + var(--tail, 0px));
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
  .bubble b.tool {
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
  .tool.bash {
    color: #4a4f60;
  }
  .b-turn {
    padding: 0 4px;
    font-size: 12px;
    color: #f4ecdd;
    background: #1b1f2a;
  }
  .b-check {
    width: 10px;
    height: 10px;
    flex: none;
    background: #22803a;
    clip-path: polygon(0 50%, 20% 50%, 40% 70%, 80% 10%, 100% 10%, 100% 30%, 40% 100%, 0 70%);
  }
  .b-folder {
    width: 12px;
    height: 9px;
    flex: none;
    background: #8a6a4a;
    clip-path: polygon(0 0, 45% 0, 55% 20%, 100% 20%, 100% 100%, 0 100%);
  }
  .bubble .mono,
  .bubble.term {
    font-family: 'JetBrains Mono', monospace;
  }
  .bubble.folder {
    font-size: 12px;
  }
  .bubble.ask {
    --edge: #3a2204;
    min-width: calc(var(--px) * 8);
    justify-content: center;
    font-size: 18px;
    font-weight: 700;
    color: #3a2204;
    background: #f59e0b;
    animation: ask-bob 1s steps(2) infinite;
  }
  @keyframes ask-bob {
    50% {
      transform: translate(-50%, calc(var(--px) * -1));
    }
  }
  .bubble.term {
    --edge: #05070d;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    padding: 3px 8px 4px;
    font-size: 12px;
    color: #c9d2e8;
    background: #111111;
  }
  .t-prompt {
    color: #5aa0ff;
  }
  .t-out {
    color: #6ec87a;
  }

  .tag-note {
    --edge: #1b1f2a;
    display: block;
    padding: 2px 8px 3px 10px;
    font-size: 13px;
    color: #1b1f2a;
    background: #e8eefc;
    border-left: calc(var(--px) * 1.5) solid #0b6dd6;
    opacity: 0;
    translate: 0 calc(var(--px) * 3);
    transition:
      opacity 0.5s steps(5) var(--d),
      translate 0.5s steps(5) var(--d);
  }
  .tag-note.show {
    opacity: 1;
    translate: 0 0;
    animation: note-float 3s steps(6) var(--d) infinite;
  }
  @keyframes note-float {
    50% {
      translate: 0 calc(var(--px) * -1.5);
    }
  }

  .hit {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: auto;
    cursor: pointer;
    background: transparent;
  }
  .hit:focus-visible {
    outline: 2px dashed #ffe7a8;
    outline-offset: 2px;
  }

  /* Welcome callouts and the sundial */
  .callout,
  .dial-hint {
    --edge: #0b1224;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 1px 8px 2px;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    color: #1b1f2a;
    background: #ffe7a8;
    box-shadow:
      0 calc(var(--px) * -1) 0 0 var(--edge),
      0 var(--px) 0 0 var(--edge),
      calc(var(--px) * -1) 0 0 0 var(--edge),
      var(--px) 0 0 0 var(--edge);
  }
  .dial-hint {
    margin-bottom: calc(var(--px) * 2);
    background: #f4ecdd;
  }
  .dial-range {
    position: absolute;
    left: 0;
    top: 0;
    margin: 0;
    pointer-events: auto;
    appearance: none;
    background: transparent;
    cursor: ew-resize;
  }
  .dial-range::-webkit-slider-runnable-track {
    height: 100%;
    background: transparent;
  }
  .dial-range::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 100%;
    background: transparent;
  }
  .dial-range::-moz-range-track {
    background: transparent;
  }
  .dial-range::-moz-range-thumb {
    opacity: 0;
  }
  .dial-range:focus-visible {
    outline: 2px dashed #ffe7a8;
    outline-offset: 2px;
  }

  /* App panel column and the key */
  .app-col {
    position: absolute;
    z-index: 2;
    top: 8px;
    left: 12px;
    right: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 520px;
    margin: 0 auto;
    pointer-events: none;
  }
  .app-col > :global(*) {
    pointer-events: auto;
  }
  .app-col.wide {
    top: 20px;
    left: auto;
    right: clamp(24px, 3vw, 48px);
    width: clamp(340px, 28vw, 420px);
    max-width: none;
    margin: 0;
  }
  .app-col.wide .legend-slot {
    order: 2;
  }
  .legend-left {
    position: absolute;
    z-index: 3;
    left: 24px;
    bottom: 16px;
    width: min(280px, calc((100% - min(780px, 100% - 600px)) / 2 - 40px));
  }
  /* Leave the bottom left corner to the key. */
  .stage.wide .bottom-ui > * {
    max-width: min(780px, calc(100% - 600px));
  }

  /* Title screen */
  .title-card {
    position: absolute;
    z-index: 2;
    left: 0;
    top: 0;
    width: 100%;
    padding: 24px clamp(24px, 5vw, 72px) 0;
    will-change: transform, opacity;
  }
  .title-card.stacked {
    position: relative;
    z-index: auto;
    padding: 28px 16px 40px;
    /* Ends on the canvas sky's top band so the two read as one sky. */
    background: linear-gradient(180deg, #0b0f1c, #030715);
  }
  .title-card.stacked::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    width: 3px;
    height: 3px;
    opacity: 0.6;
    box-shadow:
      300px 40px 0 #f4ecdd,
      352px 120px 0 #c9d2e8,
      250px 210px 0 #c9d2e8,
      330px 290px 0 #f4ecdd,
      40px 330px 0 #c9d2e8,
      190px 20px 0 #c9d2e8;
    pointer-events: none;
  }
  .stage.wide .title-card {
    width: min(560px, 42%);
    padding: clamp(32px, 7vh, 72px) 0 0 clamp(32px, 5vw, 72px);
  }
  .kicker {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
    font-size: 15px;
    color: #c9d2e8;
  }
  .title-card h1 {
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
    font-size: clamp(30px, 8.4vw, 36px);
    font-weight: 700;
    line-height: 1.02;
    letter-spacing: 0.01em;
    color: #f4ecdd;
    text-shadow:
      3px 3px 0 #0b1224,
      0 3px 0 #0b1224;
    text-wrap: balance;
  }
  .stage.wide .title-card h1 {
    font-size: clamp(40px, 4.2vw, 60px);
  }
  .lede {
    margin-top: 14px;
    max-width: 44ch;
    font-size: 14px;
    line-height: 1.6;
    color: #c9d2e8;
    text-shadow: 0 2px 0 #0b1224;
  }
  .stage.wide .lede {
    font-size: 15px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
  }
  .actions.center {
    justify-content: center;
  }

  /* Pixel buttons */
  .pix-btn {
    --edge: #0b1224;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 42px;
    padding: 8px 16px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    font-weight: 600;
    color: #eef1f8;
    background: #26324f;
    box-shadow:
      0 -3px 0 0 var(--edge),
      0 3px 0 0 var(--edge),
      -3px 0 0 0 var(--edge),
      3px 0 0 0 var(--edge),
      inset 0 -3px 0 0 rgb(0 0 0 / 0.3),
      inset 0 3px 0 0 rgb(255 255 255 / 0.12);
    transition:
      transform 0.1s steps(2),
      filter 0.1s;
    cursor: pointer;
  }
  .pix-btn:hover:not(:disabled) {
    filter: brightness(1.15);
    transform: translateY(-2px);
  }
  .pix-btn:active:not(:disabled) {
    transform: translateY(1px);
  }
  .pix-btn.primary {
    color: #ffffff;
    background: var(--color-primary);
  }
  .pix-btn.small {
    min-height: 34px;
    padding: 4px 10px;
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
    font-size: 14px;
  }
  .pix-btn.ghost {
    background: #1b2744;
  }
  .pix-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* HUD and dialogue */
  .bottom-ui {
    position: absolute;
    z-index: 3;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 16px 16px;
    pointer-events: none;
  }
  .bottom-ui > * {
    pointer-events: auto;
    width: 100%;
    max-width: 780px;
  }
  .hud {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 22px;
  }
  .pips {
    display: flex;
    gap: 2px;
  }
  .pip {
    display: grid;
    place-items: center;
    width: 30px;
    height: 36px;
  }
  .pip span {
    width: 10px;
    height: 10px;
    background: rgb(238 241 248 / 0.25);
    box-shadow: 0 0 0 2px #0b1224;
    transition: background-color 0.2s steps(2);
  }
  .pip.past span {
    background: #6ec87a;
  }
  .pip.on span {
    width: 14px;
    height: 14px;
    background: #ffe7a8;
  }
  .pip:hover span {
    background: #eef1f8;
  }
  .plant {
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
    font-size: 16px;
    background: #2f5a37;
  }
  .plant-count {
    padding: 0 6px;
    font-size: 13px;
    color: #cfe9d3;
    background: rgb(0 0 0 / 0.3);
  }
  /* The dialogue grows upward from a fixed slot, so the scene never jumps. */
  .dlg-wrap {
    --dlg-h: 138px;
    --dlg-font: 18px;
    position: relative;
    height: var(--dlg-h);
  }
  .dlg-wrap > :global(.dlg) {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }

  .plant,
  .pix-btn.small {
    white-space: nowrap;
  }

  @media (max-width: 639px) {
    .dlg-wrap {
      --dlg-h: 150px;
      --dlg-font: 16px;
    }
    .bottom-ui {
      padding: 0 12px 12px;
    }
    .bottom-ui.talking .hud {
      visibility: hidden;
    }
    .hud {
      gap: 8px;
      margin-bottom: 20px;
    }
    .pip {
      width: 22px;
    }
    .plant {
      gap: 6px;
      padding: 6px 10px;
      font-size: 15px;
    }
  }

  /* ------------------------------------------------------------------------
     How it works */

  .eyebrow {
    margin-bottom: 10px;
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
    font-size: 15px;
    color: #6ec87a;
  }
  .section-title {
    font-size: clamp(24px, 3.2vw, 34px);
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }
  .steps {
    position: relative;
    display: grid;
    gap: 28px;
    margin-top: 44px;
    list-style: none;
  }
  @media (min-width: 768px) {
    .steps {
      grid-template-columns: repeat(3, 1fr);
      gap: 32px;
    }
    .steps::before {
      content: '';
      position: absolute;
      left: 12%;
      right: 12%;
      top: 58px;
      height: 4px;
      background: repeating-linear-gradient(90deg, #8a6a4a 0 8px, transparent 8px 16px);
      opacity: 0.6;
    }
  }
  .step {
    position: relative;
    padding: 28px 24px 26px;
    background: var(--color-card);
    box-shadow:
      0 -3px 0 0 var(--color-border),
      0 3px 0 0 var(--color-border),
      -3px 0 0 0 var(--color-border),
      3px 0 0 0 var(--color-border);
  }
  .step-num {
    position: absolute;
    top: -14px;
    left: 20px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
    font-size: 16px;
    font-weight: 700;
    color: #0b1224;
    background: #ffe7a8;
    box-shadow: 0 0 0 3px #0b1224;
  }
  .step-icon {
    display: block;
    height: 46px;
    width: auto;
    margin-bottom: 18px;
    image-rendering: pixelated;
  }
  .step h3 {
    margin-bottom: 8px;
    font-size: 17px;
    font-weight: 700;
  }
  .step p {
    font-size: 14px;
    line-height: 1.65;
    color: var(--color-muted-foreground);
  }
  .kbd {
    padding: 1px 6px;
    font-size: 14px;
    color: var(--color-foreground);
    background: var(--color-muted);
    box-shadow: 0 2px 0 0 #0b0b0b;
  }

  /* ------------------------------------------------------------------------
     CTA */

  .cta {
    position: relative;
    overflow: hidden;
    padding-top: 96px;
    text-align: center;
    background: linear-gradient(
      180deg,
      #0b1020 0 22%,
      #0e1530 22% 44%,
      #121b3c 44% 62%,
      #172249 62% 100%
    );
  }
  .cta-sky {
    position: absolute;
    inset: 0 0 30% 0;
  }
  .cta-star {
    position: absolute;
    width: 3px;
    height: 3px;
    background: #f4ecdd;
    opacity: 0.35;
    animation: twinkle 4s steps(4) infinite;
  }
  @keyframes twinkle {
    50% {
      opacity: 0.9;
    }
  }
  .cta-head {
    position: relative;
  }
  .cta-title {
    font-family: 'Pixelify Sans', 'JetBrains Mono', monospace;
    font-size: clamp(32px, 5vw, 52px);
    font-weight: 700;
    line-height: 1.05;
    color: #f4ecdd;
    text-shadow: 3px 3px 0 #0b1224;
    text-wrap: balance;
  }
  .cta-sub {
    margin: 14px auto 0;
    max-width: 46ch;
    font-size: 15px;
    line-height: 1.6;
    color: #c9d2e8;
  }
  .cta-grove {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    gap: clamp(6px, 2.4vw, 22px);
    height: 120px;
    margin-top: 48px;
  }
  .cta-plot {
    position: relative;
    display: flex;
    align-items: flex-end;
    width: var(--w);
  }
  .cta-lamp {
    position: absolute;
    right: -10px;
    bottom: 0;
    width: 3px;
    height: 22px;
    background: #6a5040;
  }
  .cta-lamp::before {
    content: '';
    position: absolute;
    left: -3px;
    top: -9px;
    width: 9px;
    height: 9px;
    box-shadow: 0 0 0 2px #1e1e1e;
  }
  .cta-lamp.working::before {
    background: var(--color-primary);
    box-shadow:
      0 0 0 2px #1e1e1e,
      0 0 14px 4px oklch(0.541 0.181 254.624 / 0.55);
    animation: lamp-pulse 1.5s steps(3) infinite;
  }
  .cta-lamp.permission::before {
    background: #f59e0b;
    box-shadow:
      0 0 0 2px #1e1e1e,
      0 0 14px 4px rgb(245 158 11 / 0.5);
    animation: lamp-pulse 1s steps(3) infinite;
  }
  .cta-lamp.ready::before {
    background: #22c55e;
    box-shadow:
      0 0 0 2px #1e1e1e,
      0 0 14px 4px rgb(34 197 94 / 0.45);
  }
  @keyframes lamp-pulse {
    50% {
      opacity: 0.5;
    }
  }
  .cta-meadow {
    position: relative;
    padding: 44px 0 72px;
    background:
      linear-gradient(180deg, #5ab868 0 3px, #4aaa58 3px 6px, #3a9a48 6px 9px, #1e3325 9px 26px, #16241c 26px);
  }
  .cta-meadow .actions {
    margin-top: 0;
  }
  .req {
    margin-top: 22px;
    font-size: 14px;
    line-height: 1.6;
    color: #a9b8ad;
  }

  /* ------------------------------------------------------------------------
     Footer */

  .footer-links {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 22px;
    list-style: none;
  }
  .footer-links a {
    font-size: 14px;
    color: var(--color-muted-foreground);
    transition: color 0.15s;
  }
  .footer-links a:hover {
    color: var(--color-foreground);
  }

  @media (prefers-reduced-motion: reduce) {
    .sign-board.bounce,
    .bubble.ask,
    .tag-note.show,
    .cta-star,
    .cta-lamp::before {
      animation: none;
    }
    .tag-note,
    .pix-btn {
      transition: none;
    }
  }
</style>
