<script>
  /** @type {{ title: string, caption: string, class?: string, children: import('svelte').Snippet }} */
  let { title, caption, class: className = '', children } = $props();
</script>

<article class="tile {className}">
  <div class="demo">
    {@render children()}
  </div>
  <div class="cap">
    <h3>{title}</h3>
    <p>{caption}</p>
  </div>
</article>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--color-card);
    border: 1px solid var(--color-border);
    transition:
      border-color 0.2s ease,
      background-color 0.2s ease;
  }
  .tile:hover {
    border-color: oklch(0.541 0.181 254.624 / 0.35);
  }
  .demo {
    flex: 1;
    min-width: 0;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
  }
  .cap {
    padding: 1rem 1.25rem 1.25rem;
    border-top: 1px solid var(--color-border);
  }
  h3 {
    font-size: 15px;
    font-weight: 700;
    color: var(--color-foreground);
    letter-spacing: -0.01em;
  }
  p {
    margin-top: 0.25rem;
    font-size: 14px;
    line-height: 1.5;
    color: var(--color-muted-foreground);
  }
</style>
