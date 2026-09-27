<script>
  import Stage from '../Stage.svelte';
  import Commit from '../Commit.svelte';
  import Bubble from '../Bubble.svelte';
  import { worktreesScene } from '../scenes/worktrees.js';
  import { agents, hashes } from '../data.js';
  import { lanes } from '../lanes.js';

  /** @type {{ reduced?: boolean }} */
  let { reduced = false } = $props();

  const keys = /** @type {const} */ (['auth', 'api', 'fix']);

  function talk(key) {
    const a = agents[key];
    return {
      status: 'working',
      text: `I just got \`.grove-wt/${a.id}\` on branch \`${a.branch}\`. It is my own copy of the project, so I can't touch anyone else's files.`,
    };
  }
</script>

<section class="lg-section" aria-labelledby="h-worktrees">
  <div class="lg-wrap">
    <div class="lg-col">
      <Commit id="worktrees" hash={hashes.worktrees} title="Worktrees" headingId="h-worktrees">
        <p>
          Click <span class="lg-ui">+ Conversation</span> and Grove Bench makes a branch, a git worktree in
          <code>.grove-wt/&lt;id&gt;</code> and a terminal. Here, each tree is one worktree.
        </p>
      </Commit>
      <div class="lg-scene">
        <Stage
          id="worktrees"
          factory={worktreesScene}
          {reduced}
          {talk}
          dataTod={0.04}
          class="lg-frame"
          label="Three saplings sprout from bare ground and grow into trees, one per worktree. Each gets a signpost with its branch, feat/auth, feat/api and fix/login-bug, and a tag with its folder under .grove-wt. Then an agent walks in and sits on the bench under each tree."
        >
          {#snippet overlays(pin, snap)}
            <div class="pin" use:pin={'fork'} data-anchor="fork" data-kind="fork" aria-hidden="true"></div>
            {#each keys as key (key)}
              <div class="pin" use:pin={`tag:${key}`} aria-hidden="true">
                <span class="lg-tag" style="--tag: {lanes[key].stroke}">.grove-wt/{agents[key].id}</span>
              </div>
              <div class="pin" use:pin={`sign:${key}`} aria-hidden="true">
                <span class="lg-sign pop">{agents[key].branch}</span>
              </div>
              <div class="pin" use:pin={`bubble:${key}`} aria-hidden="true">
                <Bubble b={{ tool: 'Read', detail: key === 'fix' ? 'session.ts' : 'package.json' }} />
              </div>
            {/each}
          {/snippet}
        </Stage>
      </div>
    </div>
  </div>
</section>
