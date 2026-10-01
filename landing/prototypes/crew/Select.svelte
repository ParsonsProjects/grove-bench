<script>
  import Sprite from '../shared/Sprite.svelte';
  import GroveScene from '../shared/GroveScene.svelte';
  import { AGENT_SPRITES } from '../shared/app-art.js';
  import { stateColor, stateLabel, filterFor, FILTERS } from '../shared/colors.js';
  import { CAST } from './states.js';

  /**
   * Character select: a grid of every state, and a stage that shows the
   * picked one on its bench with what it means. Arrow keys move the cursor.
   */

  let index = $state(1);
  let tiles = $state([]);
  const pick = $derived(CAST[index]);
  const sprite = $derived(AGENT_SPRITES[pick.state]);
  const filter = $derived(FILTERS.find((f) => f.key === filterFor(pick.state)));
  const motion = $derived(sprite.frames.length > 1 ? `${sprite.frames.length} frames, ${sprite.frameSeconds}s each.` : '');
  const seeds = ['b2c41a9e', '7f03d6c1', '3a9e0b57', 'e41d8c26', '0c7a5f93', '96b2e7d4', '5e18c0aa', 'd7f4a312', '24c9b6e0', 'a83f1d75', '61e0c4b9', 'f2a7953c'];

  function onkey(e) {
    const cols = window.matchMedia('(max-width: 560px)').matches ? 3 : 4;
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    index = (index + move + CAST.length) % CAST.length;
    tiles[index]?.focus();
  }
</script>

<section class="select" aria-labelledby="select-h">
  <div class="stage panel" style="--glow: {stateColor(pick.state)}">
    <p class="p1 pixel" aria-hidden="true">P1</p>
    <div class="spot">
      <GroveScene state={pick.state} seed={seeds[index]} scale={6} />
    </div>
    <div class="plate">
      <h3 class="pixel">{pick.title}</h3>
      <p class="label">
        <i style="background: {stateColor(pick.state)}"></i>
        {stateLabel(pick.state)}
        {#if filter}<span class="chip" style="--c: {filter.color}">counts under {filter.label}</span>{/if}
      </p>
      <dl>
        <div><dt>Pose</dt><dd>{pick.pose} {#if motion}<span class="faint">{motion}</span>{/if}</dd></div>
        <div><dt>When</dt><dd>{pick.when}</dd></div>
        <div><dt>What to do</dt><dd>{pick.todo}</dd></div>
        <div><dt>Seen in</dt><dd>{pick.where}</dd></div>
      </dl>
    </div>
  </div>

  <div class="roster">
    <h2 id="select-h" class="pixel">Choose a character</h2>
    <p class="sub">Twelve poses, one per state. Each conversation’s agent wears the colour of its state, so you can read the sidebar at a glance.</p>
    <div class="grid" role="radiogroup" aria-label="Character states" tabindex="-1" onkeydown={onkey}>
      {#each CAST as c, i (c.state)}
        <button
          type="button"
          role="radio"
          class="tile"
          class:on={i === index}
          aria-checked={i === index}
          tabindex={i === index ? 0 : -1}
          bind:this={tiles[i]}
          onclick={() => (index = i)}
          style="--c: {stateColor(c.state)}"
        >
          <Sprite state={c.state} seed={seeds[i]} scale={5} label="" />
          <span>{stateLabel(c.state)}</span>
        </button>
      {/each}
    </div>
    <p class="keys">Use the arrow keys to move between characters.</p>
  </div>
</section>

<style>
  .select {
    display: grid;
    gap: 28px;
    align-items: start;
  }
  @media (min-width: 980px) {
    .select {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
  .stage {
    overflow: hidden;
    padding: 24px;
    background:
      radial-gradient(60% 50% at 50% 38%, color-mix(in oklch, var(--glow) 22%, transparent), transparent 70%),
      var(--panel);
  }
  .p1 {
    position: absolute;
    top: 12px;
    left: 14px;
    padding: 0 6px;
    font-size: 14px;
    color: #0b1224;
    background: var(--gold);
  }
  .spot {
    display: flex;
    justify-content: center;
    padding: 16px 0 8px;
    overflow: hidden;
  }
  @media (max-width: 420px) {
    .spot :global(.scene) {
      zoom: 0.72;
    }
  }
  .plate {
    margin-top: 10px;
  }
  .plate h3 {
    font-size: 34px;
    color: #f6f7fb;
  }
  .label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin-top: 4px;
    font-size: 15px;
    font-weight: 700;
    color: #eef1f8;
  }
  .label i {
    width: 10px;
    height: 10px;
  }
  .chip {
    padding: 1px 8px;
    font-size: 12px;
    font-weight: 400;
    border: 1px solid color-mix(in oklch, var(--c) 55%, transparent);
    background: color-mix(in oklch, var(--c) 12%, transparent);
  }
  dl {
    display: grid;
    gap: 10px;
    margin-top: 16px;
  }
  dl div {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 12px;
  }
  dt {
    font-family: var(--font-pixel);
    font-size: 14px;
    color: var(--leaf-1);
  }
  dd {
    font-size: 14px;
    line-height: 1.55;
    color: #c7cfe0;
  }
  .faint {
    color: var(--faint);
  }
  .roster h2 {
    font-size: 30px;
    color: #f6f7fb;
  }
  .sub {
    margin-top: 8px;
    max-width: 56ch;
    font-size: 14px;
    color: var(--muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-top: 18px;
  }
  @media (max-width: 560px) {
    .grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 14px 6px 10px;
    font-size: 12px;
    line-height: 1.25;
    color: var(--muted);
    background: rgb(255 255 255 / 0.03);
    border: 0;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08);
    cursor: pointer;
  }
  .tile:hover {
    background: rgb(255 255 255 / 0.06);
  }
  .tile.on {
    color: #fff;
    background: color-mix(in oklch, var(--c) 14%, transparent);
    box-shadow:
      inset 0 0 0 2px var(--c),
      0 0 0 3px #0b1224,
      0 0 0 5px var(--gold);
  }
  .keys {
    margin-top: 12px;
    font-size: 12px;
    color: var(--faint);
  }
</style>
