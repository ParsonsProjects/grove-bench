<script lang="ts">
  import MarkdownBlock from './MarkdownBlock.svelte';
  import { isPreviewableMarkdown } from '../lib/markdown-detect.js';
  import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';

  let { content }: { content: string } = $props();

  // Only document-like responses (plans, reports, audits) earn the affordance.
  let previewable = $derived(isPreviewableMarkdown(content));
</script>

<div class="py-1 text-sm text-foreground relative group/atb">
  {#if previewable}
    <button
      onclick={() => markdownPreviewStore.show(content, 'Agent response')}
      class="absolute right-0 top-1 z-10 flex items-center gap-1 text-[11px] px-1.5 py-0.5 border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary transition-all opacity-0 group-hover/atb:opacity-100"
      title="Open rendered preview"
    >
      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
      Preview
    </button>
  {/if}
  <MarkdownBlock {content} />
</div>
