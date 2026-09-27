<script>
  import Stage from '../Stage.svelte';
  import Commit from '../Commit.svelte';
  import Bubble from '../Bubble.svelte';
  import { shipScene } from '../scenes/ship.js';
  import { agents, hashes } from '../data.js';
  import { story } from '../story.svelte.js';

  /** @type {{ reduced?: boolean }} */
  let { reduced = false } = $props();

  const keys = /** @type {const} */ (['auth', 'api', 'fix']);
  /** @type {any} */
  let snap = $state(null);

  const waitingBubble = { tool: '?', detail: '' };
  const sitting = { auth: { tool: 'Bash', detail: 'npm test' }, api: { tool: 'Edit', detail: 'profile.ts +18' }, fix: { tool: 'Bash', detail: 'npm test' } };

  function talk(key) {
    const a = agents[key];
    if (key === 'api' && story.permission === 'pending') {
      return { status: 'permission', text: 'I am still waiting for your answer in Permissions, so my branch is not ready yet.' };
    }
    const pose = snap?.poses?.[key];
    if (pose === 'sit') return { status: 'working', text: `${a.task} Nearly done.` };
    return {
      status: 'ready',
      text: `\`${a.branch}\` is ready. Review my diff in the Changes tab, then open a PR from the app or merge the branch your usual way.`,
    };
  }
</script>

<section class="lg-section" aria-labelledby="h-ship">
  <div class="lg-wrap">
    <div class="lg-col">
      <Commit id="ship" hash={hashes.ship} title="Review and ship" headingId="h-ship">
        <p>
          Check each diff in the Changes tab, unified or side by side, and revert single files. Then open a PR from the
          app or merge the branch your usual way.
        </p>
      </Commit>
      <div class="lg-scene">
        <Stage
          id="ship"
          factory={shipScene}
          bind:snap
          {reduced}
          {talk}
          dataTod={0.52}
          class="lg-frame"
          label="Dawn. One by one the agents get up and walk along the path to the gate marked main, and each lamp turns green as its branch is ready. If feat/api is still waiting for permission, it stays at its bench with an amber lamp."
        >
          {#snippet overlays(pin, s)}
            {#each keys as key (key)}
              <div class="pin" use:pin={`merge:${key}`} data-anchor="merge-{key}" data-kind="merge" data-merges={key} aria-hidden="true"></div>
              <div class="pin" use:pin={`bubble:${key}`} aria-hidden="true">
                <Bubble b={key === 'api' && s?.waiting ? waitingBubble : sitting[key]} />
              </div>
            {/each}
            <div class="pin" use:pin={'gate'} aria-hidden="true">
              <span class="lg-board below gate" class:good={s?.all}>main</span>
            </div>
            {#if s?.home}
              <div class="pin" use:pin={'ready'} aria-hidden="true">
                <span class="lg-callout ready">{s.home} of 3 ready for main</span>
              </div>
            {/if}
          {/snippet}
        </Stage>
        {#if story.permission === 'pending'}
          <p class="waiting">
            <span class="dot" aria-hidden="true"></span>
            feat/api is still waiting for you.
            <a href="#permissions">Answer it in Permissions</a>
          </p>
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  .gate {
    font-size: 14px;
  }
  .ready {
    font-size: 12px;
  }
  .waiting {
    margin-top: 18px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    font-size: 14px;
    color: oklch(0.75 0 0);
  }
  .waiting a {
    color: #f7b955;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .dot {
    width: 9px;
    height: 9px;
    background: #f59e0b;
  }
</style>
