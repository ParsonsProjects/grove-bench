<script>
  import { CHECKPOINTS } from './data.js';

  /**
   * Winds the fix/login-bug limb back through its checkpoints (one per
   * message sent), then rewinds the files and conversation, or just the
   * conversation.
   *
   * @type {{
   *   turn?: number,
   *   rewound?: { mode: 'all' | 'conv', turn: number } | null,
   *   onturn?: (n: number) => void,
   *   onrewind?: (mode: 'all' | 'conv' | null) => void,
   * }}
   */
  let { turn = CHECKPOINTS.length, rewound = null, onturn, onrewind } = $props();

  const max = CHECKPOINTS.length;
  const current = $derived(CHECKPOINTS[turn - 1]);
  const latest = $derived(turn >= max);

  const result = $derived.by(() => {
    if (rewound?.mode === 'all') return `Rewound to turn ${rewound.turn}: files and conversation.`;
    if (rewound?.mode === 'conv') return `Conversation back at turn ${rewound.turn}. Files unchanged.`;
    if (latest) return 'You are at the latest turn. Drag back to pick an earlier one.';
    return `Turn ${turn} is picked. Choose what to rewind.`;
  });
</script>

<div class="rw">
  <label class="lbl" for="cn-turn">
    <span class="n">Turn {turn} of {max}</span>
    <span class="you">you: "{current.you}"</span>
  </label>
  <input
    id="cn-turn"
    class="range"
    type="range"
    min="1"
    {max}
    step="1"
    value={turn}
    style="--p: {((turn - 1) / (max - 1)) * 100}%"
    aria-valuetext="Turn {turn} of {max}: {current.you}"
    oninput={(e) => onturn?.(Number(e.currentTarget.value))}
  />
  <div class="ticks" aria-hidden="true">
    {#each CHECKPOINTS as _, i}<span class:on={i + 1 <= turn}>{i + 1}</span>{/each}
  </div>

  <div class="acts">
    <div class="act">
      <button type="button" class="cn-btn" class:chosen={rewound?.mode === 'all'} disabled={latest} onclick={() => onrewind?.('all')}>Rewind all</button>
      <span class="hint">Files and conversation go back to this turn.</span>
    </div>
    <div class="act">
      <button type="button" class="cn-btn ghost" class:chosen={rewound?.mode === 'conv'} disabled={latest} onclick={() => onrewind?.('conv')}>Conv. only</button>
      <span class="hint">Just the conversation goes back. Files stay.</span>
    </div>
  </div>
  <p class="result" aria-live="polite">{result}</p>
</div>

<style>
  .rw {
    margin-top: 16px;
    padding: 12px 14px 12px;
    background: rgb(110 200 122 / 0.07);
    box-shadow: inset 0 0 0 1px rgb(110 200 122 / 0.4);
  }
  .lbl {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    font-size: 14px;
  }
  .n {
    font-weight: 700;
    color: #9fe0a8;
  }
  .you {
    color: #c7cfe0;
  }

  /* A chunky pixel track with square notches and a square thumb. */
  .range {
    -webkit-appearance: none;
    appearance: none;
    display: block;
    width: 100%;
    height: 32px;
    margin-top: 6px;
    background: transparent;
    cursor: pointer;
  }
  .range::-webkit-slider-runnable-track {
    height: 8px;
    background:
      linear-gradient(90deg, #6ec87a var(--p), #2a3450 var(--p));
    box-shadow:
      0 -2px 0 0 var(--ink),
      0 2px 0 0 var(--ink),
      -2px 0 0 0 var(--ink),
      2px 0 0 0 var(--ink);
  }
  .range::-moz-range-track {
    height: 8px;
    background: linear-gradient(90deg, #6ec87a var(--p), #2a3450 var(--p));
    box-shadow:
      0 -2px 0 0 var(--ink),
      0 2px 0 0 var(--ink),
      -2px 0 0 0 var(--ink),
      2px 0 0 0 var(--ink);
  }
  .range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 24px;
    margin-top: -8px;
    background: #f4ecdd;
    box-shadow:
      0 -2px 0 0 var(--ink),
      0 2px 0 0 var(--ink),
      -2px 0 0 0 var(--ink),
      2px 0 0 0 var(--ink),
      inset 0 -4px 0 0 #c9b99c;
  }
  .range::-moz-range-thumb {
    width: 18px;
    height: 24px;
    border: 0;
    border-radius: 0;
    background: #f4ecdd;
    box-shadow:
      0 -2px 0 0 var(--ink),
      0 2px 0 0 var(--ink),
      -2px 0 0 0 var(--ink),
      2px 0 0 0 var(--ink),
      inset 0 -4px 0 0 #c9b99c;
  }
  .range:focus-visible {
    outline: 2px dashed #ffe7a8;
    outline-offset: 4px;
  }
  .ticks {
    display: flex;
    justify-content: space-between;
    padding-inline: 4px;
    font-size: 12px;
    color: #6f7a94;
  }
  .ticks .on {
    color: #9fe0a8;
  }
  .acts {
    margin-top: 12px;
    display: grid;
    gap: 10px;
  }
  .act {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .act .cn-btn {
    flex: none;
    min-width: 128px;
  }
  .hint {
    font-size: 14px;
    line-height: 1.4;
    color: #c7cfe0;
  }
  .result {
    margin-top: 10px;
    min-height: 21px;
    font-size: 14px;
    color: #9fe0a8;
  }
</style>
