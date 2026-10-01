<script>
  import Sprite from '../shared/Sprite.svelte';
  import Tree from '../shared/Tree.svelte';
  import BenchSeat from '../shared/BenchSeat.svelte';
  import Walker from '../shared/Walker.svelte';
  import Pixels from '../shared/Pixels.svelte';
  import GroveScene from '../shared/GroveScene.svelte';
  import GroveWalk from '../shared/GroveWalk.svelte';
  import ContextStrip from '../shared/ContextStrip.svelte';
  import { FLAG } from '../shared/app-art.js';
  import Clock from './Clock.svelte';
  import { arrive } from './scroll.svelte.js';
  import { FEATURES } from './content.js';

  /**
   * Six feature cards. Each picture plays a short scene of the characters
   * once its card scrolls into view, then rests on its last frame (the
   * characters keep their own small animations).
   */
  const TINT = { green: 'var(--p-green)', amber: 'var(--p-amber)', blue: 'var(--p-blue)', pink: 'var(--p-pink)', lilac: 'var(--p-lilac)', mint: 'var(--p-mint)' };
  const AGENTS = [
    { id: 'a3f8b2c1', tint: '#3b82f6', branch: 'feat/auth' },
    { id: 'e52b9a73', tint: '#6ec87a', branch: 'fix/login' },
    { id: '9b0e27f5', tint: '#f59e0b', branch: 'docs/readme' },
  ];
  const grow = (t, at, d = 0.9) => Math.min(1, Math.max(0, (t - at) / d));

  // Status card: each row's state over time.
  const ROWS = [
    { id: 'a3f8b2c1', name: 'feat/auth', at: [[0, 'working', 'Edit: routes/index.ts'], [3.4, 'unread', '6 tests passed.']] },
    { id: 'e52b9a73', name: 'fix/login-bug', at: [[0, 'working', 'Read: auth/session.ts'], [1.8, 'permission', 'Wants to run a command']] },
    { id: '9b0e27f5', name: 'docs/readme', at: [[0, 'ready', 'README covers the API.'], [5, 'sleeping', 'README covers the API.']] },
  ];
  const rowAt = (r, t) => r.at.findLast(([at]) => t >= at);
</script>

{#snippet worktrees(t)}
  <div class="ground"></div>
  <div class="row-trees">
    <div class="col"><Tree scale={4} /><span class="tag dark">main</span></div>
    {#each AGENTS as a, i}
      <div class="col">
        <Tree scale={3} growth={grow(t, 0.4 + i * 0.35)} tint={a.tint} />
        {#if t > 1.6 + i * 0.2}<span class="tag">{a.branch}</span>{/if}
        {#if t > 2.4 + i * 0.3}
          <span class="seat"><BenchSeat state={t > 3.2 + i * 0.3 ? 'working' : 'ready'} seed={a.id} scale={2} label="" /></span>
        {:else if t > 1.6}
          <span class="walkin" style="left: {-40 + Math.min(1, (t - 1.6) / (0.8 + i * 0.3)) * 50}px"><Walker seed={a.id} scale={2} /></span>
        {/if}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet permissions(t)}
  {@const answered = t > 2.4}
  <div class="paper-ui">
    <div class="pu-head"><Sprite state={answered ? 'allowed' : 'permission'} seed="e52b9a73" scale={3} label="" /><b>permission</b><span>Bash</span></div>
    <code class="pu-cmd">npm test</code>
    {#if !answered}
      <div class="pu-btns"><span class="pb allow" class:pressed={t > 2}>Allow</span><span class="pb allow">Allow all commands</span><span class="pb deny">Deny</span></div>
      {#if t > 0.9}<span class="cursor" style="transform: translate({Math.max(0, 1 - (t - 0.9) / 1) * 80}px, {Math.max(0, 1 - (t - 0.9) / 1) * 40}px)"></span>{/if}
    {:else}
      <p class="pu-done">Allowed</p>
      {#if t > 3.2}<p class="pu-out"><span>$</span> npm test → 5 passed</p>{/if}
    {/if}
  </div>
{/snippet}

{#snippet status(t)}
  <div class="paper-ui list">
    <div class="filters">
      {#each [['Needs you', 'permission', '#f59e0b'], ['Working', 'working', '#3b82f6'], ['Unread', 'unread', '#22c55e']] as [label, st, c]}
        <span style="--c: {c}"><i></i>{label} {ROWS.filter((r) => rowAt(r, t)[1] === st).length}</span>
      {/each}
    </div>
    {#each ROWS as r (r.id)}
      {@const [, st, line] = rowAt(r, t)}
      <div class="srow">
        <Sprite state={st} seed={r.id} projectColor="#6ec87a" scale={2} />
        <span><b>{r.name}</b><small class:amber={st === 'permission'}>{line}</small></span>
      </div>
    {/each}
  </div>
{/snippet}

{#snippet checkpoints(t)}
  {@const back = t > 3.4}
  <div class="ground"></div>
  <div class="cp-path">
    {#each [1, 2, 3] as n, i}
      <span class="flag" style="left: {16 + i * 28}%" class:shown={t > 0.4 + i * 0.8} class:gone={back && n === 3}>
        <Pixels map={FLAG} scale={3} />
        <span class="tag">turn {n}</span>
      </span>
    {/each}
    <span class="cp-agent" style="left: {back ? 44 + (1 - grow(t, 3.4, 0.9)) * 28 : 6 + Math.min(1, t / 2.8) * 66}%">
      {#if (t > 0.1 && t < 2.8) || (t > 3.4 && t < 4.3)}<Walker seed="a3f8b2c1" scale={3} state="working" flip={t > 3.4} />{:else}<Sprite state={back ? 'ready' : 'working'} seed="a3f8b2c1" scale={3} label="" />{/if}
    </span>
    {#if back}<span class="rewind">⟲ rewind all</span>{/if}
  </div>
{/snippet}

{#snippet sleep(t)}
  <div class="center">
    {#if t > 3.4 && t < 6}
      <GroveWalk mode="wake" seed="9b0e27f5" scale={2} />
    {:else}
      <GroveScene state={t < 1.4 ? 'unread' : t < 3.4 ? 'sleeping' : 'ready'} seed="9b0e27f5" scale={3} />
    {/if}
    <span class="cap">{t < 1.4 ? 'done for now' : t < 3.4 ? '30 minutes later: asleep' : t < 6 ? 'opened: waking up' : 'back where it left off'}</span>
  </div>
{/snippet}

{#snippet context(t)}
  {@const pct = t < 0.5 ? 3 : t < 2 ? 34 : t < 4 ? 88 : 24}
  <div class="center">
    <div class="ctx">
      <div class="ctx-grove"><ContextStrip seed="a3f8b2c1" percent={pct} width={110} scale={3} /></div>
      <div class="ctx-bar"><span>feat/auth</span><b>context {pct}%</b></div>
    </div>
    <span class="cap">{t < 4 ? 'grows as the conversation fills its context' : '/compact: the grove thins out'}</span>
  </div>
{/snippet}

<section class="band b-features" id="features" aria-labelledby="features-h">
  <div class="inner">
    <div class="head">
      <h2 class="h2 rise" id="features-h" use:arrive>less waiting.<br /><span class="tone-2">more shipping.</span></h2>
      <p class="lede rise" use:arrive>You hand out the tasks. Grove Bench keeps every agent in its own lane, and tells you when one needs you.</p>
    </div>
    <div class="cards">
      {#each FEATURES as f, i (f.key)}
        <article class="card rise" use:arrive style="transition-delay: {(i % 3) * 0.1}s">
          <Clock class="pic" max={9}>
            {#snippet children(t)}
              <div class="pic-in" style="background: {TINT[f.tone]}">
                {#if f.key === 'worktrees'}{@render worktrees(t)}
                {:else if f.key === 'permissions'}{@render permissions(t)}
                {:else if f.key === 'status'}{@render status(t)}
                {:else if f.key === 'checkpoints'}{@render checkpoints(t)}
                {:else if f.key === 'sleep'}{@render sleep(t)}
                {:else}{@render context(t)}{/if}
              </div>
            {/snippet}
          </Clock>
          <div class="body">
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        </article>
      {/each}
    </div>
  </div>
</section>

<style>
  .inner {
    padding-block: 96px;
  }
  .head {
    display: grid;
    gap: 18px;
    align-items: end;
  }
  @media (min-width: 900px) {
    .head {
      grid-template-columns: minmax(0, 1fr) minmax(0, 0.6fr);
    }
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: 22px;
    margin-top: 40px;
  }
  .card {
    display: flex;
    flex-direction: column;
    background: #fffdf8;
    box-shadow:
      0 0 0 1px var(--line),
      0 14px 30px -18px rgb(58 42 28 / 0.35);
  }
  .card :global(.pic) {
    margin: 10px 10px 0;
  }
  .pic-in {
    position: relative;
    aspect-ratio: 16 / 10;
    max-width: 100%;
    overflow: hidden;
  }
  .body {
    padding: 16px 18px 20px;
  }
  h3 {
    font-size: 16px;
    font-weight: 800;
    letter-spacing: -0.03em;
    text-transform: lowercase;
  }
  .body p {
    margin-top: 6px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--soft);
  }

  /* Scene parts. */
  .ground {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 18%;
    background: linear-gradient(180deg, #5ab868 0 4px, #4aaa58 4px);
  }
  .row-trees {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 18%;
    display: flex;
    justify-content: space-evenly;
    align-items: flex-end;
  }
  .col {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .tag {
    position: absolute;
    top: calc(100% + 6px);
    padding: 0 5px;
    font-size: 10px;
    white-space: nowrap;
    color: #f4ecdd;
    background: #5a4130;
  }
  .tag.dark {
    background: #2d2016;
  }
  .seat {
    position: absolute;
    bottom: 0;
    left: 40%;
  }
  .walkin {
    position: absolute;
    bottom: 0;
  }
  .paper-ui {
    position: absolute;
    inset: 14px;
    padding: 12px 14px;
    font-size: 12px;
    background: #fff;
    box-shadow:
      0 0 0 1px rgb(58 42 28 / 0.14),
      0 10px 20px -12px rgb(58 42 28 / 0.4);
  }
  .pu-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pu-head b {
    color: #b06a00;
  }
  .pu-cmd {
    display: block;
    margin-top: 8px;
    padding: 6px 10px;
    font-family: var(--head);
    font-size: 12px;
    color: var(--ink);
    background: #f6f1e6;
  }
  .pu-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .pb {
    padding: 3px 9px;
    font-size: 11.5px;
    border: 1px solid;
  }
  .pb.allow {
    color: #1f7a33;
  }
  .pb.deny {
    color: #b42318;
  }
  .pb.pressed {
    background: #dff3e2;
  }
  .cursor {
    position: absolute;
    left: 44px;
    bottom: 26px;
    width: 12px;
    height: 16px;
    background: var(--ink);
    clip-path: polygon(0 0, 100% 62%, 55% 66%, 75% 100%, 55% 100%, 38% 70%, 0 92%);
  }
  .pu-done {
    margin-top: 8px;
    color: #1f7a33;
  }
  .pu-out {
    margin-top: 4px;
    color: #1f7a33;
  }
  .pu-out span {
    color: var(--blue);
  }
  .list {
    padding: 10px 0;
  }
  .filters {
    display: flex;
    gap: 10px;
    padding: 0 12px 6px;
    font-size: 10.5px;
    color: var(--soft);
  }
  .filters span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .filters i {
    width: 6px;
    height: 6px;
    background: var(--c);
  }
  .srow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
  }
  .srow span {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .srow b {
    font-size: 12px;
  }
  .srow small {
    overflow: hidden;
    font-size: 10.5px;
    color: var(--faint);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .srow small.amber {
    color: #b06a00;
  }
  .cp-path {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 18%;
    height: 60%;
  }
  .flag {
    position: absolute;
    bottom: 0;
    opacity: 0;
    transition: opacity 0.3s;
  }
  .flag.shown {
    opacity: 1;
  }
  .flag.gone {
    opacity: 0.25;
  }
  .flag .tag {
    left: -4px;
  }
  .cp-agent {
    position: absolute;
    bottom: 0;
    transform: translateX(-50%);
  }
  .rewind {
    position: absolute;
    top: 6px;
    right: 10px;
    padding: 1px 8px;
    font-family: var(--pixel);
    font-size: 13px;
    color: #fff;
    background: #c2553d;
  }
  .center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .cap {
    font-family: var(--pixel);
    font-size: 13px;
    color: var(--soft);
  }
  .ctx {
    position: relative;
    width: 86%;
    margin-top: 24px;
  }
  .ctx-grove {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    overflow: hidden;
    line-height: 0;
  }
  .ctx-grove :global(svg) {
    max-width: none;
  }
  .ctx-bar {
    display: flex;
    justify-content: space-between;
    padding: 7px 10px;
    font-size: 11px;
    color: oklch(0.835 0 0);
    background: oklch(0.176 0 0);
  }
  .ctx-bar b {
    color: oklch(0.792 0.209 151.711);
    font-weight: 400;
  }
</style>
