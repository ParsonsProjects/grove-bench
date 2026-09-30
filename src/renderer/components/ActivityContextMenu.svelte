<script lang="ts">
  import ContextMenu from './ContextMenu.svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
  import { activityMenuEntries, readActivityTarget, type ActivityMenuAction, type ActivityMenuEntry } from '$lib/activity-menu.js';
  import { bookmarkSelection } from '$lib/bookmark-selection.js';
  import { writeRichText } from '$lib/clipboard.js';

  // Right-click menu for the Activity thread. It offers what's under the
  // pointer (selection, code block, table, link) and then the whole row, next
  // to the hover icons rather than instead of them.
  let {
    sessionId,
    container,
  }: { sessionId: string; container: HTMLElement | null | undefined } = $props();

  let menu = $state<{ x: number; y: number; entries: ActivityMenuEntry[] } | null>(null);

  $effect(() => {
    const el = container;
    if (!el) return;
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as Element;
      // Text boxes keep the spell check menu.
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const entries = activityMenuEntries(readActivityTarget(target, el, messageStore.getMessages(sessionId)));
      if (entries.length === 0) return;
      e.preventDefault();
      let { clientX: x, clientY: y } = e;
      // Opened from the keyboard (Menu key, Shift+F10) the event may carry no
      // position, so open under the focused element instead of the corner.
      if (x === 0 && y === 0) {
        const rect = target.getBoundingClientRect();
        x = rect.left;
        y = rect.bottom;
      }
      menu = { x, y, entries };
    };
    el.addEventListener('contextmenu', onContextMenu);
    return () => el.removeEventListener('contextmenu', onContextMenu);
  });

  function run(action: ActivityMenuAction) {
    switch (action.kind) {
      case 'copy':
        navigator.clipboard.writeText(action.text).catch(() => {});
        break;
      case 'copy-rich':
        writeRichText(action.text, action.html).catch(() => {});
        break;
      case 'bookmark':
        bookmarkSelection(sessionId, action.text, action.msgId).catch(() => {});
        window.getSelection()?.removeAllRanges();
        break;
      case 'to-prompt':
        messageStore.requestPromptInsert(sessionId, action.text);
        window.getSelection()?.removeAllRanges();
        break;
      case 'rewind':
        messageStore.openRewindDialog(sessionId, action.uuid);
        break;
      case 'focus':
        markdownPreviewStore.show(action.content, 'Agent response');
        break;
    }
  }
</script>

<!-- Keyed so a right-click while the menu is open remounts it at the new
     spot (ContextMenu measures its position once, on mount). -->
{#key menu}
  {#if menu}
    <ContextMenu
      x={menu.x}
      y={menu.y}
      label="Activity actions"
      items={menu.entries.map((entry) => ({ label: entry.label, separator: entry.separator, action: () => run(entry.action) }))}
      onclose={() => menu = null}
    />
  {/if}
{/key}
