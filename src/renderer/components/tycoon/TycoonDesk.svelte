<script lang="ts">
  import { developerAppearance, buildSprite, SPRITE_COLS, SPRITE_ROWS } from '../../lib/tycoon-appearance.js';
  import { iso, DESK_H, SPRITE_SCALE } from '../../lib/tycoon-iso.js';
  import { sessionMood } from '../../lib/tycoon-mood.js';

  interface Props {
    session: { id: string; branch: string; repoPath: string; status: string; displayName?: string | null };
    /** Origin tile of the desk (spans 2 tiles in x, 1 in y). */
    tx: number;
    ty: number;
    selected: boolean;
    onselect: (id: string) => void;
    onopen: (id: string) => void;
  }

  let { session, tx, ty, selected, onselect, onopen }: Props = $props();

  let appearance = $derived(developerAppearance(session.id));
  let sprite = $derived(buildSprite(appearance));
  let mood = $derived(sessionMood(session));

  let label = $derived.by(() => {
    const name = session.displayName || session.branch;
    return name.length > 18 ? name.slice(0, 17) + '…' : name;
  });

  /** "x,y" for a tile corner, optionally shifted up in screen px. */
  function p(x: number, y: number, dy = 0): string {
    const q = iso(x, y);
    return `${q.x},${q.y + dy}`;
  }

  const dh = DESK_H;

  // Desk box faces
  let deskTop = $derived(`${p(tx, ty, -dh)} ${p(tx + 2, ty, -dh)} ${p(tx + 2, ty + 1, -dh)} ${p(tx, ty + 1, -dh)}`);
  let deskFront = $derived(`${p(tx, ty + 1, -dh)} ${p(tx + 2, ty + 1, -dh)} ${p(tx + 2, ty + 1)} ${p(tx, ty + 1)}`);
  let deskSide = $derived(`${p(tx + 2, ty, -dh)} ${p(tx + 2, ty + 1, -dh)} ${p(tx + 2, ty + 1)} ${p(tx + 2, ty)}`);

  // Chair back peeking out behind the developer
  let chair = $derived(`${p(tx + 0.62, ty - 0.35, -30)} ${p(tx + 1.38, ty - 0.35, -30)} ${p(tx + 1.38, ty - 0.35, -4)} ${p(tx + 0.62, ty - 0.35, -4)}`);

  // Monitor on the desk, back toward the camera
  let monitorBack = $derived(`${p(tx + 0.55, ty + 0.5, -dh - 21)} ${p(tx + 1.45, ty + 0.5, -dh - 21)} ${p(tx + 1.45, ty + 0.5, -dh - 2)} ${p(tx + 0.55, ty + 0.5, -dh - 2)}`);
  let monitorFoot = $derived(`${p(tx + 0.9, ty + 0.45, -dh - 2)} ${p(tx + 1.1, ty + 0.45, -dh - 2)} ${p(tx + 1.1, ty + 0.45, -dh)} ${p(tx + 0.9, ty + 0.45, -dh)}`);

  // Selection ring on the floor around the desk footprint
  let ring = $derived(`${p(tx - 0.45, ty - 1.15)} ${p(tx + 2.45, ty - 1.15)} ${p(tx + 2.45, ty + 1.45)} ${p(tx - 0.45, ty + 1.45)}`);

  // Developer sprite placement: seated behind the desk's back edge, torso
  // partly hidden by the desk top. TycoonMoodBubble mirrors this to anchor
  // the status bubble above the head.
  const S = SPRITE_SCALE;
  let devCenter = $derived(iso(tx + 1, ty));
  let devX = $derived(devCenter.x - (SPRITE_COLS / 2) * S);
  let devY = $derived(devCenter.y - dh + 8 - SPRITE_ROWS * S);

  // Name plaque centered on the desk's front face
  let plaque = $derived.by(() => {
    const a = iso(tx + 1, ty + 1);
    return { x: a.x, y: a.y - dh / 2 + 3.5 };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<g
  class="desk-group"
  role="button"
  tabindex="-1"
  aria-label={session.displayName || session.branch}
  onclick={(e) => { e.stopPropagation(); onselect(session.id); }}
  ondblclick={(e) => { e.stopPropagation(); onopen(session.id); }}
>
  {#if selected}
    <polygon points={ring} class="sel-ring" />
  {/if}

  <!-- chair, then dev (both behind the desk) -->
  <polygon points={chair} fill="#3a3f47" />
  <polygon points={`${p(tx + 0.55, ty - 0.35, -4)} ${p(tx + 1.45, ty - 0.35, -4)} ${p(tx + 1.45, ty - 0.1, -4)} ${p(tx + 0.55, ty - 0.1, -4)}`} fill="#2f343b" />
  <g transform="translate({devX}, {devY}) scale({S})">
    {#each sprite as px ((px.x << 8) | px.y)}
      <rect x={px.x} y={px.y} width="1" height="1" fill={px.color} />
    {/each}
  </g>

  <!-- desk -->
  <polygon points={deskTop} fill="#a9714b" />
  <polygon points={deskFront} fill="#8a5a3a" />
  <polygon points={deskSide} fill="#754c30" />

  <!-- monitor (back toward camera) -->
  <polygon points={monitorFoot} fill="#101018" />
  <polygon points={monitorBack} fill="#191922" class:mon-glow={mood === 'working'} />
  <polygon points={`${p(tx + 0.55, ty + 0.5, -dh - 21)} ${p(tx + 1.45, ty + 0.5, -dh - 21)} ${p(tx + 1.45, ty + 0.5, -dh - 18)} ${p(tx + 0.55, ty + 0.5, -dh - 18)}`} fill="#2c2c3a" />

  <!-- name plaque on the desk front -->
  <text x={plaque.x} y={plaque.y} class="plate">{label}</text>
</g>

<style>
  .desk-group {
    cursor: pointer;
    outline: none;
  }
  .desk-group:hover .plate {
    fill: #ffffff;
  }

  .sel-ring {
    fill: rgb(88 214 141 / 0.10);
    stroke: #58d68d;
    stroke-width: 1.5;
  }

  .mon-glow {
    stroke: #6fb7ff;
    stroke-width: 1.2;
    animation: tycoon-glow 1.6s ease-in-out infinite;
  }
  @keyframes tycoon-glow {
    0%, 100% { stroke-opacity: 0.15; }
    50% { stroke-opacity: 0.8; }
  }

  .plate {
    font-size: 8px;
    font-weight: 600;
    text-anchor: middle;
    fill: #f2e9dc;
    stroke: #4a3018;
    stroke-width: 1.5px;
    paint-order: stroke;
  }
</style>
