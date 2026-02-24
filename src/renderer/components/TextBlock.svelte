<script lang="ts">
  import { renderMarkdown } from '../lib/markdown.js';

  let { text }: { text: string } = $props();
</script>

<div class="prose prose-invert prose-sm max-w-none">
  {@html renderMarkdown(text)}
</div>
