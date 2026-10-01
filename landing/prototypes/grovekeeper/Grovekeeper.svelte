<script>
  import { onMount } from 'svelte';
  import Shell from '../shared/Shell.svelte';
  import Sprite from '../shared/Sprite.svelte';
  import Pixels from '../shared/Pixels.svelte';
  import { LAMP } from '../shared/app-art.js';
  import { FILTERS } from '../shared/colors.js';
  import { mix } from '../../src/pixel/palette.js';
  import { animationLoop } from '../../src/lib/motion.js';
  import Plot from './Plot.svelte';
  import Thread from './Thread.svelte';
  import { PROJECT } from './tasks.js';
  import * as G from './game.js';

  let game = $state(G.createGame());
  let paused = $state(false);
  let started = $state(false);
  let k = $state(4);
  let groveEl = $state();

  const selected = $derived(game.plots.find((p) => p && p.id === game.selected) ?? null);
  const counts = $derived(G.counts(game));
  const free = $derived(game.plots.some((p) => p === null));
  const busy = $derived(game.plots.some((p) => p !== null));

  // The sky follows the clock: morning blue to an orange home time.
  const SKY = [
    { at: G.DAY_START, top: '#6fa6e0', low: '#cfe6f6' },
    { at: 13 * 60, top: '#4f97e6', low: '#bfe2f8' },
    { at: 15.5 * 60, top: '#6b8fd6', low: '#f2d9b0' },
    { at: G.DAY_END, top: '#5a5aa8', low: '#f3a66b' },
  ];
  function sky(t) {
    let i = SKY.findIndex((s) => s.at > t);
    if (i <= 0) i = i === 0 ? 1 : SKY.length - 1;
    const a = SKY[i - 1];
    const b = SKY[i];
    const f = Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at)));
    return { top: mix(a.top, b.top, f), low: mix(a.low, b.low, f) };
  }
  // Recomputed every few game minutes, not every frame.
  const skyNow = $derived(sky(Math.floor(game.clock / 5) * 5));
  const sunX = $derived(((game.clock - G.DAY_START) / (G.DAY_END - G.DAY_START)) * 100);

  onMount(() => {
    const mq = window.matchMedia('(max-width: 700px)');
    const fit = () => (k = mq.matches ? 3 : 4);
    fit();
    mq.addEventListener('change', fit);
    return () => mq.removeEventListener('change', fit);
  });

  $effect(() => {
    if (!groveEl || paused || !started || game.over) return;
    return animationLoop(groveEl, (dt) => G.tick(game, dt));
  });

  function start(ticket) {
    started = true;
    const p = G.plant(game, ticket);
    if (p && !game.selected) G.open(game, p);
    // On one column the board sits under the grove: bring the new tree into view.
    if (p && window.matchMedia('(max-width: 999px)').matches) groveEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function restart() {
    game = G.createGame();
    started = false;
    paused = false;
  }

  const ticketTone = (t) => t.split('-')[0].toLowerCase();
</script>

<Shell current="grovekeeper">
  <section class="wrap intro">
    <div>
      <p class="eyebrow">Prototype · a small game</p>
      <h1>You're the grovekeeper</h1>
      <p class="lede">
        Grove Bench gives every conversation its own git worktree and branch. Here each worktree is a tree, and its agent
        works on the bench underneath. Hand out tasks, answer agents when they need you, and get their branches to the
        main gate before home time.
      </p>
    </div>
    <ul class="legend" aria-label="What the characters mean">
      <li><Sprite state="working" seed="leg-1" scale={3} label="" /><span><b>Typing</b> working on it</span></li>
      <li><Sprite state="permission" seed="leg-2" scale={3} label="" /><span><b>Amber ?</b> needs you, click it</span></li>
      <li><Sprite state="unread" seed="leg-3" scale={3} label="" /><span><b>Waving</b> finished, review it</span></li>
      <li><Sprite state="sleeping" seed="leg-4" scale={3} label="" /><span><b>Asleep</b> idle too long, click to wake</span></li>
    </ul>
  </section>

  <section class="wrap game" aria-label="Grovekeeper game">
    <div class="hud panel">
      <div class="clock pixel" aria-label="Time {G.clockText(game.clock)}">
        <span class="time">{G.clockText(game.clock)}</span>
        <span class="till">home at 17:00</span>
      </div>
      <ul class="chips" aria-label="Sidebar filters">
        {#each FILTERS as f}
          <li style="--c: {f.color}"><i></i>{f.label} <b>{counts[f.key]}</b></li>
        {/each}
      </ul>
      <div class="stats">
        <span>PRs opened <b>{game.shipped.length}</b></span>
        <span>Kept waiting <b>{G.secondsText(game.waited)}</b></span>
      </div>
      <button type="button" class="btn small ghost" onclick={() => (paused = !paused)} disabled={!started || game.over} aria-pressed={paused}>
        {paused ? 'Resume' : 'Pause'}
      </button>
    </div>

    <div class="col left">
    <aside class="tasks panel paper" aria-labelledby="tasks-h">
      <h2 id="tasks-h" class="pixel">Task board</h2>
      <p class="proj">Project <b>{PROJECT}</b></p>
      <fieldset class="defmode">
        <legend>New conversations start in</legend>
        <div class="seg">
          {#each Object.entries(G.MODES) as [key, m]}
            <label class:on={game.defaultMode === key}>
              <input type="radio" name="defmode" value={key} checked={game.defaultMode === key} onchange={() => G.setDefaultMode(game, key)} />
              {m.label}
            </label>
          {/each}
        </div>
        <p class="modehelp">{G.MODES[game.defaultMode].help}</p>
      </fieldset>
      <ul class="tickets">
        {#each game.board as t (t.ticket)}
          <li class="ticket">
            <span class="tid {ticketTone(t.ticket)}">{t.ticket}</span>
            <span class="ttitle">{t.title}</span>
            <button type="button" class="btn small primary" disabled={!free || game.over} onclick={() => start(t.ticket)}>Start</button>
          </li>
        {/each}
      </ul>
      <p class="note">
        {free ? 'Each one gets a new branch, its own worktree and its own agent.' : 'All four plots are busy. Open a PR to free one.'}
        This demo has room for four. In the app, start as many as you like.
      </p>
    </aside>

    <section class="log panel" aria-labelledby="log-h">
      <h2 id="log-h" class="pixel">What the app just did</h2>
      <ol>
        {#each game.log.slice(0, 7) as entry, i (game.log.length - i)}
          <li><time>{G.clockText(entry.t)}</time>{entry.text}</li>
        {/each}
      </ol>
    </section>
    </div>

    <div class="col right">
    <div class="grove" bind:this={groveEl} style="--sky-top: {skyNow.top}; --sky-low: {skyNow.low}">
      <span class="sun" style="left: calc({sunX}% - 14px); bottom: {62 + Math.sin((sunX / 100) * Math.PI) * 26}%" aria-hidden="true"></span>
      <span class="cloud c1" aria-hidden="true"></span>
      <span class="cloud c2" aria-hidden="true"></span>
      {#if !started}
        <div class="start-hint pixel">Pick a task on the board to plant your first tree</div>
      {/if}
      <div class="plots">
        {#each game.plots as p, i (p?.id ?? `free-${i}`)}
          <Plot {p} {k} selected={!!p && game.selected === p.id} onopen={() => G.open(game, p)} />
        {/each}
      </div>
      <div class="path" aria-hidden="true">
        <span class="trunk"></span>
        <span class="main-label">main</span>
        <span class="gate" class:lit={game.plots.some((p) => p?.phase === 'ship')}>
          <Pixels map={LAMP} scale={3} />
          <span class="arch">main</span>
          <Pixels map={LAMP} scale={3} />
        </span>
      </div>
      {#if game.shipped.length}
        <ul class="shipped" aria-label="Pull requests opened">
          {#each game.shipped as s}
            <li title="{s.branch}: +{s.add} -{s.del}">PR #{s.pr} <span>{s.ticket}</span></li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="thread-slot">
      <Thread
        p={selected}
        onanswer={(c) => G.answer(game, selected, c)}
        onmode={(m) => G.setMode(game, selected, m)}
        onfollow={() => G.followUp(game, selected)}
        onrewind={() => G.rewindAll(game, selected)}
        onship={() => G.ship(game, selected)}
      />
    </div>
    </div>

    {#if game.over}
      <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="over-h">
        <div class="panel paper over">
          <h2 id="over-h" class="pixel">Home time</h2>
          <dl>
            <div><dt>PRs opened</dt><dd>{game.shipped.length}</dd></div>
            <div><dt>Requests answered</dt><dd>{game.answered}</dd></div>
            <div><dt>Agents kept waiting</dt><dd>{G.secondsText(game.waited)}</dd></div>
            <div><dt>Longest wait</dt><dd>{G.secondsText(game.longestWait)}</dd></div>
          </dl>
          <p>
            {game.shipped.length >= 4
              ? 'A busy grove. Every branch was built in its own worktree, so nobody tripped over anyone else.'
              : busy
                ? 'Unfinished branches keep their worktrees overnight. Tomorrow they pick up where they left off.'
                : 'Each task got its own tree, branch and agent. That is the whole idea.'}
          </p>
          <button type="button" class="btn primary" onclick={restart}>Play again</button>
        </div>
      </div>
    {/if}
  </section>
</Shell>

<style>
  .intro {
    display: grid;
    gap: 24px;
    padding-block: 40px 24px;
    align-items: end;
  }
  @media (min-width: 960px) {
    .intro {
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    }
  }
  h1 {
    margin-top: 8px;
    font-family: var(--font-pixel);
    font-size: clamp(34px, 2.6vw + 22px, 54px);
    color: #f6f7fb;
  }
  .lede {
    margin-top: 14px;
    max-width: 62ch;
    color: #c7cfe0;
  }
  .legend {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 18px;
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--muted);
  }
  .legend b {
    display: block;
    color: #eef1f8;
  }

  /* Two columns on wide screens: tasks and the log on the left, the grove and
     the open conversation on the right. One column on narrow ones, with the
     grove first. */
  .game {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .col {
    display: contents;
  }
  .hud {
    order: 0;
  }
  .grove {
    order: 1;
  }
  .thread-slot {
    order: 2;
  }
  .tasks {
    order: 3;
  }
  .log {
    order: 4;
  }
  @media (min-width: 1000px) {
    .game {
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
      align-items: start;
    }
    .hud {
      grid-column: 1 / -1;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: 22px;
      min-width: 0;
    }
  }
  .hud {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 28px;
    padding: 12px 18px;
  }
  .clock {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .time {
    font-size: 30px;
    color: #f6f7fb;
    font-variant-numeric: tabular-nums;
  }
  .till {
    font-size: 14px;
    color: var(--muted);
  }
  .chips {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chips li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    font-size: 12px;
    color: #dfe4ef;
    border: 1px solid color-mix(in oklch, var(--c) 55%, transparent);
    background: color-mix(in oklch, var(--c) 12%, transparent);
  }
  .chips i {
    width: 8px;
    height: 8px;
    background: var(--c);
  }
  .chips b {
    font-variant-numeric: tabular-nums;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 20px;
    margin-left: auto;
    font-size: 13px;
    color: var(--muted);
  }
  .stats b {
    color: #f3f5fa;
    font-variant-numeric: tabular-nums;
  }

  .tasks h2 {
    font-size: 22px;
  }
  .proj {
    margin-top: 2px;
    font-size: 13px;
    color: var(--paper-muted);
  }
  .defmode {
    margin-top: 14px;
    border: 0;
  }
  .defmode legend {
    font-size: 12px;
    font-weight: 700;
    color: var(--paper-muted);
  }
  .seg {
    display: flex;
    margin-top: 6px;
    box-shadow: 0 0 0 2px var(--bark);
  }
  .seg label {
    flex: 1;
    padding: 5px 0;
    font-size: 13px;
    font-weight: 700;
    text-align: center;
    cursor: pointer;
    color: var(--paper-ink);
  }
  .seg label + label {
    border-left: 2px solid var(--bark);
  }
  .seg label.on {
    color: var(--cream);
    background: #2b3a55;
  }
  .seg label:focus-within {
    outline: 2px dashed #2b3a55;
    outline-offset: 2px;
  }
  .seg input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .modehelp {
    margin-top: 8px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--paper-muted);
  }
  .tickets {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 16px;
  }
  .ticket {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'id btn' 'title btn';
    gap: 2px 10px;
    align-items: center;
    padding: 8px 10px;
    background: #fffaf0;
    box-shadow: 0 0 0 1px rgb(58 42 28 / 0.25);
  }
  .tid {
    grid-area: id;
    justify-self: start;
    padding: 0 5px;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    background: #4a5a78;
  }
  .tid.bug {
    background: #a23b2a;
  }
  .tid.ui {
    background: #6c4aa0;
  }
  .tid.doc {
    background: #3f7a4a;
  }
  .tid.perf {
    background: #a06a10;
  }
  .ttitle {
    grid-area: title;
    font-size: 13px;
    line-height: 1.35;
    color: var(--paper-ink);
  }
  .ticket .btn {
    grid-area: btn;
  }
  .note {
    margin-top: 14px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--paper-muted);
  }

  .grove {
    position: relative;
    overflow: hidden;
    padding: 64px 16px 0;
    background: linear-gradient(180deg, var(--sky-top), var(--sky-low) 78%);
    box-shadow:
      0 -3px 0 0 var(--ink),
      0 3px 0 0 var(--ink),
      -3px 0 0 0 var(--ink),
      3px 0 0 0 var(--ink),
      0 9px 0 0 rgb(0 0 0 / 0.28);
  }
  .sun {
    position: absolute;
    width: 28px;
    height: 28px;
    background: #ffe7a8;
    box-shadow:
      0 0 0 4px rgb(255 231 168 / 0.45),
      0 0 0 8px rgb(255 231 168 / 0.2);
  }
  .cloud {
    position: absolute;
    height: 12px;
    background: rgb(255 255 255 / 0.75);
    box-shadow:
      12px -8px 0 0 rgb(255 255 255 / 0.75),
      24px 0 0 0 rgb(255 255 255 / 0.75);
    animation: drift 60s linear infinite;
  }
  .c1 {
    top: 26px;
    left: 10%;
    width: 40px;
  }
  .c2 {
    top: 54px;
    left: 62%;
    width: 30px;
    animation-duration: 80s;
  }
  @keyframes drift {
    to {
      transform: translateX(260px);
    }
  }
  .start-hint {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 12px;
    font-size: 16px;
    white-space: nowrap;
    color: var(--paper-ink);
    background: rgb(244 236 221 / 0.92);
    box-shadow: 0 0 0 2px var(--bark);
    z-index: 3;
  }
  @media (max-width: 520px) {
    .start-hint {
      white-space: normal;
      width: 80%;
      text-align: center;
      font-size: 14px;
    }
  }
  .plots {
    position: relative;
    isolation: isolate;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    padding-bottom: 14px;
  }
  @media (max-width: 560px) {
    .plots {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      row-gap: 22px;
    }
  }
  /* Grass behind the plots' ground line. */
  .plots::before {
    content: '';
    position: absolute;
    inset: auto -16px 0;
    height: 64px;
    background: linear-gradient(180deg, #4aaa58 0 6px, #3a9a48 6px);
    z-index: -1;
  }
  @media (max-width: 560px) {
    .plots::before {
      display: none;
    }
    .plots :global(.plot) {
      background: linear-gradient(180deg, transparent 0 calc(100% - 52px), #3a9a48 calc(100% - 52px));
    }
  }
  .path {
    position: relative;
    display: flex;
    align-items: center;
    height: 54px;
    margin-inline: -16px;
    padding-inline: 16px;
    background: #3a9a48;
  }
  .trunk {
    position: absolute;
    left: 0;
    right: 0;
    top: 22px;
    height: 10px;
    background: #8a6a4a;
    box-shadow:
      0 3px 0 #6a5040,
      0 -2px 0 #a07e5a;
  }
  .main-label {
    position: relative;
    padding: 0 6px;
    font-family: var(--font-pixel);
    font-size: 14px;
    color: var(--cream);
    background: #6a5040;
  }
  .gate {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 4px;
    margin-left: auto;
  }
  .arch {
    margin-bottom: 14px;
    padding: 2px 8px;
    font-family: var(--font-pixel);
    font-size: 14px;
    color: var(--cream);
    background: #2d2016;
    box-shadow: 0 0 0 2px #5a4130;
  }
  .gate.lit .arch {
    color: #12361a;
    background: var(--green);
  }
  .shipped {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 0 12px;
    margin-inline: -16px;
    padding-inline: 16px;
    background: #2f7d3b;
  }
  .shipped li {
    padding: 2px 8px;
    font-size: 12px;
    font-weight: 700;
    color: #12361a;
    background: #bff0c4;
  }
  .shipped span {
    font-weight: 400;
  }

  .thread-slot {
    min-width: 0;
  }

  .log h2 {
    font-size: 18px;
    color: #f3f5fa;
  }
  .log ol {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
    font-size: 12px;
    line-height: 1.5;
    color: #c7cfe0;
  }
  .log li {
    overflow-wrap: anywhere;
  }
  .log time {
    margin-right: 8px;
    color: var(--leaf-1);
    font-variant-numeric: tabular-nums;
  }

  .overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(8 12 24 / 0.55);
  }
  .over {
    width: min(440px, 100%);
    display: grid;
    gap: 14px;
  }
  .over h2 {
    font-size: 30px;
  }
  .over dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .over dt {
    font-size: 12px;
    color: var(--paper-muted);
  }
  .over dd {
    font-family: var(--font-pixel);
    font-size: 26px;
    font-variant-numeric: tabular-nums;
  }
  .over p {
    font-size: 14px;
    color: var(--paper-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .cloud {
      animation: none;
    }
  }
</style>
