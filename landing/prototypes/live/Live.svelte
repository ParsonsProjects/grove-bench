<script>
  import { onMount } from 'svelte';
  import Shell from '../shared/Shell.svelte';
  import Window from '../shared/app/Window.svelte';
  import Tree from '../shared/Tree.svelte';
  import { links } from '../../src/lib/brand.js';
  import { DownloadIcon } from '../../src/lib/icons.js';
  import { animationLoop } from '../../src/lib/motion.js';
  import { BEATS, CHAPTERS, END, initialWorld, worldAt, startDraft } from './script.js';

  const W = 1120;
  const LEAD = 0.9; // seconds the pointer takes to reach what it clicks

  let world = $state(initialWorld());
  let t = $state(0);
  let next = 0;
  let playing = $state(true);
  let driving = $state(false);
  let caption = $state(BEATS[0].caption);
  let zoom = $state(1);
  let stageEl = $state();
  let winEl = $state();
  let cursor = $state({ x: 0, y: 0, show: false, click: 0 });
  let from = { x: 0, y: 0 };
  let typing = null;

  const chapterIndex = $derived(CHAPTERS.findLastIndex((c) => c.at <= t + 0.01));

  onMount(() => {
    const ro = new ResizeObserver(([e]) => (zoom = Math.min(1, e.contentRect.width / W)));
    ro.observe(stageEl);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) playing = false;
    return () => ro.disconnect();
  });

  /** Centre of a [data-target] in the window, in stage coordinates. */
  function targetPoint(name) {
    const el = winEl?.querySelector(`[data-target="${name}"]`);
    if (!el || !stageEl) return null;
    const r = el.getBoundingClientRect();
    const s = stageEl.getBoundingClientRect();
    return { x: r.left - s.left + Math.min(r.width / 2, 60), y: r.top - s.top + r.height / 2 };
  }

  function step(dt) {
    t += dt;
    // The pointer heads for the next click a moment before it happens.
    const target = BEATS.slice(next).find((b) => b.cursor);
    if (target && t >= target.at - LEAD && t < target.at) {
      const p = targetPoint(target.cursor);
      if (p) {
        const k = Math.min(1, (t - (target.at - LEAD)) / (LEAD * 0.8));
        const e = 1 - (1 - k) ** 3;
        cursor = { ...cursor, x: from.x + (p.x - from.x) * e, y: from.y + (p.y - from.y) * e, show: true };
      }
    } else if (!target || t < target.at - LEAD) {
      from = { x: cursor.x, y: cursor.y };
    }
    while (next < BEATS.length && BEATS[next].at <= t) {
      const b = BEATS[next++];
      if (b.cursor) {
        cursor = { ...cursor, click: cursor.click + 1 };
        from = { x: cursor.x, y: cursor.y };
      }
      if (b.run) b.run(world);
      if (b.caption) caption = b.caption;
      if (b.typing) typing = { text: b.typing, at: b.at };
    }
    if (typing && world.draft) {
      const n = Math.min(typing.text.length, Math.floor((t - typing.at) / 0.055));
      world.draft.text = typing.text.slice(0, n);
      if (n >= typing.text.length) typing = null;
    }
    if (t >= END) jump(0);
  }

  $effect(() => {
    if (!playing || driving || !stageEl) return;
    return animationLoop(stageEl, step);
  });

  /** Rebuilds the world for a moment of the tour and plays on from there. */
  function jump(at) {
    const start = Math.max(0, at - LEAD - 0.1);
    world = worldAt(at);
    next = BEATS.findIndex((b) => b.at >= at);
    if (next < 0) next = BEATS.length;
    t = start;
    typing = null;
    const before = BEATS.slice(0, next).findLast((b) => b.caption);
    caption = before?.caption ?? BEATS[0].caption;
    driving = false;
    playing = true;
  }

  function resume() {
    jump(CHAPTERS[Math.max(0, chapterIndex)].at);
  }

  // Anything the visitor clicks pauses the tour and does what the app would.
  function take() {
    if (!driving) caption = 'You’re driving. Click around the window, or resume the tour.';
    driving = true;
    cursor = { ...cursor, show: false };
  }
  const sel = () => world.convs.find((c) => c.id === world.selected);
  const handlers = {
    onselect(id) {
      take();
      world.draft = null;
      world.selected = id;
      const c = sel();
      if (c.state === 'unread') c.state = 'ready';
      if (c.state === 'sleeping' || c.state === 'stopped') {
        c.scene = 'wake';
        c.run += 1;
        c.state = 'starting';
        setTimeout(() => {
          c.scene = null;
          c.state = 'ready';
        }, 2400);
      }
    },
    ontab(tab) {
      take();
      world.tab = tab;
    },
    onanswer(choice) {
      take();
      const c = sel();
      const p = c?.items.findLast((i) => i.kind === 'perm' && !i.resolved);
      if (!p) return;
      p.resolved = choice === 'deny' ? 'denied' : 'allowed';
      c.state = 'working';
      c.lineTone = 'blue';
      c.line = choice === 'deny' ? 'Working…' : `Bash: ${p.detail}`;
      setTimeout(() => {
        c.items.push({ kind: 'text', text: choice === 'deny' ? 'OK, I won’t run it. You can run npm test in the terminal.' : 'Tests pass.' });
        c.state = 'ready';
        c.line = c.items.at(-1).text;
        c.lineTone = 'muted';
      }, 1800);
    },
    onpr() {
      take();
      const c = sel();
      if (c && !c.pr) c.pr = 42;
    },
    onnew() {
      take();
      world.draft = { text: 'Add search to the dashboard (UI-31)' };
    },
    onstart() {
      take();
      if (world.convs.some((c) => c.id === '1d6f4c08')) {
        world.draft = null;
        return;
      }
      startDraft(world);
      const d = sel();
      setTimeout(() => {
        d.scene = null;
        d.state = 'ready';
        d.items.push({ kind: 'text', text: "I'll look at the dashboard first." });
        d.name = 'feat/UI-31-dashboard-search';
      }, 3800);
    },
    onfile(i) {
      take();
      world.file = i;
    },
    oncheckpoint(i) {
      take();
      world.checkpoint = i;
    },
  };
</script>

<Shell current="live">
  <section class="wrap hero">
    <p class="eyebrow">Prototype · the app, running</p>
    <h1>Several agents, one window</h1>
    <p class="lede">
      This is Grove Bench’s own layout, playing a short session: four conversations on one project, each on its own branch.
      Click anything in the window to take over, or jump to a moment below.
    </p>
  </section>

  <section class="night" aria-label="Grove Bench, playing a session">
    <div class="sky" aria-hidden="true"></div>
    <div class="wrap">
      <div class="stage" bind:this={stageEl} style="height: {Math.round(620 * zoom) + 2}px">
        <div class="frame" bind:this={winEl} style="zoom: {zoom}">
          <Window {world} {...handlers} />
        </div>
        {#if cursor.show && !driving}
          <span class="cursor" style="transform: translate({cursor.x}px, {cursor.y}px)" aria-hidden="true">
            {#key cursor.click}<i class="ring"></i>{/key}
            <svg width="16" height="22" viewBox="0 0 8 11" shape-rendering="crispEdges">
              <path d="M0 0h1v1h1v1h1v1h1v1h1v1h1v1h1v1H5v1h1v2H5v-1H4V9H3V8H2v1H1v1H0z" fill="#0b1224" />
              <path d="M1 2h1v1h1v1h1v1h1v1h1v1H4v1h1v1H4V8H3V7H2v1H1z" fill="#f4ecdd" />
            </svg>
          </span>
        {/if}
      </div>
    </div>
    <p class="wrap small-note">Shown to scale. It’s easier to follow on a wider screen.</p>
    <div class="treeline" aria-hidden="true">
      {#each Array(9) as _, i}
        <Tree scale={i % 3 === 1 ? 5 : 3} dim={i % 2 === 0} />
      {/each}
    </div>
  </section>

  <section class="wrap tour" aria-label="Tour">
    <div class="caption panel" aria-live="polite">
      <p>{caption}</p>
      <div class="ctl">
        {#if driving}
          <button type="button" class="btn small primary" onclick={resume}>Resume tour</button>
        {:else}
          <button type="button" class="btn small ghost" onclick={() => (playing = !playing)} aria-pressed={!playing}>{playing ? 'Pause' : 'Play'}</button>
        {/if}
      </div>
    </div>
    <ol class="chapters">
      {#each CHAPTERS as ch, i}
        <li>
          <button type="button" class:on={!driving && i === chapterIndex} onclick={() => { jump(ch.at); stageEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}>
            <span class="n">{i + 1}</span>{ch.name}
          </button>
        </li>
      {/each}
    </ol>
  </section>

  <section class="wrap notes" aria-label="What you just saw">
    <div class="note">
      <h2 class="pixel">One branch each</h2>
      <p>Every conversation gets its own git worktree and branch, so agents never write over each other. Start with a task; the branch names itself.</p>
    </div>
    <div class="note">
      <h2 class="pixel">You stay in charge</h2>
      <p>Pick how much each one may do: Ask, Plan, Edit, Auto, or Grove Bench’s own Read-safe. Anything outside that waits for you.</p>
    </div>
    <div class="note">
      <h2 class="pixel">Status at a glance</h2>
      <p>Each conversation’s character shows what it’s doing: typing, a question mark when it needs you, a wave when it’s done, asleep when idle.</p>
    </div>
    <a class="btn primary get" href={links.releases} target="_blank" rel="noopener">{@html DownloadIcon} Download for Windows</a>
  </section>
</Shell>

<style>
  .hero {
    display: grid;
    gap: 6px 40px;
    padding-block: 28px 18px;
  }
  @media (min-width: 900px) {
    .hero {
      grid-template-columns: auto minmax(0, 1fr);
      align-items: end;
    }
    .hero .eyebrow {
      grid-column: 1 / -1;
    }
  }
  h1 {
    font-family: var(--font-pixel);
    font-size: clamp(30px, 2.4vw + 18px, 46px);
    color: #f6f7fb;
  }
  .lede {
    max-width: 62ch;
    font-size: 14px;
    color: #c7cfe0;
  }
  .night {
    position: relative;
    padding-top: 18px;
    overflow: hidden;
  }
  .sky {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(1px 1px at 12% 20%, #fff8, transparent),
      radial-gradient(1px 1px at 28% 8%, #fff6, transparent),
      radial-gradient(2px 2px at 44% 30%, #ffe7a855, transparent),
      radial-gradient(1px 1px at 63% 12%, #fff7, transparent),
      radial-gradient(1px 1px at 81% 26%, #fff5, transparent),
      radial-gradient(2px 2px at 92% 9%, #fff4, transparent),
      linear-gradient(180deg, var(--night), #101a33 70%, #142240);
  }
  .stage {
    position: relative;
    z-index: 2;
    max-width: 1120px;
    margin-inline: auto;
  }
  .frame {
    width: 1122px;
    box-shadow:
      0 0 0 3px var(--ink),
      0 0 0 6px #2b3a55,
      0 20px 60px rgb(0 0 0 / 0.5);
  }
  .cursor {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 5;
    pointer-events: none;
    filter: drop-shadow(0 2px 0 rgb(0 0 0 / 0.4));
  }
  .ring {
    position: absolute;
    left: -10px;
    top: -10px;
    width: 20px;
    height: 20px;
    border: 2px solid var(--gold);
    animation: ring 0.45s steps(4) forwards;
  }
  @keyframes ring {
    from {
      transform: scale(0.4);
      opacity: 1;
    }
    to {
      transform: scale(1.4);
      opacity: 0;
    }
  }
  .small-note {
    position: relative;
    z-index: 2;
    display: none;
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
  }
  @media (max-width: 760px) {
    .small-note {
      display: block;
    }
  }
  .treeline {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-top: -34px;
    padding-inline: 2%;
    border-bottom: 8px solid var(--leaf-4);
    pointer-events: none;
  }
  .tour {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-top: 26px;
  }
  .caption {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 74px;
    padding: 14px 18px;
  }
  .caption p {
    flex: 1;
    font-size: 15px;
    color: #eef1f8;
  }
  .chapters {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chapters button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px 5px 6px;
    font-size: 13px;
    color: var(--muted);
    background: rgb(255 255 255 / 0.04);
    border: 0;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1);
    cursor: pointer;
  }
  .chapters button:hover {
    color: #fff;
  }
  .chapters button.on {
    color: #fff;
    box-shadow: inset 0 0 0 2px var(--leaf-1);
  }
  .n {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    font-family: var(--font-pixel);
    font-size: 12px;
    color: #12361a;
    background: var(--leaf-2);
  }
  .notes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: 28px;
    padding-top: 56px;
    align-items: start;
  }
  .note h2 {
    font-size: 22px;
    color: #f3f5fa;
  }
  .note p {
    margin-top: 8px;
    font-size: 14px;
    color: #c7cfe0;
  }
  .get {
    grid-column: 1 / -1;
    justify-self: start;
  }
  @media (prefers-reduced-motion: reduce) {
    .ring {
      animation: none;
      opacity: 0;
    }
  }
</style>
