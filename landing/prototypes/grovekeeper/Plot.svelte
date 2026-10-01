<script>
  import Tree from '../shared/Tree.svelte';
  import BenchSeat from '../shared/BenchSeat.svelte';
  import Walker from '../shared/Walker.svelte';
  import Bubble from '../shared/Bubble.svelte';
  import Pixels from '../shared/Pixels.svelte';
  import { SPROUT } from '../shared/app-art.js';
  import { stateLabel } from '../shared/colors.js';
  import { spriteState, walkProgress, sproutProgress, bubble } from './game.js';

  /**
   * One plot in the grove: a tree for the worktree, the agent on its bench,
   * a speech bubble and the branch sign. Empty plots show a sprout.
   *
   * @type {{ p: any, k: number, selected: boolean, onopen: () => void }}
   */
  let { p, k, selected, onopen } = $props();

  const TONE = { Read: 'read', Grep: 'read', Glob: 'read', Edit: 'edit', Write: 'write', Bash: 'bash' };
  const state = $derived(p ? spriteState(p) : null);
  const b = $derived(p ? bubble(p) : null);
  const walk = $derived(p ? walkProgress(p) : 1);
  const growth = $derived(p ? (p.phase === 'ship' ? 1 - walk * 0.9 : sproutProgress(p)) : 0);
  const walking = $derived(p && (p.phase === 'walk' || p.phase === 'ship'));
  // The walker comes in from the left edge and stops at the bench; shipping, it
  // carries on to the right towards the gate.
  const walkerLeft = $derived(p?.phase === 'ship' ? 50 + walk * 60 : -18 + walk * 68);
</script>

{#if p}
  <button
    type="button"
    class="plot"
    class:selected
    style="--k: {k}px"
    aria-label="{p.branch}, {stateLabel(state ?? 'starting')}. Open conversation"
    aria-pressed={selected}
    onclick={onopen}
  >
    <span class="scene">
      <span class="tree" style="opacity: {p.phase === 'ship' ? 1 - walk * 0.6 : 1}"><Tree scale={k + 2} {growth} /></span>
      {#if walking}
        <span class="walker" style="left: {walkerLeft}%; opacity: {p.phase === 'ship' ? 1 - Math.max(0, walk - 0.7) / 0.3 : 1}">
          <Walker seed={p.id} scale={k} />
        </span>
        <span class="bench"><BenchSeat empty scale={k} /></span>
      {:else if state}
        <span class="bench"><BenchSeat {state} seed={p.id} scale={k} label="" /></span>
      {/if}
      {#if b}
        <span class="say">
          <Bubble tone={b.ask ? 'ask' : b.done ? 'done' : 'plain'}>
            {#if b.tool}<b class={TONE[b.tool]}>{b.tool}</b>{/if}{b.text}
          </Bubble>
        </span>
      {/if}
    </span>
    <span class="sign" class:fresh={!p.renamed}>
      <b>{p.branch}</b>
      <small>worktree {p.id}</small>
    </span>
  </button>
{:else}
  <div class="plot empty" style="--k: {k}px">
    <span class="scene">
      <span class="mound"></span>
      <span class="sprout"><Pixels map={SPROUT} scale={k} /></span>
    </span>
    <span class="sign free"><b>Free plot</b><small>start a task</small></span>
  </div>
{/if}

<style>
  .plot {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-width: 0;
    padding: 0;
    background: none;
    border: 0;
    cursor: pointer;
    text-align: center;
  }
  .plot.empty {
    cursor: default;
  }
  .scene {
    position: relative;
    display: block;
    height: calc(var(--k) * 46);
  }
  /* The tree is drawn two steps larger than the bench, its trunk behind it. */
  .tree {
    position: absolute;
    bottom: 0;
    left: calc(50% - (var(--k) + 2px) * 10.5 - var(--k) * 2);
  }
  .bench {
    position: absolute;
    bottom: 0;
    left: calc(50% - var(--k) * 4);
  }
  .walker {
    position: absolute;
    bottom: 0;
    transform: translateX(-50%);
  }
  .say {
    position: absolute;
    left: calc(50% + var(--k) * 1.5);
    bottom: calc(var(--k) * 11.5);
    transform: translateX(-50%);
    z-index: 2;
    pointer-events: none;
  }
  .mound {
    position: absolute;
    left: calc(50% - var(--k) * 6);
    bottom: 0;
    width: calc(var(--k) * 12);
    height: calc(var(--k) * 2);
    background: #6a5040;
    box-shadow: 0 calc(var(--k) * -1) 0 #8a6a4a;
  }
  .sprout {
    position: absolute;
    left: calc(50% - var(--k) * 1.5);
    bottom: calc(var(--k) * 2);
  }
  .sign {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 6px;
    padding: 4px 6px 5px;
    min-width: 0;
    font-size: 11px;
    line-height: 1.25;
    color: #f4ecdd;
    background: #5a4130;
    box-shadow:
      inset 0 -2px 0 rgb(0 0 0 / 0.25),
      0 0 0 2px #2d2016;
  }
  .sign b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
  }
  .sign small {
    font-size: 10px;
    color: #d9c3a5;
  }
  .sign.fresh b {
    color: #ffe7a8;
  }
  .sign.free {
    background: rgb(90 65 48 / 0.35);
    color: rgb(244 236 221 / 0.7);
  }
  .selected .sign {
    box-shadow:
      inset 0 -2px 0 rgb(0 0 0 / 0.25),
      0 0 0 2px #2d2016,
      0 0 0 4px var(--gold);
  }
  .plot:not(.empty):hover .scene {
    filter: brightness(1.08);
  }
  .plot:focus-visible {
    outline: 2px dashed var(--gold);
    outline-offset: 4px;
  }
</style>
