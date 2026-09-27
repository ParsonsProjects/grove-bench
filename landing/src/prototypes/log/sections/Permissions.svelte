<script>
  import Stage from '../Stage.svelte';
  import Commit from '../Commit.svelte';
  import Bubble from '../Bubble.svelte';
  import { permissionScene } from '../scenes/permission.js';
  import { agents, hashes, ask } from '../data.js';
  import { story } from '../story.svelte.js';

  /** @type {{ reduced?: boolean }} */
  let { reduced = false } = $props();

  const keys = /** @type {const} */ (['auth', 'api', 'fix']);
  const answered = $derived(story.permission !== 'pending');

  /** @param {'allow' | 'always' | 'deny'} choice */
  function answer(choice) {
    if (story.permission !== 'pending') return;
    story.permission = choice;
  }

  const results = {
    allow: 'Allowed once. The lamp goes blue, feat/api gets on with it, and its lane in the log catches up.',
    always: 'Allowed. This conversation will not ask about Bash again. Its lane in the log catches up.',
    deny: 'Denied. The agent picks another way to do it, and its lane in the log catches up.',
  };

  function talk(key) {
    const a = agents[key];
    if (key !== 'api') return { status: 'working', text: `${a.task} I have not needed to ask for anything yet.` };
    if (!answered) {
      return { status: 'permission', text: `I want to run \`${ask.command}\` to validate profile input. Allow or deny it below.` };
    }
    if (story.permission === 'deny') return { status: 'working', text: 'No problem. I will check the input by hand instead of adding a library.' };
    return { status: 'working', text: `Thanks. Running \`${ask.command}\`, then writing the profile endpoints.` };
  }
</script>

<section class="lg-section" id="permissions" aria-labelledby="h-permission">
  <div class="lg-wrap">
    <div class="lg-col">
      <Commit id="permission" hash={hashes.permission} lanes={['api']} status="permission" title="Permissions" headingId="h-permission">
        <p>
          When an agent wants to run a command or edit a file, its lamp turns amber and it waits for you. Pick a
          permission mode per conversation: <b>Default</b>, <b>Accept Edits</b> or <b>Plan</b>.
        </p>
      </Commit>
      <div class="lg-scene">
        <Stage
          id="permission"
          factory={permissionScene}
          {reduced}
          {talk}
          dataTod={0.18}
          class="lg-frame"
          label="The feat/api agent sits under its tree with an amber lamp and a question mark over its head. It is waiting for permission to run npm install zod. The other two agents keep working with blue lamps."
        >
          {#snippet overlays(pin, snap)}
            <div class="pin" use:pin={'sign:api'} aria-hidden="true">
              <span class="lg-sign">feat/api</span>
            </div>
            {#each keys as key (key)}
              <div class="pin" use:pin={`bubble:${key}`} aria-hidden="true">
                {#if key === 'api'}
                  <Bubble b={snap?.api.bubble} />
                {:else}
                  <Bubble b={key === 'auth' ? { tool: 'Edit', detail: 'auth.ts +47' } : { tool: 'Bash', detail: 'npm test' }} />
                {/if}
              </div>
            {/each}
          {/snippet}
        </Stage>

        <div class="lg-panel perm" role="group" aria-labelledby="perm-q">
          <p class="who"><span class="dot" class:asking={!answered} aria-hidden="true"></span>feat/api asks</p>
          <p class="say" id="perm-q">Can I run <code>{ask.command}</code>?</p>
          <div class="lg-actions">
            <button type="button" class="lg-pbtn allow" class:chosen={story.permission === 'allow'} aria-disabled={answered} onclick={() => answer('allow')}>
              Allow
            </button>
            <button type="button" class="lg-pbtn allow" class:chosen={story.permission === 'always'} aria-disabled={answered} onclick={() => answer('always')}>
              Always Allow
            </button>
            <button type="button" class="lg-pbtn deny" class:chosen={story.permission === 'deny'} aria-disabled={answered} onclick={() => answer('deny')}>
              Deny
            </button>
          </div>
          <p class="result" aria-live="polite">
            {#if story.permission === 'pending'}
              Until you answer, the feat/api lane in the log on the left waits here.
            {:else}
              {results[story.permission]}
            {/if}
          </p>
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .perm .who {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot {
    width: 9px;
    height: 9px;
    background: #5aa0ff;
    box-shadow: 0 0 0 2px #0b1224;
  }
  .dot.asking {
    background: #f59e0b;
    animation: ask 1s steps(2) infinite;
  }
  @keyframes ask {
    50% {
      opacity: 0.45;
    }
  }
  .result {
    margin-top: 14px;
    font-size: 15px;
    line-height: 1.45;
    color: #c9d2e8;
  }
  .lg-pbtn[aria-disabled="true"].chosen {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .dot.asking {
      animation: none;
    }
  }
</style>
