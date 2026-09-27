<script>
  import Stage from '../Stage.svelte';
  import Commit from '../Commit.svelte';
  import Bubble from '../Bubble.svelte';
  import { terminalsScene } from '../scenes/terminals.js';
  import { agents, hashes } from '../data.js';
  import { lanes } from '../lanes.js';

  /** @type {{ reduced?: boolean }} */
  let { reduced = false } = $props();

  const keys = /** @type {const} */ (['auth', 'api', 'fix']);
  /** @type {any} */
  let engine = $state(null);

  function talk(key) {
    const a = agents[key];
    const s = engine?.scene.snapshot()[key];
    const now = s ? (s.tool === 'Bash' ? `running \`${s.cmd}\` in my own terminal` : `\`${s.tool} ${s.detail}\``) : '';
    return {
      status: 'working',
      text: `${a.task} Right now: ${now}. The terminal is a real one, opened in my worktree.`,
    };
  }
</script>

<section class="lg-section" aria-labelledby="h-terminals">
  <div class="lg-wrap">
    <div class="lg-col">
      <Commit id="terminals" hash={hashes.terminals} lanes={['auth']} status="working" title="Terminals" headingId="h-terminals">
        <p>
          Every conversation has its own terminal, a real PTY opened in its worktree. Run tests and dev servers for
          each branch side by side.
        </p>
      </Commit>
      <div class="lg-scene">
        <Stage
          id="terminals"
          factory={terminalsScene}
          bind:engine
          {reduced}
          {talk}
          dataTod={0.08}
          class="lg-frame"
          label="The three agents sit at their benches, laptops glowing. Above each one floats its own terminal: feat/auth runs npm test and gets 4 passed, feat/api runs npm run dev, fix/login-bug runs npm test and gets 5 passed. Speech bubbles show their tool calls."
        >
          {#snippet overlays(pin, snap)}
            {#each keys as key (key)}
              {@const s = snap?.[key]}
              <div class="pin" use:pin={`bubble:${key}`} aria-hidden="true">
                <Bubble b={s ? { tool: s.tool, detail: s.detail } : null} />
              </div>
              <div class="pin" use:pin={`term:${key}`} aria-hidden="true">
                {#if s}
                  <span class="lg-term" style="--edge: {lanes[key].stroke}">
                    {#if snap?.compact}<span class="dim">{s.tool} {s.detail}</span>{/if}
                    <span><span class="p">$</span> {s.cmd}</span>
                    {#if s.running && s.total}
                      <span class="ok">{'✓'.repeat(s.ticks)}<span class="dim">{'·'.repeat(Math.max(0, s.total - s.ticks))}</span></span>
                    {/if}
                    {#if !s.running || s.done}
                      <span class="ok">{s.result}</span>
                    {:else if !s.total}
                      <span class="dim">starting…</span>
                    {/if}
                  </span>
                {/if}
              </div>
            {/each}
          {/snippet}
        </Stage>
      </div>
    </div>
  </div>
</section>
