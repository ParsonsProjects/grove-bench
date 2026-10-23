<script lang="ts">
  /**
   * The Skills drawer: a slide-out on the right with two tabs. This thread
   * has the open thread's skills (Run, Schedule, and for Claude Code turning
   * them off, suggestions and Add skill); Scheduled has every project's
   * scheduled skills. Replaces the Skills popover and the Scheduled skills
   * dialog, which ran out of room.
   */
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !skillsPanelStore.open) return;
    // A dropdown or a dialog over the drawer takes Escape first.
    if (document.querySelector('[role="dialog"], [role="listbox"]')) return;
    e.stopPropagation();
    if (skillsPanelStore.form) skillsPanelStore.form = null;
    else skillsPanelStore.close();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if skillsPanelStore.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40 bg-black/40"
    transition:fade={{ duration: 150 * motion }}
    onclick={() => skillsPanelStore.close()}
  ></div>
  <aside
    class="fixed top-0 right-0 z-50 h-full w-[32rem] max-w-[90vw] bg-card border-l border-border shadow-xl flex flex-col"
    transition:fly={{ x: 400, duration: 200 * motion }}
    aria-label="Skills"
  >
    <PanelHeader>
      <span class="font-medium text-foreground">Skills</span>
      {#snippet actions()}
        <Button size="icon-2xs" variant="quiet" onclick={() => skillsPanelStore.close()} title="Close (Esc)" aria-label="Close skills">
          <XIcon />
        </Button>
      {/snippet}
    </PanelHeader>

    <Tabs.Root
      value={skillsPanelStore.tab}
      onValueChange={(v) => { if (v === 'thread' || v === 'scheduled') { skillsPanelStore.tab = v; skillsPanelStore.form = null; } }}
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
  </aside>
{/if}
