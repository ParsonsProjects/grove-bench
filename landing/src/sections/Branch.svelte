<script>
  /**
   * A section's label as a branch name, the way the app's sidebar shows a
   * conversation's branch. The trail down the page is main; each section is
   * a branch off it.
   *
   * @type {{ name: string }}
   */
  let { name } = $props();
</script>

<p class="branch">
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path fill="currentColor" d="M5 3a2 2 0 1 0-2 2v6a2 2 0 1 0 2 0V8.4c.6.4 1.3.6 2 .6h2a2 2 0 0 0 2-2V5.7a2 2 0 1 0-2 0V7H7a1 1 0 0 1-1-1V5a2 2 0 0 0-1-2Zm-2 9a.8.8 0 1 1 0 1.6A.8.8 0 0 1 3 12Zm0-9.8A.8.8 0 1 1 3 3.8a.8.8 0 0 1 0-1.6Zm7 2A.8.8 0 1 1 10 5.8a.8.8 0 0 1 0-1.6Z" />
  </svg>
  {name}
</p>

<style>
  .branch {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 14px;
    font-size: 13px;
    color: var(--soft);
  }
  svg {
    color: var(--green);
  }
  :global(.b-dusk) svg,
  :global(.b-night) svg {
    color: #6ec87a;
  }
</style>
