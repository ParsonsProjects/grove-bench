<script>
  import Legend from '../grove/Legend.svelte';

  // The key to the metaphor, one click away from anywhere on the page.
  let open = $state(false);
  /** @type {HTMLButtonElement | undefined} */
  let btn = $state();
  /** @type {HTMLDivElement | undefined} */
  let pop = $state();

  function onkeydown(e) {
    if (e.key === 'Escape' && open) {
      open = false;
      btn?.focus();
    }
  }
  function onclick(e) {
    if (!open) return;
    if (btn?.contains(e.target) || pop?.contains(e.target)) return;
    open = false;
  }
</script>

<svelte:window {onkeydown} {onclick} />

<div class="key">
  <button
    bind:this={btn}
    type="button"
    class="key-btn"
    aria-expanded={open}
    aria-controls="lg-key"
    onclick={() => (open = !open)}
  >
    <span class="lamps" aria-hidden="true"><i class="b"></i><i class="a"></i><i class="g"></i></span>
    Key
  </button>
  {#if open}
    <div class="pop" id="lg-key" bind:this={pop}>
      <Legend />
    </div>
  {/if}
</div>

<style>
  .key {
    position: relative;
  }
  .key-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 500;
    color: oklch(0.88 0 0);
    background: oklch(0.27 0 0);
    border: 1px solid oklch(0.34 0 0);
    cursor: pointer;
  }
  .key-btn:hover,
  .key-btn[aria-expanded='true'] {
    background: oklch(0.31 0 0);
  }
  .lamps {
    display: flex;
    gap: 2px;
  }
  .lamps i {
    width: 4px;
    height: 7px;
  }
  .b {
    background: #5aa0ff;
  }
  .a {
    background: #f59e0b;
  }
  .g {
    background: #22c55e;
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 10px);
    z-index: 60;
    width: min(340px, calc(100vw - 32px));
  }
</style>
