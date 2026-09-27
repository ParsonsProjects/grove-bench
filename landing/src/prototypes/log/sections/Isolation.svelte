<script>
  import Stage from '../Stage.svelte';
  import Commit from '../Commit.svelte';
  import Bubble from '../Bubble.svelte';
  import { isolationScene } from '../scenes/isolation.js';
  import { agents, hashes, sameFile, sameFileEdits } from '../data.js';

  /** @type {{ reduced?: boolean }} */
  let { reduced = false } = $props();

  const keys = /** @type {const} */ (['auth', 'api', 'fix']);

  function talk(key) {
    const a = agents[key];
    return {
      status: 'working',
      text: `Editing \`${sameFile}\` (${sameFileEdits[key]}). It is my copy, in \`.grove-wt/${a.id}\`, so the others can edit theirs at the same time.`,
    };
  }
</script>

<section class="lg-section" aria-labelledby="h-isolation">
  <div class="lg-wrap">
    <div class="lg-col">
      <Commit
        id="isolation"
        hash={hashes.isolation}
        lanes={['auth', 'api', 'fix']}
        status="working"
        title="Isolation"
        headingId="h-isolation"
      >
        <p>
          All three agents can edit <code>{sameFile}</code> at once. Each edits its own copy, so nothing collides while
          they work. You choose what lands when you merge.
        </p>
      </Commit>
      <div class="lg-scene">
        <Stage
          id="isolation"
          factory={isolationScene}
          {reduced}
          {talk}
          dataTod={0.13}
          class="lg-frame"
          label="All three agents edit index.ts at the same time, each on its own copy in its own worktree. Low fences stand between the benches. A wooden sign in front reads conflicts: 0."
        >
          {#snippet overlays(pin)}
            {#each keys as key (key)}
              <div class="pin" use:pin={`bubble:${key}`} aria-hidden="true">
                <Bubble b={{ tool: 'Edit', detail: `index.ts ${sameFileEdits[key]}` }} />
              </div>
            {/each}
            <div class="pin" use:pin={'board'}>
              <span class="lg-board">conflicts: 0</span>
            </div>
          {/snippet}
        </Stage>
      </div>
    </div>
  </div>
</section>
