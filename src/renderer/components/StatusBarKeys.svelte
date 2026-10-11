<script lang="ts">
  /** "Keys": the keyboard shortcuts, with a link to the full list in Help. */
  import { SHORTCUT_GROUPS, formatShortcut } from '../lib/shortcut-list.js';
  import { helpStore } from '../stores/help.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Kbd } from '$lib/components/ui/kbd/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import StatusBarPopover from './StatusBarPopover.svelte';

  let shortcutsOpen = $state(false);
</script>

<StatusBarPopover
  bind:open={shortcutsOpen}
  align="right"
  class="hidden @2xl:block"
  id="status-bar-shortcuts"
  label="Keyboard shortcuts"
  panelClass="w-64 max-h-[70vh] overflow-y-auto"
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
    <SectionLabel class="mb-1 {i > 0 ? 'mt-3' : ''}">{group.title}</SectionLabel>
    <dl class="space-y-1.5 text-muted-foreground">
      {#each group.rows as row (row.label)}
        <!-- A keycap per key; the "+" between them is for screen readers. -->
        <div class="flex items-center justify-between gap-3"><dt>{row.label}</dt><dd class="flex shrink-0 items-center gap-0.5">{#each formatShortcut(row.key).split('+') as key, k (k)}{#if k > 0}<span class="sr-only">+</span>{/if}<Kbd variant="key">{key}</Kbd>{/each}</dd></div>
      {/each}
    </dl>
  {/each}
  <Button
    variant="link"
    size="inline"
    class="mt-3"
    onclick={() => { shortcutsOpen = false; helpStore.show('keyboard-shortcuts'); }}
  >
    All shortcuts
  </Button>
</StatusBarPopover>
