<script lang="ts">
  import { sessionMood } from '../../lib/tycoon-mood.js';
  import { iso, DESK_H, SPRITE_SCALE } from '../../lib/tycoon-iso.js';
  import { SPRITE_ROWS } from '../../lib/tycoon-appearance.js';

  interface Props {
    session: { id: string; status: string };
    /** Origin tile of the session's desk. */
    tx: number;
    ty: number;
  }

  let { session, tx, ty }: Props = $props();

  let mood = $derived(sessionMood(session));

  // Anchor above the developer's head (same placement math as TycoonDesk).
  let devCenter = $derived(iso(tx + 1, ty));
  let x = $derived(devCenter.x);
  let y = $derived(devCenter.y - DESK_H + 8 - SPRITE_ROWS * SPRITE_SCALE - 10);
</script>

{#if mood !== 'idle'}
  <g transform="translate({x}, {y})" class="mood mood-{mood}">
    <rect x="-15" y="-18" width="30" height="16" fill="#f4f4f0" stroke="#1a1a24" stroke-width="1.5" />
    <rect x="-2" y="-3" width="4" height="4" fill="#1a1a24" />
    {#if mood === 'working'}
      <rect x="-8" y="-12" width="4" height="4" class="dot d1" />
      <rect x="-2" y="-12" width="4" height="4" class="dot d2" />
      <rect x="4" y="-12" width="4" height="4" class="dot d3" />
    {:else if mood === 'waiting'}
      <text x="0" y="-6" class="mood-text" fill="#b45309">?</text>
    {:else if mood === 'error'}
      <text x="0" y="-6" class="mood-text" fill="#b91c1c">!</text>
    {:else if mood === 'setup'}
      <text x="0" y="-6.5" class="mood-text mood-zzz" fill="#1a1a24">zZz</text>
    {:else if mood === 'done'}
      <text x="0" y="-6" class="mood-text" fill="#15803d">✓</text>
    {/if}
  </g>
{/if}

<style>
  .mood {
    pointer-events: none;
  }
  .mood-text {
    font-size: 11px;
    font-weight: 700;
    text-anchor: middle;
  }
  .mood-zzz {
    font-size: 8px;
    font-style: italic;
  }

  .mood-waiting, .mood-done {
    animation: mood-pulse 1s ease-in-out infinite;
  }
  @keyframes mood-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .dot {
    fill: #1a1a24;
    animation: mood-typing 1.2s ease-in-out infinite;
  }
  .d2 { animation-delay: 0.2s; }
  .d3 { animation-delay: 0.4s; }
  @keyframes mood-typing {
    0%, 60%, 100% { opacity: 0.25; }
    30% { opacity: 1; }
  }
</style>
