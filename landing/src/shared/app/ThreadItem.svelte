<script>
  import Sprite from '../Sprite.svelte';

  /**
   * One block of the Thread tab: your message, the agent's text, a tool call,
   * a shell command, a permission prompt (with its character) or a status line.
   *
   * @type {{ it: any, seed?: string, onanswer?: (choice: 'allow' | 'all' | 'deny') => void }}
   */
  let { it, seed, onanswer } = $props();

  const TONE = { Read: 'read', Grep: 'read', Glob: 'read', Edit: 'edit', Write: 'write' };
  const promptState = $derived(it.resolved === 'allowed' ? 'allowed' : it.resolved === 'denied' ? 'denied' : 'permission');
</script>

{#if it.kind === 'you'}
  <div class="you"><span class="gt">&gt;</span><span>{it.text}</span></div>
{:else if it.kind === 'text'}
  <p class="text">{it.text}</p>
{:else if it.kind === 'tool'}
  <div class="tool">
    <b class={TONE[it.tool]}>{it.tool}</b>
    <span class="detail">{it.detail}</span>
    {#if it.add}<span class="add">+{it.add}</span>{/if}
    {#if it.del}<span class="del">-{it.del}</span>{/if}
  </div>
{:else if it.kind === 'bash'}
  <div class="bash">
    <div class="cmd"><span class="t-blue">$</span> {it.cmd}</div>
    {#if it.out}<div class="out">{it.out}</div>{/if}
  </div>
  {#if it.running}
    <div class="status"><i class="sq"></i><span class="t-amber">Running</span> <b class="t-amber">Bash</b> <span class="t-muted">{it.cmd}</span></div>
  {/if}
{:else if it.kind === 'perm'}
  <div class="perm" class:done={!!it.resolved}>
    <div class="phead">
      <Sprite state={promptState} {seed} scale={2} />
      <b class="t-amber">permission</b>
      <span>{it.tool}</span>
      <span class="t-muted pdetail">{it.detail}</span>
    </div>
    {#if it.tool === 'Bash'}<pre class="pcmd">{it.detail}</pre>{/if}
    {#if it.resolved}
      <div class="pres" class:t-green={it.resolved === 'allowed'} class:t-red={it.resolved === 'denied'}>{it.resolved === 'allowed' ? 'Allowed' : 'Denied'}</div>
    {:else}
      <div class="pbtns">
        <button type="button" class="gb-btn allow" data-target="allow" onclick={() => onanswer?.('allow')}>Allow</button>
        <button type="button" class="gb-btn allow" data-target="allow-all" onclick={() => onanswer?.('all')}>{it.allLabel ?? (it.tool === 'Bash' ? 'Allow all commands' : 'Allow all edits (Edit mode)')}</button>
        <button type="button" class="gb-btn deny" data-target="deny" onclick={() => onanswer?.('deny')}>Deny</button>
      </div>
    {/if}
  </div>
{:else if it.kind === 'status'}
  <div class="status"><i class="sq"></i><span class="t-muted">{it.text}</span></div>
{/if}

<style>
  .you {
    display: flex;
    gap: 8px;
    padding: 9px 12px;
    color: var(--fg);
    background: var(--primary-soft);
    border-left: 2px solid var(--primary);
  }
  .gt {
    color: var(--primary);
  }
  .text {
    color: var(--fg);
  }
  .tool {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    font-size: 12px;
    color: var(--muted-fg);
  }
  .tool b {
    font-weight: 700;
  }
  .read {
    color: var(--blue);
  }
  .edit {
    color: var(--yellow);
  }
  .write {
    color: var(--green);
  }
  .detail {
    color: var(--fg);
  }
  .bash {
    padding: 6px 12px;
    font-size: 12px;
    border-left: 2px solid oklch(0.4 0 0);
  }
  .out {
    color: var(--green);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .sq {
    width: 8px;
    height: 8px;
    background: var(--primary);
    animation: gbpulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
  @keyframes gbpulse {
    50% {
      opacity: 0.4;
    }
  }
  .perm {
    padding: 4px 0 4px 12px;
    border-left: 4px solid var(--amber);
  }
  .perm.done {
    border-left-color: oklch(0.4 0 0);
  }
  .phead {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .pdetail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pcmd {
    margin: 6px 0 0;
    padding: 6px 10px;
    font: inherit;
    font-size: 12px;
    color: var(--fg);
    background: oklch(0.233 0 0 / 0.8);
    border: 1px solid var(--border);
    white-space: pre-wrap;
  }
  .pbtns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .pres {
    margin-top: 4px;
    font-size: 12px;
  }
  @media (prefers-reduced-motion: reduce) {
    .sq {
      animation: none;
    }
  }
</style>
