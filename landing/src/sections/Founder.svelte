<script>
  import { trackLandingEvent } from '../lib/analytics.js';
  import { arrive } from './scroll.svelte.js';
  import { FOUNDER, README, links } from './content.js';
  import '../shared/app/app.css';

  /**
   * The founder note as a commit in the app's Terminal tab: `git log -1`,
   * with the note as the message and the sign-off as a trailer. The app's
   * terminal runs cmd.exe on Windows (src/main/terminal.ts), hence the prompt.
   */
  const PROMPT = 'C:\\grove-bench>';
</script>

<section class="band b-founder" id="why" aria-labelledby="founder-h">
  <div class="inner">
    <div class="gb term rise" use:arrive>
      <div class="tabs" aria-hidden="true"><span class="on">Terminal <i class="t-faint">Alt+4</i></span></div>
      <div class="screen">
        <p class="t-muted" aria-hidden="true">{PROMPT}git log -1</p>
        <p class="hash">commit {FOUNDER.commit}</p>
        <p>Author: {FOUNDER.name}</p>
        <h2 class="msg subject" id="founder-h">{FOUNDER.title}</h2>
        {#each FOUNDER.paragraphs as p}<p class="msg">{p}</p>{/each}
        <p class="msg t-muted">Signed-off-by: {FOUNDER.name}</p>
        <p class="t-muted" aria-hidden="true">{PROMPT}<span class="caret"></span></p>
      </div>
    </div>
    <p class="links">
      <a href={README} target="_blank" rel="noopener">read the readme ↗</a>
      <a href={links.github} target="_blank" rel="noopener" onclick={() => trackLandingEvent('github_click', { location: 'trail-founder' })}>see the source ↗</a>
    </p>
  </div>
</section>

<style>
  .inner {
    padding-block: 96px;
  }
  .term {
    max-width: 780px;
    box-shadow:
      0 0 0 1px rgb(58 42 28 / 0.2),
      0 26px 50px -22px rgb(58 42 28 / 0.45);
  }
  .tabs {
    display: flex;
    background: oklch(0.176 0 0);
    border-bottom: 1px solid var(--border);
  }
  .tabs span {
    padding: 7px 14px;
    font-size: 12px;
    border-bottom: 1px solid var(--primary);
    margin-bottom: -1px;
  }
  .tabs i {
    margin-left: 6px;
    font-style: normal;
  }
  .screen {
    padding: 18px 20px 20px;
    font-size: 13.5px;
    line-height: 1.65;
  }
  .hash {
    margin-top: 6px;
    color: var(--yellow);
    overflow-wrap: anywhere;
  }
  /* git log indents the message by four spaces. */
  .msg {
    max-width: calc(72ch + 4ch);
    padding-left: 4ch;
    margin-top: 1.1em;
  }
  .subject {
    font-family: inherit;
    font-size: clamp(17px, 0.8vw + 12px, 21px);
    font-weight: 700;
    line-height: 1.35;
    color: #fff;
  }
  .screen > p:last-child {
    margin-top: 1.1em;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 0 22px;
    margin-top: 12px;
    font-size: 13px;
  }
  .links a {
    display: inline-block;
    padding-block: 6px;
    color: var(--blue-ink);
  }
  @media (max-width: 760px) {
    .screen {
      padding: 14px 14px 16px;
      font-size: 12.5px;
    }
    .msg {
      padding-left: 2ch;
    }
  }
</style>
