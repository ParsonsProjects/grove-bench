<script lang="ts">
  /**
   * The agent monitor mockup as a dialog over the app, as it would be if it
   * lived in the main window rather than a window of its own. The page
   * (/agent-monitor-dialog.html) runs the demo app (demo-mock.ts) behind it,
   * so Open thread really switches the app to that thread. It opens from
   * the trigger (MonitorTrigger.svelte) in the sidebar's footer, the
   * collapsed rail and the title bar, or with Ctrl+Shift+A, the shortcut
   * proposed for it. It starts closed; add ?open to the address to start
   * with it open.
   *
   * In the app it would read the threads from the stores the main window
   * already keeps (messageStore, backgroundTaskStore); here the rows are
   * still the mockup's made-up data.
   */
  import { onMount } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { store } from '../stores/sessions.svelte.js';
  import { monitor } from './monitor.svelte.js';
  import { injectTriggers } from './inject-triggers.js';
  import MonitorView from './MonitorView.svelte';

  let open = $state(new URLSearchParams(location.search).has('open'));

  onMount(() => injectTriggers(() => (open = true)));

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
