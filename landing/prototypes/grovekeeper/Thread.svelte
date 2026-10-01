<script>
  import Sprite from '../shared/Sprite.svelte';
  import BenchSeat from '../shared/BenchSeat.svelte';
  import Tree from '../shared/Tree.svelte';
  import Pixels from '../shared/Pixels.svelte';
  import { FLAG } from '../shared/app-art.js';
  import { stateLabel } from '../shared/colors.js';
  import { MODES, spriteState, allowAllLabel, hasFollowUp, secondsText, filesText } from './game.js';

  /**
   * The open conversation, laid out like the app's Thread tab: your messages,
   * checkpoints, tool calls, permission blocks and replies. When the turn is
   * done: the changes, the next message, Rewind all and Create PR.
   *
   * @type {{
   *   p: any,
   *   onanswer: (choice: 'allow' | 'deny' | 'all') => void,
   *   onmode: (mode: string) => void,
   *   onfollow: () => void,
   *   onrewind: () => void,
   *   onship: () => void,
   * }}
   */
  let { p, onanswer, onmode, onfollow, onrewind, onship } = $props();

  const TONE = { Read: 'read', Grep: 'read', Glob: 'read', Edit: 'edit', Write: 'write', Bash: 'bash' };
  const state = $derived(p ? (spriteState(p) ?? 'starting') : null);
  const nextMessage = $derived(p && hasFollowUp(p) ? p.task.turns[p.turn + 1].you : null);

  let listEl = $state();
  $effect(() => {
    // Keep the newest item in view as the thread grows.
    p?.items.length;
    p?.pending;
    if (listEl) listEl.scrollTop = listEl.scrollHeight;
  });
</script>

<section class="panel thread" aria-label="Conversation" aria-live="polite">
  {#if !p}
    <div class="empty">
      <div class="empty-art">
        <Tree scale={3} />
        <BenchSeat empty scale={3} />
      </div>
      <p class="pixel">No conversation open</p>
      <p class="hint">Click an agent in the grove to open its conversation. Amber ones are waiting for you.</p>
    </div>
  {:else}
    <header class="head">
      <Sprite {state} seed={p.id} scale={3} />
      <div class="who">
        <b>{p.branch}</b>
        <span>{p.phase === 'ship' ? 'PR opened' : stateLabel(state)} · {p.task.ticket} · worktree {p.id}</span>
      </div>
      <div class="modes" role="group" aria-label="Mode">
        {#each Object.entries(MODES) as [key, m]}
          <button type="button" class="mode {key}" aria-pressed={p.mode === key} title={m.help} onclick={() => onmode(key)}>{m.label}</button>
        {/each}
      </div>
    </header>

    <ol class="items" bind:this={listEl}>
      {#each p.items as it, i (i)}
        <li class="it {it.kind}">
          {#if it.kind === 'you'}
            <span class="label">You</span>{it.text}
          {:else if it.kind === 'checkpoint'}
            <Pixels map={FLAG} scale={1.4} />Checkpoint {it.turn} saved
          {:else if it.kind === 'tool'}
            <b class="tool {TONE[it.tool]}">{it.tool}</b>
            <span class="detail">{it.detail}</span>
            {#if it.add || it.del}<span class="diff">{#if it.add}<i class="add">+{it.add}</i>{/if} {#if it.del}<i class="del">-{it.del}</i>{/if}</span>{/if}
            {#if it.out}<span class="out">{it.out}</span>{/if}
          {:else if it.kind === 'perm'}
            <div class="perm-head">
              <span class="perm-tag">{it.resolved ? it.resolved : 'Waiting for you'}</span>
              <b class="tool {TONE[it.step.tool]}">{it.step.tool}</b>
              <span class="detail">{it.step.detail}</span>
            </div>
            {#if it.step.kind === 'edit' && !it.resolved}
              <div class="preview" aria-label="Diff preview"><i class="add">+ {it.step.add ?? 0} lines</i>{#if it.step.del}<i class="del">- {it.step.del} lines</i>{/if}</div>
            {/if}
            {#if !it.resolved && p.pending}
              <div class="perm-btns">
                <button type="button" class="btn small allow" onclick={() => onanswer('allow')}>Allow</button>
                <button type="button" class="btn small deny" onclick={() => onanswer('deny')}>Deny</button>
                <button type="button" class="btn small ghost" onclick={() => onanswer('all')}>{allowAllLabel(it.step)}</button>
              </div>
              <p class="wait">Waiting {secondsText(p.waiting)}</p>
            {/if}
          {:else if it.kind === 'blocked'}
            {it.text}
          {:else}
            {it.text}
          {/if}
        </li>
      {/each}
      {#if p.phase === 'work' && !p.pending}
        <li class="it typing" aria-hidden="true"><span></span><span></span><span></span></li>
      {/if}
    </ol>

    {#if p.phase === 'done'}
      <footer class="done">
        <p class="changes">Changes <i class="add">+{p.add}</i> <i class="del">-{p.del}</i> in {filesText(p.files.length)}</p>
        <div class="done-btns">
          <button type="button" class="btn primary" onclick={onship}>Create PR</button>
          {#if nextMessage}
            <button type="button" class="btn" onclick={onfollow} title="Send this as the next message">Send "{nextMessage}"</button>
          {/if}
          {#if p.history.length > 1}
            <button type="button" class="btn ghost" onclick={onrewind}>Rewind all</button>
          {/if}
        </div>
      </footer>
    {:else if p.phase === 'wake'}
      <footer class="done"><p class="changes">Waking up...</p></footer>
    {/if}
  {/if}
</section>

<style>
  .thread {
    display: flex;
    flex-direction: column;
    min-height: 340px;
    padding: 0;
  }
  .empty {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 10px;
    flex: 1;
    padding: 28px 20px;
    text-align: center;
  }
  .empty-art {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    opacity: 0.85;
  }
  .empty .pixel {
    font-size: 20px;
    color: #f3f5fa;
  }
  .hint {
    max-width: 34ch;
    font-size: 14px;
    color: var(--muted);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--edge);
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .who b {
    overflow-wrap: anywhere;
    font-size: 14px;
    color: #f3f5fa;
  }
  .who span {
    font-size: 12px;
    color: var(--muted);
  }
  .modes {
    display: flex;
    gap: 2px;
  }
  .mode {
    padding: 3px 9px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    background: rgb(255 255 255 / 0.05);
    border: 1px solid rgb(255 255 255 / 0.1);
    cursor: pointer;
  }
  .mode[aria-pressed='true'].ask {
    color: #fff;
    background: oklch(0.541 0.181 254.624 / 0.5);
    border-color: oklch(0.65 0.15 254.624);
  }
  .mode[aria-pressed='true'].edit {
    color: #fff;
    background: oklch(0.55 0.18 300 / 0.5);
    border-color: oklch(0.68 0.15 300);
  }
  .mode[aria-pressed='true'].auto {
    color: #062a30;
    background: var(--cyan);
    border-color: var(--cyan);
  }
  .items {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 360px;
    overflow-y: auto;
    padding: 14px 16px;
    font-size: 13px;
    line-height: 1.5;
  }
  .it {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .it.you {
    padding: 8px 10px;
    color: #eef1f8;
    background: rgb(96 165 250 / 0.12);
    border-left: 3px solid oklch(0.707 0.165 254.624);
  }
  .label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: oklch(0.8 0.1 254.624);
  }
  .it.checkpoint {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--faint);
  }
  .it.tool {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    color: #c7cfe0;
  }
  .detail {
    color: #dfe4ef;
  }
  .out {
    color: var(--green);
  }
  .out::before {
    content: '→ ';
    color: var(--faint);
  }
  i {
    font-style: normal;
  }
  .add {
    color: var(--green);
  }
  .del {
    color: var(--red);
  }
  .it.perm {
    padding: 10px;
    background: rgb(245 158 11 / 0.1);
    box-shadow: inset 0 0 0 1px rgb(245 158 11 / 0.45);
  }
  .perm-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
  }
  .perm-tag {
    font-size: 11px;
    font-weight: 700;
    color: var(--amber);
  }
  .preview {
    display: flex;
    gap: 12px;
    margin-top: 6px;
    padding: 4px 8px;
    font-size: 12px;
    background: rgb(0 0 0 / 0.25);
  }
  .perm-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .wait {
    margin-top: 6px;
    font-size: 11px;
    color: var(--amber);
  }
  .it.blocked {
    padding: 6px 10px;
    font-size: 12px;
    color: oklch(0.85 0.1 211);
    background: rgb(34 211 238 / 0.08);
    border-left: 3px solid var(--cyan);
  }
  .it.text {
    color: #eef1f8;
  }
  .it.system {
    font-size: 12px;
    color: var(--gold);
  }
  .typing {
    display: flex;
    gap: 4px;
    padding: 4px 0;
  }
  .typing span {
    width: 6px;
    height: 6px;
    background: oklch(0.707 0.165 254.624);
    animation: blink 1.2s steps(2) infinite;
  }
  .typing span:nth-child(2) {
    animation-delay: 0.2s;
  }
  .typing span:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .done {
    padding: 12px 16px 16px;
    border-top: 1px solid var(--edge);
  }
  .changes {
    font-size: 13px;
    color: var(--muted);
  }
  .done-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 10px;
  }
  @media (prefers-reduced-motion: reduce) {
    .typing span {
      animation: none;
    }
  }
</style>
