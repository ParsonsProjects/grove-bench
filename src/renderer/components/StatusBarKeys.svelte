<script lang="ts">
  /** "Keys": the keyboard shortcuts, with a link to the full list in Help. */
  import { SHORTCUT_GROUPS, formatShortcut } from '../lib/shortcut-list.js';
  import { helpStore } from '../stores/help.svelte.js';
  import StatusBarPopover from './StatusBarPopover.svelte';

  let shortcutsOpen = $state(false);
</script>

<StatusBarPopover
  bind:open={shortcutsOpen}
  align="right"
  class="hidden @2xl:block"
  id="status-bar-shortcuts"
  label="Keyboard shortcuts"
  panelClass="bg-popover border border-border shadow-xl p-3 text-xs w-64 max-h-[70vh] overflow-y-auto"
>
  {#snippet trigger()}
    <button
      onclick={() => shortcutsOpen = !shortcutsOpen}
      class="text-muted-foreground hover:text-foreground transition-colors"
      title="Keyboard shortcuts"
      aria-expanded={shortcutsOpen}
      aria-controls="status-bar-shortcuts"
    >
      Keys
    </button>
  {/snippet}

  <div class="font-medium text-foreground mb-2">Keyboard shortcuts</div>
  {#each SHORTCUT_GROUPS as group, i (group.title)}
    <div class="text-muted-foreground font-medium mb-1 {i > 0 ? 'mt-3' : ''}">{group.title}</div>
    <dl class="space-y-1.5 text-muted-foreground">
      {#each group.rows as row (row.label)}
        <div class="flex justify-between gap-3"><dt>{row.label}</dt><dd><kbd class="text-foreground">{formatShortcut(row.key)}</kbd></dd></div>
      {/each}
    </dl>
  {/each}
  <button
    type="button"
    class="mt-3 text-primary hover:underline"
    onclick={() => { shortcutsOpen = false; helpStore.show('keyboard-shortcuts'); }}
  >
    All shortcuts
  </button>
</StatusBarPopover>
