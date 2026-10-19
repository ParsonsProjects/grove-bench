<script lang="ts">
  /**
   * The To do flag's mark: a pixel ring, an open to-do. Round so it can't be
   * taken for a status square, and not the goal's flag. The view box is the
   * ring alone, so at 10px each pixel lands on a whole screen pixel.
   */
  let { class: className = '' }: { class?: string } = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="2 2 20 20" class="shrink-0 {className}" aria-hidden="true"><path d="M8 2h8v2H8Zm0 18h8v2H8ZM4 4h4v2H4Zm12 0h4v2h-4ZM4 18h4v2H4Zm12 0h4v2h-4ZM2 6h2v12H2Zm18 0h2v12h-2Z"/></svg>
