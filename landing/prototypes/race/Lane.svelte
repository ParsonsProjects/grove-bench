<script>
  import Tree from '../shared/Tree.svelte';
  import BenchSeat from '../shared/BenchSeat.svelte';
  import Walker from '../shared/Walker.svelte';
  import Bubble from '../shared/Bubble.svelte';
  import { stepAt, inTrouble, fmt, sharedFiles } from './plan.js';

  /**
   * One way of running the tasks: its scene, a timeline per task on the same
   * scale as the other lanes, the latest events and, at the end, the result.
   *
   * @type {{ kind: 'solo' | 'shared' | 'grove', plan: any, tasks: any[], t: number, scaleEnd: number, k: number, started: boolean }}
   */
  let { kind, plan, tasks, t, scaleEnd, k, started } = $props();

  const INFO = {
    solo: { title: 'One agent, one folder', sub: 'Safe, but every task waits its turn.' },
    shared: { title: 'Several agents, one folder', sub: 'All at once, all in the same files.' },
    grove: { title: 'Grove Bench', sub: 'A worktree and a branch for each agent.', badge: true },
  };
  const info = INFO[kind];
  const byKey = $derived(Object.fromEntries(tasks.map((x) => [x.key, x])));
  const finished = $derived(started && t >= plan.end);
  const events = $derived(plan.events.filter((e) => e.t <= t).slice(-2).reverse());
  const overlap = $derived(kind === 'grove' ? sharedFiles(tasks) : []);
  const pct = (v) => `${(Math.min(v, scaleEnd) / scaleEnd) * 100}%`;
  const short = (f) => (f.includes('/') ? f.split('/').at(-1) : f);

  /** What one agent is doing at time t. */
  function look(track) {
    const task = byKey[track.task];
    if (!started) return { state: 'ready', bubble: null };
    if (t < track.start) return { state: 'queued', bubble: null };
    if (t >= track.end) return { state: t - track.end < 2 ? 'unread' : 'ready', bubble: { done: true, text: 'Done' } };
    if (inTrouble(track, t)) {
      const s = stepAt(track, t);
      return { state: 'error', bubble: { trouble: true, text: s?.tool === 'Bash' ? 'tests failed!' : 'file changed!' } };
    }
    const s = stepAt(track, t);
    return { state: 'working', bubble: s ? { tool: s.tool, text: short(s.file) } : null, task };
  }

  const TONE = { Read: 'read', Edit: 'edit', Write: 'write', Bash: 'bash' };
  const looks = $derived(plan.tracks.map((tr) => ({ tr, task: byKey[tr.task], ...look(tr) })));
  const active = $derived(kind === 'solo' ? looks.find((l) => l.state === 'working' || l.state === 'error') : null);
  const queue = $derived(kind === 'solo' ? looks.filter((l) => l.state === 'queued') : []);
  const doneSolo = $derived(kind === 'solo' ? looks.filter((l) => started && t >= l.tr.end) : []);
</script>

<article class="lane panel" class:grove={kind === 'grove'} aria-labelledby="lane-{kind}">
  <header class="head">
    <h3 id="lane-{kind}" class="pixel">{info.title}{#if info.badge}<span class="badge">this app</span>{/if}</h3>
    <p>{info.sub}</p>
  </header>

  <div class="scene" style="--k: {k}px" aria-hidden="true">
    {#if kind === 'grove'}
      <div class="row">
        {#each looks as l (l.tr.task)}
          <div class="plot">
            {#if l.bubble}<span class="say"><Bubble tone={l.bubble.done ? 'done' : l.bubble.trouble ? 'ask' : 'plain'}>{#if l.bubble.tool}<b class={TONE[l.bubble.tool]}>{l.bubble.tool}</b>{/if}{l.bubble.text}</Bubble></span>{/if}
            <span class="tree"><Tree scale={k + 1} tint={l.task.color} /></span>
            <span class="bench"><BenchSeat state={l.state === 'queued' ? 'ready' : l.state} seed={l.task.seed} scale={k} label="" /></span>
          </div>
        {/each}
      </div>
    {:else if kind === 'shared'}
      <div class="one-tree"><Tree scale={k + 2} /></div>
      <div class="row tight">
        {#each looks as l, i (l.tr.task)}
          <div class="plot small">
            {#if l.bubble}<span class="say" class:high={i % 2 === 1}><Bubble tone={l.bubble.done ? 'done' : l.bubble.trouble ? 'ask' : 'plain'}>{#if l.bubble.tool}<b class={TONE[l.bubble.tool]}>{l.bubble.tool}</b>{/if}{l.bubble.text}</Bubble></span>{/if}
            <span class="bench"><BenchSeat state={l.state === 'queued' ? 'ready' : l.state} seed={l.task.seed} scale={k} label="" /></span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="solo">
        <div class="queue">
          {#each queue as l (l.tr.task)}
            <span class="waiting" title="{l.task.branch} waiting"><Walker seed={l.task.seed} scale={k} still state="ready" /></span>
          {/each}
          {#if queue.length}<span class="qlabel">waiting</span>{/if}
        </div>
        <div class="plot">
          {#if active?.bubble}<span class="say"><Bubble>{#if active.bubble.tool}<b class={TONE[active.bubble.tool]}>{active.bubble.tool}</b>{/if}{active.bubble.text}</Bubble></span>{/if}
          <span class="tree"><Tree scale={k + 1} /></span>
          <span class="bench">
            {#if active}
              <BenchSeat state="working" seed={active.task.seed} scale={k} label="" />
            {:else}
              <BenchSeat state={started && t >= plan.end ? 'unread' : 'ready'} seed={(doneSolo.at(-1) ?? looks[0])?.task.seed} scale={k} label="" />
            {/if}
          </span>
        </div>
        <div class="done-pile">
          {#each doneSolo as l (l.tr.task)}<i style="background: {l.task.color}" title="{l.task.branch} done"></i>{/each}
        </div>
      </div>
    {/if}
    <div class="ground"></div>
  </div>

  <ol class="gantt" aria-label="Timeline">
    {#each looks as l (l.tr.task)}
      <li>
        <span class="who" style="--c: {l.task.color}"><i></i>{l.task.branch}</span>
        <span class="track">
          {#each l.tr.segments as seg}
            {#if started && t > seg.from}
              <span
                class="seg {seg.kind}"
                style="left: {pct(seg.from)}; width: calc({pct(Math.min(t, seg.to))} - {pct(seg.from)}); --c: {l.task.color}"
              ></span>
            {/if}
          {/each}
          {#if !started}
            {#each l.tr.segments as seg}
              <span class="seg ghost {seg.kind}" style="left: {pct(seg.from)}; width: calc({pct(seg.to)} - {pct(seg.from)}); --c: {l.task.color}"></span>
            {/each}
          {/if}
        </span>
      </li>
    {/each}
  </ol>

  <ul class="events" aria-live="polite">
    {#each events as e (e.t + e.text)}
      <li class={e.kind}><time>{fmt(e.t)}m</time>{e.text}</li>
    {/each}
    {#if !events.length}<li class="idle">{started ? 'Working...' : 'Waiting for the start.'}</li>{/if}
  </ul>

  <footer class="result" class:show={finished}>
    {#if finished}
      <p class="big pixel">{fmt(plan.end)} min</p>
      {#if kind === 'solo'}
        <p>No collisions, but each task waited for the one before. The last one waited {fmt(plan.tracks.at(-1).start)} minutes before it began.</p>
      {:else if kind === 'shared'}
        <p>
          {plan.clashes ? `${plan.clashes} collision${plan.clashes === 1 ? '' : 's'} on the way.` : 'No collisions this time.'}
          Every change sits in one folder on one branch, mixed together. Shipping them as separate PRs means untangling them by hand.
        </p>
      {:else}
        <p>No collisions. {tasks.length} branches, each in its own worktree, each ready for its own PR.</p>
        {#if overlap.length}
          <p class="fine">
            {overlap.map((o) => `${o.branches.join(' and ')} both changed ${o.file}`).join('; ')}. Git merges them like any branches; if the same lines changed, you sort it out once, when you merge.
          </p>
        {/if}
      {/if}
    {:else}
      <p class="fine">{started ? 'Running...' : 'Press Go to start.'}</p>
    {/if}
  </footer>
</article>

<style>
  .lane {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    padding: 16px;
  }
  .lane.grove {
    box-shadow:
      inset 0 0 0 1px rgb(110 200 122 / 0.5),
      0 -3px 0 0 var(--ink),
      0 3px 0 0 var(--ink),
      -3px 0 0 0 var(--ink),
      3px 0 0 0 var(--ink),
      0 9px 0 0 rgb(0 0 0 / 0.28);
  }
  .head h3 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 21px;
    color: #f3f5fa;
  }
  .badge {
    padding: 0 6px;
    font-size: 12px;
    color: #12361a;
    background: var(--leaf-1);
  }
  .head p {
    margin-top: 2px;
    font-size: 13px;
    color: var(--muted);
  }

  .scene {
    position: relative;
    height: calc(var(--k) * 40);
    overflow: hidden;
    background: linear-gradient(180deg, #0f1730, #18223f);
  }
  .ground {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(var(--k) * 2);
    background: #3a9a48;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(var(--k) * 2);
    display: flex;
    justify-content: space-evenly;
    align-items: flex-end;
  }
  .row.tight {
    justify-content: center;
    gap: calc(var(--k) * 3);
  }
  .plot {
    position: relative;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    width: calc(var(--k) * 22);
    height: calc(var(--k) * 26);
  }
  .plot.small {
    width: calc(var(--k) * 15);
    height: calc(var(--k) * 12);
  }
  .tree {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-60%);
  }
  .bench {
    position: relative;
    z-index: 1;
    transform: translateX(calc(var(--k) * 2));
  }
  .plot.small .bench {
    transform: none;
  }
  .say {
    position: absolute;
    bottom: calc(var(--k) * 12);
    left: 50%;
    z-index: 3;
    transform: translateX(-50%);
  }
  .say :global(.bubble) {
    font-size: 11px;
    padding: 2px 6px 3px;
  }
  .plot.small .say {
    bottom: calc(var(--k) * 11);
  }
  /* Neighbours on one tree: every other bubble sits higher so they don't overlap. */
  .plot.small .say.high {
    bottom: calc(var(--k) * 11 + 24px);
  }
  .one-tree {
    position: absolute;
    left: 50%;
    bottom: calc(var(--k) * 2);
    transform: translateX(-50%);
    opacity: 0.85;
  }
  .solo {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(var(--k) * 2);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding-inline: 10px;
  }
  .queue {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 4px;
    min-width: calc(var(--k) * 16);
  }
  .qlabel {
    position: absolute;
    left: 0;
    top: -18px;
    font-family: var(--font-pixel);
    font-size: 12px;
    color: var(--amber);
  }
  .done-pile {
    display: flex;
    flex-direction: column-reverse;
    gap: 3px;
    min-width: calc(var(--k) * 8);
    align-items: flex-end;
  }
  .done-pile i {
    width: calc(var(--k) * 6);
    height: calc(var(--k) * 2);
    box-shadow: 0 0 0 1px #0b1224;
  }

  .gantt {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .gantt li {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    font-size: 11px;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: #dfe4ef;
  }
  .who i {
    flex: none;
    width: 8px;
    height: 8px;
    background: var(--c);
  }
  .track {
    position: relative;
    height: 12px;
    background: rgb(255 255 255 / 0.05);
  }
  .seg {
    position: absolute;
    top: 0;
    height: 100%;
  }
  .seg.work {
    background: var(--c);
  }
  .seg.wait {
    background: repeating-linear-gradient(90deg, rgb(245 158 11 / 0.55) 0 4px, transparent 4px 8px);
  }
  .seg.redo {
    background: var(--red);
  }
  .seg.ghost {
    opacity: 0.18;
  }

  .events {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 76px;
    font-size: 12px;
    line-height: 1.45;
    color: #c7cfe0;
  }
  .events time {
    margin-right: 6px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .events .clash {
    color: oklch(0.82 0.12 25);
  }
  .events .done {
    color: oklch(0.85 0.12 151);
  }
  .events .idle {
    color: var(--faint);
  }
  .result {
    margin-top: auto;
    padding-top: 12px;
    border-top: 1px solid var(--edge);
    font-size: 13px;
    line-height: 1.5;
    color: #c7cfe0;
  }
  .big {
    font-size: 30px;
    line-height: 1.1;
    color: #f6f7fb;
  }
  .result p + p {
    margin-top: 6px;
  }
  .fine {
    font-size: 12px;
    color: var(--muted);
  }
</style>
