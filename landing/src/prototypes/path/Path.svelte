<script>
  import './path.css';
  import { tick } from 'svelte';
  import { prefersReducedMotion } from '../shared/motion.js';
  import { links, treeGreens } from '../shared/brand.js';
  import { trackLandingEvent } from '../../lib/analytics.js';
  import { DownloadIcon, GithubIcon } from '../branches/icons.js';
  import Dialogue from '../grove/Dialogue.svelte';
  import World from './World.svelte';
  import Panel from './Panel.svelte';
  import Key from './Key.svelte';
  import { AGENTS, LANES, TURNS, STEPS, PERMISSION_RESULT } from './data.js';

  let pageEl = $state();
  let vw = $state(typeof window === 'undefined' ? 1440 : window.innerWidth);
  let dpr = $state(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);

  const reduced = $derived(prefersReducedMotion.current);
  const wide = $derived(vw >= 900);
  // Art pixel size: 3 CSS px on laptops and up, 2 below. Always a whole
  // number of device pixels so the art stays crisp.
  const kTarget = $derived(wide && vw >= 1200 ? 3 : 2);
  const k = $derived(Math.max(1, Math.round(kTarget * dpr)) / dpr);
  const pxv = $derived(Math.max(2, Math.min(4, k)));

  /** @type {'pending' | 'allow' | 'always' | 'deny'} */
  let permission = $state('pending');
  let turn = $state(4);
  /** @type {null | 'all' | 'conv'} */
  let rewindMode = $state(null);
  let rewoundTo = $state(0);

  // Moving the sundial again clears the last rewind choice.
  let lastTurn = 4;
  $effect(() => {
    if (turn !== lastTurn) {
      lastTurn = turn;
      rewindMode = null;
    }
  });

  function answer(value) {
    permission = value;
  }

  function rewind(mode) {
    rewindMode = mode;
    rewoundTo = turn;
  }

  // ---------------------------------------------------------------------------
  // Agent dialogue

  /** @type {null | { key: string, status: string, target: HTMLElement, text: string }} */
  let open = $state(null);
  let dialogueRef = $state();

  function agentText(key, info) {
    const def = AGENTS.find((a) => a.key === key);
    if (key === 'api' && permission === 'pending' && info.status === 'permission')
      return `${def.task} Waiting for you: it wants to run \`${def.ask}\`. Answer it in Permissions.`;
    if (info.status === 'ready') return `${def.task} Done and ready for your review.`;
    if (key === 'fix' && turn < 4)
      return `${def.task} You took it back to turn ${turn}: "${TURNS[turn - 1].you}".`;
    if (info.sitting) {
      const step = def.work[def.work.length - 1];
      return `${def.task} Working at its bench in its own terminal: \`${step.term.slice(2)}\`.`;
    }
    return `${def.task} It works in its own worktree, on its own branch.`;
  }

  async function onagent(key, info) {
    if (open?.key === key) {
      closeAgent();
      return;
    }
    open = { key, status: info.status, target: info.target, text: agentText(key, info) };
    await tick();
    dialogueRef?.focus();
  }

  function closeAgent() {
    const target = open?.target;
    open = null;
    target?.focus();
  }

  // ---------------------------------------------------------------------------
  // Floating key

  let keyOpen = $state(false);
  let keyBtn = $state();

  function onWindowKey(e) {
    if (e.key !== 'Escape') return;
    if (open) closeAgent();
    else if (keyOpen) {
      keyOpen = false;
      keyBtn?.focus();
    }
  }

  function onWindowPointer(e) {
    if (keyOpen && !e.target.closest?.('.pp-keyfloat')) keyOpen = false;
  }

  // What the world tells the page: its geometry (to place the controls), the
  // agents' statuses, and a small API (also used by the scroll checks).
  /** @type {any} */
  let geo = $state(null);
  let hitEls = $state([]);
  let statuses = $state({ auth: 'working', api: 'working', fix: 'working' });
  let worldApi = null;
  function ondebug(api) {
    worldApi = api;
    if (typeof window !== 'undefined') window.__path = api;
  }
  const statusWord = { working: 'working', permission: 'waiting for you', ready: 'ready' };

  function clickAgent(i, e) {
    const a = worldApi?.agents()[i];
    if (!a) return;
    onagent(a.key, { status: statuses[a.key], sitting: a.pose === 'sit', target: e.currentTarget });
  }
  const cssPx = (v) => `${(v * k).toFixed(1)}px`;
  // Agent hit areas: the sprite plus a margin, never smaller than a finger.
  const hitW = $derived(Math.round(Math.max(13 * k, 34)));
  const hitH = $derived(Math.round(Math.max(19 * k, 44)));

  const footerLinks = [
    { label: 'GitHub', href: links.github },
    { label: 'Releases', href: links.releases },
    { label: 'Contributing', href: links.contributing },
    { label: 'License', href: links.license },
    { label: 'Issues', href: links.issues },
  ];
</script>

<svelte:window bind:innerWidth={vw} bind:devicePixelRatio={dpr} onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

{#snippet logo(size)}
  <svg width={size} height={Math.round((size * 24) / 21)} viewBox="0 0 21 24" fill="none" aria-hidden="true" style="image-rendering: pixelated">
    {#each treeGreens as p}
      <rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />
    {/each}
  </svg>
{/snippet}

{#snippet ctas(location)}
  <div class="pp-ctas">
    <a
      href={links.releases}
      target="_blank"
      rel="noopener"
      class="pp-btn primary"
      onclick={() => trackLandingEvent('download_click', { location })}
    >
      {@html DownloadIcon}
      Download for Windows
    </a>
    <a
      href={links.github}
      target="_blank"
      rel="noopener"
      class="pp-btn"
      onclick={() => trackLandingEvent('github_click', { location })}
    >
      {@html GithubIcon}
      View source
    </a>
  </div>
{/snippet}

<div class="pp-page" class:wide bind:this={pageEl} style="--k: {k}px; --px: {pxv}px">
  {#if pageEl}
    <World
      page={pageEl}
      {k}
      {wide}
      {reduced}
      {permission}
      {turn}
      {rewindMode}
      {hitEls}
      ongeo={(g) => (geo = g)}
      onstatus={(st) => (statuses = st)}
      {ondebug}
    />
  {/if}

  <a class="pp-skip" href="#pp-main">Skip to content</a>

  <nav class="pp-nav" aria-label="Main">
    <div class="pp-wrap pp-nav-inner">
      <a href="#top" class="pp-brand" aria-label="Grove Bench, back to top">
        {@render logo(16)}
        <span>Grove Bench</span>
      </a>
      <div class="pp-keyfloat">
        <button
          type="button"
          class="key-btn"
          bind:this={keyBtn}
          aria-expanded={keyOpen}
          aria-controls="pp-key-pop"
          onclick={() => (keyOpen = !keyOpen)}
        >
          {@render logo(12)}
          Key
        </button>
        {#if keyOpen}
          <div class="key-pop" id="pp-key-pop">
            <Key />
          </div>
        {/if}
      </div>
      <a
        href={links.github}
        target="_blank"
        rel="noopener"
        class="pp-gh"
        onclick={() => trackLandingEvent('github_click', { location: 'path-nav' })}
      >
        {@html GithubIcon}
        GitHub
      </a>
    </div>
  </nav>

  <main id="pp-main">
    <!-- 1. Hero -->
    <header class="pp-hero" id="top">
      <div class="pp-wrap pp-row hero-row">
        <div
          class="pp-scene hero-scene"
          data-scene="hero"
          role="img"
          aria-label="Night. The main path starts under a big tree, the project's own worktree. Three agents stand on the path beside a blue status lamp."
        ></div>
        <div class="hero-text">
          <p class="hero-meta"><code>4b1e0c7</code> <span class="pp-chip" style="--lane: {LANES.main.colour}; --lane-text: {LANES.main.text}">(main)</span></p>
          <h1>Run several AI coding agents on one project at once</h1>
          <p class="lede">
            Grove Bench is a Windows app for AI coding agents. Each conversation works in its own git worktree, on its own
            branch, with its own terminal.
          </p>
          {@render ctas('path-hero')}
          <p class="scroll-hint">Scroll down and the agents walk the path with you. Click one to ask what it is doing.</p>
        </div>
        {#if geo}
          <!-- The agents, clickable wherever they are on the path -->
          {#each AGENTS as a, i (a.key)}
            <button
              class="pp-hit"
              type="button"
              bind:this={hitEls[i]}
              style="width: {hitW}px; height: {hitH}px; margin-left: {-hitW / 2}px; margin-top: {k - hitH}px"
              aria-label="{LANES[a.key].name} agent, {statusWord[statuses[a.key]]}. Open details"
              onclick={(e) => clickAgent(i, e)}
            ></button>
          {/each}
        {/if}
        <div class="hero-key" data-panel>
          <Key />
        </div>
      </div>
    </header>

    <!-- 2. Worktrees -->
    <section class="pp-stop" aria-labelledby="h-wt">
      <div class="pp-wrap pp-row">
        <div
          class="pp-scene"
          data-scene="worktrees"
          style="--scene-h: 212"
          role="img"
          aria-label="Main forks into three side paths, feat/auth, feat/api and fix/login-bug, each with a signpost and a young tree for its worktree. Each agent steps onto its own path."
        ></div>
        <Panel hash="9fceb02" lane="main" title="Worktrees" id="h-wt">
          <p>
            Click <code>+ Conversation</code> and Grove Bench makes a branch, a git worktree in
            <code>.grove-wt/&lt;id&gt;</code> and a terminal. Each agent edits its own copy, so none of them overwrites another.
          </p>
          <p class="aside">Each tree beside a lane is one worktree.</p>
        </Panel>
      </div>
    </section>

    <!-- 3. Terminals -->
    <section class="pp-stop" aria-labelledby="h-term">
      <div class="pp-wrap pp-row">
        <div
          class="pp-scene"
          data-scene="terminals"
          style="--scene-h: 144"
          role="img"
          aria-label="Each agent sits on a bench beside its lane with a glowing laptop and a blue lamp. Speech bubbles show its tool calls and terminal output."
        ></div>
        <Panel hash="3e7a1d9" lane="auth" title="Terminals" id="h-term">
          <p>
            Every conversation has its own terminal, a real PTY opened in its worktree. Run the tests in one while another
            runs a dev server.
          </p>
          <p class="aside">A blue lamp means the agent is working.</p>
        </Panel>
      </div>
    </section>

    <!-- 4. Permissions -->
    <section class="pp-stop" id="permissions" aria-labelledby="h-perm">
      <div class="pp-wrap pp-row">
        <div
          class="pp-scene"
          data-scene="permissions"
          style="--scene-h: 144"
          role="img"
          aria-label="A small gate closes the feat/api lane. Its agent waits there with an amber lamp until you answer."
        ></div>
        <Panel hash="6f1c3b8" lane="api" title="Permissions" id="h-perm">
          <p>
            Before an agent runs a command or edits a file, its lamp turns amber and it waits for you. Pick a mode per
            conversation: Default, Accept Edits or Plan.
          </p>
          <div class="pp-prompt" role="group" aria-labelledby="perm-q">
            <p id="perm-q" class="prompt-q">
              <span class="dot" class:amber={permission === 'pending'} aria-hidden="true"></span>
              <b>feat/api</b> wants to run <code>npm install zod</code>
            </p>
            {#if permission === 'pending'}
              <div class="pp-choices">
                <button type="button" class="pp-pixbtn allow" onclick={() => answer('allow')}>Allow</button>
                <button type="button" class="pp-pixbtn" onclick={() => answer('always')}>Always Allow</button>
                <button type="button" class="pp-pixbtn deny" onclick={() => answer('deny')}>Deny</button>
              </div>
            {/if}
            <p class="prompt-result" aria-live="polite">
              {#if permission !== 'pending'}{PERMISSION_RESULT[permission]}{:else}Its lane stays closed until you answer.{/if}
            </p>
          </div>
        </Panel>
      </div>
    </section>

    <!-- 5. Checkpoints -->
    <section class="pp-stop" aria-labelledby="h-cp">
      <div class="pp-wrap pp-row">
        <div
          class="pp-scene"
          data-scene="checkpoints"
          style="--scene-h: 150"
          role="img"
          aria-label="A sundial beside the fix/login-bug lane, with four numbered stones for its turns and the lane's tree behind it."
        ></div>
        {#if geo}
          <!-- Drag the sundial's shadow (or use the arrow keys) to walk fix/login-bug back -->
          <input
            class="pp-dial"
            type="range"
            min="1"
            max="4"
            step="1"
            bind:value={turn}
            style="left: {cssPx(geo.sundial.x - 18)}; top: {cssPx(geo.sundial.base - 30)}; width: {cssPx(36)}; height: {cssPx(32)}"
            aria-label="Sundial: checkpoint for fix/login-bug"
            aria-valuetext="Turn {turn} of 4: {TURNS[turn - 1].you}"
          />
        {/if}
        <Panel hash="8c4f0b2" lane="fix" title="Checkpoints" id="h-cp">
          <p>
            A checkpoint is saved each time you send a message. Drag the sundial's shadow, or use the arrow keys on it, to
            take fix/login-bug back a turn or two.
          </p>
          <div class="pp-turns">
            <p class="turn-read">
              Turn <b>{turn}</b> of 4: <span class="you">"{TURNS[turn - 1].you}"</span>
            </p>
            <div class="pp-rewind">
              <div class="opt">
                <button type="button" class="pp-pixbtn" disabled={turn >= 4} onclick={() => rewind('all')}>Rewind all</button>
                <span>files and conversation go back</span>
              </div>
              <div class="opt">
                <button type="button" class="pp-pixbtn" disabled={turn >= 4} onclick={() => rewind('conv')}>Conv. only</button>
                <span>just the conversation, files stay</span>
              </div>
            </div>
            <p class="prompt-result" aria-live="polite">
              {#if rewindMode === 'all'}
                Rewound to turn {rewoundTo}. Files and conversation are back where they were.
              {:else if rewindMode === 'conv'}
                Conversation back at turn {rewoundTo}. The files keep every change, so the tree stays full.
              {:else if turn < 4}
                Previewing turn {turn}. Pick how to rewind.
              {:else}
                Latest turn.
              {/if}
            </p>
          </div>
        </Panel>
      </div>
    </section>

    <!-- 6. Project memory -->
    <section class="pp-stop" aria-labelledby="h-mem">
      <div class="pp-wrap pp-row">
        <div
          class="pp-scene"
          data-scene="memory"
          style="--scene-h: 150"
          role="img"
          aria-label="An old tree and a glowing memory stone beside main. Notes labelled repo, conventions, architecture and sessions float down every lane to the agents."
        ></div>
        <Panel hash="2d9e6a5" lane="main" title="Project memory" id="h-mem">
          <p>
            Markdown notes for each project, in <code>repo/</code>, <code>conventions/</code>, <code>architecture/</code> and
            <code>sessions/</code>. Every conversation reads them first. A budget meter and auto-compaction keep them short.
          </p>
        </Panel>
      </div>
    </section>

    <!-- 7. Review and ship -->
    <section class="pp-stop" aria-labelledby="h-ship">
      <div class="pp-wrap pp-row">
        <div
          class="pp-scene"
          data-scene="review"
          style="--scene-h: 176"
          role="img"
          aria-label="The three lanes curve back into main and pass through a gate. Their lamps turn green as each agent walks through."
        ></div>
        <Panel hash="0a7d4e3" lane="main" title="Review and ship" id="h-ship">
          <p>
            Check each diff in the Changes tab, unified or side by side, and revert single files. Then open a PR from the app
            or merge the branch your usual way.
          </p>
          {#if permission === 'pending'}
            <p class="aside">feat/api is still waiting at its gate. <a href="#permissions">Answer it in Permissions</a>.</p>
          {/if}
        </Panel>
      </div>
    </section>

    <!-- 8. How it works -->
    <section class="pp-stop how" aria-labelledby="h-how">
      <div class="pp-wrap pp-row">
        <div class="pp-scene" data-scene="how" style="--scene-h: 110" aria-hidden="true"></div>
        <Panel hash="5b2e8f1" lane="main" title="How it works" id="h-how">
          <ol class="pp-steps">
            {#each STEPS as step, i}
              <li>
                <span class="n" aria-hidden="true">{i + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            {/each}
          </ol>
        </Panel>
      </div>
    </section>

    <!-- 9. CTA -->
    <section class="pp-stop cta" aria-labelledby="h-cta">
      <div class="pp-wrap pp-row">
        <div
          class="pp-scene"
          data-scene="cta"
          style="--scene-h: 132"
          role="img"
          aria-label="Main ends at a big tree that grows as you arrive. The agents stop beside it."
        ></div>
        <Panel hash="ea5c9d0" lane="main" head title="Try it on your next task" id="h-cta">
          {@render ctas('path-cta')}
          <p class="req">Windows 10 or later, git 2.17+ and the Claude Code CLI. Free and open source (MIT).</p>
        </Panel>
      </div>
    </section>
  </main>

  <footer class="pp-footer">
    <div class="pp-wrap pp-foot">
      <div class="foot-brand">
        {@render logo(12)}
        <span>Grove Bench</span>
        <span class="mit">Open source under MIT</span>
      </div>
      <ul class="foot-links">
        {#each footerLinks as l}
          <li>
            <a
              href={l.href}
              target="_blank"
              rel="noopener"
              onclick={() => trackLandingEvent('footer_click', { location: 'path-footer', link: l.label })}>{l.label}</a
            >
          </li>
        {/each}
      </ul>
    </div>
  </footer>

  {#if open}
    {@const def = AGENTS.find((a) => a.key === open.key)}
    <div class="pp-dialogue" style="--px: 3px">
      <Dialogue
        bind:this={dialogueRef}
        id="pp-agent"
        mode="agent"
        speaker={LANES[open.key].name}
        tag={def.model}
        status={open.status}
        text={open.text}
        instant={reduced}
        meta={[
          { label: 'Worktree', value: `.grove-wt/${def.id}` },
          { label: 'Branch', value: LANES[open.key].name },
          { label: 'Model', value: def.model },
        ]}
        onclose={closeAgent}
      />
    </div>
  {/if}
</div>
