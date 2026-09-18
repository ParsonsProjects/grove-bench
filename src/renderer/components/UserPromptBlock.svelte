<script lang="ts">
  import MarkdownBlock from './MarkdownBlock.svelte';

  let {
    text,
    onRewind,
  }: {
    text: string;
    /** When set, a "Rewind to here" action is shown on hover. Only messages
     *  with a checkpoint (a uuid) get one. */
    onRewind?: () => void;
  } = $props();
</script>

<div class="user-prompt group py-2.5 px-3 my-1 text-sm text-foreground bg-primary/8 border-l-2 border-primary flex items-start">
  <span class="text-primary select-none mr-2 shrink-0 leading-[1.6]">&gt;</span>
  <div class="min-w-0 flex-1">
    <MarkdownBlock content={text} />
  </div>
  {#if onRewind}
    <button
      type="button"
      onclick={onRewind}
      class="shrink-0 ml-2 -my-1 px-1.5 py-1 flex items-center gap-1 text-[10px] text-muted-foreground border border-transparent
        opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:border-border hover:bg-card/80 transition-colors"
      title="Rewind to this message: restore files to how they were before it and drop the turns after it"
      aria-label="Rewind to this message"
    >
      <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
      </svg>
      Rewind
    </button>
  {/if}
</div>

<style>
  .user-prompt :global(.markdown-content > p:first-child) {
    margin-top: 0;
  }
  .user-prompt :global(.markdown-content > p:last-child) {
    margin-bottom: 0;
  }
</style>
