<script>
  import { animationLoop } from '../shared/motion.js';
  import { lanes, laneStyle } from './lanes.js';
  import { agents } from './data.js';

  /**
   * Three agents edit src/routes/index.ts at the same time, each in its own
   * worktree. Lines are inserted live in every pane; the conflict counter
   * stays at zero.
   *
   * @type {{ reduced?: boolean }}
   */
  let { reduced = false } = $props();

  const base = [
    "import { Router } from 'express'",
    "import { health } from './health'",
    "import { users } from './users'",
    '',
    'const router = Router()',
    "router.get('/health', health)",
    "router.use('/users', users)",
    '',
    'export default router',
  ];

  // after: number of base lines above the inserted line.
  const inserts = {
    auth: [
      { after: 1, text: "import { auth } from './auth'" },
      { after: 5, text: 'router.use(auth)' },
    ],
    api: [
      { after: 3, text: "import { profile } from './profile'" },
      { after: 7, text: "router.use('/profile', profile)" },
    ],
    fix: [
      { after: 2, text: "import { refresh } from './session'" },
      { after: 6, text: "router.post('/refresh', refresh)" },
    ],
  };

  const CPS = 30;
  const order = ['auth', 'api', 'fix'];
  // Interleave so all three panes type at once.
  const events = [];
  for (let k = 0; k < 2; k++) {
    order.forEach((lane, j) => {
      const ins = inserts[lane][k];
      events.push({ lane, k, start: 0.4 + (k * 3 + j) * 0.62, dur: ins.text.length / CPS });
    });
  }
  const END = Math.max(...events.map((e) => e.start + e.dur));
  const HOLD = 3.4;

  let t = $state(0);
  /** @type {HTMLElement} */
  let root;

  $effect(() => {
    if (reduced) {
      t = END + 0.01;
      return;
    }
    t = 0;
    return animationLoop(root, (dt) => {
      t += dt;
      if (t > END + HOLD) t = 0;
    });
  });

  function stateOf(lane, k) {
    const e = events.find((x) => x.lane === lane && x.k === k);
    if (t < e.start) return { phase: 'hidden', n: 0 };
    const len = inserts[lane][k].text.length;
    if (t < e.start + e.dur) return { phase: 'typing', n: Math.floor((t - e.start) * CPS) };
    return { phase: 'done', n: len };
  }

  /** Lines of one pane at time t, with running line numbers. */
  function paneLines(lane) {
    const out = [];
    let num = 0;
    const ins = inserts[lane];
    for (let i = 0; i <= base.length; i++) {
      ins.forEach((x, k) => {
        if (x.after !== i) return;
        const s = stateOf(lane, k);
        if (s.phase !== 'hidden') num++;
        out.push({ key: `i${k}`, ins: true, text: x.text.slice(0, s.n), phase: s.phase, num: s.phase === 'hidden' ? '' : num });
      });
      if (i < base.length) {
        num++;
        out.push({ key: `b${i}`, ins: false, text: base[i], phase: 'base', num });
      }
    }
    return out;
  }

  const panes = $derived(
    order.map((lane) => {
      const agent = agents.find((a) => a.lane === lane);
      const added = inserts[lane].filter((_, k) => stateOf(lane, k).phase === 'done').length;
      return { lane, agent, lines: paneLines(lane), added };
    }),
  );
  const totalAdded = $derived(panes.reduce((s, p) => s + p.added, 0));
</script>

<div class="iso" bind:this={root}>
  <div class="stats" role="group" aria-label="Edit counters">
    <div class="file">
      <span class="label">file</span>
      <span class="val">src/routes/index.ts</span>
    </div>
    <div class="nums">
      <div class="stat">
        <span class="label">lines added</span>
        <span class="big" aria-live="off">{totalAdded}</span>
      </div>
      <div class="stat zero">
        <span class="label">conflicts</span>
        <span class="big">0</span>
      </div>
    </div>
  </div>

  <div class="panes">
    {#each panes as pane (pane.lane)}
      <figure class="bx-card pane" style={laneStyle(pane.lane)}>
        <figcaption
          class="bx-card-head"
          data-anchor="pane-{pane.lane}"
          data-lane={pane.lane}
          data-kind="row"
          data-connect="false"
        >
          <span class="branch">{lanes[pane.lane].name}</span>
          <span class="count">+{pane.added}</span>
          <span class="path">{pane.agent.wt}/src/routes/index.ts</span>
        </figcaption>
        <pre class="code" aria-label="src/routes/index.ts in the {lanes[pane.lane].name} worktree">{#each pane.lines as line (line.key)}<span
              class="ln {line.phase}"
              class:ins={line.ins}
            ><span class="num">{line.num}</span><span class="src">{line.text}{#if line.phase === 'typing'}<span
                    class="caret"
                  ></span>{/if}</span></span>{/each}</pre>
      </figure>
    {/each}
  </div>
</div>

<style>
  .iso {
    margin-top: 40px;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px 32px;
    margin-bottom: 18px;
  }
  .label {
    display: block;
    font-size: 12px;
    color: oklch(0.6 0 0);
  }
  .val {
    font-size: 14px;
    color: oklch(0.88 0 0);
  }
  .nums {
    display: flex;
    gap: 28px;
  }
  @media (min-width: 640px) {
    .stat {
      text-align: right;
    }
  }
  .big {
    display: block;
    font-size: 30px;
    font-weight: 800;
    line-height: 1.1;
    color: oklch(0.92 0 0);
    font-variant-numeric: tabular-nums;
  }
  .zero .big {
    color: #4ade80;
  }

  .panes {
    display: grid;
    gap: 16px;
  }
  @media (min-width: 1024px) {
    .panes {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .pane {
    min-width: 0;
  }
  .pane .bx-card-head {
    flex-wrap: wrap;
    row-gap: 2px;
  }
  .branch {
    color: var(--lane-text);
    font-weight: 700;
    font-size: 13px;
  }
  .count {
    margin-left: auto;
    color: #4ade80;
    font-variant-numeric: tabular-nums;
  }
  .path {
    flex-basis: 100%;
    font-size: 11px;
    color: oklch(0.58 0 0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .code {
    margin: 0;
    padding: 8px 0;
    font-family: inherit;
    font-size: 12px;
    line-height: 20px;
    color: oklch(0.7 0 0);
    overflow: hidden;
  }
  .ln {
    display: flex;
    height: 20px;
    overflow: hidden;
    white-space: pre;
    transition:
      height 0.28s ease,
      background-color 0.4s ease;
  }
  .ln.hidden {
    height: 0;
  }
  .ln.ins {
    background: color-mix(in oklch, var(--lane) 16%, transparent);
    box-shadow: inset 2px 0 0 var(--lane);
    color: oklch(0.92 0 0);
  }
  .num {
    flex: 0 0 34px;
    padding-right: 10px;
    text-align: right;
    color: oklch(0.45 0 0);
    user-select: none;
  }
  .ins .num {
    color: var(--lane-text);
  }
  .src {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-right: 10px;
  }
  .caret {
    display: inline-block;
    width: 7px;
    height: 13px;
    vertical-align: -2px;
    background: var(--lane-text);
  }

  @media (prefers-reduced-motion: reduce) {
    .ln {
      transition: none;
    }
  }
</style>
