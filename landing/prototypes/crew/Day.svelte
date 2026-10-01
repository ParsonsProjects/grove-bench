<script>
  import Sprite from '../shared/Sprite.svelte';
  import GroveScene from '../shared/GroveScene.svelte';
  import GroveWalk from '../shared/GroveWalk.svelte';
  import ContextStrip from '../shared/ContextStrip.svelte';
  import { stateColor, stateLabel, filterFor, FILTERS } from '../shared/colors.js';
  import { DAY, BRANCH } from './day.js';

  /**
   * One conversation through a working day, scrubbed on a timeline: the
   * sidebar row and filter counts, the main area, the prompt character and
   * the context grove, all as the app would show them.
   *
   * @type {{ seed: string, look: Record<string, string>, projectColor: string, modelLabel: string, modeLabel: string, modeColor: string }}
   */
  let { seed, look, projectColor, modelLabel, modeLabel, modeColor } = $props();

  let i = $state(0);
  let playing = $state(false);
  let run = $state(0);
  const ev = $derived(DAY[i]);
  const others = [
    { branch: 'fix/login-bug', state: 'ready', row: 'Fixed. 5 tests passed.', seed: 'e52b9a73' },
    { branch: 'docs/readme', state: 'sleeping', row: 'The README covers the new endpoints.', seed: '9b0e27f5' },
  ];
  const counts = $derived.by(() => {
    const c = { needs: 0, working: 0, unread: 0 };
    for (const s of [ev.state, ...others.map((o) => o.state)]) {
      const f = filterFor(s);
      if (f) c[f]++;
    }
    return c;
  });

  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const START = toMin('09:00');
  const END = toMin('18:00');
  const pos = (t) => ((toMin(t) - START) / (END - START)) * 100;

  function go(n) {
    i = (n + DAY.length) % DAY.length;
    run += 1;
  }

  $effect(() => {
    if (!playing) return;
    const hold = ev.scene ? 4600 : 3200;
    const t = setTimeout(() => {
      if (i === DAY.length - 1) playing = false;
      else go(i + 1);
    }, hold);
    return () => clearTimeout(t);
  });
</script>

<section class="day" aria-labelledby="day-h">
  <div class="head">
    <div>
      <h2 id="day-h" class="pixel">A day in the grove</h2>
      <p class="sub">Your agent, from the first message to home time. Press play, or click any moment on the timeline.</p>
    </div>
    <div class="ctl">
      <button type="button" class="btn small ghost" onclick={() => go(i - 1)} aria-label="Previous moment">◀</button>
      <button type="button" class="btn small primary" onclick={() => (playing = !playing)} aria-pressed={playing}>{playing ? 'Pause' : 'Play'}</button>
      <button type="button" class="btn small ghost" onclick={() => go(i + 1)} aria-label="Next moment">▶</button>
    </div>
  </div>

  <div class="timeline" role="group" aria-label="Timeline">
    <div class="track" aria-hidden="true">
      {#each DAY as e, n}
        {@const next = DAY[n + 1]?.at ?? '18:00'}
        <span class="seg" style="left: {pos(e.at)}%; width: {pos(next) - pos(e.at)}%; background: {stateColor(e.state)}"></span>
      {/each}
    </div>
    {#each DAY as e, n}
      <button
        type="button"
        class="tick"
        class:on={n === i}
        style="left: {pos(e.at)}%; --c: {stateColor(e.state)}"
        aria-label="{e.at}: {e.title}"
        aria-current={n === i ? 'step' : undefined}
        onclick={() => go(n)}
      ></button>
    {/each}
    <div class="hours" aria-hidden="true">
      {#each ['09:00', '11:00', '13:00', '15:00', '17:00'] as h}
        <span style="left: {pos(h)}%">{h}</span>
      {/each}
    </div>
  </div>

  <div class="app">
    <aside class="side" aria-label="Sidebar">
      <p class="side-h">Conversations</p>
      <ul class="chips">
        {#each FILTERS as f}
          <li style="--c: {f.color}"><i></i>{f.label} {counts[f.key]}</li>
        {/each}
      </ul>
      <ul class="rows">
        <li class="row on">
          <Sprite state={ev.state} {seed} {look} {projectColor} scale={2} />
          <span><b>{BRANCH}</b><small>{ev.row}</small></span>
        </li>
        {#each others as o}
          <li class="row">
            <Sprite state={o.state} seed={o.seed} {projectColor} scale={2} />
            <span><b>{o.branch}</b><small>{o.row}</small></span>
          </li>
        {/each}
      </ul>
    </aside>

    <div class="main">
      <div class="scene">
        {#key run}
          {#if ev.scene === 'arrive'}
            <GroveWalk mode="arrive" {seed} {look} scale={4} />
          {:else if ev.scene === 'wake'}
            <GroveWalk mode="wake" wakeFrom="sleeping" {seed} {look} scale={4} />
          {:else}
            <GroveScene state={ev.state} {seed} {look} scale={5} />
          {/if}
        {/key}
      </div>
      {#if ev.prompt}
        <div class="prompt" class:question={ev.prompt === 'asking' || ev.prompt === 'answered'}>
          <Sprite state={ev.prompt} {seed} {look} scale={3} />
          <span>
            <b>{ev.prompt === 'asking' || ev.prompt === 'answered' ? 'Question' : 'Permission'}</b>
            {ev.prompt === 'asking' || ev.prompt === 'answered' ? 'Which date format should profiles use?' : 'Bash npm install zod'}
          </span>
          <em>{stateLabel(ev.prompt)}</em>
        </div>
      {/if}
      <div class="status">
        <ContextStrip seed={`${seed}-day`} percent={ev.context} width={200} scale={3} />
        <div class="bar">
          <span class="agentctl"><b>Claude</b><span>{modelLabel} · <i style="color: {modeColor}">{modeLabel}</i></span></span>
          <span class="pct">Context {ev.context}%</span>
        </div>
      </div>
    </div>
  </div>

  <div class="caption panel paper" aria-live="polite">
    <time class="pixel">{ev.at}</time>
    <div>
      <h3>{ev.title}</h3>
      <p>{ev.text}</p>
    </div>
  </div>
</section>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 14px;
  }
  h2 {
    font-size: 30px;
    color: #f6f7fb;
  }
  .sub {
    margin-top: 8px;
    font-size: 14px;
    color: var(--muted);
  }
  .ctl {
    display: flex;
    gap: 8px;
  }
  .timeline {
    position: relative;
    height: 58px;
    margin: 26px 10px 0;
  }
  .track {
    position: absolute;
    left: 0;
    right: 0;
    top: 10px;
    height: 10px;
    background: rgb(255 255 255 / 0.06);
  }
  .seg {
    position: absolute;
    top: 0;
    height: 100%;
    opacity: 0.75;
  }
  .tick {
    position: absolute;
    top: 3px;
    width: 14px;
    height: 24px;
    margin-left: -7px;
    padding: 0;
    background: var(--c);
    border: 0;
    box-shadow: 0 0 0 2px #0b1224;
    cursor: pointer;
  }
  .tick:hover {
    transform: translateY(-2px);
  }
  .tick.on {
    box-shadow:
      0 0 0 2px #0b1224,
      0 0 0 4px var(--gold);
    transform: translateY(-3px);
  }
  .hours span {
    position: absolute;
    top: 36px;
    transform: translateX(-50%);
    font-size: 11px;
    color: var(--faint);
  }

  .app {
    display: grid;
    margin-top: 10px;
    background: oklch(0.208 0 0);
    box-shadow:
      0 0 0 3px var(--ink),
      0 9px 0 0 rgb(0 0 0 / 0.28);
  }
  @media (min-width: 820px) {
    .app {
      grid-template-columns: 280px minmax(0, 1fr);
    }
  }
  .side {
    padding: 14px;
    background: oklch(0.176 0 0);
    border-right: 1px solid oklch(0.26 0 0);
  }
  .side-h {
    font-size: 12px;
    font-weight: 700;
    color: oklch(0.835 0 0);
  }
  .chips {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .chips li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 7px;
    font-size: 11px;
    color: oklch(0.835 0 0);
    border: 1px solid color-mix(in oklch, var(--c) 45%, transparent);
  }
  .chips i {
    width: 6px;
    height: 6px;
    background: var(--c);
  }
  .rows {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
  }
  .row.on {
    background: oklch(0.31 0.065 245);
  }
  .row span {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .row b {
    font-size: 12px;
    color: oklch(0.9 0 0);
  }
  .row small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: oklch(0.6 0 0);
  }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .scene {
    display: grid;
    place-items: center;
    min-height: 220px;
    padding: 24px 12px 10px;
    overflow: hidden;
  }
  .prompt {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 16px 12px;
    padding: 10px 12px;
    font-size: 12px;
    color: oklch(0.85 0 0);
    background: rgb(245 158 11 / 0.08);
    box-shadow: inset 0 0 0 1px rgb(245 158 11 / 0.4);
  }
  .prompt.question {
    background: rgb(34 211 238 / 0.07);
    box-shadow: inset 0 0 0 1px rgb(34 211 238 / 0.4);
  }
  .prompt span {
    flex: 1;
    min-width: 0;
  }
  .prompt b {
    display: block;
  }
  .prompt em {
    font-style: normal;
    font-size: 11px;
    color: var(--muted);
  }
  .status {
    margin-top: auto;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 12px;
    font-size: 12px;
    background: oklch(0.176 0 0);
    border-top: 1px solid oklch(0.26 0 0);
  }
  .agentctl {
    display: flex;
    flex-direction: column;
    line-height: 1.3;
    color: oklch(0.835 0 0);
  }
  .agentctl > span {
    color: oklch(0.6 0 0);
  }
  .agentctl i {
    font-style: normal;
    font-weight: 700;
  }
  .pct {
    color: oklch(0.6 0 0);
    font-variant-numeric: tabular-nums;
  }
  .caption {
    display: flex;
    gap: 18px;
    align-items: flex-start;
    margin-top: 22px;
  }
  .caption time {
    font-size: 26px;
    line-height: 1;
    color: var(--bark);
    font-variant-numeric: tabular-nums;
  }
  .caption h3 {
    font-size: 18px;
  }
  .caption p {
    margin-top: 4px;
    font-size: 14px;
    color: var(--paper-muted);
  }
</style>
