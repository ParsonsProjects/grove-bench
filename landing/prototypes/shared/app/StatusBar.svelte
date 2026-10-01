<script>
  import ContextStrip from '../ContextStrip.svelte';

  /**
   * The status bar under a conversation: the context grove along its top
   * edge, the agent settings control, the thread view, the branch and PR, and
   * the context meter.
   *
   * @type {{ c: any, onpr?: () => void, groveWidth?: number }}
   */
  let { c, onpr, groveWidth = 400 } = $props();

  const MODE_TONE = { Ask: 'blue', Plan: 'yellow', Edit: 'purple', Auto: 'cyan', 'Read-safe': 'green' };
</script>

<div class="sb">
  <div class="grove"><ContextStrip seed={c.id} percent={c.context} width={groveWidth} scale={2} /></div>
  <div class="bar">
    <div class="agent">
      <i class="dot"></i>
      <span class="two"><span>Claude Agent</span><span class="t-faint">{c.model} · <b class="m-{MODE_TONE[c.mode] ?? 'blue'}">{c.mode}</b></span></span>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" /></svg>
    </div>
    <span class="div"></span>
    <span class="view t-primary">Summary</span>
    <span class="div"></span>
    <span class="two branch">
      <span class="t-faint">{c.project} / <span class="t-muted">{c.name}</span></span>
      {#if c.pr}
        <span><span class="t-green">●</span> <span class="t-primary">PR #{c.pr}</span></span>
      {:else}
        <button type="button" class="pr" data-target="create-pr" onclick={onpr}><span class="t-amber">↑{c.ahead ?? 1}</span> <span class="t-primary">Create PR</span></button>
      {/if}
    </span>
    <span class="ctx">
      <span class="t-green">Context {c.context}%</span>
      <span class="meter"><span style="width: {c.context}%"></span></span>
    </span>
    <span class="keys t-muted">Keys</span>
  </div>
</div>

<style>
  .sb {
    position: relative;
    flex: none;
  }
  .grove {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    overflow: hidden;
    pointer-events: none;
    line-height: 0;
  }
  .grove :global(svg) {
    max-width: none;
    height: 16px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 6px 12px;
    font-size: 11.5px;
    background: var(--side);
    border-top: 1px solid var(--border);
    white-space: nowrap;
  }
  .agent {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 8px;
    border: 1px solid var(--border);
  }
  .dot {
    width: 6px;
    height: 6px;
    background: var(--primary);
  }
  .two {
    display: flex;
    flex-direction: column;
    line-height: 1.35;
  }
  .m-blue {
    color: var(--blue);
  }
  .m-yellow {
    color: var(--yellow);
  }
  .m-purple {
    color: var(--purple);
  }
  .m-cyan {
    color: var(--cyan);
  }
  .m-green {
    color: var(--green);
  }
  .div {
    width: 1px;
    height: 22px;
    background: var(--border);
  }
  .branch {
    min-width: 0;
    overflow: hidden;
  }
  .pr {
    padding: 0;
    text-align: left;
    font-size: 11.5px;
  }
  .pr:hover .t-primary {
    text-decoration: underline;
  }
  .ctx {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    margin-left: auto;
  }
  .meter {
    width: 96px;
    height: 4px;
    background: var(--muted);
  }
  .meter span {
    display: block;
    height: 100%;
    background: var(--primary);
    transition: width 0.8s steps(8);
  }
</style>
