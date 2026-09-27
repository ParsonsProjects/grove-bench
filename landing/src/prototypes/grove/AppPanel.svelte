<script>
  // A small copy of the real Grove Bench window, showing what the current
  // chapter (or the agent you clicked) looks like in the app. Styled after
  // src/renderer/components: Sidebar, TerminalPanel, MemoryPanel,
  // CheckpointsPanel, ChangesReviewPanel and CreatePrDialog.
  import { fade } from 'svelte/transition';
  import { treeGreens } from '../shared/brand.js';
  import { statusLabel } from './agents.js';

  /**
   * @type {{
   *   view: 'sidebar' | 'worktrees' | 'terminal' | 'memory' | 'checkpoints' | 'changes' | 'activity',
   *   agents?: any[], focus?: number | null, turn?: number, maxTurn?: number,
   *   rewindNote?: { mode: string, turn: number } | null,
   *   history?: { you: string, add: number, del: number }[],
   *   merged?: boolean, reduced?: boolean,
   *   onturn?: (n: number) => void, onrewind?: (mode: 'all' | 'conv') => void,
   *   onanswer?: (allow: boolean) => void, class?: string, style?: string,
   * }}
   */
  let {
    view,
    agents = [],
    focus = null,
    turn = 4,
    maxTurn = 4,
    rewindNote = null,
    history = [],
    merged = false,
    reduced = false,
    onturn,
    onrewind,
    onanswer,
    class: className = '',
    style = '',
  } = $props();

  const PROJECT = 'C:\\my-app';
  const TABS = ['Activity', 'Changes', 'Checkpoints', 'Terminal'];

  const focused = $derived(focus != null ? agents[focus] : null);
  const auth = $derived(agents.find((a) => a.branch === 'feat/auth') ?? agents[0]);
  const loginBug = $derived(agents.find((a) => a.rewindTarget));

  // Which conversation the window is showing, for the title bar.
  const conversation = $derived(
    {
      activity: focused?.branch,
      terminal: auth?.branch,
      checkpoints: loginBug?.branch,
      changes: loginBug?.branch,
    }[view] ?? null,
  );
  const tab = $derived({ activity: 'Activity', terminal: 'Terminal', checkpoints: 'Checkpoints', changes: 'Changes' }[view]);
  const viewKey = $derived(view === 'activity' ? `activity-${focus}` : view);
  const dur = $derived(reduced ? 0 : 220);

  // Short fake commit ids, stable per worktree.
  const shortSha = (id) => [...id].reverse().join('').slice(0, 7);

  function subtitle(a) {
    if (a.status === 'starting') return { text: 'Creating worktree…', tone: 'muted' };
    if (a.bubble?.tool === 'merge') return { text: 'Ready for main', tone: 'muted' };
    if (a.realStatus === 'permission') return { text: `Waiting for approval: Bash`, tone: 'waiting' };
    const b = a.bubble;
    if (!b) return { text: '', tone: 'muted' };
    if (a.status === 'ready') return { text: b.tool === 'done' ? b.detail : 'Ready', tone: 'muted' };
    return { text: `${b.tool}: ${b.detail}`, tone: 'working' };
  }

  /** Splits "src/x.ts +12 -4" into the path and coloured counts. */
  function splitCounts(detail) {
    const parts = detail.split(' ');
    const counts = [];
    while (parts.length > 1 && /^[+-]\d+$/.test(parts[parts.length - 1])) counts.unshift(parts.pop());
    return { text: parts.join(' '), counts };
  }

  // Terminal output appears a line at a time.
  let termShown = $state(6);
  $effect(() => {
    if (view !== 'terminal' || reduced) {
      termShown = 6;
      return;
    }
    termShown = 1;
    const id = setInterval(() => {
      termShown += 1;
      if (termShown >= 6) clearInterval(id);
    }, 480);
    return () => clearInterval(id);
  });

  // Memory files light up one after another, as if being read.
  let reading = $state(-1);
  $effect(() => {
    if (view !== 'memory' || reduced) {
      reading = -1;
      return;
    }
    reading = 0;
    const id = setInterval(() => (reading = (reading + 1) % 8), 650);
    return () => clearInterval(id);
  });

  let diffMode = $state('turn');
  let prClicked = $state(false);
  const prShown = $derived(prClicked || merged);

  const totals = $derived(history.reduce((t, h) => ({ add: t.add + h.add, del: t.del + h.del }), { add: 0, del: 0 }));
  const sinceHere = $derived(
    history.slice(turn - 1).reduce((t, h) => ({ add: t.add + h.add, del: t.del + h.del }), { add: 0, del: 0 }),
  );
  const thisTurn = $derived(history[turn - 1] ?? { add: 0, del: 0 });

  const MEMORY = [
    ['repo/', ['overview.md', 'key-files.md']],
    ['conventions/', ['naming.md', 'testing.md']],
    ['architecture/', ['data-flow.md', 'auth.md']],
    ['sessions/', ['feat-auth.md', 'fix-login-bug.md']],
  ];
</script>

{#snippet counts(add, del)}
  <span class="counts">
    {#if add}<span class="add">+{add}</span>{/if}
    {#if del}<span class="del">−{del}</span>{/if}
  </span>
{/snippet}

{#snippet prompt(path)}<span class="prompt">{path}&gt;</span>{/snippet}

<section class="ap {className}" {style} aria-label="The same thing in the Grove Bench app">
  <div class="ap-title">
    <svg width="11" height="13" viewBox="0 0 21 24" aria-hidden="true" shape-rendering="crispEdges">
      {#each treeGreens as p}<rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />{/each}
    </svg>
    <span class="ap-name">Grove Bench</span>
    {#if conversation}<span class="ap-conv">{conversation}</span>{/if}
    <span class="ap-cap">In the app</span>
  </div>

  <div class="ap-stack">
    {#key viewKey}
      <div class="ap-view" in:fade={{ duration: dur, delay: dur / 3 }} out:fade={{ duration: dur }}>
        {#if tab}
          <div class="ap-tabs" aria-hidden="true">
            {#each TABS as t}<span class:on={t === tab}>{t}</span>{/each}
          </div>
        {/if}

        {#if view === 'sidebar'}
          <div class="pad">
            <p class="caps">Conversations <span class="sort">Newest first</span></p>
            <ul class="sb">
              {#each [...agents].reverse() as a (a.id)}
                {@const sub = subtitle(a)}
                <li class="sb-row" class:fresh={a.status === 'starting'}>
                  <div class="sb-l1">
                    <span class="dot {a.status}" title={statusLabel(a.status)}></span>
                    <svg class="wt" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2h4v2H4zm0 6h4v2H4zM2 4h2v4H2zm6 0h2v4H8zm8 0h4v2h-4zm0 6h4v2h-4zm-2-4h2v4h-2zm6 0h2v4h-2zm-8 13h5v2h-5zm5-5h2v5h-2zM5 12h2v10H5z" /></svg>
                    <span class="sb-branch">{a.branch}</span>
                    <span class="sb-model">{a.model}</span>
                  </div>
                  <div class="sb-l2">
                    <span class="sb-wt">.grove-wt/{a.id}</span>
                    <span class="sb-sub {sub.tone}">{sub.text}</span>
                  </div>
                  <span class="sr-only">{statusLabel(a.status)}</span>
                </li>
              {/each}
            </ul>
          </div>
        {:else if view === 'worktrees'}
          <div class="term">
            <div>{@render prompt(PROJECT)} git worktree list</div>
            <div class="wt-grid">
              <span>C:/my-app</span><span class="muted">4e1a9c2</span><span class="br">[main]</span>
              {#each agents as a (a.id)}
                <span>C:/my-app/.grove-wt/{a.id}</span><span class="muted">{shortSha(a.id)}</span><span class="br">[{a.branch}]</span>
              {/each}
            </div>
            <div>{@render prompt(PROJECT)} <span class="cursor"></span></div>
          </div>
        {:else if view === 'terminal'}
          <div class="term-bar">
            <span class="live"><i></i>Running</span>
            <span class="tb">To prompt</span><span class="tb">Kill</span><span class="tb">Restart</span><span class="tb">Clear</span>
          </div>
          <div class="term" aria-live="off">
            <div>{@render prompt(`${PROJECT}\\.grove-wt\\${auth?.id}`)} npm test</div>
            {#if termShown >= 2}<div class="muted">&gt; vitest run</div>{/if}
            {#if termShown >= 3}<div><span class="ok">✓</span> src/middleware/auth.test.ts <span class="muted">(3 tests)</span></div>{/if}
            {#if termShown >= 4}<div><span class="ok">✓</span> src/routes/index.test.ts <span class="muted">(1 test)</span></div>{/if}
            {#if termShown >= 5}<div><span class="muted">Tests</span> <span class="ok strong">4 passed</span> <span class="muted">(4)</span></div>{/if}
            {#if termShown >= 6}<div>{@render prompt(`${PROJECT}\\.grove-wt\\${auth?.id}`)} <span class="cursor"></span></div>{/if}
          </div>
        {:else if view === 'memory'}
          <div class="pad">
            <p class="mem-title">Project Memory <span class="muted">my-app</span></p>
            <p class="budget">Agent prompt budget: <span class="fg">9.2 KB / 16 KB</span></p>
            <div class="meter" aria-hidden="true"><i style="width: 58%"></i></div>
            <p class="caps">Files</p>
            <dl class="mem">
              {#each MEMORY as [folder, files], fi}
                <div class="mem-row">
                  <dt>{folder}</dt>
                  <dd>
                    {#each files as f, j}
                      <span class:reading={reading === fi * 2 + j}>{f}</span>
                    {/each}
                  </dd>
                </div>
              {/each}
            </dl>
          </div>
        {:else if view === 'checkpoints'}
          <div class="cp">
            <div class="cp-row all">
              <span class="cp-n">≡</span><span class="cp-t">All turns</span>{@render counts(totals.add, totals.del)}
            </div>
            {#each [...history].map((h, i) => ({ ...h, n: i + 1 })).reverse() as h (h.n)}
              <button
                type="button"
                class="cp-row"
                class:sel={turn === h.n}
                aria-pressed={turn === h.n}
                onclick={() => onturn?.(h.n)}
              >
                <span class="cp-n">#{h.n}</span><span class="cp-t">{h.you}</span>{@render counts(h.add, h.del)}
              </button>
            {/each}
            <div class="cp-actions">
              <div class="seg" role="group" aria-label="Diff mode">
                <button type="button" class:on={diffMode === 'turn'} aria-pressed={diffMode === 'turn'} onclick={() => (diffMode = 'turn')}>This turn</button>
                <button type="button" class:on={diffMode === 'since'} aria-pressed={diffMode === 'since'} onclick={() => (diffMode = 'since')}>Since here</button>
              </div>
              <button type="button" class="btn primary" disabled={turn >= maxTurn} onclick={() => onrewind?.('all')}>Rewind all</button>
              <button type="button" class="btn" disabled={turn >= maxTurn} onclick={() => onrewind?.('conv')}>Conv. only</button>
            </div>
            <p class="cp-status" aria-live="polite">
              {#if rewindNote?.mode === 'all'}
                Rewound to #{rewindNote.turn}: files and conversation.
              {:else if rewindNote?.mode === 'conv'}
                Conversation back at #{rewindNote.turn}. Files kept.
              {:else}
                #{turn} {diffMode === 'turn' ? 'this turn' : 'since here'}:
                {@render counts(diffMode === 'turn' ? thisTurn.add : sinceHere.add, diffMode === 'turn' ? thisTurn.del : sinceHere.del)}
                {#if (diffMode === 'turn' ? thisTurn.add + thisTurn.del : sinceHere.add + sinceHere.del) === 0}<span class="muted">no file changes</span>{/if}
              {/if}
            </p>
          </div>
        {:else if view === 'changes'}
          <div class="pad">
            <div class="ch-scope">
              <span class="seg static"><span>Uncommitted</span><span class="on">Branch</span></span>
              <span class="muted">vs main</span>
            </div>
            <ul class="ch">
              <li><span class="st m">M</span><span class="path">src/auth/session.ts</span>{@render counts(12, 4)}</li>
              <li><span class="st a">A</span><span class="path">src/auth/session.test.ts</span>{@render counts(38, 0)}</li>
            </ul>
            <button type="button" class="btn primary" disabled={prShown} onclick={() => (prClicked = true)}>
              {prShown ? 'PR created' : 'Create PR'}
            </button>
            {#if prShown}
              <div class="term inset" transition:fade={{ duration: dur }}>
                <div><span class="prompt">&gt;</span> gh pr create --base main</div>
                <div><span class="ok">✓</span> github.com/you/my-app/pull/42</div>
              </div>
            {/if}
          </div>
        {:else if view === 'activity' && focused}
          <ul class="ac pad">
            {#each focused.activity as it, i (i)}
              {#if it.kind === 'user'}
                <li class="ac-user">{it.text}</li>
              {:else if it.kind === 'tool'}
                {@const d = splitCounts(it.detail)}
                <li class="ac-tool">
                  <b>{it.tool}</b><span class="ac-d">{d.text}</span>
                  {#each d.counts as c}<span class={c.startsWith('+') ? 'add' : 'del'}>{c.replace('-', '−')}</span>{/each}
                  {#if it.pending}<i class="pend" aria-label="running"></i>{/if}
                </li>
              {:else if it.kind === 'text'}
                <li class="ac-text">{it.text}</li>
              {:else if it.kind === 'system'}
                <li class="ac-sys">{it.text}</li>
              {:else if it.kind === 'permission'}
                <li class="ac-perm">
                  <div><b>Bash</b> <span class="ac-d">{it.detail}</span></div>
                  {#if it.resolved}
                    <span class="muted">{it.resolved}</span>
                  {:else}
                    <div class="perm-btns">
                      <button type="button" class="btn primary" onclick={() => onanswer?.(true)}>Allow</button>
                      <button type="button" class="btn" onclick={() => onanswer?.(true)}>Always Allow</button>
                      <button type="button" class="btn" onclick={() => onanswer?.(false)}>Deny</button>
                    </div>
                  {/if}
                </li>
              {/if}
            {/each}
          </ul>
        {/if}
      </div>
    {/key}
  </div>
</section>

<style>
  .ap {
    --bg: #181818;
    --card: #1e1e1e;
    --side: #111111;
    --line: #2a2a2a;
    --fg: #c9c9c9;
    --muted: #8a8a8a;
    --primary: oklch(0.541 0.181 254.624);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
    font-size: 12px;
    line-height: 1.45;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--line);
    box-shadow: 6px 6px 0 0 rgb(0 0 0 / 0.45);
  }
  .ap-title {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 24px;
    padding: 0 8px;
    font-size: 11px;
    color: var(--muted);
    background: var(--card);
    border-bottom: 1px solid #242424;
    white-space: nowrap;
  }
  .ap-conv {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg);
  }
  .ap-conv::before {
    content: '/ ';
    color: #555;
  }
  .ap-cap {
    margin-left: auto;
    padding: 0 6px;
    color: #9cc3ff;
    background: rgb(0 108 212 / 0.2);
  }
  .ap-stack {
    display: grid;
    min-height: 0;
    overflow: hidden;
    /* Anything that does not fit fades out instead of spilling onto the scene. */
    mask-image: linear-gradient(to bottom, #000 calc(100% - 14px), transparent);
  }
  .ap-view {
    grid-area: 1 / 1;
    min-width: 0;
  }
  .ap-tabs {
    display: flex;
    background: var(--card);
    border-bottom: 1px solid #242424;
    overflow: hidden;
  }
  .ap-tabs span {
    padding: 3px 9px 2px;
    font-size: 11px;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }
  .ap-tabs span.on {
    color: var(--fg);
    border-bottom-color: var(--primary);
  }
  .pad {
    padding: 6px 10px 9px;
  }
  .caps {
    margin-bottom: 4px;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
  }
  .sort {
    float: right;
    letter-spacing: 0;
    text-transform: none;
    color: #6f6f6f;
  }
  .fg {
    color: var(--fg);
  }
  .add {
    color: #4ade80;
  }
  .del {
    color: #f87171;
  }
  .counts {
    display: inline-flex;
    gap: 5px;
    font-size: 11px;
  }

  /* Sidebar */
  .sb {
    display: grid;
    gap: 2px;
    list-style: none;
  }
  .sb-row {
    position: relative;
    padding: 2px 4px 3px;
    line-height: 1.35;
    background: var(--side);
  }
  .sb-row.fresh {
    outline: 1px solid rgb(234 179 8 / 0.35);
  }
  .sb-l1,
  .sb-l2 {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .sb-l2 {
    padding-left: 26px;
    font-size: 11px;
  }
  .wt {
    flex: none;
    color: var(--muted);
  }
  .sb-branch {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sb-model {
    margin-left: auto;
    flex: none;
    font-size: 11px;
    color: var(--muted);
  }
  .sb-wt {
    flex: none;
    color: #6f6f6f;
  }
  .sb-sub {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sb-sub.working {
    color: #6aa8ff;
  }
  .sb-sub.waiting {
    color: #f59e0b;
  }
  .sb-sub.muted {
    color: var(--muted);
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    background: #737373;
  }
  .dot.working {
    background: var(--primary);
    animation: pulse 1.4s ease-in-out infinite;
  }
  .dot.permission {
    background: #f59e0b;
    animation: pulse 1s ease-in-out infinite;
  }
  .dot.ready {
    background: #22c55e;
  }
  .dot.starting {
    background: #eab308;
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }

  /* Terminal */
  .term {
    padding: 8px 10px 10px;
    font-size: 11px;
    line-height: 1.55;
    color: #d4d4d4;
    background: #1f1f1f;
    overflow-wrap: anywhere;
  }
  .term.inset {
    margin-top: 8px;
    padding: 5px 8px;
    border: 1px solid #242424;
  }
  .prompt {
    color: #9cc3ff;
  }
  .ok {
    color: #4ade80;
  }
  .strong {
    font-weight: 700;
  }
  .cursor {
    display: inline-block;
    width: 7px;
    height: 12px;
    vertical-align: -2px;
    background: #d4d4d4;
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .wt-grid {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    column-gap: 1ch;
    white-space: nowrap;
  }
  .wt-grid .br {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .term-bar {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    font-size: 11px;
    color: var(--muted);
    background: rgb(30 30 30 / 0.6);
    border-bottom: 1px solid #242424;
    white-space: nowrap;
    overflow: hidden;
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-right: auto;
  }
  .live i {
    width: 6px;
    height: 6px;
    background: #22c55e;
  }
  .tb {
    padding: 0 6px;
    border: 1px solid #2e2e2e;
  }

  /* Memory */
  .mem-title {
    margin-bottom: 4px;
    font-size: 12px;
    color: var(--fg);
  }
  .budget {
    font-size: 11px;
    color: var(--muted);
  }
  .meter {
    height: 5px;
    margin: 4px 0 8px;
    background: #2a2a2a;
  }
  .meter i {
    display: block;
    height: 100%;
    background: var(--primary);
  }
  .mem {
    display: grid;
    gap: 2px;
    font-size: 11px;
  }
  .mem-row {
    display: grid;
    grid-template-columns: 13ch 1fr;
    gap: 6px;
  }
  .mem dt {
    color: var(--fg);
  }
  .mem dd {
    display: flex;
    flex-wrap: wrap;
    gap: 0 10px;
    color: var(--muted);
  }
  .mem dd span {
    transition: color 0.2s;
  }
  .mem dd span.reading {
    color: #9cc3ff;
  }

  /* Checkpoints */
  .cp {
    background: var(--side);
  }
  .cp-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 3px 10px;
    font-size: 11px;
    text-align: left;
    color: var(--fg);
    border-bottom: 1px solid rgb(42 42 42 / 0.6);
    border-left: 2px solid transparent;
  }
  button.cp-row:hover {
    background: rgb(14 51 79 / 0.35);
  }
  .cp-row.sel {
    background: #262626;
    border-left-color: var(--primary);
  }
  .cp-row.all {
    color: var(--muted);
  }
  .cp-n {
    flex: none;
    min-width: 3ch;
    padding: 0 4px;
    text-align: center;
    color: var(--muted);
    background: #2a2a2a;
  }
  .cp-t {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cp-actions {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px 0;
  }
  .cp-status {
    display: flex;
    flex-wrap: wrap;
    gap: 0 6px;
    padding: 4px 10px 8px;
    font-size: 11px;
    color: var(--muted);
  }
  .seg {
    display: inline-flex;
    margin-right: auto;
    border: 1px solid #2e2e2e;
  }
  .seg button,
  .seg span {
    padding: 1px 6px;
    font-size: 11px;
    color: var(--muted);
  }
  .seg .on {
    color: var(--fg);
    background: #2a2a2a;
  }
  .seg.static {
    margin-right: 6px;
  }
  .btn {
    padding: 2px 8px;
    font-size: 11px;
    color: var(--muted);
    background: #2a2a2a;
    white-space: nowrap;
  }
  .btn.primary {
    color: #fff;
    background: var(--primary);
  }
  .btn:disabled {
    opacity: 0.5;
  }
  .btn:not(:disabled):hover {
    filter: brightness(1.15);
  }

  /* Changes */
  .ch-scope {
    display: flex;
    align-items: center;
    margin-bottom: 6px;
    font-size: 11px;
  }
  .ch {
    display: grid;
    gap: 2px;
    margin-bottom: 8px;
    list-style: none;
    font-size: 11px;
  }
  .ch li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 4px;
    background: var(--side);
  }
  .ch .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .st {
    width: 2ch;
    text-align: center;
    font-weight: 700;
  }
  .st.m {
    color: #f59e0b;
  }
  .st.a {
    color: #4ade80;
  }

  /* Activity */
  .ac {
    display: grid;
    gap: 3px;
    list-style: none;
    font-size: 11px;
  }
  .ac-user {
    padding: 2px 8px;
    color: var(--fg);
    border-left: 3px solid var(--primary);
    background: rgb(0 108 212 / 0.08);
  }
  .ac-tool,
  .ac-perm {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0 7px;
    padding: 1px 8px;
    border-left: 3px solid #2e2e2e;
  }
  .ac-tool b,
  .ac-perm b {
    color: var(--muted);
  }
  .ac-d {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .ac-text {
    padding: 2px 8px;
    color: #dcdcdc;
  }
  .ac-sys {
    padding: 1px 8px;
    color: #eab308;
  }
  .ac-perm {
    padding: 4px 8px;
    border-left-color: #f59e0b;
    background: rgb(245 158 11 / 0.08);
  }
  .perm-btns {
    display: flex;
    gap: 5px;
    width: 100%;
    margin-top: 4px;
  }
  .pend {
    width: 8px;
    height: 8px;
    background: var(--primary);
    animation: pulse 1s ease-in-out infinite;
  }

  .ap button:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .dot,
    .pend,
    .cursor {
      animation: none;
    }
  }
</style>
