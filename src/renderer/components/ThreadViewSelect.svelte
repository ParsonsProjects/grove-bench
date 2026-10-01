<script lang="ts">
  /**
   * The Thread tab's view picker (Detailed / Summary / Focus). It sits on the
   * tab itself while Thread is the open tab, next to what it changes. Per
   * conversation; new ones start in Settings > General > Default thread view.
   * Given `subagentOf`, it picks the view of that subagent's panel instead.
   */
  import { Select as SelectPrimitive } from 'bits-ui';
  import * as Select from '$lib/components/ui/select/index.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { subagentPanelStore } from '../stores/subagentPanel.svelte.js';
  import { ACTIVITY_VIEW_MODES, type ActivityViewMode } from '../../shared/types.js';
  import { filterVisibleMessages, threadMessages, VIEW_MODE_DESCRIPTIONS, VIEW_MODE_LABELS } from '../lib/message-view.js';

  let { sessionId, subagentOf }: {
    sessionId: string;
    /** The Agent call whose subagent's thread this picks the view of. */
    subagentOf?: string;
  } = $props();

  let viewMode = $derived(subagentOf ? subagentPanelStore.viewMode(sessionId) : messageStore.getViewMode(sessionId));
  let thread = $derived(threadMessages(messageStore.getMessages(sessionId), subagentOf));
  let hiddenCount = $derived(thread.length - filterVisibleMessages(thread, viewMode).length);
  let label = $derived(VIEW_MODE_LABELS[viewMode]);
  let hiddenText = $derived(hiddenCount > 0 ? `${hiddenCount} hidden` : '');
  let what = $derived(subagentOf ? 'Subagent view' : 'Thread view');

  function pick(mode: ActivityViewMode) {
    if (subagentOf) subagentPanelStore.setViewMode(mode);
    else messageStore.setViewMode(sessionId, mode);
  }
</script>

<Select.Root
  type="single"
  value={viewMode}
  onValueChange={(v) => { if (v) pick(v as ActivityViewMode); }}
>
  <!-- A filtering view is tinted, so it's clear some messages are hidden. -->
  <SelectPrimitive.Trigger
    class="flex items-center gap-1.5 pl-1 pr-3 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring
      {viewMode === 'detailed' ? 'text-muted-foreground hover:text-foreground' : 'text-primary hover:text-primary/80'}"
    aria-label="{what}: {label}{hiddenText ? `, ${hiddenText}` : ''}"
    title="{what}: {VIEW_MODE_DESCRIPTIONS[viewMode]}{hiddenText ? ` (${hiddenText})` : ''}"
  >
    <!-- Sets it apart from the tab's name; the subagent panel has none. -->
    {#if !subagentOf}
      <span class="text-muted-foreground/40" aria-hidden="true">·</span>
    {/if}
    {label}
    {#if hiddenText}
      <!-- Dropped first when the tab strip is narrow; the tooltip keeps it. -->
      <span class="hidden @3xl:inline text-muted-foreground/70 font-normal">{hiddenText}</span>
    {/if}
    <svg class="w-3 h-3 shrink-0 opacity-60" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  </SelectPrimitive.Trigger>
  <Select.Content align="start" class="w-80">
    {#each ACTIVITY_VIEW_MODES as mode (mode)}
      <Select.Item value={mode} label={VIEW_MODE_LABELS[mode]} class="text-xs items-start">
        {#snippet children()}
          <!-- Full-width lines: the item centres its last span's children. -->
          <span class="flex flex-col gap-0.5">
            <span class="w-full text-foreground">{VIEW_MODE_LABELS[mode]}</span>
            <span class="w-full text-[11px] text-muted-foreground whitespace-normal">{VIEW_MODE_DESCRIPTIONS[mode]}</span>
          </span>
        {/snippet}
      </Select.Item>
    {/each}
  </Select.Content>
</Select.Root>
