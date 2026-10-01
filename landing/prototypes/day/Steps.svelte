<script>
  import Tree from '../shared/Tree.svelte';
  import BenchSeat from '../shared/BenchSeat.svelte';
  import Walker from '../shared/Walker.svelte';
  import Sprite from '../shared/Sprite.svelte';
  import Clock from './Clock.svelte';
  import { arrive } from './scroll.svelte.js';
  import { STEPS } from './content.js';

  const grow = (t, at, d = 1) => Math.min(1, Math.max(0, (t - at) / d));
</script>

<section class="band b-steps" id="how" aria-labelledby="how-h">
  <div class="inner">
    <h2 class="h2 rise" id="how-h" use:arrive>three steps<br /><span class="tone-2">to your first grove.</span></h2>
    <Clock class="steps" max={7}>
      {#snippet children(t)}
        <ol class="list">
          {#each STEPS as s, i}
            <li class="step" class:lit={t > i * 1.2}>
              <div class="pic" aria-hidden="true">
                {#if i === 0}
                  <Tree scale={4} growth={grow(t, 0.2, 1.2)} />
                {:else if i === 1}
                  <div class="pair">
                    <Tree scale={3} growth={grow(t, 1.2, 0.8)} tint="#3b82f6" />
                    {#if t > 3}<BenchSeat state="working" seed="a3f8b2c1" scale={3} label="" />{:else if t > 1.8}<span class="w" style="transform: translateX({(1 - grow(t, 1.8, 1.2)) * -60}px)"><Walker seed="a3f8b2c1" scale={3} /></span>{/if}
                  </div>
                {:else}
                  <div class="gate">
                    <Sprite state={t > 3.6 ? 'unread' : 'ready'} seed="a3f8b2c1" scale={3} label="" />
                    <span class="arch" class:open={t > 3.6}>main</span>
                  </div>
                {/if}
              </div>
              <span class="n">{i + 1}</span>
              <span class="ui">{s.ui}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          {/each}
        </ol>
      {/snippet}
    </Clock>
  </div>
</section>

<style>
  .inner {
    padding-block: 96px;
  }
  .list {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: 28px;
    margin-top: 40px;
  }
  .step {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 18px;
    border-top: 3px solid rgb(58 42 28 / 0.15);
    transition: border-color 0.4s;
  }
  .step.lit {
    border-top-color: var(--green);
  }
  .pic {
    display: flex;
    align-items: flex-end;
    height: 110px;
  }
  .pair {
    display: flex;
    align-items: flex-end;
    gap: 6px;
  }
  .gate {
    display: flex;
    align-items: flex-end;
    gap: 12px;
  }
  .arch {
    padding: 4px 12px 28px;
    font-family: var(--pixel);
    font-size: 15px;
    color: #f4ecdd;
    background: #2d2016;
    box-shadow: 0 0 0 3px #5a4130;
    transition: background 0.3s;
  }
  .arch.open {
    color: #12361a;
    background: #6ec87a;
  }
  .n {
    position: absolute;
    top: -15px;
    left: 0;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    font-family: var(--pixel);
    font-weight: 700;
    color: #fff;
    background: var(--green);
  }
  .ui {
    align-self: flex-start;
    margin-top: 6px;
    padding: 1px 8px;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    background: var(--blue);
  }
  h3 {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.03em;
  }
  p {
    color: var(--soft);
    font-size: 13.5px;
  }
</style>
