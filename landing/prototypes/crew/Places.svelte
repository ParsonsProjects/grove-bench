<script>
  import GroveScene from '../shared/GroveScene.svelte';
  import Sprite from '../shared/Sprite.svelte';

  /** Where the characters turn up in the app, using its own scenes. */
  let { seed, look, projectColor } = $props();

  const PLACES = [
    { tab: 'none', state: null, title: 'Nothing open yet', text: 'With no conversations, the main area shows the logo tree and an empty bench.' },
    { tab: 'changes', state: 'ready', title: 'Changes tab', text: 'Nothing changed yet: your agent waits by a watering can and a sprout.' },
    { tab: 'checkpoints', state: 'ready', title: 'Checkpoints tab', text: 'No checkpoints yet: a flag on a pole, as in a game.' },
    { tab: 'preview', state: 'ready', title: 'Preview tab', text: 'No page open: an easel holding a small web page.' },
  ];
  const RAIL = [
    { state: 'working', seed: 'r1a2b3c4' },
    { state: 'permission', seed: 'r5d6e7f8' },
    { state: 'unread', seed: 'r9a0b1c2' },
    { state: 'ready', seed: 'r3d4e5f6' },
    { state: 'sleeping', seed: 'r7a8b9c0' },
  ];
</script>

<section class="places" aria-labelledby="places-h">
  <h2 id="places-h" class="pixel">Where you’ll meet them</h2>
  <p class="sub">The same characters turn up all over the app, in the empty spaces as well as the busy ones.</p>
  <div class="grid">
    {#each PLACES as p}
      <figure class="panel place">
        <div class="art"><GroveScene tab={p.tab} state={p.state} {seed} {look} scale={3} /></div>
        <figcaption><b>{p.title}</b> {p.text}</figcaption>
      </figure>
    {/each}
    <figure class="panel place rail">
      <div class="art railart" aria-hidden="true">
        {#each RAIL as r}
          <Sprite state={r.state} seed={r.seed} {projectColor} scale={3} label="" />
        {/each}
      </div>
      <figcaption><b>The sidebar rail</b> Fold the sidebar and each open conversation keeps its character, one per row.</figcaption>
    </figure>
  </div>
  <p class="setting">Prefer plain dots? Turn off <b>Show grove characters</b> in Settings → The grove. It’s on by default.</p>
</section>

<style>
  h2 {
    font-size: 30px;
    color: #f6f7fb;
  }
  .sub {
    margin-top: 8px;
    font-size: 14px;
    color: var(--muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr));
    gap: 20px;
    margin-top: 20px;
  }
  @media (min-width: 1100px) {
    .grid {
      grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(0, 0.7fr);
    }
  }
  .place {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
  }
  .art {
    display: grid;
    place-items: center;
    min-height: 100px;
  }
  .railart {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    width: 52px;
    margin-inline: auto;
    background: oklch(0.176 0 0);
    box-shadow: inset 0 0 0 1px oklch(0.26 0 0);
  }
  figcaption {
    font-size: 13px;
    line-height: 1.5;
    color: #c7cfe0;
  }
  figcaption b {
    display: block;
    color: #f3f5fa;
  }
  .setting {
    margin-top: 18px;
    font-size: 13px;
    color: var(--muted);
  }
  .setting b {
    color: #eef1f8;
  }
</style>
