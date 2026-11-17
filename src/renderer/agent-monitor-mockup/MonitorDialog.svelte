<script lang="ts">
  /**
   * The agent monitor mockup as a dialog over the app, as it would be if it
   * lived in the main window rather than a window of its own. The page
   * (/agent-monitor-dialog.html) runs the demo app (demo-mock.ts) behind it,
   * so Open thread really switches the app to that thread. Ctrl+Shift+A, the
   * shortcut proposed for it, opens and closes it.
   *
   * In the app it would read the threads from the stores the main window
   * already keeps (messageStore, backgroundTaskStore); here the rows are
   * still the mockup's made-up data.
   */
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Kbd } from '$lib/components/ui/kbd/index.js';
  import ActivityIcon from '@lucide/svelte/icons/activity';
  import { store } from '../stores/sessions.svelte.js';
  import { monitor } from './monitor.svelte.js';
  import MonitorView from './MonitorView.svelte';

  let open = $state(true);

  monitor.openThreadIn = (threadId) => {
    if (store.sessions.some((s) => s.id === threadId)) {
      store.activeSessionId = threadId;
      open = false;
    } else {
      monitor.say("That thread isn't in the demo app's data.");
    }
    return true;
  };

  /** Opens with the cursor in the filter box, so typing narrows the list. */
  function focusFilter(e: Event) {
    e.preventDefault();
    document.querySelector<HTMLInputElement>('[data-monitor-filter]')?.focus();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      open = !open;
    }
  }
</script>

<svelte:window {onkeydown} />

<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[85vh] max-h-[90vh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl" showCloseButton={false} onOpenAutoFocus={focusFilter}>
    <MonitorView class="h-full min-h-0" onclose={() => (open = false)}>
      {#snippet heading()}
        <Dialog.Title class="text-sm font-medium">Agent monitor</Dialog.Title>
        <Dialog.Description class="sr-only">What every thread's agent and subagents are running, in every project.</Dialog.Description>
      {/snippet}
    </MonitorView>
  </Dialog.Content>
</Dialog.Root>

<!-- Mockup only: a way back in once it's closed. In the app the trigger
     would be the shortcut, an icon in the sidebar's bottom toolbar, or the
     sidebar's Working and Needs you counts. -->
{#if !open}
  <button
    class="fixed top-1 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-xl hover:bg-accent"
    onclick={() => (open = true)}
  >
    <Badge tone="warning">mockup</Badge>
    <ActivityIcon class="size-3.5 text-muted-foreground" aria-hidden="true" />
    Agent monitor
    <Kbd>Ctrl+Shift+A</Kbd>
  </button>
{/if}
