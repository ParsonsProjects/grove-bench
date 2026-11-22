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
   * A button that opens a list of choices: a split button's arrow, or a ⋯
   * menu. Escape or a click outside closes it, and focus goes back to the
   * button. Escape is marked handled, so a popover around it stays open
   * (StatusBarPopover). Built from the kit: its Button, and the menu recipes
   * the other hand-made menus use.
   *
   * The list is placed against the window (position: fixed), not inside
   * whatever holds the button: the branch popup scrolls, and would clip a
   * list near its edge. It opens below the button, or above when there is
   * no room below.
   */
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import CheckIcon from '@lucide/svelte/icons/check';
  import { Button } from '$lib/components/ui/button/index.js';
  import { menuItem, menuPanel, menuSeparator } from '$lib/components/ui/menu/index.js';

  let { items, label, align = 'left', variant = 'quiet', size = 'icon-2xs', class: className = '', disabled = false, children }: {
    items: DropdownItem[];
    /** The button's accessible name and tooltip. */
    label: string;
    /** Which edge of the button the list lines up with. */
    align?: 'left' | 'right';
    /** The kit Button's look: quiet for a ⋯ menu, or a split button's
     *  arrow in the main button's variant. */
    variant?: 'quiet' | 'default' | 'subtle-primary';
    size?: 'icon-2xs' | 'icon-xs';
    class?: string;
    disabled?: boolean;
    children: Snippet;
  } = $props();

  let open = $state(false);
  let ref = $state<HTMLDivElement | null>(null);
  let trigger = $state<HTMLElement | null>(null);

  const GAP = 4;

  /** Put the list by the button, inside the window. */
  function place(node: HTMLElement) {
    const button = trigger?.getBoundingClientRect();
    if (!button) return;
    const height = node.offsetHeight;
    const below = window.innerHeight - button.bottom - GAP;
    const style = node.style;
    if (height > below && button.top - GAP > below) {
      style.top = '';
      style.bottom = `${window.innerHeight - button.top + GAP}px`;
    } else {
      style.bottom = '';
      style.top = `${button.bottom + GAP}px`;
    }
    const width = node.offsetWidth;
    const left = align === 'right' ? button.right - width : button.left;
    style.left = `${Math.max(GAP, Math.min(left, window.innerWidth - width - GAP))}px`;
  }

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

  /** The window resized, or something around the button scrolled: close
   *  the list rather than leave it floating away from its button. */
  function onWindowChange() {
    open = false;
  }

  onMount(() => {
    window.addEventListener('click', onWindowClick);
    window.addEventListener('keydown', onWindowKeydown, true);
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);
  });
  onDestroy(() => {
    window.removeEventListener('click', onWindowClick);
    window.removeEventListener('keydown', onWindowKeydown, true);
    window.removeEventListener('resize', onWindowChange);
    window.removeEventListener('scroll', onWindowChange, true);
  });
</script>

<div class="inline-flex" bind:this={ref}>
  <Button
    bind:ref={trigger}
    {variant}
    {size}
    class={className}
    aria-label={label}
    title={label}
    aria-haspopup="menu"
    aria-expanded={open}
    {disabled}
    onclick={() => (open = !open)}
  >
    {@render children()}
  </Button>
  {#if open}
    <div role="menu" aria-label={label} use:place class="{menuPanel()} fixed z-50 w-64">
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
