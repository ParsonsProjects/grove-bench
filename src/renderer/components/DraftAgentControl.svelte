<script lang="ts">
  /**
   * The draft conversation's Agent settings: the same trigger and column
   * popover as a running conversation's (SessionControlsPopover), but every
   * column can still change, the agent included, because nothing has started.
   * Values live in the draft store and are sent with the first message.
   */
  import { onMount, onDestroy } from 'svelte';
  import { draftStore } from '../stores/draft.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import type { ControlOption } from '../../shared/types.js';
  import { toneText } from '../lib/control-tones.js';
  import { controlHint, controlSummary } from '../lib/control-hint.js';
  import AgentSettingsTrigger from './AgentSettingsTrigger.svelte';

  let open = $state(false);
  /** Option under the pointer or focus, explained in the footer. Removing
   *  the popover fires no mouseleave, so closing it clears this too. */
  let hovered = $state<ControlOption | null>(null);
  $effect(() => { if (!open) hovered = null; });
  let rootRef = $state<HTMLDivElement | null>(null);

  const draft = $derived(draftStore.draft);
  const agentName = $derived(agentsStore.get(draft?.agentId)?.displayName ?? draft?.agentId ?? 'Agent');
  const model = $derived(draftStore.effectiveModel);
  const modelLabel = $derived(draftStore.models.find((m) => m.value === model)?.label ?? model);

  const hint = $derived(controlHint(draftStore.descriptors, (id) => draftStore.controlValue(id), hovered));
  /** The mode, and any other control off its default, for the button. */
  const summary = $derived(controlSummary(draftStore.descriptors, (id) => draftStore.controlValue(id)));

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as Node;
    if (open && rootRef && target.isConnected && !rootRef.contains(target)) open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      open = false;
    }
  }

  onMount(() => {
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKeydown, true);
    agentsStore.load();
  });

  onDestroy(() => {
    window.removeEventListener('click', handleClickOutside);
    window.removeEventListener('keydown', handleKeydown, true);
  });
</script>

<div class="relative" bind:this={rootRef}>
  <AgentSettingsTrigger
    {agentName}
    {modelLabel}
    mode={summary.mode}
    details={summary.details}
    {open}
    onclick={() => open = !open}
  />

  {#if open && draft}
    <div
      class="absolute bottom-full left-0 mb-2 bg-popover border border-border shadow-xl p-3 text-xs z-50"
      role="dialog"
      aria-label="Agent settings"
    >
      <div class="flex items-center justify-between gap-6 mb-2">
        <span class="font-medium text-foreground">Agent settings</span>
        <span class="text-muted-foreground/60 text-[10px]">The agent is fixed once you send the first message</span>
      </div>

      <div class="flex gap-3 overflow-x-auto max-w-[80vw]">
        <div class="min-w-36">
          <div class="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Agent</div>
          {#each agentsStore.list.length > 0 ? agentsStore.list : [{ id: draft.agentId, displayName: agentName }] as a (a.id)}
            {@const current = a.id === draft.agentId}
            <button
              onclick={() => draftStore.setAgent(a.id)}
              class="w-full text-left px-2 py-1 border-l-2 transition-colors hover:bg-accent
                {current ? 'border-primary text-foreground bg-accent/50' : 'border-transparent text-muted-foreground'}"
              aria-pressed={current}
            >
              {a.displayName}
            </button>
          {/each}
        </div>

        <div class="min-w-32">
          <div class="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Model</div>
          {#each draftStore.models as opt (opt.value)}
            {@const current = opt.value === model}
            <button
              onclick={() => draftStore.setModel(opt.value)}
              class="w-full text-left px-2 py-1 border-l-2 transition-colors hover:bg-accent hover:text-accent-foreground
                {current ? 'border-primary text-foreground bg-accent/50' : 'border-transparent text-muted-foreground'}"
              aria-pressed={current}
            >
              {opt.label}
            </button>
          {:else}
            <div class="px-2 py-1 text-muted-foreground/50">{model || 'Provider default'}</div>
          {/each}
        </div>

        {#each draftStore.descriptors as ctl (ctl.id)}
          {@const value = draftStore.controlValue(ctl.id)}
          <div class="min-w-32">
            <div class="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">{ctl.label}</div>
            {#each ctl.options as opt, i (opt.value)}
              {@const current = opt.value === value}
              {#if opt.group && opt.group !== ctl.options[i - 1]?.group}
                <div class="mt-1.5 pt-1.5 border-t border-border/60 px-2 text-[10px] uppercase tracking-wide text-muted-foreground/60">
                  {opt.group}
                </div>
              {/if}
              <button
                onclick={() => draftStore.setControl(ctl.id, opt.value)}
                class="w-full text-left px-2 py-1 border-l-2 transition-colors hover:bg-accent
                  {current ? `bg-accent/50 ${toneText(opt.tone)} border-current` : 'border-transparent text-muted-foreground'}"
                onmouseenter={() => hovered = opt}
                onmouseleave={() => hovered = null}
                onfocus={() => hovered = opt}
                onblur={() => hovered = null}
                aria-pressed={current}
              >
                {opt.label}
              </button>
            {/each}
          </div>
        {/each}
      </div>

      <!-- No Done button, as in SessionControlsPopover: choices apply on
           click, and the hint keeps the full width with two lines reserved. -->
      {#if hint}
        <div class="mt-3 pt-2 border-t border-border">
          <p class="text-[11px] min-h-[2lh] text-muted-foreground" aria-live="polite">
            <span class="text-foreground">{hint.label}:</span> {hint.description}
          </p>
        </div>
      {/if}
    </div>
  {/if}
</div>
