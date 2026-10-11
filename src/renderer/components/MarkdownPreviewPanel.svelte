<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import MarkdownBlock from './MarkdownBlock.svelte';
  import CopyButton from './CopyButton.svelte';
  import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import XIcon from '@lucide/svelte/icons/x';

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
    <PanelHeader>
      <svg class="size-3.5 text-muted-foreground shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
      <span class="truncate font-medium text-foreground">{markdownPreviewStore.title}</span>
      {#snippet actions()}
        <CopyButton text={markdownPreviewStore.content} />
        <Button
          size="icon-2xs"
          variant="quiet"
          onclick={() => markdownPreviewStore.close()}
          title="Close (Esc)"
          aria-label="Close preview"
        >
          <XIcon />
        </Button>
      {/snippet}
    </PanelHeader>
    <div class="flex-1 overflow-y-auto px-6 py-4 text-sm" bind:this={contentEl}>
      <MarkdownBlock content={markdownPreviewStore.content} />
    </div>
  </aside>
{/if}
