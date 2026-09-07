<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import MarkdownBlock from './MarkdownBlock.svelte';
  import CopyButton from './CopyButton.svelte';
  import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';

  let contentEl = $state<HTMLDivElement | null>(null);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && markdownPreviewStore.open) {
      e.stopPropagation();
      markdownPreviewStore.close();
    }
  }

  // Scroll back to the top whenever new content is shown.
  $effect(() => {
    markdownPreviewStore.content; // track
    if (contentEl) contentEl.scrollTop = 0;
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if markdownPreviewStore.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40 bg-black/40"
    transition:fade={{ duration: 150 }}
    onclick={() => markdownPreviewStore.close()}
  ></div>
  <aside
    class="fixed top-0 right-0 z-50 h-full w-[720px] max-w-[90vw] bg-card border-l border-border shadow-xl flex flex-col"
    transition:fly={{ x: 400, duration: 200 }}
    aria-label="Markdown preview"
  >
    <div class="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
      <svg class="w-4 h-4 text-muted-foreground shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
      <span class="text-sm font-medium text-foreground truncate flex-1">{markdownPreviewStore.title}</span>
      <CopyButton text={markdownPreviewStore.content} />
      <button
        onclick={() => markdownPreviewStore.close()}
        class="text-muted-foreground hover:text-foreground transition-colors p-0.5"
        title="Close (Esc)"
        aria-label="Close preview"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
    <div class="flex-1 overflow-y-auto px-6 py-4 text-sm" bind:this={contentEl}>
      <MarkdownBlock content={markdownPreviewStore.content} />
    </div>
  </aside>
{/if}
