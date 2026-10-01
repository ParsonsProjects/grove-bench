<script>
  import { onMount } from 'svelte';
  import Shell from '../shared/Shell.svelte';
  import Sprite from '../shared/Sprite.svelte';
  import { animationLoop } from '../../src/lib/motion.js';
  import Lane from './Lane.svelte';
  import { TASKS } from './tasks.js';
  import { planAll } from './plan.js';

  /** Simulated minutes per real second. */
  const SPEED = 1.1;

  let picked = $state(['auth', 'logout', 'search']);
  let t = $state(0);
  let running = $state(false);
  let started = $state(false);
  let k = $state(3);
  let raceEl = $state();

  const tasks = $derived(TASKS.filter((x) => picked.includes(x.key)));
  const plan = $derived(planAll(tasks));
  const scaleEnd = $derived(Math.max(plan.solo.end, plan.shared.end, plan.grove.end));
  const over = $derived(started && t >= scaleEnd);

  onMount(() => {
    const mq = window.matchMedia('(max-width: 420px)');
    const fit = () => (k = mq.matches ? 2 : 3);
    fit();
    mq.addEventListener('change', fit);
    return () => mq.removeEventListener('change', fit);
  });

  $effect(() => {
    if (!running || !raceEl) return;
    return animationLoop(raceEl, (dt) => {
      t = Math.min(scaleEnd + 0.01, t + dt * SPEED);
      if (t >= scaleEnd) running = false;
    });
  });

  function toggle(key) {
    if (started) return;
    if (picked.includes(key)) {
      if (picked.length > 2) picked = picked.filter((p) => p !== key);
    } else if (picked.length < 4) {
      picked = [...picked, key];
    }
  }

  function go() {
    if (over || !started) {
      t = 0;
      started = true;
    }
    running = !running || over;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      t = scaleEnd + 0.01;
      running = false;
    }
  }

  function reset() {
    running = false;
    started = false;
    t = 0;
  }
</script>

<Shell current="race">
  <section class="wrap intro">
    <div>
      <p class="eyebrow">Prototype · press go</p>
      <h1>Parallel race</h1>
      <p class="lede">
        The same tasks, run three ways. One agent working through them in turn. Several agents sharing one folder. Or
        Grove Bench, where each agent gets its own git worktree and branch. Pick the tasks, then press Go.
      </p>
    </div>
  </section>

  <section class="wrap setup" aria-labelledby="pick-h">
    <div class="pick">
      <h2 id="pick-h" class="pixel">Pick 2 to 4 tasks</h2>
      <ul class="cards">
        {#each TASKS as task (task.key)}
          {@const on = picked.includes(task.key)}
          <li>
            <button
              type="button"
              class="card"
              class:on
              style="--c: {task.color}"
              aria-pressed={on}
              disabled={started || (!on && picked.length >= 4) || (on && picked.length <= 2)}
              onclick={() => toggle(task.key)}
            >
              <Sprite state={on ? 'ready' : 'sleeping'} seed={task.seed} scale={3} label="" />
              <span class="ct">
                <b>{task.title}</b>
                <small>{task.steps.filter((s) => s.op === 'edit').map((s) => s.file.split('/').at(-1)).join(', ')}</small>
              </span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="hint">The small print on each card is the files it changes. Tasks that share a file are where the trouble starts.</p>
    </div>
    <div class="go">
      <div class="clock pixel" aria-live="off">{Math.min(t, scaleEnd).toFixed(1)}<span>min</span></div>
      <div class="go-btns">
        <button type="button" class="btn primary big" onclick={go}>{!started || over ? (over ? 'Race again' : 'Go') : running ? 'Pause' : 'Resume'}</button>
        <button type="button" class="btn ghost" onclick={reset} disabled={!started}>Change tasks</button>
      </div>
      <p class="hint">Simulated minutes. The timings are made up; the kinds of trouble are real.</p>
    </div>
  </section>

  <section class="wrap lanes" bind:this={raceEl} aria-label="The race">
    <Lane kind="solo" plan={plan.solo} {tasks} {t} {scaleEnd} {k} {started} />
    <Lane kind="shared" plan={plan.shared} {tasks} {t} {scaleEnd} {k} {started} />
    <Lane kind="grove" plan={plan.grove} {tasks} {t} {scaleEnd} {k} {started} />
  </section>

  <section class="wrap why" aria-labelledby="why-h">
    <h2 id="why-h" class="pixel">Why the shared folder trips up</h2>
    <div class="why-grid">
      <div class="panel">
        <h3>Edits collide</h3>
        <p>An agent reads a file, plans a change, then finds another agent changed it in the meantime. Its edit fails and it has to read the file again.</p>
      </div>
      <div class="panel">
        <h3>Tests catch the wrong thing</h3>
        <p>A test run sees every agent’s half-finished work, not just its own. It fails for reasons that have nothing to do with the task.</p>
      </div>
      <div class="panel">
        <h3>Everything ends up together</h3>
        <p>One folder means one branch. To ship the tasks as separate PRs, someone untangles them by hand. With a worktree each, they never mix.</p>
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
    max-width: 66ch;
    color: #c7cfe0;
  }
  .setup {
    display: grid;
    gap: 24px;
    padding-block: 16px 28px;
    align-items: end;
  }
  @media (min-width: 980px) {
    .setup {
      grid-template-columns: minmax(0, 1fr) 300px;
    }
  }
  .pick h2 {
    font-size: 20px;
    color: #f3f5fa;
  }
  .cards {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
    gap: 10px;
    margin-top: 12px;
  }
  .card {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    text-align: left;
    background: rgb(255 255 255 / 0.03);
    border: 0;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1);
    cursor: pointer;
  }
  .card.on {
    background: color-mix(in oklch, var(--c) 14%, transparent);
    box-shadow: inset 0 0 0 2px var(--c);
  }
  .card:disabled {
    cursor: default;
  }
  .card:disabled:not(.on) {
    opacity: 0.5;
  }
  .ct {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .ct b {
    font-size: 13px;
    color: #eef1f8;
  }
  .ct small {
    overflow: hidden;
    font-size: 11px;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    margin-top: 10px;
    font-size: 12px;
    color: var(--muted);
  }
  .go {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .clock {
    font-size: 52px;
    line-height: 1;
    color: #f6f7fb;
    font-variant-numeric: tabular-nums;
  }
  .clock span {
    margin-left: 6px;
    font-size: 18px;
    color: var(--muted);
  }
  .go-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .btn.big {
    min-width: 120px;
    font-size: 16px;
  }
  .lanes {
    display: grid;
    gap: 22px;
    align-items: stretch;
  }
  @media (min-width: 1080px) {
    .lanes {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .why {
    padding-top: 56px;
  }
  .why h2 {
    font-size: 26px;
    color: #f3f5fa;
  }
  .why-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: 20px;
    margin-top: 16px;
  }
  .why h3 {
    font-family: var(--font-pixel);
    font-size: 18px;
    color: #f3f5fa;
  }
  .why p {
    margin-top: 6px;
    font-size: 14px;
    color: #c7cfe0;
  }
</style>
