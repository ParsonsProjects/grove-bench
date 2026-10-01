<script>
  import { onMount } from 'svelte';
  import Window from '../shared/app/Window.svelte';
  import Tree from '../shared/Tree.svelte';
  import { DownloadIcon, GithubIcon } from '../../src/lib/icons.js';
  import { heroWorld } from './heroWorld.js';
  import { arrive } from './scroll.svelte.js';
  import { CHIPS, links } from './content.js';

  /**
   * Headline, buttons, and the app itself with notes pinned around it. The
   * window can be clicked: switch conversation, change tab, answer the
   * prompt. `title` is the headline as [dark part, blue part].
   *
   * @type {{ title: [string, string], lede: string }}
   */
  let { title, lede } = $props();

  const W = 1122;
  const H = 622;
  let world = $state(heroWorld());
  let zoom = $state(0.9);
  let stageEl = $state();

  onMount(() => {
    const ro = new ResizeObserver(([e]) => (zoom = Math.min(1, e.contentRect.width / W)));
    ro.observe(stageEl);
    return () => ro.disconnect();
  });

  const sel = () => world.convs.find((c) => c.id === world.selected);
  const handlers = {
    onselect(id) {
      world.selected = id;
      const c = sel();
      if (c.state === 'unread') c.state = 'ready';
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

  // Numbered pins on the window (in its own pixels), explained underneath.
  const NOTES = [
    { x: -16, y: 242, text: 'An amber question mark: this one needs you.' },
    { x: 650, y: 333, text: 'You decide what each agent may run.' },
    { x: 792, y: 523, text: 'Every conversation has its own branch and worktree.' },
    { x: -16, y: 350, text: 'Asleep: idle for a while. It wakes when you open it.' },
  ];
</script>

<section class="band b-hero" id="top">
  <div class="inner head">
    <div class="copy">
      <h1 class="h1">{title[0]}<br /><span class="tone-2">{title[1]}</span></h1>
      <p class="lede">{lede}</p>
      <ul class="chips" aria-label="Features">
        {#each CHIPS as c, i}
          <li class="chip {['amber', 'blue', 'pink', 'green', 'lilac'][i]}">{c}</li>
        {/each}
      </ul>
    </div>
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
    <div class="horizon" aria-hidden="true">
      {#each [4, 6, 3, 5, 4, 7, 3, 5] as s, i}<span style="--d: {i * 0.12}s"><Tree scale={s} dim={i % 2 === 0} /></span>{/each}
    </div>
    <div class="stage" bind:this={stageEl} style="height: {Math.round(H * zoom)}px">
      <div class="frame" style="zoom: {zoom}">
        <Window {world} {...handlers} />
      </div>
      <div class="pins" style="--z: {zoom}" aria-hidden="true">
        {#each NOTES as n, i}
          <span class="pin" style="left: calc({n.x}px * var(--z)); top: calc({n.y}px * var(--z))">{i + 1}</span>
        {/each}
      </div>
    </div>
    <ol class="legend" use:arrive>
      {#each NOTES as n, i}
        <li class="pop" style="transition-delay: {0.15 + i * 0.12}s"><span class="pin static">{i + 1}</span>{n.text}</li>
      {/each}
    </ol>
    <p class="hint small">The app’s own layout, with sample conversations. Click a conversation, a tab or the prompt.</p>
  </div>
</section>

<style>
  .head {
    display: grid;
    gap: 28px;
    padding-top: 64px;
    align-items: start;
  }
  @media (min-width: 960px) {
    .head {
      grid-template-columns: minmax(0, 1fr) auto;
      padding-top: 84px;
    }
  }
  .lede {
    max-width: 58ch;
    margin-top: 18px;
  }
  .chips {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 18px;
  }
  .ctas {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
  }
  @media (min-width: 960px) {
    .ctas {
      padding-top: 10px;
    }
  }
  .shot-wrap {
    position: relative;
    padding-top: 56px;
    padding-bottom: 40px;
  }
  .horizon {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding-inline: 4%;
    overflow: hidden;
    pointer-events: none;
  }
  @media (max-width: 700px) {
    .horizon {
      zoom: 0.5;
    }
  }
  .horizon span {
    animation: sprout 0.7s steps(5) var(--d) both;
  }
  @keyframes sprout {
    from {
      transform: translateY(14px);
      opacity: 0;
    }
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
  .pins {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .pin {
    position: absolute;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    margin: -12px 0 0 -12px;
    font-family: var(--pixel);
    font-size: 14px;
    font-weight: 700;
    color: #2a1a00;
    background: var(--gold);
    box-shadow:
      0 0 0 2px var(--ink),
      0 0 0 6px rgb(242 184 75 / 0.35);
    animation: beat 2.4s steps(2) infinite;
  }
  .pin.static {
    position: static;
    flex: none;
    margin: 0;
    animation: none;
  }
  @keyframes beat {
    50% {
      box-shadow:
        0 0 0 2px var(--ink),
        0 0 0 9px rgb(242 184 75 / 0.15);
    }
  }
  .legend {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    gap: 14px 24px;
    margin-top: 26px;
  }
  .legend li {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--soft);
  }
  .pop {
    transition:
      opacity 0.5s ease,
      transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  :global(.js-motion) .legend:not(:global(.in)) .pop {
    opacity: 0;
    transform: translateY(10px);
  }
  .hint {
    margin-top: 14px;
    text-align: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .horizon span,
    .pin {
      animation: none;
    }
  }
</style>
