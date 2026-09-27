<script lang="ts">
  import { highlightSegments } from '../lib/search-highlight.js';

  /** Text with search matches marked. `words` highlights each query term
   *  separately instead of the whole phrase. */
  let { text, query, words = false }: { text: string; query: string; words?: boolean } = $props();

  let segments = $derived(highlightSegments(text, query, { words }));
</script>

{#each segments as seg}
  {#if seg.match}<mark class="bg-yellow-400/80 text-neutral-950 rounded-sm">{seg.text}</mark>{:else}{seg.text}{/if}
{/each}
