<script>
  import Sprite from '../shared/Sprite.svelte';
  import Tree from '../shared/Tree.svelte';
  import BenchSeat from '../shared/BenchSeat.svelte';
  import Walker from '../shared/Walker.svelte';
  import Pixels from '../shared/Pixels.svelte';
  import GroveScene from '../shared/GroveScene.svelte';
  import GroveWalk from '../shared/GroveWalk.svelte';
  import ContextStrip from '../shared/ContextStrip.svelte';
  import Row from '../shared/app/Row.svelte';
  import Chips from '../shared/app/Chips.svelte';
  import ThreadItem from '../shared/app/ThreadItem.svelte';
  import '../shared/app/app.css';
  import { FLAG } from '../shared/app-art.js';
  import Branch from './Branch.svelte';
  import Clock from './Clock.svelte';
  import { arrive } from './scroll.svelte.js';
  import { FEATURES } from './content.js';

  /**
   * Six features in a column beside the trail, pictures alternating sides,
   * each on a side path of its own (Rail draws one to every [data-spur]). Each picture plays a short
   * scene once it scrolls into view, then rests on its last frame. The two
   * that show the app use its own sidebar and prompt.
   */
  const AGENTS = [
    { id: 'a3f8b2c1', tint: '#3b82f6', branch: 'feat/auth' },
    { id: 'e52b9a73', tint: '#6ec87a', branch: 'fix/login' },
    { id: '9b0e27f5', tint: '#f59e0b', branch: 'docs/readme' },
  ];
  const grow = (t, at, d = 0.9) => Math.min(1, Math.max(0, (t - at) / d));

  // Sidebar scene: each conversation's state over time.
  const ROWS = [
    { id: 'a3f8b2c1', name: 'feat/auth', age: '2m ago', at: [[0, 'working', 'Edit: routes/index.ts'], [3.4, 'unread', '6 tests passed.']] },
    { id: 'e52b9a73', name: 'fix/login-bug', age: '4m ago', at: [[0, 'working', 'Read: auth/session.ts'], [1.8, 'permission', 'Wants to run a command']] },
    { id: '9b0e27f5', name: 'docs/readme', age: '40m ago', at: [[0, 'ready', 'README covers the API.'], [5, 'sleeping', 'README covers the API.']] },
  ];
  const TONE = { permission: 'amber', working: 'blue' };
  const rowsAt = (t) =>
    ROWS.map((r) => {
      const [, state, line] = r.at.findLast(([at]) => t >= at);
      return { id: r.id, name: r.name, age: r.age, state, line, lineTone: TONE[state] ?? 'muted', projectColor: '#6ec87a' };
    });
</script>

{#snippet worktrees(t)}
  <div class="ground" data-spur></div>
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
  <div class="gb ui thread" class:press={t > 1.7 && !answered}>
    <ThreadItem it={{ kind: 'you', text: 'Fix the failing login test' }} />
    <ThreadItem it={{ kind: 'perm', tool: 'Bash', detail: 'npm test', resolved: answered ? 'allowed' : null }} seed="e52b9a73" />
    {#if t > 3.2}<ThreadItem it={{ kind: 'bash', cmd: 'npm test', out: '5 passed' }} />{/if}
  </div>
{/snippet}

{#snippet status(t)}
  {@const rows = rowsAt(t)}
  <div class="gb ui side" data-spur>
    <div class="chips"><Chips states={rows.map((r) => r.state)} /></div>
    {#each rows as c (c.id)}<Row {c} showProject={false} />{/each}
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
    {#if back}<span class="rewind">⟲ Rewind all</span>{/if}
  </div>
{/snippet}

{#snippet sleep(t)}
  <div class="center" data-spur>
    {#if t > 3.4 && t < 6}
      <GroveWalk mode="wake" seed="9b0e27f5" scale={3} />
    {:else}
      <GroveScene state={t < 1.4 ? 'unread' : t < 3.4 ? 'sleeping' : 'ready'} seed="9b0e27f5" scale={4} />
    {/if}
    <span class="cap">{t < 1.4 ? 'done for now' : t < 3.4 ? '30 minutes later: asleep' : t < 6 ? 'opened: waking up' : 'back where it left off'}</span>
  </div>
{/snippet}

{#snippet context(t)}
  {@const pct = t < 0.5 ? 3 : t < 2 ? 34 : t < 4 ? 88 : 24}
  <div class="center">
    <div class="ctx">
      <div class="ctx-grove"><ContextStrip seed="a3f8b2c1" percent={pct} width={110} scale={3} /></div>
      <div class="ctx-bar"><span>feat/auth</span><b>Context {pct}%</b></div>
    </div>
    <span class="cap">{t < 4 ? 'grows as the thread fills its context' : '/compact: the grove thins out'}</span>
  </div>
{/snippet}

<section class="band b-features" id="features" aria-labelledby="features-h">
  <div class="inner">
    <div class="head rise" use:arrive>
      <Branch name="feat/side-by-side" />
      <h2 class="h2" id="features-h">Less waiting. More shipping.</h2>
      <p class="lede">You hand out the tasks. Grove Bench keeps every agent in its own lane, and tells you when one needs you.</p>
    </div>
    <div class="list">
      {#each FEATURES as f, i (f.key)}
        <article class="feat rise" class:flip={i % 2 === 1} use:arrive>
          <Clock class="pic" max={9}>
            {#snippet children(t)}
              <div class="pic-in" class:fit={f.key === 'permissions' || f.key === 'status'} aria-hidden="true" inert>
                {#if f.key === 'worktrees'}{@render worktrees(t)}
                {:else if f.key === 'permissions'}{@render permissions(t)}
                {:else if f.key === 'status'}{@render status(t)}
                {:else if f.key === 'checkpoints'}{@render checkpoints(t)}
                {:else if f.key === 'sleep'}{@render sleep(t)}
                {:else}{@render context(t)}{/if}
              </div>
            {/snippet}
          </Clock>
          <!-- The side path meets the picture when it's on the left, else the words. -->
          <div class="copy" data-spur={i % 2 === 1 ? '' : undefined}>
            <span class="where">{f.where}</span>
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
  .head .lede {
    max-width: 58ch;
    margin-top: 14px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 44px;
    margin-top: 48px;
  }
  .feat {
    display: grid;
    gap: 18px;
    align-items: center;
  }
  @media (min-width: 860px) {
    .feat {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 56px;
    }
    .feat.flip :global(.pic) {
      order: 2;
      justify-self: end;
    }
  }
  .feat :global(.pic) {
    width: 100%;
    max-width: 440px;
  }
  .pic-in {
    position: relative;
    aspect-ratio: 16 / 9;
    overflow: hidden;
  }
  /* The app panels take the height they need, so nothing is cut off on a
     narrow screen. */
  .pic-in.fit {
    display: grid;
    align-items: center;
    aspect-ratio: auto;
    min-height: 230px;
    overflow: visible;
  }
  .copy {
    max-width: 44ch;
  }
  /* Where it lives in the app, styled like the app's key hints. */
  .where {
    display: inline-block;
    padding: 0 6px;
    font-size: 11.5px;
    color: var(--soft);
    border: 1px solid color-mix(in srgb, var(--ink) 22%, transparent);
  }
  h3 {
    margin-top: 10px;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.025em;
  }
  .copy p {
    margin-top: 6px;
    font-size: 14px;
    line-height: 1.65;
    color: var(--soft);
  }

  /* The app's own panels, framed like the hero window. */
  .ui {
    box-shadow:
      0 0 0 1px rgb(58 42 28 / 0.2),
      0 18px 34px -16px rgb(58 42 28 / 0.45);
  }
  .thread {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    font-size: 12px;
  }
  .press :global([data-target='allow']) {
    background: oklch(0.792 0.209 151.711 / 0.22);
  }
  .side {
    padding: 8px 0;
    background: oklch(0.176 0 0);
  }
  .side .chips {
    padding: 2px 12px 6px;
  }

  /* Scene parts. */
  /* A strip of grass for the scenes to stand on. */
  .ground {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 34px;
    height: 12px;
    background: linear-gradient(180deg, #5ab868 0 3px, #4aaa58 3px);
    box-shadow: 0 3px 0 #3d8f4a;
  }
  .row-trees {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 46px;
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
    top: calc(100% + 2px);
    padding: 0 5px;
    font-size: 10px;
    white-space: nowrap;
    color: #f4ecdd;
    background: #5a4130;
  }
  .tag.dark {
    background: #2d2016;
  }
  .col:nth-child(even) > .tag {
    top: calc(100% + 21px);
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
  .cp-path {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 46px;
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
    top: 14%;
    right: 10px;
    padding: 2px 10px;
    font-size: 12px;
    color: oklch(0.835 0 0);
    background: oklch(0.233 0 0);
    border: 1px solid oklch(0.32 0 0);
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
