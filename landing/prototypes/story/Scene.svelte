<script>
  import { onMount } from 'svelte';
  import '../shared/app/app.css';
  import Sprite from '../shared/Sprite.svelte';
  import Tree from '../shared/Tree.svelte';
  import Walker from '../shared/Walker.svelte';
  import GroveScene from '../shared/GroveScene.svelte';
  import GroveWalk from '../shared/GroveWalk.svelte';
  import ContextStrip from '../shared/ContextStrip.svelte';
  import Row from '../shared/app/Row.svelte';
  import Chips from '../shared/app/Chips.svelte';
  import ThreadItem from '../shared/app/ThreadItem.svelte';
  import Panes from '../shared/app/Panes.svelte';
  import Pixels from '../shared/Pixels.svelte';
  import { FLAG, LAMP } from '../shared/app-art.js';

  /**
   * What the stage shows for one chapter. Each scene plays once when it
   * mounts (the page remounts it when its chapter comes into view), and ends
   * on a still frame that makes sense on its own.
   *
   * @type {{ scene: string }}
   */
  let { scene } = $props();

  const ID = 'a3f8b2c1';
  const COLOR = '#6ec87a';
  const NAME = 'feat/API-142-jwt-auth';
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // A small clock for the scene's own timeline, in seconds since it mounted.
  let s = $state(reduced ? 99 : 0);
  onMount(() => {
    if (reduced) return;
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      s = (now - start) / 1000;
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  });

  const conv = (over) => ({ id: ID, name: NAME, project: 'acme-shop', projectColor: COLOR, age: 'now', state: 'working', line: 'Working…', lineTone: 'blue', files: [], ...over });

  // Draft: the message types itself out.
  const MESSAGE = 'Add JWT auth to the API routes (API-142)';
  const typed = $derived(MESSAGE.slice(0, Math.max(0, Math.floor((s - 0.4) / 0.045))));

  // Thread: one block at a time.
  const THREAD = [
    { kind: 'you', text: MESSAGE },
    { kind: 'text', text: "I'll add a middleware that checks the token, then put it in front of the routes." },
    { kind: 'tool', tool: 'Read', detail: 'src/routes/index.ts' },
    { kind: 'tool', tool: 'Write', detail: 'src/middleware/auth.ts', add: 13 },
    { kind: 'tool', tool: 'Edit', detail: 'src/routes/index.ts', add: 6, del: 2 },
  ];
  const threadShown = $derived(THREAD.slice(0, Math.min(THREAD.length, 1 + Math.floor(s / 0.9))));

  // Permission: pick a mode to see what happens to `npm test`.
  const MODES = [
    { key: 'Ask', tone: 'blue', verdict: 'Waits for you. In Ask mode every edit and command asks first; reading files doesn’t.' },
    { key: 'Plan', tone: 'yellow', verdict: 'No edits yet. It explores and writes a plan, then asks you to approve the plan before it changes anything.' },
    { key: 'Edit', tone: 'purple', verdict: 'Still waits. Edit mode lets file edits in the worktree through; commands still ask.' },
    { key: 'Auto', tone: 'cyan', verdict: 'Goes ahead. Claude’s classifier approves or blocks each action instead of asking. Risky ones are blocked.' },
    { key: 'Read-safe', tone: 'green', verdict: 'Waits. Read-safe lets edits and known read-only commands (git status, ls, grep) through. npm test isn’t one.' },
  ];
  let mode = $state('Ask');
  const m = $derived(MODES.find((x) => x.key === mode));

  // Rename: the temporary name gives way after the first reply.
  const renamed = $derived(s > 1.6);

  // Checkpoints: what comes back with each button.
  let rewind = $state('all');

  // Sleep: asleep on the bench, then opened.
  const woke = $derived(s > 1.8);

  // Context: fills up, then /compact.
  const pct = $derived(s < 0.3 ? 4 : s < 5 ? 88 : 24);
  const compacted = $derived(s >= 5);

  // Ship: Create PR, then off to main.
  const prOpen = $derived(s > 1.4);
  const walk = $derived(Math.min(1, Math.max(0, (s - 1.8) / 3)));

  const FILES = [
    {
      path: 'src/middleware/auth.ts',
      status: 'A',
      add: 13,
      del: 0,
      diff: ['@@ -0,0 +1,13 @@', "+import jwt from 'jsonwebtoken';", '+', '+export function requireAuth(req, res, next) {', "+  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');", "+  if (!token) return res.status(401).json({ error: 'Missing token' });", '+  try {', '+    req.user = jwt.verify(token, process.env.JWT_SECRET);', '+    next();', '+  } catch {', "+    res.status(401).json({ error: 'Invalid token' });", '+  }', '+}'],
    },
    {
      path: 'src/routes/index.ts',
      status: 'M',
      add: 6,
      del: 2,
      diff: ['@@ -1,8 +1,12 @@', " import { Router } from 'express';", "+import { requireAuth } from '../middleware/auth';", ' ', ' export const routes = Router();', "-routes.use('/orders', orders);", "-routes.use('/profile', profile);", "+routes.use('/orders', requireAuth, orders);", "+routes.use('/profile', requireAuth, profile);", '+', '+// Health checks stay public.', "+routes.get('/health', (_req, res) => res.send('ok'));"],
    },
  ];
  let file = $state(1);
</script>

<div class="scene s-{scene}">
  {#if scene === 'draft'}
    <div class="gb card">
      <div class="bar-top"><b>New conversation</b> <span class="t-faint">in acme-shop · Claude Agent</span></div>
      <div class="dots body center">
        <GroveScene scale={3} />
        <p class="t-muted small">The agent will work on a new branch from main, in a separate copy. The branch is named from your message after the first reply.</p>
      </div>
      <div class="picker">
        <span class="t-faint">acme-shop /</span>
        {#each ['New branch', 'Branch or PR', 'Project folder'] as tab, i}<span class="ptab" class:on={i === 0}>{tab}</span>{/each}
      </div>
      <div class="input"><div class="box">{typed}<span class="caret"></span></div><span class="gb-btn startb">Start</span></div>
    </div>
  {:else if scene === 'worktree'}
    <div class="pix">
      <div class="sprout">
        <Tree scale={6} growth={Math.min(1, s / 1.4)} />
        <span class="sign">grove/{ID}</span>
      </div>
      <pre class="gb term"><span class="t-muted">PS C:\dev\acme-shop&gt;</span> git worktree list
{#if s > 1.2}C:/dev/acme-shop                                                    4f1c2ab [main]
<span class="hl">C:/Users/you/AppData/Roaming/grove-bench/worktrees/3f9a1c2e/{ID}  4f1c2ab [grove/{ID}]</span>{/if}</pre>
    </div>
  {:else if scene === 'arrive'}
    <div class="gb card">
      <div class="dots body">
        <ThreadItem it={{ kind: 'you', text: MESSAGE }} />
        <div class="center walkbox">
          <GroveWalk mode="arrive" seed={ID} scale={4} />
          <p class="t-muted small">{s < 3 ? 'Starting agent...' : ''}</p>
        </div>
      </div>
    </div>
  {:else if scene === 'thread'}
    <div class="gb card">
      <div class="side1"><Row c={conv({ name: `grove/${ID}`, line: `Edit: src/routes/index.ts` })} selected /></div>
      <div class="dots body list">
        {#each threadShown as it}<ThreadItem {it} seed={ID} />{/each}
      </div>
    </div>
  {:else if scene === 'rename'}
    <div class="gb card">
      <div class="side1 big">
        <Row c={conv({ name: renamed ? NAME : `grove/${ID}`, line: renamed ? 'Bash: npm test' : 'Write: src/middleware/auth.ts' })} selected />
      </div>
      <div class="dots body">
        <p class="t-faint small label">Recent branches in acme-shop</p>
        <ul class="branches">
          <li>feat/API-139-orders-export</li>
          <li>fix/BUG-77-early-logout</li>
          <li>chore/OPS-12-prune-branches</li>
          {#if renamed}<li class="new">{NAME}</li>{/if}
        </ul>
      </div>
    </div>
  {:else if scene === 'permission'}
    <div class="gb card">
      <div class="dots body list">
        {#if mode === 'Auto'}
          <ThreadItem it={{ kind: 'bash', cmd: 'npm test', out: '6 passed' }} />
        {:else if mode === 'Plan'}
          <div class="plan"><b class="t-yellow">plan ready</b> Agent wants to execute the plan<div class="pbtns"><span class="gb-btn allow">Approve</span><span class="gb-btn deny">Keep planning</span></div></div>
        {:else}
          <ThreadItem it={{ kind: 'perm', tool: 'Bash', detail: 'npm test', resolved: null }} seed={ID} />
        {/if}
      </div>
      <div class="modes" role="radiogroup" aria-label="Mode">
        {#each MODES as x}
          <button type="button" role="radio" aria-checked={mode === x.key} class="mode m-{x.tone}" class:on={mode === x.key} onclick={() => (mode = x.key)}>{x.key}</button>
        {/each}
      </div>
      <p class="verdict" aria-live="polite"><b class="m-{m.tone}">{m.key}:</b> {m.verdict}</p>
    </div>
  {:else if scene === 'done'}
    <div class="gb card">
      <div class="sidebar">
        <div class="chipsrow"><Chips states={['unread', 'working', 'ready']} /></div>
        <Row c={conv({ state: 'unread', line: 'Every route checks the token now. 6 tests passed.', lineTone: 'muted', files: [1, 2] })} />
        <Row c={conv({ id: 'e52b9a73', name: 'fix/BUG-77-early-logout', state: 'working', line: 'Bash: npm test' })} selected />
        <Row c={conv({ id: '9b0e27f5', name: 'docs/DOC-9-readme-api', state: 'ready', line: 'The README covers the new endpoints.', lineTone: 'muted' })} />
      </div>
      {#if s > 0.8}
        <div class="toast">
          <div class="toast-app">
            <svg width="10" height="12" viewBox="0 0 21 24" aria-hidden="true"><rect x="9" y="0" width="2" height="2" fill="#6ec87a" /><rect x="6" y="3" width="8" height="2" fill="#5ab868" /><rect x="3" y="6" width="14" height="2" fill="#4aaa58" /><rect x="0" y="9" width="20" height="2" fill="#3a9a48" /><rect x="9" y="12" width="2" height="8" fill="#8a6a4a" /></svg>
            Grove Bench
          </div>
          <b>{NAME}</b>
          <span>Agent finished a turn</span>
        </div>
      {/if}
    </div>
  {:else if scene === 'changes'}
    <div class="gb card tall"><Panes c={{ files: FILES, state: 'ready', id: ID }} tab="changes" {file} onfile={(i) => (file = i)} /></div>
  {:else if scene === 'checkpoints'}
    <div class="gb card">
      <div class="dots body">
        <div class="cols">
          {#each [{ k: 'files', label: 'Files' }, { k: 'conv', label: 'Conversation' }] as col}
            {@const back = rewind === 'all' || col.k === 'conv'}
            <div class="col">
              <p class="t-muted small">{col.label}</p>
              <ol class="flags">
                {#each [1, 2, 3] as n}
                  <li class:now={back ? n === 2 : n === 3} class:gone={back && n === 3}><Pixels map={FLAG} scale={1.5} /> Turn {n}</li>
                {/each}
              </ol>
              <p class="small" class:t-amber={back} class:t-muted={!back}>{back ? '⟲ back to turn 2' : 'kept as they are'}</p>
            </div>
          {/each}
        </div>
      </div>
      <div class="modes" role="radiogroup" aria-label="Rewind">
        <button type="button" role="radio" aria-checked={rewind === 'all'} class="mode m-red" class:on={rewind === 'all'} onclick={() => (rewind = 'all')}>Rewind all</button>
        <button type="button" role="radio" aria-checked={rewind === 'conv'} class="mode m-blue" class:on={rewind === 'conv'} onclick={() => (rewind = 'conv')}>Conv. only</button>
      </div>
      <p class="verdict">{rewind === 'all' ? 'Files and conversation go back to the checkpoint. A full undo.' : 'Only the conversation goes back. The files on disk stay as they are.'} Project memory notes aren’t rolled back.</p>
    </div>
  {:else if scene === 'others'}
    <div class="gb card">
      <div class="sidebar">
        <div class="chipsrow"><Chips states={['working', 'permission', 'unread', 'sleeping']} /></div>
        <Row c={conv({ line: 'Edit: src/routes/login.ts', files: [1] })} selected />
        <Row c={conv({ id: '7c19e0d4', name: 'feat/UI-31-dashboard-search', state: 'permission', line: 'Wants to run a command', lineTone: 'amber', files: [1, 2] })} />
        <Row c={conv({ id: 'e52b9a73', name: 'fix/BUG-77-early-logout', state: 'unread', line: 'Fixed. 5 tests passed.', lineTone: 'muted', files: [1] })} />
        <Row c={conv({ id: '9b0e27f5', name: 'docs/DOC-9-readme-api', state: 'sleeping', line: 'The README covers the new endpoints.', lineTone: 'muted', age: '1h ago', files: [1] })} />
      </div>
    </div>
  {:else if scene === 'sleep'}
    <div class="gb card">
      <div class="dots body center tallish">
        {#if !woke}
          <GroveScene state="sleeping" seed={ID} scale={4} />
          <p class="t-muted small">Sleeping</p>
        {:else}
          <GroveWalk mode="wake" seed={ID} scale={4} />
          <p class="t-muted small">Waking up...</p>
        {/if}
      </div>
    </div>
  {:else if scene === 'context'}
    <div class="gb card">
      <div class="dots body center tallish">
        <div class="bigstrip"><ContextStrip seed={ID} percent={pct} width={110} scale={4} /></div>
        <p class="pctnum t-green">Context {pct}%</p>
        <p class="small" class:t-amber={compacted} class:t-faint={!compacted}>{compacted ? '/compact: the conversation is summarised' : 'Filling the context window'}</p>
      </div>
    </div>
  {:else if scene === 'ship'}
    <div class="pix ship">
      <div class="gb shipbar">
        <span class="t-faint">acme-shop / <span class="t-muted">{NAME}</span></span>
        {#if prOpen}<span><span class="t-green">●</span> <span class="t-primary">PR #42</span></span>{:else}<span><span class="t-amber">↑3</span> <span class="t-primary under">Create PR</span></span>{/if}
      </div>
      <div class="path">
        <span class="walker" style="left: {8 + walk * 70}%">
          {#if walk < 1}<Walker seed={ID} scale={5} state="unread" />{:else}<Sprite state="unread" seed={ID} scale={5} />{/if}
        </span>
        <span class="gate" class:lit={walk >= 1}><Pixels map={LAMP} scale={4} /><span class="arch">main</span><Pixels map={LAMP} scale={4} /></span>
      </div>
    </div>
  {/if}
</div>

<style>
  .scene {
    width: 100%;
  }
  .card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid oklch(0.32 0 0);
    box-shadow:
      0 0 0 3px var(--ink),
      0 14px 40px rgb(0 0 0 / 0.45);
  }
  .card.tall {
    height: 380px;
  }
  .bar-top {
    padding: 7px 14px;
    font-size: 12px;
    border-bottom: 1px solid var(--border);
  }
  .bar-top b {
    font-weight: 500;
  }
  .body {
    padding: 16px;
  }
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
  }
  .tallish {
    min-height: 260px;
    justify-content: center;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 220px;
  }
  .small {
    max-width: 52ch;
    margin: 0;
    font-size: 12px;
  }
  .picker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: 11.5px;
    background: var(--side);
    border-top: 1px solid var(--border);
  }
  .ptab {
    padding: 2px 8px;
    color: var(--muted-fg);
    border: 1px solid var(--border);
  }
  .ptab.on {
    color: var(--fg);
    border-color: var(--primary);
  }
  .input {
    display: flex;
    gap: 8px;
    padding: 10px 12px 12px;
    border-top: 1px solid var(--border);
  }
  .box {
    flex: 1;
    min-height: 36px;
    padding: 8px 10px;
    font-size: 12.5px;
    background: var(--card);
    border: 1px solid var(--border);
  }
  .caret {
    display: inline-block;
    width: 7px;
    height: 14px;
    vertical-align: -2px;
    background: var(--fg);
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .startb {
    color: oklch(0.65 0.17 254.624);
    border-color: var(--primary);
  }

  .pix {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
  }
  .sprout {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 160px;
    justify-content: flex-end;
  }
  .sign {
    margin-top: 8px;
    padding: 3px 10px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--cream);
    background: #5a4130;
    box-shadow: 0 0 0 2px #2d2016;
  }
  .term {
    width: 100%;
    min-height: 90px;
    margin: 0;
    padding: 12px 14px;
    overflow-x: auto;
    font-size: 10.5px;
    line-height: 1.7;
    background: oklch(0.17 0 0);
    border: 1px solid oklch(0.32 0 0);
    box-shadow: 0 0 0 3px var(--ink);
    white-space: pre;
  }
  .hl {
    color: var(--green);
  }
  .walkbox {
    padding-top: 18px;
  }
  .side1 {
    background: var(--side);
    border-bottom: 1px solid var(--border);
  }
  .side1.big {
    zoom: 1.25;
  }
  .label {
    margin-bottom: 8px;
  }
  .branches {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12.5px;
    color: var(--muted-fg);
  }
  .branches .new {
    color: var(--green);
  }
  .plan {
    padding: 4px 0 4px 12px;
    font-size: 12px;
    border-left: 4px solid var(--yellow);
  }
  .t-yellow {
    color: var(--yellow);
  }
  .pbtns {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .modes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 12px 0;
    background: var(--side);
    border-top: 1px solid var(--border);
  }
  .mode {
    padding: 3px 10px;
    font-size: 12px;
    color: var(--muted-fg);
    border: 1px solid var(--border);
  }
  .mode.on {
    color: #0b1224;
    background: var(--c);
    border-color: var(--c);
  }
  .m-blue {
    --c: var(--blue);
  }
  .m-yellow {
    --c: var(--yellow);
  }
  .m-purple {
    --c: var(--purple);
  }
  .m-cyan {
    --c: var(--cyan);
  }
  .m-green {
    --c: var(--green);
  }
  .m-red {
    --c: oklch(0.7 0.18 25);
  }
  b.m-blue,
  b.m-yellow,
  b.m-purple,
  b.m-cyan,
  b.m-green {
    color: var(--c);
  }
  .verdict {
    margin: 0;
    padding: 8px 12px 12px;
    font-size: 12px;
    color: var(--fg);
    background: var(--side);
    min-height: 54px;
  }
  .sidebar {
    padding: 8px 0;
    background: var(--side);
  }
  .chipsrow {
    padding: 2px 12px 8px;
  }
  .toast {
    position: absolute;
    right: 14px;
    bottom: 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 250px;
    padding: 10px 12px;
    font-size: 12px;
    color: #f3f3f3;
    background: #2b2b2b;
    border: 1px solid #3c3c3c;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.5);
    animation: slide 0.3s steps(4);
  }
  .s-done .card {
    position: relative;
    min-height: 300px;
  }
  .toast-app {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #bbb;
  }
  @keyframes slide {
    from {
      transform: translateY(16px);
      opacity: 0;
    }
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .flags {
    list-style: none;
    margin: 6px 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .flags li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    font-size: 12px;
    border: 1px solid transparent;
  }
  .flags li.now {
    border-color: var(--border);
    background: oklch(0.26 0 0);
  }
  .flags li.gone {
    opacity: 0.35;
    text-decoration: line-through;
  }
  .bigstrip {
    width: 100%;
    display: flex;
    justify-content: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .pctnum {
    margin: 6px 0 0;
    font-size: 18px;
  }
  .shipbar {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    padding: 12px 14px;
    font-size: 12px;
    background: var(--side);
    border: 1px solid oklch(0.32 0 0);
    box-shadow: 0 0 0 3px var(--ink);
  }
  .under {
    text-decoration: underline;
  }
  .path {
    position: relative;
    width: 100%;
    height: 90px;
    border-bottom: 10px solid #8a6a4a;
    box-shadow: 0 6px 0 var(--leaf-4);
  }
  .walker {
    position: absolute;
    bottom: 0;
    transform: translateX(-50%);
  }
  .gate {
    position: absolute;
    right: 4%;
    bottom: 0;
    display: flex;
    align-items: flex-end;
    gap: 4px;
  }
  .arch {
    margin-bottom: 26px;
    padding: 2px 10px;
    font-family: var(--font-pixel);
    font-size: 15px;
    color: var(--cream);
    background: #2d2016;
    box-shadow: 0 0 0 2px #5a4130;
  }
  .gate.lit .arch {
    color: #12361a;
    background: var(--green);
  }
  @media (prefers-reduced-motion: reduce) {
    .caret,
    .toast {
      animation: none;
    }
  }
</style>
