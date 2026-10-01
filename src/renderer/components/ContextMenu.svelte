<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface ContextMenuItem {
    label: string;
    icon?: string;
    action: () => void;
    variant?: 'default' | 'destructive';
    separator?: boolean;
    disabled?: boolean;
  }

  let {
    x,
    y,
    items,
    onclose,
    label,
  }: {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onclose: () => void;
    /** Accessible name for the menu. */
    label?: string;
  } = $props();

  let menuEl: HTMLDivElement | undefined = $state();

  /** Highlighted item, shared by mouse hover and the arrow keys. -1 = none. */
  let activeIndex = $state(-1);

  // When any item has an icon, the others get an empty slot so labels line up.
  let hasIcons = $derived(items.some((item) => item.icon));

  function choose(item: ContextMenuItem) {
    if (item.disabled) return;
    item.action();
    onclose();
  }

  /** Next enabled item in direction `dir`, wrapping round. */
  function step(dir: 1 | -1): number {
    const n = items.length;
    const start = activeIndex < 0 ? (dir === 1 ? -1 : n) : activeIndex;
    for (let i = 1; i <= n; i++) {
      const idx = (((start + dir * i) % n) + n) % n;
      if (!items[idx].disabled) return idx;
    }
    return activeIndex;
  }

  function handleDismiss(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) {
      onclose();
    }
  }

  const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

  // Runs in the capture phase so the keys the menu uses never reach whatever
  // has focus underneath (e.g. Enter would otherwise send the prompt).
  function handleKeydown(e: KeyboardEvent) {
    if (MODIFIER_KEYS.has(e.key)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      activeIndex = step(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const item = items[activeIndex];
      if (item) choose(item);
      else onclose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    } else {
      // Typing carries on as normal; the menu just gets out of the way.
      onclose();
    }
  }

  function handleWindowChange() {
    onclose();
  }

  // Adjust position if menu overflows viewport
  let offsetX = $state(0);
  let offsetY = $state(0);
  let adjustedX = $derived(x + offsetX);
  let adjustedY = $derived(y + offsetY);

  onMount(() => {
    if (menuEl) {
      const rect = menuEl.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        offsetX = window.innerWidth - rect.width - 4 - x;
      }
      if (rect.bottom > window.innerHeight) {
        // Open upwards from the pointer, like a native menu, so what was
        // clicked (e.g. the misspelled word) stays visible.
        const above = y - rect.height;
        offsetY = (above >= 4 ? above : window.innerHeight - rect.height - 4) - y;
      }
    }
    document.addEventListener('click', handleDismiss, true);
    document.addEventListener('contextmenu', handleDismiss, true);
    window.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('blur', handleWindowChange);
    window.addEventListener('resize', handleWindowChange);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleDismiss, true);
    document.removeEventListener('contextmenu', handleDismiss, true);
    window.removeEventListener('keydown', handleKeydown, true);
    window.removeEventListener('blur', handleWindowChange);
    window.removeEventListener('resize', handleWindowChange);
  });
</script>

<!-- mousedown is cancelled so choosing an item never moves focus: the spell
     check menu relies on the text box keeping its caret.
     It can also open over a dialog, which turns off pointer events on the
     page and closes on any pointerdown outside itself. So the menu sits above
     dialogs, turns pointer events back on, and keeps its pointerdowns to
     itself. -->
<div
  bind:this={menuEl}
  role="menu"
  tabindex="-1"
  aria-label={label}
  class="fixed z-[100] pointer-events-auto min-w-[160px] border border-border bg-popover text-popover-foreground shadow-md py-1"
  style="left: {adjustedX}px; top: {adjustedY}px;"
  onmousedown={(e) => e.preventDefault()}
  onpointerdown={(e) => e.stopPropagation()}
  onmouseleave={() => activeIndex = -1}
>
  {#each items as item, i}
    {#if item.separator}
      <div class="border-t border-border my-1" role="separator"></div>
    {/if}
    <button
      role="menuitem"
      tabindex="-1"
      disabled={item.disabled}
      aria-disabled={item.disabled || undefined}
      onclick={() => choose(item)}
      onmouseenter={() => activeIndex = item.disabled ? -1 : i}
      class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors
        {item.disabled ? 'text-muted-foreground cursor-default' : ''}
        {item.variant === 'destructive' ? 'text-destructive' : ''}
        {i === activeIndex ? (item.variant === 'destructive' ? 'bg-accent' : 'bg-accent text-accent-foreground') : ''}"
    >
      {#if item.icon === 'add'}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      {:else if item.icon === 'destroy'}
        <!-- A bin, like the sidebar row's delete: ✕ is 'close'. -->
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      {:else if item.icon === 'folder'}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
      {:else if item.icon === 'rename'}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>
      {:else if item.icon === 'close'}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      {:else if item.icon === 'check'}
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      {:else if hasIcons}
        <span class="w-3 shrink-0" aria-hidden="true"></span>
      {/if}
      {item.label}
    </button>
  {/each}
</div>
