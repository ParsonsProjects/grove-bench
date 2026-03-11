<script lang="ts">
  import MarkdownBlock from './MarkdownBlock.svelte';

  let { content }: { content: string } = $props();
</script>

<div class="py-1 text-sm text-neutral-200">
  <MarkdownBlock {content} />
</div>
