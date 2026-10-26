<script lang="ts">
  /**
   * The Skills drawer: a slide-out on the right with two tabs. This thread
   * has the open thread's skills (Run, Schedule, Add skill, Share and Link,
   * and for Claude Code turning them off and suggestions); Scheduled has
   * every project's scheduled skills. Replaces the Skills popover and the
   * Scheduled skills dialog, which ran out of room.
   *
   * It is a modal dialog (bits-ui), so keyboard focus moves into it, stays
   * there and goes back where it was on close, and a dropdown or dialog
   * opened from it takes Escape and outside clicks first. While a skill's
   * SKILL.md is open with unsaved changes, closing the drawer or switching
   * tab asks first (skillsPanelStore.unlessUnsaved).
   */
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { fly, fade } from 'svelte/transition';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { prefersReducedMotion } from '$lib/utils.js';
  import XIcon from '@lucide/svelte/icons/x';
  import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
  import { schedulesStore } from '../stores/schedules.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import ThreadSkills from './ThreadSkills.svelte';
  import ScheduledSkills from './ScheduledSkills.svelte';

  const motion = prefersReducedMotion() ? 0 : 1;
  const activeId = $derived(store.activeSessionId && store.sessions.some((s) => s.id === store.activeSessionId) ? store.activeSessionId : null);

  /** The thread open when the drawer opened. */
  let openedOn: string | null = null;
  let content = $state<HTMLElement | null>(null);

  /** Focus starts on the open tab, ahead of what it holds. */
  function focusTab(e: Event) {
    e.preventDefault();
    openedOn = store.activeSessionId;
    requestAnimationFrame(() => content?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus());
  }

  /** Focus goes back where it was, unless a thread started from the drawer
   *  (Run) is now open: that thread has it. */
  function keepNewThreadFocus(e: Event) {
    if (store.activeSessionId !== openedOn) e.preventDefault();
  }

  /** Escape leaves the skill editor or closes the form first, then the drawer. */
  function closeFormFirst(e: KeyboardEvent) {
    if (skillsPanelStore.edit) {
      e.preventDefault();
      // A second Escape answers "Discard your changes?" with Cancel.
      if (skillsPanelStore.pendingDiscard) skillsPanelStore.pendingDiscard = null;
      else skillsPanelStore.leaveEdit();
      return;
    }
    if (!skillsPanelStore.form) return;
    e.preventDefault();
    skillsPanelStore.form = null;
  }
</script>

<!-- Bound through the store, so a close it holds back for unsaved changes
     leaves the drawer open. -->
<DialogPrimitive.Root bind:open={() => skillsPanelStore.open, (open) => { if (!open) skillsPanelStore.requestClose(); }}>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay forceMount>
      {#snippet child({ props, open })}
        {#if open}
          <div {...props} class="fixed inset-0 z-40 bg-black/40" transition:fade={{ duration: 150 * motion }}></div>
        {/if}
      {/snippet}
    </DialogPrimitive.Overlay>
    <DialogPrimitive.Content
      forceMount
      bind:ref={content}
      onOpenAutoFocus={focusTab}
      onCloseAutoFocus={keepNewThreadFocus}
      onEscapeKeydown={closeFormFirst}
    >
      {#snippet child({ props, open })}
        {#if open}
          <div
            {...props}
            class="fixed top-0 right-0 z-50 h-full w-[32rem] max-w-[90vw] bg-card border-l border-border shadow-xl flex flex-col outline-none"
            transition:fly={{ x: 400, duration: 200 * motion }}
          >
            <PanelHeader>
              <DialogPrimitive.Title class="font-medium text-foreground">Skills</DialogPrimitive.Title>
              {#snippet actions()}
                <Button size="icon-2xs" variant="quiet" onclick={() => skillsPanelStore.requestClose()} title="Close (Esc)" aria-label="Close skills">
                  <XIcon />
                </Button>
              {/snippet}
            </PanelHeader>

            <Tabs.Root
              bind:value={() => skillsPanelStore.tab, (v) => {
                if (v !== 'thread' && v !== 'scheduled') return;
                skillsPanelStore.unlessUnsaved(() => { skillsPanelStore.tab = v; skillsPanelStore.form = null; skillsPanelStore.edit = null; });
              }}
              class="flex-1 min-h-0 flex flex-col"
            >
              <Tabs.List class="px-3 border-b border-border" aria-label="Skills views">
                <Tabs.Trigger value="thread">This thread</Tabs.Trigger>
                <Tabs.Trigger value="scheduled">Scheduled{schedulesStore.list.length ? ` (${schedulesStore.list.length})` : ''}</Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="thread" class="flex-1 overflow-y-auto px-4 py-3 text-xs outline-none">
                {#if activeId}
                  {#key activeId}
                    <ThreadSkills sessionId={activeId} />
                  {/key}
                {:else}
                  <p class="text-xs text-muted-foreground mt-4 text-center">Open a thread to see its agent's skills.</p>
                {/if}
              </Tabs.Content>
              <Tabs.Content value="scheduled" class="flex-1 overflow-y-auto px-4 py-3 text-xs outline-none">
                <ScheduledSkills />
              </Tabs.Content>
            </Tabs.Root>
          </div>
        {/if}
      {/snippet}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
