<script lang="ts">
  /** "Keys": the keyboard shortcuts, with a link to the full list in Help. */
  import { SHORTCUT_GROUPS, formatShortcut } from '../lib/shortcut-list.js';
  import { helpStore } from '../stores/help.svelte.js';
  import StatusBarPopover from './StatusBarPopover.svelte';

  let shortcutsOpen = $state(false);
</script>

<StatusBarPopover bind:open={shortcutsOpen} align="right" class="hidden @2xl:block" testid="shortcuts" panelClass="bg-popover border border-border shadow-xl p-3 text-xs w-60">
  {#snippet trigger()}
    <button
      onclick={() => shortcutsOpen = !shortcutsOpen}
      class="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
      title="Keyboard shortcuts"
      aria-expanded={shortcutsOpen}
    >
      Keys
    </button>
  {/snippet}

  <div class="font-medium text-foreground mb-2">Keyboard shortcuts</div>
  {#each SHORTCUT_GROUPS as group, i (group.title)}
    <div class="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1 {i > 0 ? 'mt-2.5' : ''}">{group.title}</div>
    <div class="space-y-1 text-muted-foreground">
      {#each group.rows as row (row.label)}
        <div class="flex justify-between gap-3"><span>{row.label}</span><kbd class="text-foreground">{formatShortcut(row.key)}</kbd></div>
      {/each}
    </div>
  {/each}
  <button
    onclick={() => { shortcutsOpen = false; helpStore.show('keyboard-shortcuts'); }}
    class="mt-3 pt-2 w-full text-left border-t border-border text-blue-400 hover:text-blue-300 hover:underline"
  >
    All shortcuts in Help
  </button>
</StatusBarPopover>
