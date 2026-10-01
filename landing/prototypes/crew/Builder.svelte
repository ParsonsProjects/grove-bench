<script>
  import BenchSeat from '../shared/BenchSeat.svelte';
  import Bubble from '../shared/Bubble.svelte';
  import ContextStrip from '../shared/ContextStrip.svelte';
  import { SKIN_TONES, HAIR_TONES, agentLook } from '../shared/app-art.js';
  import { PROJECT_COLORS, stateLabel } from '../shared/colors.js';
  import { MODELS, MODES, VOICES } from './states.js';

  /**
   * Build your own agent: its look (or the look the app would pick from a
   * conversation id), laptop logo, model, mode and response style.
   *
   * @type {{ me: { id: string, skin: number, hair: number, logo: number, model: string, mode: string, voice: string }, look: Record<string, string> }}
   */
  let { me = $bindable(), look } = $props();

  let idText = $state(me.id);
  let pose = $state('working');
  let context = $state(38);
  const POSES = ['working', 'permission', 'unread', 'sleeping'];

  const model = $derived(MODELS.find((m) => m.key === me.model));
  const mode = $derived(MODES.find((m) => m.key === me.mode));
  const voice = $derived(VOICES.find((v) => v.key === me.voice));
  const valid = $derived(/^[0-9a-f]{8}$/.test(idText));
  const tokens = $derived((context / 100) * model.ctx * 1_000_000);
  const usedText = $derived(tokens >= 1_000_000 ? '1M' : `${Math.round(tokens / 1000)}K`);

  function useId(id) {
    const l = agentLook(id);
    me.id = id;
    me.skin = Math.max(0, SKIN_TONES.findIndex((t) => t.s === l.s));
    me.hair = Math.max(0, HAIR_TONES.indexOf(l.h));
  }

  function roll() {
    idText = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    useId(idText);
  }

  function onIdInput() {
    idText = idText.trim().toLowerCase();
    if (valid) useId(idText);
  }

  // Picking a swatch by hand means the look no longer comes from an id.
  function setSkin(i) {
    me.skin = i;
    me.id = 'custom';
  }
  function setHair(i) {
    me.hair = i;
    me.id = 'custom';
  }
  // Auto mode isn't offered on Haiku.
  $effect(() => {
    if (!model.auto && me.mode === 'auto') me.mode = 'ask';
  });
</script>

<section class="builder" aria-labelledby="build-h">
  <div class="controls">
    <h2 id="build-h" class="pixel">Make your own</h2>
    <p class="sub">The app gives every conversation its own agent. Here you pick everything yourself.</p>

    <div class="group">
      <label class="gl" for="seed">From a conversation id</label>
      <p class="hint">The app picks skin and hair from each conversation’s id, so an agent looks the same wherever it shows up. Type 8 hex characters, or roll one.</p>
      <div class="seedrow">
        <input id="seed" type="text" maxlength="8" spellcheck="false" autocomplete="off" bind:value={idText} oninput={onIdInput} aria-invalid={!valid} />
        <button type="button" class="btn small" onclick={roll}>Roll</button>
      </div>
      {#if !valid}<p class="err">Use 8 characters from 0-9 and a-f, like 1d6f4c08.</p>{/if}
    </div>

    <fieldset class="group">
      <legend class="gl">Skin</legend>
      <div class="swatches">
        {#each SKIN_TONES as t, i}
          <label class="sw" style="--sw: {t.s}" title="Skin {i + 1}">
            <input type="radio" name="skin" checked={me.skin === i} onchange={() => setSkin(i)} />
            <span class="visually-hidden">Skin tone {i + 1}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset class="group">
      <legend class="gl">Hair</legend>
      <div class="swatches">
        {#each HAIR_TONES as h, i}
          <label class="sw" style="--sw: {h}">
            <input type="radio" name="hair" checked={me.hair === i} onchange={() => setHair(i)} />
            <span class="visually-hidden">Hair colour {i + 1}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset class="group">
      <legend class="gl">Laptop logo</legend>
      <p class="hint">Takes the project’s colour, so you can tell projects apart in the sidebar.</p>
      <div class="swatches">
        {#each PROJECT_COLORS as c, i}
          <label class="sw" style="--sw: {c}">
            <input type="radio" name="logo" checked={me.logo === i} onchange={() => (me.logo = i)} />
            <span class="visually-hidden">Project colour {i + 1}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset class="group">
      <legend class="gl">Model</legend>
      <div class="models">
        {#each MODELS as m}
          <label class="model" class:on={me.model === m.key}>
            <input type="radio" name="model" value={m.key} bind:group={me.model} />
            <b>{m.label}</b>
            <span>Context {m.context}</span>
            <span>Default effort {m.effort}</span>
            <span class:no={!m.fast}>{m.fast ? 'Fast speed' : 'No Fast speed'}</span>
            <span class:no={!m.auto}>{m.auto ? 'Auto mode' : 'No Auto mode'}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset class="group">
      <legend class="gl">Mode</legend>
      <div class="chips">
        {#each MODES as m}
          <label class="chip" class:on={me.mode === m.key} class:off={m.key === 'auto' && !model.auto} style="--c: {m.color}">
            <input type="radio" name="mode" value={m.key} bind:group={me.mode} disabled={m.key === 'auto' && !model.auto} />
            {m.label}
          </label>
        {/each}
      </div>
      <p class="hint">{mode.help}{#if !model.auto} Auto needs Opus or Sonnet 4.6 and later, or Fable.{/if}</p>
    </fieldset>

    <fieldset class="group">
      <legend class="gl">Response style</legend>
      <div class="chips">
        {#each VOICES as v}
          <label class="chip" class:on={me.voice === v.key} style="--c: var(--leaf-1)">
            <input type="radio" name="voice" value={v.key} bind:group={me.voice} />
            {v.label}
          </label>
        {/each}
      </div>
      <p class="hint">{voice.note} The caveman styles use about 65 to 75% fewer output tokens. Code blocks stay normal.</p>
    </fieldset>
  </div>

  <div class="preview panel">
    <p class="tag pixel">Your agent</p>
    <div class="stage">
      <div class="say">
        <Bubble tone="plain" class="wrap-bubble">{pose === 'sleeping' ? 'zzz' : pose === 'permission' ? 'Can I run npm test?' : voice.say}</Bubble>
      </div>
      <BenchSeat state={pose} {look} projectColor={PROJECT_COLORS[me.logo]} scale={10} />
    </div>
    <div class="poses" role="group" aria-label="Try a pose">
      {#each POSES as p}
        <button type="button" class="btn small ghost" aria-pressed={pose === p} onclick={() => (pose = p)}>{stateLabel(p)}</button>
      {/each}
    </div>

    <div class="bar">
      <div class="agentctl">
        <b>Claude</b>
        <span>{model.label} · <i style="color: {mode.color}">{mode.label}</i></span>
      </div>
      <div class="convo">conversation <code>{me.id}</code></div>
    </div>
    <div class="ctx">
      <ContextStrip seed={me.id === 'custom' ? 'custom-agent' : me.id} percent={context} width={110} scale={3} />
      <label class="ctxl" for="ctx">Context used <b>{context}%</b> <span>{usedText} of {model.context}</span></label>
      <input id="ctx" type="range" min="0" max="100" step="1" bind:value={context} />
      <p class="hint dark">Drag it. The app grows this grove along the status bar as the context window fills, and thins it after /compact.</p>
    </div>
  </div>
</section>

<style>
  .builder {
    display: grid;
    gap: 28px;
    align-items: start;
  }
  @media (min-width: 980px) {
    .builder {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .preview {
      position: sticky;
      top: 80px;
    }
  }
  h2 {
    font-size: 30px;
    color: #f6f7fb;
  }
  .sub {
    margin-top: 8px;
    font-size: 14px;
    color: var(--muted);
  }
  .group {
    margin-top: 22px;
    border: 0;
  }
  .gl {
    display: block;
    font-family: var(--font-pixel);
    font-size: 16px;
    color: #eef1f8;
  }
  .hint {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted);
  }
  .err {
    margin-top: 6px;
    font-size: 12px;
    color: oklch(0.8 0.15 25);
  }
  .seedrow {
    display: flex;
    gap: 10px;
    margin-top: 8px;
  }
  input[type='text'] {
    width: 12ch;
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: 15px;
    letter-spacing: 0.08em;
    color: var(--gold);
    background: #0b1224;
    border: 0;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.2);
  }
  input[aria-invalid='true'] {
    box-shadow: inset 0 0 0 1px oklch(0.637 0.237 25.331);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .sw {
    position: relative;
    width: 30px;
    height: 30px;
    background: var(--sw);
    cursor: pointer;
    box-shadow: inset 0 0 0 2px rgb(0 0 0 / 0.25);
  }
  .sw input,
  .chip input,
  .model input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .sw:has(input:checked) {
    box-shadow:
      0 0 0 2px #0b1224,
      0 0 0 4px var(--gold);
  }
  .sw:has(input:focus-visible),
  .chip:has(input:focus-visible),
  .model:has(input:focus-visible) {
    outline: 2px dashed var(--gold);
    outline-offset: 4px;
  }
  .models {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-top: 8px;
  }
  @media (max-width: 480px) {
    .models {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .model {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px;
    font-size: 12px;
    color: var(--muted);
    background: rgb(255 255 255 / 0.03);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1);
    cursor: pointer;
  }
  .model b {
    font-size: 14px;
    color: #eef1f8;
  }
  .model .no {
    color: var(--faint);
    text-decoration: line-through;
  }
  .model.on {
    background: rgb(110 200 122 / 0.1);
    box-shadow: inset 0 0 0 2px var(--leaf-1);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .chip {
    position: relative;
    padding: 4px 10px;
    font-size: 13px;
    font-weight: 600;
    color: #dfe4ef;
    border: 1px solid color-mix(in oklch, var(--c) 45%, transparent);
    cursor: pointer;
  }
  .chip.on {
    color: #0b1224;
    background: var(--c);
  }
  .chip.off {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .preview {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .tag {
    font-size: 14px;
    color: var(--leaf-1);
  }
  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 18px 0 0;
    background: linear-gradient(180deg, transparent 70%, rgb(58 154 72 / 0.35) 70%);
  }
  .say {
    max-width: 100%;
    min-height: 64px;
    display: flex;
    align-items: flex-end;
  }
  .say :global(.wrap-bubble) {
    max-width: min(380px, 100%);
    white-space: normal;
    font-size: 14px;
    line-height: 1.35;
    padding: 6px 10px 7px;
  }
  @media (max-width: 420px) {
    .stage :global(.seat) {
      zoom: 0.7;
    }
  }
  .poses {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .poses .btn[aria-pressed='true'] {
    background: #2b3a55;
    box-shadow:
      0 0 0 2px var(--ink),
      0 0 0 4px var(--gold);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 8px 12px;
    background: oklch(0.176 0 0);
    box-shadow: inset 0 0 0 1px oklch(0.26 0 0);
  }
  .agentctl {
    display: flex;
    flex-direction: column;
    font-size: 12px;
    line-height: 1.35;
    color: oklch(0.835 0 0);
  }
  .agentctl span {
    color: oklch(0.65 0 0);
  }
  .agentctl i {
    font-style: normal;
    font-weight: 700;
  }
  .convo {
    font-size: 12px;
    color: var(--muted);
  }
  .ctx {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ctxl {
    font-size: 13px;
    color: #dfe4ef;
  }
  .ctxl span {
    margin-left: 8px;
    color: var(--muted);
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--leaf-2);
  }
  .hint.dark {
    margin-top: 0;
  }
</style>
