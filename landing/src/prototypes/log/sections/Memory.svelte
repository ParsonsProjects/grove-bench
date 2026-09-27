<script>
  import Stage from '../Stage.svelte';
  import Commit from '../Commit.svelte';
  import Bubble from '../Bubble.svelte';
  import { memoryScene } from '../scenes/memory.js';
  import { agents, hashes, memoryFolders } from '../data.js';

  /** @type {{ reduced?: boolean }} */
  let { reduced = false } = $props();

  const reads = { auth: 'conventions/', api: 'architecture/', fix: 'sessions/' };
  const keys = /** @type {const} */ (['auth', 'api', 'fix']);

  function talk(key) {
    const a = agents[key];
    return {
      status: 'working',
      text: `Before I started I read the project notes, \`${reads[key]}\` included, so I know how this project does things. ${a.task}`,
    };
  }
</script>

<section class="lg-section" aria-labelledby="h-memory">
  <div class="lg-wrap">
    <div class="lg-col">
      <Commit id="memory" hash={hashes.memory} title="Project memory" headingId="h-memory">
        <p>
          Markdown notes for each project, in <code>repo/</code>, <code>conventions/</code>, <code>architecture/</code> and
          <code>sessions/</code>. Every conversation reads them first. A budget meter and auto-compaction keep them short.
        </p>
      </Commit>
      <div class="lg-scene">
        <Stage
          id="memory"
          factory={memoryScene}
          {reduced}
          {talk}
          dataTod={0.32}
          class="lg-frame"
          label="The old tree of the project with a glowing memory stone at its roots. Notes are pinned to its crown: repo, conventions, architecture and sessions. Threads of light run from the stone to each of the three agents on their benches."
        >
          {#snippet overlays(pin)}
            {#each memoryFolders as folder, i}
              <div class="pin" use:pin={`note:${i}`} aria-hidden="true">
                <span class="lg-tag note" style="--tag: #0b6dd6">{folder}</span>
              </div>
            {/each}
            {#each keys as key (key)}
              <div class="pin" use:pin={`bubble:${key}`} aria-hidden="true">
                <Bubble b={{ tool: 'Read', detail: reads[key] }} />
              </div>
            {/each}
          {/snippet}
        </Stage>
      </div>
    </div>
  </div>
</section>
