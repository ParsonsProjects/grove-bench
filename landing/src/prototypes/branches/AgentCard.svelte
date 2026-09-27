<script>
  import { animationLoop } from '../shared/motion.js';
  import { statusColors } from '../shared/brand.js';
  import { lanes, laneStyle } from './lanes.js';

  /**
   * A compact live conversation. The log is always full: each new tool call
   * types out at the bottom and pushes the oldest line off the top, like a
   * terminal. Loops while on screen; reduced motion shows a still log.
   *
   * @type {{ agent: any, reduced?: boolean, index?: number }}
   */
  let { agent, reduced = false, index = 0 } = $props();

  const CPS = 40;
  const ROWS = 6;
  const ROW_H = 22;
  const SCROLL = 0.24;

  const lineText = (l) => (l.kind === 'tool' ? `${l.tool.padEnd(6, ' ')}${l.arg}` : l.text);

  const script = $derived.by(() => {
    let at = 0;
    return agent.lines.map((l) => {
      const text = lineText(l);
      const dur = text.length / CPS;
      const hold = l.kind === 'ok' ? 2.4 : l.kind === 'you' ? 0.7 : 0.45;
      const item = { ...l, text, start: at, dur, hold };
      at += SCROLL + dur + hold;
      return item;
    });
  });
  const cycle = $derived(script.at(-1).start + SCROLL + script.at(-1).dur + script.at(-1).hold);

  let t = $state(0);
  /** @type {HTMLElement} */
  let root;

  $effect(() => {
    // Start part way into the script so every card opens mid-conversation.
    const okIndex = script.findIndex((l) => l.kind === 'ok');
    const settled = script[okIndex].start + SCROLL + script[okIndex].dur + 0.2;
    if (reduced) {
      t = settled;
      return;
    }
    t = settled + agent.offset;
    return animationLoop(root, (dt) => {
      t += dt;
    });
  });

  // Where we are: absolute line number k and time since it started.
  const pos = $derived.by(() => {
    const n = script.length;
    const loops = Math.floor(t / cycle);
    const r = t - loops * cycle;
    let i = n - 1;
    for (let j = 0; j < n; j++) {
      if (r < script[j].start + SCROLL + script[j].dur + script[j].hold) {
        i = j;
        break;
      }
    }
    return { k: loops * n + i, s: r - script[i].start, line: script[i] };
  });

  const rows = $derived.by(() => {
    const n = script.length;
    const out = [];
    for (let j = pos.k - ROWS; j <= pos.k; j++) {
      const line = script[((j % n) + n) % n];
      if (j < pos.k) {
        out.push({ key: j, line, text: line.text, done: true, typing: false });
      } else {
        const typedT = pos.s - SCROLL;
        const c = Math.max(0, Math.min(line.text.length, Math.floor(typedT * CPS)));
        const done = typedT >= line.dur;
        out.push({ key: j, line, text: line.text.slice(0, done ? undefined : c), done, typing: typedT >= 0 && !done });
      }
    }
    return out;
  });

  const offset = $derived.by(() => {
    const u = Math.min(1, Math.max(0, pos.s / SCROLL));
    return (1 - Math.pow(1 - u, 3)) * ROW_H;
  });

  const ready = $derived(pos.line.kind === 'ok' && pos.s > SCROLL + pos.line.dur);
  const lane = $derived(lanes[agent.lane]);
</script>

<article
  bind:this={root}
  class="bx-card agent"
  style="{laneStyle(agent.lane)} --i: {index}"
  aria-label="{lane.name} conversation, {agent.model}, worktree {agent.wt}"
>
  <header class="bx-card-head" data-anchor="card-{agent.lane}" data-lane={agent.lane} data-kind="row">
    <span
      class="bx-dot"
      class:pulse={!ready && !reduced}
      style="--dot: {ready ? statusColors.ready : statusColors.working}"
      aria-hidden="true"
    ></span>
    <span class="branch">{lane.name}</span>
    <span class="model">{agent.model}</span>
  </header>
  <div class="sub">
    <span class="wt">{agent.wt}</span>
    <span class="state" class:ready>{ready ? 'ready' : 'working'}</span>
  </div>
  <div class="window" style="height: {ROWS * ROW_H + 20}px">
    <ol class="log" style="transform: translateY({-offset}px)">
      {#each rows as row (row.key)}
        <li class="row {row.line.kind}">
          {#if row.line.kind === 'you'}
            <span class="you" aria-hidden="true">&gt;</span>
          {:else if row.line.kind === 'ok'}
            <span class="tick" aria-hidden="true">✓</span>
          {/if}
          <span class="txt">{row.text}{#if row.typing}<span class="caret"></span>{/if}</span>
          {#if row.line.kind === 'tool' && row.line.add !== undefined}
            <span class="stat" class:on={row.done}>
              <span class="bx-add">+{row.line.add}</span>
              <span class="bx-del">-{row.line.del}</span>
            </span>
          {/if}
        </li>
      {/each}
    </ol>
  </div>
</article>

<style>
  .agent {
    width: 100%;
  }
  @media (min-width: 640px) {
    .agent {
      width: min(100%, 34rem);
      margin-left: calc(var(--i) * (100% - min(100%, 34rem)) / 2);
    }
  }
  .branch {
    color: var(--lane-text);
    font-weight: 700;
    font-size: 13px;
  }
  .model {
    margin-left: auto;
    color: oklch(0.66 0 0);
  }
  .sub {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 14px;
    font-size: 12px;
    color: oklch(0.6 0 0);
    border-bottom: 1px solid var(--color-border);
  }
  .state {
    color: oklch(0.74 0.13 254.6);
  }
  .state.ready {
    color: #4ade80;
  }
  .window {
    position: relative;
    overflow: hidden;
    padding: 0 14px;
    mask-image: linear-gradient(to bottom, transparent 0, transparent 8px, #000 26px, #000 calc(100% - 6px), transparent 100%);
  }
  .log {
    list-style: none;
    padding-top: 10px;
    font-size: 12px;
    line-height: 22px;
    will-change: transform;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    height: 22px;
    white-space: pre;
    color: oklch(0.8 0 0);
    border-left: 2px solid color-mix(in oklch, var(--lane) 55%, transparent);
    padding-left: 10px;
  }
  .row.you {
    border-left-color: transparent;
    padding-left: 0;
    color: oklch(0.92 0 0);
  }
  .row.ok {
    color: #4ade80;
    border-left-color: color-mix(in oklch, #22c55e 55%, transparent);
  }
  .you {
    color: var(--lane-text);
    font-weight: 700;
  }
  .txt {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stat {
    margin-left: auto;
    display: inline-flex;
    gap: 6px;
    opacity: 0;
    transition: opacity 0.25s ease;
  }
  .stat.on {
    opacity: 1;
  }
  .caret {
    display: inline-block;
    width: 7px;
    height: 13px;
    margin-left: 1px;
    vertical-align: -2px;
    background: var(--lane-text);
  }
</style>
