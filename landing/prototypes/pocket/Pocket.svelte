<script>
  import Shell from '../shared/Shell.svelte';
  import Sprite from '../shared/Sprite.svelte';
  import GroveScene from '../shared/GroveScene.svelte';
  import GroveWalk from '../shared/GroveWalk.svelte';
  import ContextStrip from '../shared/ContextStrip.svelte';
  import { stateColor, stateLabel, FILTERS } from '../shared/colors.js';
  import { treeGreens } from '../../src/lib/brand.js';
  import { animationLoop } from '../../src/lib/motion.js';
  import * as P from './sim.js';

  let g = $state(P.createPocket());
  let deviceEl = $state();
  let shaking = $state(false);
  let pressed = $state(null);

  const c = $derived(P.viewing(g));
  const n = $derived(P.counts(g));
  const hint = $derived(P.hints(g));
  const pages = $derived(g.convs.length + (g.convs.length < P.MAX ? 1 : 0));

  $effect(() => {
    if (!deviceEl) return;
    return animationLoop(deviceEl, (dt) => P.tick(g, dt));
  });

  // A buzz when a conversation you're not looking at needs you or finishes.
  let lastBuzz = 0;
  $effect(() => {
    if (g.buzz === lastBuzz) return;
    lastBuzz = g.buzz;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    shaking = true;
    const t = setTimeout(() => (shaking = false), 420);
    return () => clearTimeout(t);
  });

  function press(btn) {
    pressed = btn;
    setTimeout(() => (pressed = pressed === btn ? null : pressed), 140);
    if (btn === 'left' || btn === 'up') P.move(g, -1);
    else if (btn === 'right' || btn === 'down') P.move(g, 1);
    else if (btn === 'a') P.primary(g);
    else if (btn === 'b') P.secondary(g);
    else if (btn === 'start') P.start(g);
    else if (btn === 'select') P.compact(g);
  }

  const KEYS = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    Enter: 'a',
    z: 'a',
    a: 'a',
    x: 'b',
    b: 'b',
    Backspace: 'b',
    s: 'start',
    c: 'select',
  };
  function onkey(e) {
    const btn = KEYS[e.key];
    if (!btn || e.ctrlKey || e.metaKey || e.altKey) return;
    // Enter on a focused button clicks it already.
    if (e.key === 'Enter' && e.target !== deviceEl) return;
    e.preventDefault();
    press(btn);
  }

  const shortLine = (s) => (s.length > 34 ? s.slice(0, 33) + '…' : s);
</script>

<Shell current="pocket">
  <section class="wrap intro">
    <p class="eyebrow">Prototype · a handheld you can play</p>
    <h1>Pocket grove</h1>
    <p class="lede">
      Your conversations, in your pocket. Each one is a little agent that works, asks, waves when it’s done and nods off
      when you leave it alone, just like in Grove Bench’s sidebar. Look after them with the buttons, or your keyboard.
    </p>
  </section>

  <section class="wrap play">
    <div class="device-wrap">
      <!-- A keyboard-driven widget, so role="application" with its own keys.
           Every key also has an on-device button. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="device"
        class:shake={shaking}
        bind:this={deviceEl}
        tabindex="0"
        role="application"
        aria-label="Pocket grove. Left and right switch conversation, Enter is A, Backspace is B, S is Start, C is Select."
        onkeydown={onkey}
      >
        <div class="top">
          <span class="led amber" class:on={n.needs > 0} title="Needs you"></span>
          <span class="led green" class:on={n.unread > 0} title="Unread"></span>
          <span class="model pixel">GROVE POCKET</span>
        </div>

        <div class="bezel">
          <div class="screen">
            <div class="srow">
              {#each FILTERS as f}
                <span class="chip" style="--c: {f.color}" title={f.label}><i></i>{n[f.key]}</span>
              {/each}
              <span class="clock">{P.clockText(g.clock)}</span>
            </div>

            {#if c}
              <div class="title">
                <Sprite state={c.scene === 'wake' ? 'starting' : c.state} seed={c.id} scale={2} label="" />
                <b>{c.branch}</b>
                <em style="color: {stateColor(c.scene === 'wake' ? 'starting' : c.state)}">{c.scene === 'wake' ? 'Waking up' : stateLabel(c.state)}</em>
              </div>
              <div class="scene">
                {#if c.scene}
                  {#key c.run}
                    <GroveWalk mode={c.scene} run={c.run} seed={c.id} scale={2} />
                  {/key}
                {:else}
                  <GroveScene state={c.state} seed={c.id} scale={4} />
                {/if}
              </div>
              {#if c.state === 'permission' && !c.scene}
                <div class="ask">
                  <p>Wants to run <code>{c.ask}</code></p>
                  <p class="ab"><span class="ka">A</span> Allow <span class="kb">B</span> Deny</p>
                </div>
              {:else}
                <p class="line">{c.scene === 'arrive' ? 'Starting agent...' : c.scene === 'wake' ? 'Waking up...' : shortLine(c.line)}</p>
              {/if}
              <div class="ctx">
                <ContextStrip seed={c.id} percent={c.context} width={96} scale={3} />
                <span>{c.context}%</span>
              </div>
            {:else}
              <div class="title"><b>New conversation</b></div>
              <div class="scene"><GroveScene scale={4} /></div>
              <p class="line">Press A or START. You’ll get a new branch, a worktree and an agent.</p>
              <div class="ctx empty"></div>
            {/if}

            <div class="dots" aria-hidden="true">
              {#each g.convs as cv, i}
                <i class:cur={i === g.cur} style="background: {stateColor(cv.scene === 'wake' ? 'starting' : cv.state)}"></i>
              {/each}
              {#if g.convs.length < P.MAX}<i class="plus" class:cur={g.cur === g.convs.length}>+</i>{/if}
            </div>
            <div class="hints">
              {#if hint.a}<span><b>A</b> {hint.a}</span>{/if}
              {#if hint.b}<span><b>B</b> {hint.b}</span>{/if}
              {#if c && (c.state === 'ready' || c.state === 'unread') && c.context >= 15}<span><b>SEL</b> /compact</span>{/if}
            </div>

            {#if g.toast}
              <div class="toast" role="status">{g.toast.text}</div>
            {/if}
          </div>
        </div>

        <div class="brand">
          <svg width="12" height="14" viewBox="0 0 21 24" aria-hidden="true">
            {#each treeGreens as p}<rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />{/each}
          </svg>
          <span class="pixel">Grove Bench</span>
        </div>

        <div class="controls">
          <div class="dpad">
            <button type="button" class="up" class:down={pressed === 'up'} aria-label="Previous conversation" onclick={() => press('up')}></button>
            <button type="button" class="left" class:down={pressed === 'left'} aria-label="Previous conversation" onclick={() => press('left')}></button>
            <span class="mid"></span>
            <button type="button" class="right" class:down={pressed === 'right'} aria-label="Next conversation" onclick={() => press('right')}></button>
            <button type="button" class="dn" class:down={pressed === 'down'} aria-label="Next conversation" onclick={() => press('down')}></button>
          </div>
          <div class="abtns">
            <button type="button" class="round b" class:down={pressed === 'b'} onclick={() => press('b')} aria-label="B: {hint.b ?? 'nothing to do'}">B</button>
            <button type="button" class="round a" class:down={pressed === 'a'} onclick={() => press('a')} aria-label="A: {hint.a ?? 'nothing to do'}">A</button>
          </div>
        </div>
        <div class="pills">
          <button type="button" class:down={pressed === 'select'} onclick={() => press('select')}><span></span>SELECT</button>
          <button type="button" class:down={pressed === 'start'} onclick={() => press('start')}><span></span>START</button>
        </div>
        <div class="grille" aria-hidden="true">{#each Array(6) as _}<i></i>{/each}</div>
      </div>
      <p class="keys">Keys: <kbd>◀</kbd> <kbd>▶</kbd> switch · <kbd>Enter</kbd> A · <kbd>Backspace</kbd> B · <kbd>S</kbd> start · <kbd>C</kbd> select. Click the device first.</p>
    </div>

    <div class="side">
      <div class="panel">
        <h2 class="pixel">What’s on the screen</h2>
        <dl class="map">
          <div><dt>Top row</dt><dd>The sidebar’s filter chips: <b class="amber">Needs you</b>, <b class="blue">Working</b>, <b class="green">Unread</b>. A colour always means the same thing.</dd></div>
          <div><dt>Lights</dt><dd>Amber when someone needs you, green when someone finished. The device buzzes, the way the app sends a desktop notification while its window is in the background.</dd></div>
          <div><dt>Dots</dt><dd>One per open conversation, like the collapsed sidebar rail.</dd></div>
          <div><dt>Grass strip</dt><dd>The context grove. It fills as the conversation uses its context window. SELECT runs <code>/compact</code> and it thins out.</dd></div>
          <div><dt>Naps</dt><dd>Leave one alone and it falls asleep. Here it takes {P.SLEEP_S} seconds; in the app, 30 minutes by default. A wakes it on its bench.</dd></div>
        </dl>
      </div>
      <div class="panel log">
        <h2 class="pixel">What the app would do</h2>
        <ol>
          {#each g.log.slice(0, 6) as e, i (g.log.length - i)}
            <li>{e.text}</li>
          {/each}
        </ol>
      </div>
    </div>
  </section>
</Shell>

<style>
  .intro {
    padding-block: 40px 16px;
  }
  h1 {
    margin-top: 8px;
    font-family: var(--font-pixel);
    font-size: clamp(36px, 3vw + 22px, 62px);
    color: #f6f7fb;
  }
  .lede {
    margin-top: 14px;
    max-width: 64ch;
    color: #c7cfe0;
  }
  .play {
    display: grid;
    gap: 36px;
    align-items: start;
    padding-top: 20px;
  }
  @media (min-width: 980px) {
    .play {
      grid-template-columns: auto minmax(0, 1fr);
    }
  }
  .device-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }

  /* The handheld: cream plastic, stepped pixel corners. */
  .device {
    --shell: #efe4cf;
    --shell-lo: #d8c9ac;
    position: relative;
    width: 380px;
    padding: 18px 22px 26px;
    background: linear-gradient(180deg, var(--shell), var(--shell-lo));
    clip-path: polygon(
      12px 0, calc(100% - 12px) 0, calc(100% - 12px) 4px, calc(100% - 4px) 4px, calc(100% - 4px) 12px, 100% 12px,
      100% calc(100% - 40px), calc(100% - 8px) calc(100% - 40px), calc(100% - 8px) calc(100% - 20px), calc(100% - 20px) calc(100% - 20px), calc(100% - 20px) calc(100% - 8px), calc(100% - 40px) calc(100% - 8px), calc(100% - 40px) 100%,
      12px 100%, 12px calc(100% - 4px), 4px calc(100% - 4px), 4px calc(100% - 12px), 0 calc(100% - 12px),
      0 12px, 4px 12px, 4px 4px, 12px 4px
    );
    box-shadow: inset 0 -6px 0 rgb(0 0 0 / 0.08);
    outline: none;
  }
  .device:focus-visible {
    box-shadow:
      inset 0 0 0 3px var(--primary),
      inset 0 -6px 0 rgb(0 0 0 / 0.08);
  }
  @media (max-width: 420px) {
    .device {
      zoom: 0.88;
    }
  }
  .shake {
    animation: shake 0.42s steps(6);
  }
  @keyframes shake {
    25% {
      transform: translateX(-3px) rotate(-0.6deg);
    }
    50% {
      transform: translateX(3px) rotate(0.6deg);
    }
    75% {
      transform: translateX(-2px);
    }
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .led {
    width: 9px;
    height: 9px;
    background: #8f8676;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.25);
  }
  .led.amber.on {
    background: var(--amber);
    box-shadow: 0 0 8px var(--amber);
    animation: blink 1s steps(2) infinite;
  }
  .led.green.on {
    background: var(--green);
    box-shadow: 0 0 8px var(--green);
  }
  @keyframes blink {
    50% {
      opacity: 0.35;
    }
  }
  .model {
    margin-left: auto;
    font-size: 12px;
    letter-spacing: 0.12em;
    color: #8a7a5f;
  }
  .bezel {
    padding: 14px 14px 16px;
    background: #2b3a55;
    box-shadow: inset 0 3px 0 rgb(0 0 0 / 0.25);
  }
  .screen {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 346px;
    padding: 8px 10px;
    overflow: hidden;
    background: oklch(0.208 0 0);
    color: oklch(0.835 0 0);
    font-size: 12px;
    box-shadow: inset 0 0 0 2px #0b1224;
  }
  .srow {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 5px;
    font-size: 11px;
    border: 1px solid color-mix(in oklch, var(--c) 50%, transparent);
  }
  .chip i {
    width: 6px;
    height: 6px;
    background: var(--c);
  }
  .clock {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: oklch(0.6 0 0);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 22px;
  }
  .title b {
    color: #f3f5fa;
  }
  .title em {
    margin-left: auto;
    font-style: normal;
    font-size: 11px;
    font-weight: 700;
  }
  .scene {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    height: 124px;
    background: linear-gradient(180deg, #0f1730, #16203d);
  }
  .ask {
    min-height: 34px;
    padding: 5px 8px;
    font-family: var(--font-pixel);
    font-size: 13px;
    color: var(--paper-ink);
    background: var(--cream);
    box-shadow:
      0 0 0 2px var(--bark),
      0 4px 0 2px rgb(0 0 0 / 0.3);
  }
  .ask code {
    color: #5b3a0a;
    background: rgb(90 60 20 / 0.12);
  }
  .ask .ab {
    margin-top: 2px;
  }
  .ask .ab span {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    margin-left: 4px;
    font-size: 11px;
    color: #fff;
    background: #2f7d3b;
  }
  .ask .ab .kb {
    background: #6a5040;
  }
  .line {
    min-height: 34px;
    line-height: 1.4;
    color: oklch(0.75 0 0);
  }
  .ctx {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    min-height: 24px;
    border-bottom: 1px solid oklch(0.3 0 0);
  }
  .ctx span {
    margin-left: auto;
    font-size: 11px;
    color: oklch(0.6 0 0);
  }
  .dots {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-top: 2px;
  }
  .dots i {
    display: grid;
    place-items: center;
    width: 8px;
    height: 8px;
    font-style: normal;
    font-size: 10px;
    line-height: 1;
  }
  .dots i.cur {
    box-shadow:
      0 0 0 2px oklch(0.208 0 0),
      0 0 0 3px #fff;
  }
  .dots .plus {
    color: oklch(0.7 0 0);
  }
  .hints {
    display: flex;
    justify-content: center;
    gap: 14px;
    min-height: 18px;
    font-size: 11px;
    color: oklch(0.7 0 0);
  }
  .hints b {
    padding: 0 4px;
    color: #0b1224;
    background: oklch(0.8 0 0);
  }
  .toast {
    position: absolute;
    top: 30px;
    left: 10px;
    right: 10px;
    padding: 6px 8px;
    font-size: 12px;
    font-weight: 700;
    color: #0b1224;
    background: var(--gold);
    box-shadow: 0 0 0 2px #0b1224;
    animation: drop 0.2s steps(3);
  }
  @keyframes drop {
    from {
      transform: translateY(-12px);
      opacity: 0;
    }
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 10px 0 14px;
    font-size: 14px;
    color: #5a4a35;
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .dpad {
    display: grid;
    grid-template-columns: repeat(3, 34px);
    grid-template-rows: repeat(3, 34px);
  }
  .dpad button,
  .dpad .mid {
    background: #2a2a2a;
    border: 0;
    box-shadow: inset 0 -4px 0 rgb(0 0 0 / 0.4);
    cursor: pointer;
  }
  .dpad .up {
    grid-area: 1 / 2;
  }
  .dpad .left {
    grid-area: 2 / 1;
  }
  .dpad .mid {
    grid-area: 2 / 2;
    cursor: default;
  }
  .dpad .right {
    grid-area: 2 / 3;
  }
  .dpad .dn {
    grid-area: 3 / 2;
  }
  .abtns {
    display: flex;
    gap: 14px;
    transform: rotate(-18deg);
  }
  .round {
    width: 48px;
    height: 48px;
    font-family: var(--font-pixel);
    font-size: 18px;
    font-weight: 700;
    color: #f4ecdd;
    border: 0;
    cursor: pointer;
    clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%);
    box-shadow: inset 0 -5px 0 rgb(0 0 0 / 0.35);
  }
  .round.a {
    background: #3a9a48;
    margin-top: -18px;
  }
  .round.b {
    background: #8a6a4a;
  }
  .down {
    transform: translateY(2px);
    filter: brightness(0.85);
  }
  .round.a.down {
    transform: translateY(2px);
  }
  .pills {
    display: flex;
    justify-content: center;
    gap: 22px;
    margin-top: 18px;
  }
  .pills button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: #8a7a5f;
    background: none;
    border: 0;
    cursor: pointer;
  }
  .pills span {
    width: 40px;
    height: 10px;
    background: #8f8676;
    box-shadow: inset 0 -3px 0 rgb(0 0 0 / 0.25);
  }
  .grille {
    position: absolute;
    right: 34px;
    bottom: 34px;
    display: flex;
    gap: 5px;
    transform: rotate(-28deg);
  }
  .grille i {
    width: 4px;
    height: 26px;
    background: rgb(90 74 53 / 0.35);
  }
  .keys {
    max-width: 380px;
    font-size: 12px;
    color: var(--muted);
    text-align: center;
  }
  kbd {
    padding: 0 4px;
    font-family: inherit;
    font-size: 11px;
    color: #eef1f8;
    background: rgb(255 255 255 / 0.08);
    box-shadow: inset 0 -1px 0 rgb(255 255 255 / 0.2);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-width: 0;
  }
  .side h2 {
    font-size: 20px;
    color: #f3f5fa;
  }
  .map {
    display: grid;
    gap: 12px;
    margin-top: 14px;
  }
  .map div {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 12px;
  }
  .map dt {
    font-family: var(--font-pixel);
    font-size: 14px;
    color: var(--leaf-1);
  }
  .map dd {
    font-size: 13px;
    line-height: 1.55;
    color: #c7cfe0;
  }
  .amber {
    color: var(--amber);
  }
  .blue {
    color: oklch(0.707 0.165 254.624);
  }
  .green {
    color: var(--green);
  }
  .log ol {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
    font-size: 13px;
    line-height: 1.5;
    color: #c7cfe0;
  }
  .log li:first-child {
    color: #fff;
  }
  @media (prefers-reduced-motion: reduce) {
    .shake,
    .led.amber.on,
    .toast {
      animation: none;
    }
  }
</style>
