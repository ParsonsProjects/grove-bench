<script>
  import Sprite from '../shared/Sprite.svelte';
  import Branch from './Branch.svelte';
  import { arrive } from './scroll.svelte.js';
  import { FAQ } from './content.js';
  import '../shared/app/app.css';

  /**
   * The FAQ as a conversation in the app's Thread tab: each question is a
   * message you sent, and opening it shows the reply. The character in the
   * header asks while nothing is open and holds a speech bubble once you've
   * opened an answer (the app's question poses).
   */
  let opened = $state(0);
</script>

<section class="band b-dusk" id="faq" aria-labelledby="faq-h">
  <div class="inner">
    <div class="rise" use:arrive>
      <Branch name="docs/faq" />
      <h2 class="h2" id="faq-h">Fair questions, short answers.</h2>
    </div>
    <div class="gb pane rise" use:arrive>
      <div class="bar">
        <span class="tab">Thread <i class="t-faint">Alt+1</i></span>
        <span class="who" aria-hidden="true">
          <Sprite state={opened ? 'answered' : 'asking'} seed="7c19e0d4" scale={2} label="" />
          <span class="t-muted">{opened ? 'Answered' : 'Pick a question'}</span>
        </span>
      </div>
      <div class="items dots">
        {#each FAQ as item}
          <details ontoggle={(e) => (opened += e.currentTarget.open ? 1 : -1)}>
            <summary><span class="gt" aria-hidden="true">&gt;</span><span class="q">{item.q}</span><span class="plus" aria-hidden="true">+</span></summary>
            <p>{item.a}</p>
          </details>
        {/each}
      </div>
    </div>
  </div>
</section>

<style>
  .inner {
    padding-block: 104px;
  }
  .pane {
    max-width: 880px;
    margin-top: 32px;
    box-shadow:
      0 0 0 1px rgb(201 195 230 / 0.16),
      0 30px 60px -24px rgb(0 0 0 / 0.5);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-right: 14px;
    background: var(--side);
    border-bottom: 1px solid var(--border);
  }
  .tab {
    margin-bottom: -1px;
    padding: 8px 14px;
    font-size: 12px;
    border-bottom: 1px solid var(--primary);
  }
  .tab i {
    margin-left: 6px;
    font-style: normal;
  }
  .who {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
  }
  /* Each question is a message you sent: a prompt mark and a blue bar. */
  summary {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 10px 12px;
    font-size: 13.5px;
    color: var(--fg);
    background: var(--primary-soft);
    border-left: 2px solid var(--primary);
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover {
    background: oklch(0.541 0.181 254.624 / 0.14);
  }
  .gt {
    color: var(--primary);
  }
  .plus {
    margin-left: auto;
    color: var(--muted-fg);
    transition: transform 0.2s steps(3);
  }
  details[open] .plus {
    transform: rotate(45deg);
  }
  /* The reply, as the agent's text. */
  details p {
    max-width: 68ch;
    padding: 12px 2px 8px 14px;
    font-size: 13.5px;
    line-height: 1.65;
    color: var(--fg);
  }
  @media (max-width: 760px) {
    .items {
      padding: 12px;
    }
  }
</style>
