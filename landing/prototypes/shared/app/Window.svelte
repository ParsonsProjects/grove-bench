<script>
  import './app.css';
  import Row from './Row.svelte';
  import Chips from './Chips.svelte';
  import ThreadItem from './ThreadItem.svelte';
  import StatusBar from './StatusBar.svelte';
  import Panes from './Panes.svelte';
  import GroveScene from '../GroveScene.svelte';
  import GroveWalk from '../GroveWalk.svelte';
  import { treeGreens } from '../../../src/lib/brand.js';

  /**
   * A copy of the Grove Bench window, drawn from a `world` object: the
   * conversations, which one is open, which tab, and an optional draft.
   * Every control calls back, so a page can drive it or let a visitor click.
   *
   * @type {{
   *   world: any,
   *   onselect?: (id: string) => void,
   *   ontab?: (tab: string) => void,
   *   onanswer?: (choice: string) => void,
   *   onpr?: () => void,
   *   onnew?: () => void,
   *   onstart?: () => void,
   *   onfile?: (i: number) => void,
   *   oncheckpoint?: (i: number) => void,
   * }}
   */
  let { world, onselect, ontab, onanswer, onpr, onnew, onstart, onfile, oncheckpoint } = $props();

  const TABS = [
    { key: 'thread', label: 'Thread', key2: 'Alt+1' },
    { key: 'changes', label: 'Changes', key2: 'Alt+2' },
    { key: 'checkpoints', label: 'Checkpoints', key2: 'Alt+3' },
    { key: 'terminal', label: 'Terminal', key2: 'Alt+4' },
    { key: 'preview', label: 'Preview', key2: 'Alt+5' },
  ];
  const c = $derived(world.convs.find((x) => x.id === world.selected) ?? null);
  const working = $derived(c && (c.state === 'working' || c.state === 'starting'));

  let threadEl = $state();
  $effect(() => {
    c?.items.length;
    c?.scene;
    if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
  });
</script>

<div class="gb win">
  <div class="title dots">
    <svg width="12" height="14" viewBox="0 0 21 24" aria-hidden="true">{#each treeGreens as p}<rect x={p.x} y={p.y} width="2" height="2" fill={p.fill} />{/each}</svg>
    <span>Grove Bench</span>
    <span class="wc" aria-hidden="true"><i>?</i><i>–</i><i>□</i><i>✕</i></span>
  </div>

  <div class="body">
    <aside class="side">
      <div class="search t-faint"><span>⌕ Search conversations...</span><span class="kbd">Ctrl+K</span></div>
      <div class="chips"><Chips states={world.convs.map((x) => x.state)} /></div>
      <div class="sec"><span>Conversations</span><span class="t-faint sort">Name <b class="t-muted">Age ⌄</b></span></div>
      <div class="rows">
        {#if world.draft}
          <div class="draftrow"><span class="t-primary">✎</span> New conversation <span class="t-faint">draft</span></div>
        {/if}
        {#each world.convs as x (x.id)}
          <Row c={x} selected={!world.draft && x.id === world.selected} target="row-{x.id}" onclick={() => onselect?.(x.id)} />
        {/each}
      </div>
      <div class="sec proj-h"><span>Projects</span></div>
      <div class="proj"><span class="t-faint">⌄</span><i style="background: {world.projectColor}"></i>{world.project} <span class="t-faint">{world.convs.length}</span></div>
      <div class="foot">
        <div class="fbtns">
          <span class="gb-btn">+ Project</span>
          <button type="button" class="gb-btn primary" data-target="new" onclick={onnew}>+ Conversation</button>
        </div>
      </div>
    </aside>

    <section class="work">
      {#if world.draft}
        <div class="draft-h"><b>New conversation</b><span class="t-faint">in {world.project} · Claude Agent</span><span class="t-muted dis">Discard</span></div>
        <div class="pane dots draft">
          <GroveScene scale={4} />
          <p class="dt">New conversation in {world.project}</p>
          <p class="t-muted dp">The agent will work on a new branch from main, in a separate copy. The branch is named from your message after the first reply.</p>
          <p class="t-muted dp">Mode: <span class="t-green">Read-safe</span>. Auto-accept edits and read-only commands; everything else asks. Uses an OS sandbox where one can start.</p>
        </div>
        <div class="bar2"><span class="agent2">Claude Agent <span class="t-faint">Opus 5.5 · <b class="t-green">Read-safe</b></span></span><span class="t-faint">{world.project} /</span><span class="pick">New branch ⌄</span></div>
        <div class="input">
          <div class="box" class:ph={!world.draft.text}>{world.draft.text || 'What should the agent work on? Include a ticket ID if there is one.'}{#if world.draft.text}<span class="caret"></span>{/if}</div>
          <button type="button" class="gb-btn startb" data-target="start" onclick={onstart}>Start</button>
        </div>
      {:else if c}
        <nav class="tabs">
          {#each TABS as t}
            <button type="button" class="tab" class:on={world.tab === t.key} data-target="tab-{t.key}" onclick={() => ontab?.(t.key)}>
              {t.label}
              {#if t.key === 'thread' && working}<i class="busy"></i>{/if}
              {#if t.key === 'thread' && c.state === 'permission'}<i class="busy amber"></i>{/if}
              {#if t.key === 'changes' && c.files?.length}<b class="count">{c.files.length}</b>{/if}
              <span class="t-faint">{t.key2}</span>
            </button>
          {/each}
        </nav>
        <div class="pane dots" class:pad={world.tab === 'thread'} bind:this={threadEl}>
          {#if world.tab === 'thread'}
            {#if c.scene === 'wake'}
              <div class="walk">
                {#key c.run}<GroveWalk mode="wake" run={c.run} seed={c.id} wakeFrom="sleeping" scale={4} />{/key}
                <p class="t-muted">Waking up...</p>
                <small class="t-faint">Click or press any key to skip</small>
              </div>
            {:else}
              <div class="items">
                {#each c.items as it, i (i)}
                  <ThreadItem {it} seed={c.id} {onanswer} />
                {/each}
                {#if c.scene === 'arrive'}
                  <div class="walk inline">{#key c.run}<GroveWalk mode="arrive" run={c.run} seed={c.id} scale={4} />{/key}</div>
                {/if}
              </div>
            {/if}
          {:else}
            <Panes {c} tab={world.tab} file={world.file ?? 0} {onfile} checkpoint={world.checkpoint ?? -1} {oncheckpoint} />
          {/if}
        </div>
        <StatusBar {c} {onpr} />
        <div class="input">
          <div class="box ph">{working ? 'Message (Enter to queue, sent when the agent is free)' : 'Message (Enter to send, @ for files, / for commands, ! for shell)'}</div>
          {#if working}
            <span class="gb-btn qb">Queue</span><span class="gb-btn deny">Stop</span>
          {:else}
            <span class="gb-btn qb">Send</span>
          {/if}
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .win {
    display: flex;
    flex-direction: column;
    width: 1120px;
    height: 620px;
    overflow: hidden;
    border: 1px solid oklch(0.32 0 0);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
    color: var(--muted-fg);
    background-color: oklch(0.17 0 0);
    flex: none;
  }
  .wc {
    display: flex;
    gap: 22px;
    margin-left: auto;
    font-style: normal;
  }
  .wc i {
    font-style: normal;
  }
  .body {
    display: grid;
    grid-template-columns: 284px minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }
  .side {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--side);
    border-right: 1px solid var(--border);
  }
  .search {
    display: flex;
    justify-content: space-between;
    margin: 10px 10px 8px;
    padding: 5px 8px;
    font-size: 12px;
    border: 1px solid var(--border);
  }
  .kbd {
    font-size: 10px;
  }
  .chips {
    padding: 0 12px 8px;
  }
  .sec {
    display: flex;
    justify-content: space-between;
    padding: 8px 12px 4px;
    font-size: 11.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted-fg);
  }
  .sort {
    font-size: 10px;
  }
  .rows {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .draftrow {
    display: flex;
    gap: 8px;
    padding: 9px 12px;
    font-size: 13px;
    background: oklch(0.26 0 0);
  }
  .proj-h {
    margin-top: 6px;
  }
  .proj {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    font-size: 12.5px;
  }
  .proj i {
    width: 8px;
    height: 8px;
  }
  .foot {
    margin-top: auto;
    padding: 10px;
    border-top: 1px solid var(--border);
  }
  .fbtns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .fbtns .gb-btn {
    justify-content: center;
    padding: 6px 0;
  }
  .work {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .tabs {
    display: flex;
    flex: none;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 14px 7px;
    font-size: 12.5px;
    color: var(--muted-fg);
    border-bottom: 2px solid transparent;
  }
  .tab.on {
    color: oklch(0.95 0 0);
    border-bottom-color: var(--primary);
  }
  .tab span {
    font-size: 11px;
  }
  .busy {
    width: 7px;
    height: 7px;
    background: var(--primary);
  }
  .busy.amber {
    background: var(--amber);
  }
  .count {
    padding: 0 4px;
    font-size: 10px;
    color: #fff;
    background: var(--primary);
  }
  .pane {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .pane.pad {
    overflow-y: auto;
    scrollbar-width: none;
    padding: 16px 18px 26px;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .walk {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 100%;
    text-align: center;
  }
  .walk p {
    margin: 10px 0 0;
  }
  .walk small {
    font-size: 11px;
  }
  .walk.inline {
    height: auto;
    padding: 10px 0;
  }
  .draft-h {
    display: flex;
    gap: 10px;
    padding: 7px 16px;
    font-size: 12px;
    background: oklch(0.233 0 0 / 0.5);
    border-bottom: 1px solid var(--border);
  }
  .draft-h b {
    font-weight: 500;
  }
  .dis {
    margin-left: auto;
  }
  .draft {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    text-align: center;
  }
  .dt {
    margin: 18px 0 6px;
    color: oklch(0.835 0 0 / 0.8);
  }
  .dp {
    max-width: 56ch;
    margin: 2px 0;
    font-size: 12px;
  }
  .bar2 {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    font-size: 11.5px;
    background: var(--side);
    border-top: 1px solid var(--border);
  }
  .agent2 {
    display: flex;
    gap: 8px;
    padding: 3px 8px;
    border: 1px solid var(--border);
  }
  .pick {
    padding: 2px 8px;
    color: var(--fg);
    border: 1px solid var(--border);
  }
  .input {
    display: flex;
    gap: 8px;
    align-items: stretch;
    padding: 10px 14px 12px;
    flex: none;
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
  .box.ph {
    color: var(--muted-fg);
  }
  .caret {
    display: inline-block;
    width: 7px;
    height: 14px;
    margin-left: 1px;
    vertical-align: -2px;
    background: var(--fg);
    animation: gbblink2 1s steps(2) infinite;
  }
  @keyframes gbblink2 {
    50% {
      opacity: 0;
    }
  }
  .qb {
    color: oklch(0.65 0.17 254.624);
    border-color: oklch(0.541 0.181 254.624 / 0.6);
  }
  .startb {
    color: oklch(0.65 0.17 254.624);
    border-color: var(--primary);
  }
</style>
