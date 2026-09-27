<script>
  import Stage from '../Stage.svelte';
  import Commit from '../Commit.svelte';
  import Bubble from '../Bubble.svelte';
  import { checkpointsScene } from '../scenes/checkpoints.js';
  import { agents, hashes, turns } from '../data.js';

  /** @type {{ reduced?: boolean }} */
  let { reduced = false } = $props();

  /** @type {any} */
  let engine = $state(null);
  /** @type {any} */
  let snap = $state(null);

  const turn = $derived(snap?.turn ?? turns.length);
  const max = turns.length;
  const note = $derived(snap?.note ?? null);
  const current = $derived(turns[turn - 1]);
  const stepText = (t) => `${t.step[0]} ${t.step[2] ?? t.step[1]}`;

  function talk() {
    const a = agents.fix;
    if (note?.mode === 'all') return { status: 'ready', text: `Back at turn ${note.turn}. My files and our conversation are as they were then.` };
    if (note?.mode === 'conv') return { status: 'ready', text: `Our conversation is back at turn ${note.turn}. I kept the files as they are.` };
    if (turn < max) return { status: 'ready', text: `At turn ${turn} you said "${current.you}", and I ran \`${stepText(current)}\`.` };
    return { status: 'ready', text: `${a.closing} Every message you sent me saved a checkpoint.` };
  }

  function oninput(e) {
    engine?.scene.setTurn(+e.currentTarget.value);
  }
</script>

<section class="lg-section" aria-labelledby="h-checkpoints">
  <div class="lg-wrap">
    <div class="lg-col">
      <Commit id="checkpoints" hash={hashes.checkpoints} lanes={['fix']} status="ready" title="Checkpoints" headingId="h-checkpoints">
        <p>
          A checkpoint is saved each time you send a message. See what one turn changed (<b>This turn</b>) or
          everything after it (<b>Since here</b>), and step back if a turn went wrong.
        </p>
      </Commit>
      <div class="lg-scene">
        <Stage
          id="checkpoints"
          factory={checkpointsScene}
          bind:engine
          bind:snap
          {reduced}
          {talk}
          dataTod={0.24}
          class="lg-frame"
          label="A sundial stands beside the fix/login-bug tree. Its shadow marks the turn of the conversation. Drag the shadow back and the tree shrinks to what it was at that turn."
        >
          {#snippet overlays(pin, s)}
            <div class="pin" use:pin={'sign:fix'} aria-hidden="true">
              <span class="lg-sign">fix/login-bug</span>
            </div>
            <div class="pin" use:pin={'bubble:fix'} aria-hidden="true">
              {#if s?.bubble}
                <span class="turn-bubble">
                  {#if s.bubble.turn}<span class="t">T{s.bubble.turn}</span>{/if}
                  <Bubble b={s.bubble} />
                </span>
              {/if}
            </div>
            <div class="pin" use:pin={'hint'} aria-hidden="true">
              <span class="lg-callout hint">drag the shadow</span>
            </div>
            <div class="pin dial-pin" use:pin={'dial'}>
              <input
                class="dial"
                type="range"
                min="1"
                max={max}
                step="1"
                value={turn}
                {oninput}
                aria-label="Checkpoint: drag the sundial shadow to an earlier turn"
                aria-valuetext="Turn {turn} of {max}: {stepText(current)}"
              />
            </div>
          {/snippet}
        </Stage>

        <div class="lg-panel cp" role="group" aria-labelledby="cp-title">
          <p class="who" id="cp-title">fix/login-bug, turn {turn} of {max}</p>
          <ol class="turns" aria-label="Turns">
            {#each turns as t, i}
              <li class:on={i + 1 === turn} class:gone={note?.mode === 'all' && i + 1 > note.turn}>
                <button type="button" class="turn-btn" aria-pressed={i + 1 === turn} onclick={() => engine?.scene.setTurn(i + 1)}>
                  <span class="n">T{i + 1}</span>
                  <span class="you">{t.you}</span>
                </button>
              </li>
            {/each}
          </ol>
          <div class="opts">
            <div class="opt">
              <button
                type="button"
                class="lg-pbtn blue"
                aria-disabled={turn >= max}
                onclick={() => engine?.scene.rewind('all')}
              >
                Rewind all
              </button>
              <span>Files and conversation go back to this turn.</span>
            </div>
            <div class="opt">
              <button type="button" class="lg-pbtn" aria-disabled={turn >= max} onclick={() => engine?.scene.rewind('conv')}>
                Conv. only
              </button>
              <span>Just the conversation goes back. Files stay as they are.</span>
            </div>
          </div>
          <p class="result" aria-live="polite">
            {#if note?.mode === 'all'}
              Rewound to turn {note.turn}. The tree is back to its size then.
            {:else if note?.mode === 'conv'}
              Conversation back at turn {note.turn}. The files, and the tree, stay.
            {:else if turn >= max}
              Drag the sundial's shadow, or pick an earlier turn, to step back.
            {:else}
              At turn {turn} the agent ran <code>{stepText(current)}</code>.
            {/if}
          </p>
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .turn-bubble {
    display: inline-flex;
    align-items: flex-end;
    gap: 0;
  }
  .turn-bubble > :global(.lg-bubble) {
    position: relative;
  }
  .t {
    align-self: center;
    margin-bottom: calc(var(--px) * 3);
    margin-right: calc(var(--px) * 1);
    padding: 1px 4px 2px;
    font-size: 12px;
    color: #f4ecdd;
    background: #1b1f2a;
  }
  .hint {
    margin-bottom: calc(var(--px) * 2);
    font-size: 12px;
  }
  .dial-pin {
    pointer-events: auto;
  }
  .dial-pin > .dial {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transform: none;
    margin: 0;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    cursor: ew-resize;
    pointer-events: auto;
  }
  .dial::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 40px;
    background: transparent;
    border: 0;
  }
  .dial::-moz-range-thumb {
    width: 18px;
    height: 40px;
    background: transparent;
    border: 0;
  }
  .dial::-webkit-slider-runnable-track {
    background: transparent;
    height: 100%;
  }
  .dial::-moz-range-track {
    background: transparent;
  }
  .dial:focus-visible {
    outline: 2px dashed #ffe7a8;
    outline-offset: 3px;
  }
  .dial:hover {
    box-shadow: 0 0 0 1px rgb(255 231 168 / 0.6);
  }

  .turns {
    list-style: none;
    margin-top: 10px;
    display: grid;
    gap: 4px;
  }
  @media (min-width: 900px) {
    .turns {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
  }
  .turn-btn {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    min-height: 36px;
    padding: 6px 8px;
    text-align: left;
    font-family: inherit;
    font-size: 15px;
    color: #c9d2e8;
    background: rgb(255 255 255 / 0.04);
    border: 0;
    cursor: pointer;
  }
  .turn-btn:hover {
    background: rgb(255 255 255 / 0.09);
  }
  .turn-btn:focus-visible {
    outline: 2px dashed #ffe7a8;
    outline-offset: 2px;
  }
  .on .turn-btn {
    color: #fff;
    background: rgb(90 160 255 / 0.2);
    box-shadow: inset 3px 0 0 #5aa0ff;
  }
  .gone .turn-btn {
    opacity: 0.4;
    text-decoration: line-through;
  }
  .n {
    flex: none;
    font-size: 13px;
    color: #ffe7a8;
  }
  .opts {
    margin-top: 14px;
    display: grid;
    gap: 10px;
  }
  @media (min-width: 900px) {
    .opts {
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 15px;
    line-height: 1.35;
    color: #c9d2e8;
  }
  .opt .lg-pbtn {
    flex: none;
    min-width: 132px;
  }
  @media (max-width: 599px) {
    .opt {
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }
  }
  .result {
    margin-top: 14px;
    font-size: 15px;
    line-height: 1.45;
    color: #c9d2e8;
  }
</style>
