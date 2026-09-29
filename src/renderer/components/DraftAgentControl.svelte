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
  import { CONTROL_IDS, type ControlOption } from '../../shared/types.js';
  import { toneText } from '../lib/control-tones.js';
  import { controlHint } from '../lib/control-hint.js';

  let open = $state(false);
  /** Option under the pointer or focus, explained in the footer. */
  let hovered = $state<ControlOption | null>(null);
  let rootRef = $state<HTMLDivElement | null>(null);

  const draft = $derived(draftStore.draft);
  const agentName = $derived(agentsStore.get(draft?.agentId)?.displayName ?? draft?.agentId ?? 'Agent');
  const model = $derived(draftStore.effectiveModel);
  const modelLabel = $derived(draftStore.models.find((m) => m.value === model)?.label ?? model);

  const hint = $derived(controlHint(draftStore.descriptors, (id) => draftStore.controlValue(id), hovered));
  /** Subtitle: the mode always, other controls only when off their default. */
  const subtitleItems = $derived(draftStore.descriptors.flatMap((ctl) => {
    const value = draftStore.controlValue(ctl.id);
    const isMode = ctl.id === CONTROL_IDS.permissionMode;
    if (!isMode && value === ctl.default) return [];
    const option = ctl.options.find((o) => o.value === value);
    return [{ id: ctl.id, label: option?.label ?? value, tone: isMode ? option?.tone : undefined }];
  }));

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
  <button
    onclick={() => open = !open}
    class="flex items-center gap-2 pl-1.5 pr-1 py-0.5 border border-border whitespace-nowrap text-left transition-colors hover:bg-accent {open ? 'bg-accent' : ''}"
    title="Agent settings — agent, model and mode for this conversation"
    aria-haspopup="dialog"
    aria-expanded={open}
  >
    <span class="w-1.5 h-1.5 shrink-0 bg-primary" aria-hidden="true"></span>
    <span class="flex flex-col gap-px leading-snug">
      <span class="text-foreground font-medium">{agentName}</span>
      <span class="text-muted-foreground/80 text-[11px]">
        {modelLabel || 'Provider default'}
        {#each subtitleItems as item (item.id)}
          <span class="text-muted-foreground/40">{' · '}</span><span class={item.tone ? toneText(item.tone) : ''}>{item.label}</span>
        {/each}
      </span>
    </span>
    <svg
      class="w-3 h-3 shrink-0 text-muted-foreground/60 transition-transform {open ? 'rotate-180' : ''}"
      viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  </button>

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

      <div class="flex items-center justify-between gap-4 mt-3 pt-2 border-t border-border">
        {#if hint}
          <p class="text-[11px] text-muted-foreground max-w-md" aria-live="polite">
            <span class="text-foreground">{hint.label}:</span> {hint.description}
          </p>
        {:else}
          <span></span>
        {/if}
        <button
          onclick={() => open = false}
          class="px-3 py-1 border border-border text-foreground hover:bg-accent transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  {/if}
</div>
