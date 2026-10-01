<script>
  import Shell from '../shared/Shell.svelte';
  import Sprite from '../shared/Sprite.svelte';
  import { SKIN_TONES, HAIR_TONES, agentLook } from '../shared/app-art.js';
  import { PROJECT_COLORS } from '../shared/colors.js';
  import Select from './Select.svelte';
  import Builder from './Builder.svelte';
  import Day from './Day.svelte';
  import Places from './Places.svelte';
  import { CAST, MODELS, MODES } from './states.js';

  // Your agent, shared by the builder, the day and the places below it.
  const first = agentLook('1d6f4c08');
  let me = $state({
    id: '1d6f4c08',
    skin: Math.max(0, SKIN_TONES.findIndex((t) => t.s === first.s)),
    hair: Math.max(0, HAIR_TONES.indexOf(first.h)),
    logo: 0,
    model: 'opus',
    mode: 'ask',
    voice: 'normal',
  });
  const look = $derived({ ...SKIN_TONES[me.skin], h: HAIR_TONES[me.hair] });
  const seed = $derived(me.id === 'custom' ? 'custom-agent' : me.id);
  const model = $derived(MODELS.find((m) => m.key === me.model));
  const mode = $derived(MODES.find((m) => m.key === me.mode));
  const parade = ['starting', 'working', 'permission', 'unread', 'ready', 'sleeping', 'error'];
</script>

<Shell current="crew">
  <section class="wrap intro">
    <p class="eyebrow">Prototype · character select</p>
    <h1>Meet the crew</h1>
    <p class="lede">
      Every conversation in Grove Bench has a small pixel agent. Its pose and colour tell you what it’s up to, so a quick look
      at the sidebar says who is working, who needs you and who has finished. There are {CAST.length} poses to learn.
    </p>
    <div class="parade" aria-hidden="true">
      {#each parade as s, i}
        <span style="animation-delay: {i * -0.6}s"><Sprite state={s} seed="parade-{i}" scale={4} label="" /></span>
      {/each}
    </div>
  </section>

  <div class="wrap stack">
    <Select />
    <Builder bind:me {look} />
    <Day
      {seed}
      {look}
      projectColor={PROJECT_COLORS[me.logo]}
      modelLabel={model.label}
      modeLabel={mode.label}
      modeColor={mode.color}
    />
    <Places {seed} {look} projectColor={PROJECT_COLORS[me.logo]} />
  </div>
</Shell>

<style>
  .intro {
    padding-block: 40px 8px;
  }
  h1 {
    margin-top: 8px;
    font-family: var(--font-pixel);
    font-size: clamp(36px, 3vw + 22px, 62px);
    color: #f6f7fb;
  }
  .lede {
    margin-top: 14px;
    max-width: 64ch;
    color: #c7cfe0;
  }
  .parade {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    margin-top: 24px;
    padding-bottom: 6px;
    border-bottom: 4px solid var(--leaf-4);
  }
  .parade span {
    display: block;
    animation: hop 2.4s steps(2) infinite;
  }
  @keyframes hop {
    0%,
    80%,
    100% {
      transform: none;
    }
    90% {
      transform: translateY(-4px);
    }
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 72px;
    padding-top: 40px;
  }
  @media (prefers-reduced-motion: reduce) {
    .parade span {
      animation: none;
    }
  }
</style>
