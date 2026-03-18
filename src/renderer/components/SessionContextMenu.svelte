<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface MenuItem {
    label: string;
    icon?: string;
    action: () => void;
    variant?: 'default' | 'destructive';
    separator?: boolean;
  }

  let {
    x,
    y,
    items,
    onclose,
  }: {
    x: number;
    y: number;
    items: MenuItem[];
    onclose: () => void;
  } = $props();

  let menuEl: HTMLDivElement | undefined = $state();

  function handleDismiss(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) {
      onclose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  // Adjust position if menu overflows viewport
  let adjustedX = $state(x);
  let adjustedY = $state(y);

  onMount(() => {
    if (menuEl) {
      const rect = menuEl.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        adjustedX = window.innerWidth - rect.width - 4;
      }
      if (rect.bottom > window.innerHeight) {
        adjustedY = window.innerHeight - rect.height - 4;
      }
    }
    document.addEventListener('click', handleDismiss, true);
    document.addEventListener('contextmenu', handleDismiss, true);
    document.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleDismiss, true);
    document.removeEventListener('contextmenu', handleDismiss, true);
    document.removeEventListener('keydown', handleKeydown);
  });
</script>

<div
  bind:this={menuEl}
  class="fixed z-50 min-w-[160px] border border-border bg-popover text-popover-foreground shadow-md py-1"
  style="left: {adjustedX}px; top: {adjustedY}px;"
>
  {#each items as item}
    {#if item.separator}
      <div class="border-t border-border my-1"></div>
    {/if}
    <button
      onclick={() => { item.action(); onclose(); }}
      class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-accent hover:text-accent-foreground
        {item.variant === 'destructive' ? 'text-destructive hover:text-destructive' : ''}"
    >
      {#if item.icon === 'destroy'}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      {:else if item.icon === 'folder'}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
      {:else if item.icon === 'rename'}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>
      {:else if item.icon === 'close'}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      {/if}
      {item.label}
    </button>
  {/each}
</div>
