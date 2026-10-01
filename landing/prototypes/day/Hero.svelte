<script>
  import { onMount } from 'svelte';
  import Window from '../shared/app/Window.svelte';
  import Row from '../shared/app/Row.svelte';
  import Chips from '../shared/app/Chips.svelte';
  import ThreadItem from '../shared/app/ThreadItem.svelte';
  import Sprite from '../shared/Sprite.svelte';
  import { WAKE_SCENE_MS } from '../shared/app-art.js';
  import '../shared/app/app.css';
  import { DownloadIcon, GithubIcon } from '../../src/lib/icons.js';
  import { heroWorld } from './heroWorld.js';
  import { links } from './content.js';

  /**
   * Headline, buttons, and the app itself. The window can be clicked: switch
   * conversation, change tab, answer the prompt. A line under it says what
   * the conversation you point at (or the open one) is doing. `title` is the
   * headline's two lines.
   *
   * @type {{ title: [string, string], lede: string }}
   */
  let { title, lede } = $props();

  const W = 1122;
  const H = 622;
  let world = $state(heroWorld());
  let zoom = $state(0.9);
  let stageEl = $state();
  // Below this width the whole window is too small to read, so the hero
  // shows the sidebar and the open conversation's prompt instead.
  let narrow = $state(false);

  onMount(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const fit = () => (narrow = mq.matches);
    fit();
    mq.addEventListener('change', fit);
    return () => mq.removeEventListener('change', fit);
  });

  $effect(() => {
    if (!stageEl) return;
    const ro = new ResizeObserver(([e]) => (zoom = Math.min(1, e.contentRect.width / W)));
    ro.observe(stageEl);
    return () => ro.disconnect();
  });
  const selected = $derived(world.convs.find((c) => c.id === world.selected));

  const sel = () => world.convs.find((c) => c.id === world.selected);
  const handlers = {
    onselect(id) {
      world.selected = id;
      const c = sel();
      if (c.state === 'unread') c.state = 'ready';
      // Opening a sleeping conversation wakes its agent, as in the app.
      if (c.state === 'sleeping') {
        c.state = 'starting';
        c.scene = 'wake';
        c.run += 1;
        setTimeout(() => {
          c.scene = null;
          c.state = 'ready';
        }, WAKE_SCENE_MS);
      }
    },
    ontab(tab) {
      world.tab = tab;
    },
    onanswer(choice) {
      const c = sel();
      const p = c.items.findLast((i) => i.kind === 'perm' && !i.resolved);
      if (!p) return;
      p.resolved = choice === 'deny' ? 'denied' : 'allowed';
      c.state = 'working';
      c.line = choice === 'deny' ? 'Working…' : 'Bash: npm test';
      c.lineTone = 'blue';
      if (choice !== 'deny') c.items.push({ kind: 'bash', cmd: 'npm test', running: true });
      setTimeout(() => {
        const bash = c.items.findLast((i) => i.kind === 'bash');
        if (bash) {
          bash.running = false;
          bash.out = '5 passed';
        }
        c.items.push({ kind: 'text', text: choice === 'deny' ? 'OK, I won’t run them. You can run npm test in the terminal.' : 'Fixed. 5 tests passed.' });
        c.state = 'ready';
        c.line = c.items.at(-1).text;
        c.lineTone = 'muted';
      }, 1800);
    },
    onfile(i) {
      world.file = i;
    },
  };

  // What each state means, in the help pages' words (docs/help/session-states.md).
  const MEANS = {
    permission: 'Waiting for you: it wants to run a command. Allow or deny it in the prompt.',
    working: 'Working: it edits files and runs commands on its own branch.',
    unread: 'Finished a turn while you were elsewhere. Open it to read the reply.',
    ready: 'Ready: waiting for your next message.',
    starting: 'Waking up: its agent starts again where it left off.',
    sleeping: 'Sleeping: idle for a while, so its agent was shut down to save memory. It wakes when you open it.',
  };
  // The conversation the pointer (or keyboard focus) is on, if any.
  let hoverId = $state(null);
  const pointAt = (e) => {
    const row = e.target.closest?.('[data-target^="row-"]');
    hoverId = row ? row.dataset.target.slice(4) : null;
  };
  const shown = $derived(world.convs.find((c) => c.id === hoverId) ?? selected);
</script>

<section class="band b-hero" id="top">
  <div class="inner head">
    <h1 class="h1 prompt"><span class="gt" aria-hidden="true">&gt;</span>{title[0]}<br />{title[1]}<span class="caret" aria-hidden="true"></span></h1>
    <p class="lede">{lede}</p>
    <div class="ctas">
      <div>
        <a class="d-btn" href={links.releases} target="_blank" rel="noopener">{@html DownloadIcon} Download for Windows</a>
        <p class="btn-note">free · Windows 10 or later</p>
      </div>
      <div>
        <a class="d-btn ghost" href={links.github} target="_blank" rel="noopener">{@html GithubIcon} View source</a>
        <p class="btn-note">source-available, FSL-1.1-MIT</p>
      </div>
    </div>
  </div>

  <div class="inner shot-wrap">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="app" onpointerover={pointAt} onfocusin={pointAt} onpointerleave={() => (hoverId = null)} onfocusout={() => (hoverId = null)}>
      {#if narrow}
        <div class="gb compact">
          <div class="c-chips"><Chips states={world.convs.map((c) => c.state)} /></div>
          {#each world.convs as c (c.id)}
            <Row {c} target="row-{c.id}" selected={c.id === world.selected} onclick={() => handlers.onselect(c.id)} />
          {/each}
          <div class="c-thread">
            {#each selected.items.slice(-3) as it, i (i)}
              <ThreadItem {it} seed={selected.id} onanswer={handlers.onanswer} />
            {/each}
          </div>
        </div>
      {:else}
        <div class="stage" bind:this={stageEl} style="height: {Math.round(H * zoom)}px">
          <div class="frame" style="zoom: {zoom}">
            <Window {world} {...handlers} />
          </div>
        </div>
      {/if}
    </div>
    <div class="caption" aria-live="polite">
      <Sprite state={shown.state} seed={shown.id} projectColor={shown.projectColor} scale={3} label="" />
      <p><b>{shown.name}</b><span>{MEANS[shown.state] ?? ''}</span></p>
    </div>
    <p class="hint small">{narrow ? 'Sample conversations in the app’s sidebar. Tap one, or answer the prompt.' : 'Sample conversations in the app’s own layout. Point at one to see what its character means, or click around.'}</p>
  </div>
</section>

<style>
  .head {
    padding-top: 72px;
  }
  @media (min-width: 960px) {
    .head {
      padding-top: 92px;
    }
  }
  .h1 {
    max-width: 18ch;
  }
  .lede {
    max-width: 60ch;
    margin-top: 22px;
  }
  .ctas {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin-top: 28px;
  }
  .shot-wrap {
    position: relative;
    padding-top: 52px;
    padding-bottom: 40px;
  }
  .stage {
    position: relative;
    z-index: 1;
  }
  .frame {
    width: 1122px;
    box-shadow:
      0 0 0 1px rgb(58 42 28 / 0.2),
      0 30px 60px -20px rgb(58 42 28 / 0.45),
      0 12px 24px -12px rgb(58 42 28 / 0.3);
  }
  .compact {
    position: relative;
    z-index: 1;
    overflow: hidden;
    background: oklch(0.176 0 0);
    box-shadow:
      0 0 0 1px rgb(58 42 28 / 0.2),
      0 24px 40px -20px rgb(58 42 28 / 0.45);
  }
  .c-chips {
    padding: 10px 12px 6px;
  }
  .c-thread {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 12px 16px;
    background: oklch(0.208 0 0);
    border-top: 1px solid oklch(0.26 0 0);
  }
  /* What the pointed-at conversation is doing, like a sidebar row. */
  .caption {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 64px;
    margin-top: 18px;
    padding: 10px 14px;
    background: rgb(255 255 255 / 0.55);
    border: 1px solid var(--line);
  }
  .caption p {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: 13.5px;
    line-height: 1.45;
  }
  .caption b {
    font-weight: 700;
  }
  .caption span {
    color: var(--soft);
  }
  .hint {
    margin-top: 12px;
    text-align: center;
  }
</style>
