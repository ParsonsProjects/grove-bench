<script>
  import Sprite from '../Sprite.svelte';

  /**
   * A conversation row in the sidebar, as the app draws it: its character,
   * the name, how long ago, then the project and what the agent is doing, and
   * a count of changed files.
   *
   * @type {{ c: any, selected?: boolean, showProject?: boolean, onclick?: () => void, target?: string }}
   */
  let { c, selected = false, showProject = true, onclick, target } = $props();
</script>

<button type="button" class="row" class:selected {onclick} data-target={target} aria-current={selected ? 'true' : undefined}>
  <span class="who"><Sprite state={c.state} seed={c.id} projectColor={c.projectColor} scale={2} /></span>
  <span class="body">
    <span class="top">
      <svg class="br" class:red={c.state === 'permission'} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path fill="currentColor" d="M5 3a2 2 0 1 0-2 2v6a2 2 0 1 0 2 0V8.4c.6.4 1.3.6 2 .6h2a2 2 0 0 0 2-2V5.7a2 2 0 1 0-2 0V7H7a1 1 0 0 1-1-1V5a2 2 0 0 0-1-2Zm-2 9a.8.8 0 1 1 0 1.6A.8.8 0 0 1 3 12Zm0-9.8A.8.8 0 1 1 3 3.8a.8.8 0 0 1 0-1.6Zm7 2A.8.8 0 1 1 10 5.8a.8.8 0 0 1 0-1.6Z" />
      </svg>
      <span class="name">{c.name}</span>
      <span class="age">{c.age}</span>
    </span>
    <span class="sub">
      {#if showProject}<span class="proj">{c.project}</span><span class="sep">·</span>{/if}
      <span class="line t-{c.lineTone ?? 'muted'}">{c.line}</span>
      {#if c.files?.length}<span class="badge">±{c.files.length}</span>{/if}
    </span>
  </span>
</button>

<style>
  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 7px 10px 8px 12px;
    text-align: left;
  }
  .row:hover {
    background: oklch(1 0 0 / 0.03);
  }
  .row.selected {
    background: oklch(0.26 0 0);
  }
  .who {
    padding-top: 2px;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .br {
    flex: none;
    color: var(--muted-fg);
  }
  .br.red {
    color: var(--red);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 13.5px;
    color: oklch(0.92 0 0);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .age {
    flex: none;
    font-size: 11px;
    color: var(--faint-fg);
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    font-size: 11px;
  }
  .proj {
    flex: none;
    color: var(--faint-fg);
  }
  .sep {
    color: var(--faint-fg);
  }
  .line {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line.t-muted {
    color: var(--faint-fg);
  }
  .line.t-blue {
    color: oklch(0.62 0.17 254.624);
  }
  .badge {
    flex: none;
    padding: 0 4px;
    font-size: 10px;
    color: var(--muted-fg);
    border: 1px solid var(--border);
  }
</style>
