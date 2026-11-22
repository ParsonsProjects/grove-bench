<script lang="ts" module>
  /** One row of a DropdownMenu. `selected`: the current choice (a ✓ and
   *  the primary edge). `detail`: a second, quieter line. */
  export interface DropdownItem {
    label: string;
    detail?: string;
    selected?: boolean;
    disabled?: boolean;
    tone?: 'default' | 'destructive';
    /** A line above this row. */
    separator?: boolean;
    onclick: () => void;
  }
</script>

<script lang="ts">
  /**
   * A small button that opens a list of choices below it: a split button's
   * arrow, or a ⋯ menu. Escape or a click outside closes it, and focus goes
   * back to the button. Built from the kit's menu recipes, as the other
   * hand-made menus are.
   */
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import CheckIcon from '@lucide/svelte/icons/check';
  import { menuItem, menuPanel, menuSeparator } from '$lib/components/ui/menu/index.js';

  let { items, label, align = 'left', triggerClass = '', disabled = false, children }: {
    items: DropdownItem[];
    /** The button's accessible name and tooltip. */
    label: string;
    /** Which edge of the button the list lines up with. */
    align?: 'left' | 'right';
    triggerClass?: string;
    disabled?: boolean;
    children: Snippet;
  } = $props();

  let open = $state(false);
  let ref = $state<HTMLDivElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);

  function choose(item: DropdownItem) {
    open = false;
    trigger?.focus();
    item.onclick();
  }

  function onWindowClick(e: MouseEvent) {
    const target = e.target as Node;
    if (open && ref && target.isConnected && !ref.contains(target)) open = false;
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') {
      // Handled: a popover around this leaves the key alone (StatusBarPopover).
      e.preventDefault();
      e.stopPropagation();
      open = false;
      trigger?.focus();
    }
  }

  onMount(() => {
    window.addEventListener('click', onWindowClick);
    window.addEventListener('keydown', onWindowKeydown, true);
  });
  onDestroy(() => {
    window.removeEventListener('click', onWindowClick);
    window.removeEventListener('keydown', onWindowKeydown, true);
  });
</script>

<div class="relative inline-flex" bind:this={ref}>
  <button
    bind:this={trigger}
    type="button"
    class={triggerClass}
    aria-label={label}
    title={label}
    aria-haspopup="menu"
    aria-expanded={open}
    {disabled}
    onclick={() => (open = !open)}
  >
    {@render children()}
  </button>
  {#if open}
    <div role="menu" aria-label={label} class="{menuPanel()} absolute top-full z-50 mt-1 w-64 {align === 'right' ? 'right-0' : 'left-0'}">
      {#each items as item (item.label)}
        {#if item.separator}<div class={menuSeparator} role="separator"></div>{/if}
        <button
          type="button"
          role={item.selected === undefined ? 'menuitem' : 'menuitemradio'}
          aria-checked={item.selected}
          disabled={item.disabled}
          class="{menuItem({ selected: item.selected === true, tone: item.tone ?? 'default' })} items-start"
          onclick={() => choose(item)}
        >
          <span class="w-3.5 shrink-0 pt-0.5">{#if item.selected}<CheckIcon class="text-primary" />{/if}</span>
          <span class="flex min-w-0 flex-col">
            <span>{item.label}</span>
            {#if item.detail}<span class="text-caption text-muted-foreground">{item.detail}</span>{/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
