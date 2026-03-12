<script lang="ts">
  import MarkdownBlock from './MarkdownBlock.svelte';

  let { text }: { text: string } = $props();
</script>

<div class="user-prompt py-2.5 px-3 my-1 text-sm text-foreground bg-primary/8 border-l-2 border-primary flex items-start">
  <span class="text-primary select-none mr-2 shrink-0 leading-[1.6]">&gt;</span>
  <div class="min-w-0 flex-1">
    <MarkdownBlock content={text} />
  </div>
</div>

<style>
  .user-prompt :global(.markdown-content > p:first-child) {
    margin-top: 0;
  }
  .user-prompt :global(.markdown-content > p:last-child) {
    margin-bottom: 0;
  }
</style>
