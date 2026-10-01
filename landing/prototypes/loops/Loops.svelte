<script>
  import '../shared/app/app.css';
  import Shell from '../shared/Shell.svelte';
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
  import { FLAG } from '../shared/app-art.js';
  import { links } from '../../src/lib/brand.js';
  import { DownloadIcon } from '../../src/lib/icons.js';
  import Loop from './Loop.svelte';

  const COLOR = '#6ec87a';
  const AGENTS = [
    { id: 'a3f8b2c1', branch: 'feat/auth', tint: '#3b82f6' },
    { id: 'e52b9a73', branch: 'fix/login-bug', tint: '#6ec87a' },
    { id: '9b0e27f5', branch: 'docs/readme', tint: '#f59e0b' },
  ];
  const row = (id, name, state, line, lineTone = 'muted', files = [1]) => ({ id, name, state, line, lineTone, files, project: 'acme-shop', projectColor: COLOR, age: 'now' });

  // What each conversation in the sidebar loop is doing, frame by frame.
  const SIDEBAR = [
    [row('a3f8b2c1', 'feat/auth', 'working', 'Edit: src/routes/index.ts', 'blue'), row('e52b9a73', 'fix/login-bug', 'working', 'Read: src/auth/session.ts', 'blue'), row('9b0e27f5', 'docs/readme', 'ready', 'The README covers the new endpoints.')],
    [row('a3f8b2c1', 'feat/auth', 'working', 'Bash: npm test', 'blue'), row('e52b9a73', 'fix/login-bug', 'permission', 'Wants to run a command', 'amber'), row('9b0e27f5', 'docs/readme', 'ready', 'The README covers the new endpoints.')],
    [row('a3f8b2c1', 'feat/auth', 'unread', '6 tests passed.'), row('e52b9a73', 'fix/login-bug', 'permission', 'Wants to run a command', 'amber'), row('9b0e27f5', 'docs/readme', 'ready', 'The README covers the new endpoints.')],
    [row('a3f8b2c1', 'feat/auth', 'unread', '6 tests passed.'), row('e52b9a73', 'fix/login-bug', 'permission', 'Wants to run a command', 'amber'), row('9b0e27f5', 'docs/readme', 'sleeping', 'The README covers the new endpoints.')],
  ];

  const FEATURES = [
    {
      key: 'worktrees',
      title: 'A branch for every conversation',
      body: 'Each conversation gets its own git worktree, a separate folder on its own branch. Agents never write over each other’s files, and your checkout stays as it is.',
      app: 'New branch, Branch or PR, or Project folder',
      frames: [
        { dur: 1.6, caption: 'Your project, on main.' },
        { dur: 2, caption: 'Start three conversations: three worktrees grow.' },
        { dur: 2, caption: 'Each on a branch of its own.' },
        { dur: 2.6, caption: 'And each with its own agent at work.' },
      ],
    },
    {
      key: 'status',
      title: 'Status at a glance',
      body: 'Every conversation has a small agent whose pose and colour say what it’s doing. Typing means working, amber means it needs you, a wave means it finished, asleep means idle.',
      app: 'The sidebar, and its Needs you, Working and Unread filters',
      frames: [
        { dur: 2, caption: 'Two at work, one ready for its next task.' },
        { dur: 2, caption: 'fix/login-bug needs you: an amber question mark.' },
        { dur: 2, caption: 'feat/auth finished while you were elsewhere, so it waves.' },
        { dur: 2.4, caption: 'docs/readme has been idle a while, so it sleeps.' },
      ],
    },
    {
      key: 'permissions',
      title: 'It asks before it acts',
      body: 'Pick a mode per conversation: Ask, Plan, Edit, Auto, or Grove Bench’s own Read-safe. Anything outside it waits for you to Allow or Deny, or to allow every call of that kind.',
      app: 'Permission prompts in the Thread tab',
      frames: [
        { dur: 1.8, caption: 'The agent fixes the bug.' },
        { dur: 2.2, caption: 'In Ask mode, running a command waits for you.' },
        { dur: 1.6, caption: 'You allow it. The prompt keeps a tick.' },
        { dur: 2.2, caption: 'It carries on.' },
      ],
    },
    {
      key: 'checkpoints',
      title: 'Every message is a checkpoint',
      body: 'Before the agent acts on a message, Grove Bench saves a checkpoint. Rewind all puts back files and conversation; Conv. only resets just the conversation.',
      app: 'Checkpoints tab, Alt+3',
      frames: [
        { dur: 1.6, caption: 'Turn 1: a checkpoint, then the agent works.' },
        { dur: 1.6, caption: 'Turn 2: another.' },
        { dur: 1.6, caption: 'Turn 3 went the wrong way.' },
        { dur: 2.4, caption: 'Rewind all: back to before turn 3, files and all.' },
      ],
    },
    {
      key: 'terminals',
      title: 'A terminal each',
      body: 'Every conversation has its own terminal, a real PTY opened in its worktree. Run the tests in one while another serves the app.',
      app: 'Terminal tab, Alt+4',
      frames: [
        { dur: 1.4, caption: 'Two conversations, two terminals.' },
        { dur: 1.8, caption: 'feat/auth runs its tests.' },
        { dur: 1.8, caption: 'fix/login-bug starts the dev server.' },
        { dur: 2.4, caption: 'Each in its own folder, on its own branch.' },
      ],
    },
    {
      key: 'sleep',
      title: 'Naps when idle',
      body: 'After 30 minutes with nothing to do (you can change it), a conversation’s agent shuts down to save memory and CPU. Its terminal keeps running. Open it and it wakes where it left off.',
      app: 'Settings → Tending',
      frames: [
        { dur: 1.6, caption: 'Done, and nothing new to do.' },
        { dur: 2, caption: 'Idle for 30 minutes, it falls asleep.' },
        { dur: 2.4, caption: 'Open it: it wakes up on its bench and walks off.' },
        { dur: 1.8, caption: 'Same mode, same “always allow” choices.' },
      ],
    },
    {
      key: 'context',
      title: 'Watch the context fill',
      body: 'A strip of grove along the status bar grows as the conversation fills its context window: grass, then bushes, then trees. Each conversation grows its own.',
      app: 'Status bar · Context %',
      frames: [
        { dur: 1.6, caption: 'A fresh conversation: bare ground.' },
        { dur: 1.8, caption: 'Grass and saplings as it gets going.' },
        { dur: 2, caption: 'A full grove near the limit.' },
        { dur: 2.4, caption: 'Run /compact and it thins out again.' },
      ],
    },
    {
      key: 'memory',
      title: 'Project memory',
      body: 'Markdown notes per project, in repo/, conventions/, architecture/ and sessions/. The agent reads the relevant ones at the start of each conversation, and adds to them as it learns.',
      app: 'Memory panel, from the sidebar',
      frames: [
        { dur: 1.6, caption: 'Notes about the project, in four folders.' },
        { dur: 2, caption: 'A new conversation reads the relevant ones first.' },
        { dur: 2.4, caption: 'When it learns something, it saves a note for next time.' },
      ],
    },
    {
      key: 'ship',
      title: 'Review, then ship',
      body: 'Read each conversation’s diffs in the Changes tab, unified or side by side. Then open a PR from the status bar, or merge the branch your usual way.',
      app: 'Changes tab · Create PR',
      frames: [
        { dur: 2, caption: 'Two files changed.' },
        { dur: 1.6, caption: 'Create PR, from the status bar.' },
        { dur: 2.4, caption: 'The branch heads for main.' },
      ],
    },
  ];

  const grow = (t, delay = 0) => Math.min(1, Math.max(0, (t - delay) / 1.1));
</script>

{#snippet worktrees(f, t)}
  <div class="ground"></div>
  <div class="trees">
    <div class="col main"><Tree scale={4} /><span class="tag main-tag">main</span></div>
    {#each AGENTS as a, i}
      <div class="col">
        <Tree scale={3} growth={f === 0 ? 0 : f === 1 ? grow(t, i * 0.25) : 1} tint={a.tint} />
        {#if f >= 2}<span class="tag">{a.branch}</span>{/if}
        {#if f >= 3}<span class="seat"><BenchSeat state="working" seed={a.id} scale={2} label="" /></span>{/if}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet status(f)}
  <div class="gb mini side">
    <div class="pad"><Chips states={SIDEBAR[f].map((r) => r.state)} /></div>
    {#each SIDEBAR[f] as r (r.id)}<Row c={r} />{/each}
  </div>
{/snippet}

{#snippet permissions(f)}
  <div class="gb mini thread">
    <ThreadItem it={{ kind: 'tool', tool: 'Edit', detail: 'src/auth/session.ts', add: 2, del: 1 }} />
    {#if f >= 1}
      <ThreadItem it={{ kind: 'perm', tool: 'Bash', detail: 'npm test', resolved: f >= 2 ? 'allowed' : null }} seed="e52b9a73" />
    {/if}
    {#if f >= 3}<ThreadItem it={{ kind: 'bash', cmd: 'npm test', out: '5 passed' }} />{/if}
    {#if f === 1}
      <span class="pointer" aria-hidden="true">
        <svg width="14" height="19" viewBox="0 0 8 11" shape-rendering="crispEdges"><path d="M0 0h1v1h1v1h1v1h1v1h1v1h1v1h1v1H5v1h1v2H5v-1H4V9H3V8H2v1H1v1H0z" fill="#0b1224" /><path d="M1 2h1v1h1v1h1v1h1v1h1v1H4v1h1v1H4V8H3V7H2v1H1z" fill="#f4ecdd" /></svg>
      </span>
    {/if}
  </div>
{/snippet}

{#snippet checkpoints(f, t)}
  <div class="ground"></div>
  <div class="path-cp">
    {#each [1, 2, 3] as n, i}
      <div class="flag" class:gone={f === 3 && n === 3} class:hidden={i > f && f < 3}>
        <Pixels map={FLAG} scale={3} />
        <span class="tag">Turn {n}</span>
      </div>
    {/each}
    <span class="cp-agent" style="left: {f === 3 ? 30 + (1 - Math.min(1, t / 0.9)) * 30 : [8, 30, 60][f] + Math.min(1, t / 1) * 12}%">
      <Sprite state={f === 3 ? 'ready' : 'working'} seed="a3f8b2c1" scale={3} label="" />
    </span>
    {#if f === 3}<span class="rewind pixel">⟲ Rewind all</span>{/if}
  </div>
{/snippet}

{#snippet terminals(f)}
  <div class="terms">
    {#each [{ b: 'feat/auth', id: 'a3f8b2c1', lines: f >= 1 ? ['$ npm test', ' ✓ auth.test.ts (4)', ' Tests  6 passed'] : ['$'] }, { b: 'fix/login-bug', id: 'e52b9a73', lines: f >= 2 ? ['$ npm run dev', ' VITE ready', ' ➜ localhost:5173'] : ['$'] }] as term}
      <div class="term gb">
        <div class="term-h"><Sprite state={(term.b === 'feat/auth' && f >= 1) || (term.b === 'fix/login-bug' && f >= 2) ? 'working' : 'ready'} seed={term.id} scale={2} label="" /> {term.b}</div>
        <pre>{term.lines.join('\n')}</pre>
      </div>
    {/each}
  </div>
  {#if f >= 3}<p class="note-strip">…\worktrees\3f9a1c2e\a3f8b2c1 · …\worktrees\3f9a1c2e\e52b9a73</p>{/if}
{/snippet}

{#snippet sleep(f)}
  <div class="center">
    {#if f === 2}
      <GroveWalk mode="wake" seed="9b0e27f5" scale={2} />
    {:else}
      <GroveScene state={f === 0 ? 'unread' : f === 1 ? 'sleeping' : 'ready'} seed="9b0e27f5" scale={3} />
    {/if}
  </div>
{/snippet}

{#snippet context(f)}
  <div class="ctx">
    <div class="gb ctxbar">
      <div class="ctxgrove"><ContextStrip seed="a3f8b2c1" percent={[3, 32, 90, 24][f]} width={150} scale={2} /></div>
      <div class="ctxrow"><span class="t-faint">acme-shop / feat/auth</span><span class="t-green">Context {[3, 32, 90, 24][f]}%</span></div>
    </div>
    {#if f === 3}<span class="cmd">/compact</span>{/if}
  </div>
{/snippet}

{#snippet memory(f, t)}
  <div class="board">
    {#each ['repo/', 'conventions/', 'architecture/', 'sessions/'] as n, i}
      <span class="note" class:lit={f === 1 && i < 3} class:fresh={f === 2 && i === 3}>{n}</span>
    {/each}
  </div>
  <div class="mem-agent">
    {#if f >= 1}
      <BenchSeat state="working" seed="1d6f4c08" scale={3} label="" />
      <span class="say pixel">{f === 1 ? 'Reading the notes…' : 'Saved: sessions/dashboard-search.md'}</span>
    {/if}
  </div>
{/snippet}

{#snippet ship(f, t)}
  <div class="gb mini shipbox">
    <div class="files">
      <div><b class="t-green">A</b> src/middleware/auth.ts <span class="add">+13</span></div>
      <div><b class="t-amber">M</b> src/routes/index.ts <span class="add">+6</span> <span class="del">-2</span></div>
    </div>
    <div class="sbar">
      <span class="t-faint">feat/auth</span>
      {#if f === 0}<span><span class="t-amber">↑2</span> <span class="t-primary">Create PR</span></span>{:else}<span><span class="t-green">●</span> <span class="t-primary">PR #42</span></span>{/if}
    </div>
  </div>
  {#if f === 2}
    <div class="shipwalk"><span style="left: {10 + Math.min(1, t / 2.2) * 62}%"><Walker seed="a3f8b2c1" scale={3} state="unread" /></span><b class="gate pixel">main</b></div>
  {/if}
{/snippet}

<Shell current="loops">
  <section class="wrap hero">
    <p class="eyebrow">Prototype · short loops</p>
    <h1>What Grove Bench does, in a few seconds each</h1>
    <p class="lede">
      A Windows app that runs several AI coding agents on one project at once, each in its own git worktree, on its own
      branch, with its own terminal. Every feature below plays on a loop. Hover to pause, or step through it.
    </p>
  </section>

  <section class="wrap grid" aria-label="Features">
    {#each FEATURES as feat (feat.key)}
      <article class="card">
        <Loop frames={feat.frames} label={feat.title}>
          {#snippet scene(f, t)}
            {#if feat.key === 'worktrees'}{@render worktrees(f, t)}
            {:else if feat.key === 'status'}{@render status(f)}
            {:else if feat.key === 'permissions'}{@render permissions(f)}
            {:else if feat.key === 'checkpoints'}{@render checkpoints(f, t)}
            {:else if feat.key === 'terminals'}{@render terminals(f)}
            {:else if feat.key === 'sleep'}{@render sleep(f)}
            {:else if feat.key === 'context'}{@render context(f)}
            {:else if feat.key === 'memory'}{@render memory(f, t)}
            {:else}{@render ship(f, t)}{/if}
          {/snippet}
        </Loop>
        <h2 class="pixel">{feat.title}</h2>
        <p>{feat.body}</p>
        <p class="app"><span>In the app</span> {feat.app}</p>
      </article>
    {/each}
  </section>

  <section class="wrap cta">
    <a class="btn primary" href={links.releases} target="_blank" rel="noopener">{@html DownloadIcon} Download for Windows</a>
    <p>Windows 10 or later, git 2.17+ and the Claude Code CLI.</p>
  </section>
</Shell>

<style>
  .hero {
    padding-block: 44px 28px;
  }
  h1 {
    margin-top: 8px;
    max-width: 22ch;
    font-family: var(--font-pixel);
    font-size: clamp(32px, 2.6vw + 20px, 54px);
    color: #f6f7fb;
  }
  .lede {
    margin-top: 14px;
    max-width: 66ch;
    color: #c7cfe0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
    gap: 44px 32px;
  }
  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .card h2 {
    margin-top: 10px;
    font-size: 22px;
    color: #f3f5fa;
  }
  .card p {
    margin-top: 8px;
    font-size: 14px;
    color: #c7cfe0;
  }
  .card .app {
    font-size: 12px;
    color: var(--muted);
  }
  .app span {
    margin-right: 6px;
    padding: 1px 6px;
    font-size: 11px;
    color: var(--leaf-1);
    border: 1px solid rgb(110 200 122 / 0.45);
  }
  .cta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
    padding-top: 56px;
  }
  .cta p {
    font-size: 13px;
    color: var(--muted);
  }

  /* Shared scene parts. Positions are in % of the 16:10 screen. */
  .ground {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 14%;
    background: linear-gradient(180deg, var(--leaf-3) 0 4px, var(--leaf-4) 4px);
  }
  .tag {
    margin-top: 4px;
    padding: 1px 5px;
    font-size: 10px;
    white-space: nowrap;
    color: var(--cream);
    background: #5a4130;
  }
  .main-tag {
    background: #2d2016;
  }
  .trees {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 14%;
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
  .col .tag {
    position: absolute;
    top: 100%;
    margin-top: 6px;
  }
  .seat {
    position: absolute;
    bottom: 0;
    left: 50%;
  }
  .mini {
    position: absolute;
    inset: 10px;
    overflow: hidden;
    font-size: 12px;
    border: 1px solid oklch(0.32 0 0);
  }
  .side {
    background: var(--side);
  }
  .pad {
    padding: 8px 12px 4px;
  }
  .thread {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }
  .pointer {
    position: absolute;
    left: 46px;
    bottom: 22px;
    animation: tap 1.1s steps(3) forwards;
  }
  @keyframes tap {
    from {
      transform: translate(60px, 40px);
    }
  }
  .path-cp {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 14%;
    height: 60%;
  }
  .flag {
    position: absolute;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .flag:nth-child(1) {
    left: 18%;
  }
  .flag:nth-child(2) {
    left: 44%;
  }
  .flag:nth-child(3) {
    left: 72%;
  }
  .flag .tag {
    position: absolute;
    top: 100%;
    margin-top: 6px;
  }
  .flag.hidden {
    visibility: hidden;
  }
  .flag.gone {
    opacity: 0.3;
  }
  .cp-agent {
    position: absolute;
    bottom: 0;
    transform: translateX(-50%);
  }
  .rewind {
    position: absolute;
    top: -14px;
    right: 8%;
    padding: 1px 8px;
    font-size: 13px;
    color: #3a0d0d;
    background: oklch(0.7 0.18 25);
  }
  .terms {
    position: absolute;
    inset: 12px 12px 34px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .term {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid oklch(0.32 0 0);
  }
  .term-h {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    font-size: 11px;
    background: var(--side);
    border-bottom: 1px solid var(--border);
  }
  .term pre {
    flex: 1;
    margin: 0;
    padding: 6px 8px;
    overflow: hidden;
    font: inherit;
    font-size: 10.5px;
    line-height: 1.6;
    color: var(--fg);
    background: oklch(0.17 0 0);
  }
  .note-strip {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 8px;
    overflow: hidden;
    font-size: 10px;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .ctx {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 12px;
    padding: 16px;
  }
  .ctxbar {
    position: relative;
    width: 100%;
    margin-top: 30px;
    border: 1px solid oklch(0.32 0 0);
  }
  .ctxgrove {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    overflow: hidden;
    line-height: 0;
  }
  .ctxgrove :global(svg) {
    max-width: none;
  }
  .ctxrow {
    display: flex;
    justify-content: space-between;
    padding: 8px 10px;
    font-size: 11px;
    background: var(--side);
  }
  .cmd {
    padding: 2px 10px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: #0b1224;
    background: var(--gold);
  }
  .board {
    position: absolute;
    top: 12%;
    left: 8%;
    right: 8%;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 10px;
    background: #5a4130;
    box-shadow: 0 0 0 3px #2d2016;
  }
  .note {
    padding: 4px 8px;
    font-size: 11px;
    color: var(--paper-ink);
    background: var(--cream);
    transition: transform 0.2s steps(2);
  }
  .note.lit {
    background: #ffe7a8;
    transform: translateY(-2px);
  }
  .note.fresh {
    background: #bff0c4;
  }
  .mem-agent {
    position: absolute;
    left: 50%;
    bottom: 10%;
    transform: translateX(-50%);
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }
  .say {
    margin-bottom: 18px;
    padding: 2px 8px;
    font-size: 12px;
    white-space: nowrap;
    color: var(--paper-ink);
    background: var(--cream);
    box-shadow: 0 0 0 2px var(--bark);
  }
  .shipbox {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    bottom: 40%;
  }
  .files {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
  }
  .sbar {
    display: flex;
    justify-content: space-between;
    padding: 8px 12px;
    font-size: 11px;
    background: var(--side);
    border-top: 1px solid var(--border);
  }
  .shipwalk {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 34%;
    border-bottom: 8px solid #8a6a4a;
  }
  .shipwalk span {
    position: absolute;
    bottom: 0;
    transform: translateX(-50%);
  }
  .gate {
    position: absolute;
    right: 8%;
    bottom: 0;
    padding: 2px 8px 18px;
    font-size: 13px;
    color: #12361a;
    background: var(--green);
  }
  @media (prefers-reduced-motion: reduce) {
    .pointer {
      animation: none;
    }
  }
</style>
