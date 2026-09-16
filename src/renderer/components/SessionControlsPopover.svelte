<script lang="ts">
  /**
   * One status-bar trigger for everything that shapes how a session's agent
   * runs: agent (provider), model, and every control the adapter declares for
   * that model (mode, thinking, speed, ...). Opens a column-per-setting
   * popover above the status bar. Values flow through the messages store so
   * the Alt+M / Alt+T shortcuts and this popover always agree.
   */
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { usageStore } from '../stores/usage.svelte.js';
  import { formatResetTime } from '../lib/reset-time.js';
  import type { ControlTone } from '../../shared/types.js';
  import { CONTROL_IDS, CONTROL_SHORTCUTS } from '../../shared/types.js';

  export interface ModelOption { value: string; label: string; contextWindow?: number }

  let { sessionId, modelOptions = [] }: { sessionId: string; modelOptions?: ModelOption[] } = $props();

  let open = $state(false);
  let rootRef = $state<HTMLDivElement | null>(null);
  let adapters = $state<Array<{ id: string; displayName: string }>>([]);

  let session = $derived(store.sessions.find((s) => s.id === sessionId));
  // Sessions always carry an agentType; the first registered adapter is the
  // default for anything that predates it (demo data, old manifests).
  let agentType = $derived(session?.agentType || adapters[0]?.id || '');
  let agentName = $derived(adapters.find((a) => a.id === agentType)?.displayName || agentType || 'Agent');
  let model = $derived(messageStore.getModel(sessionId));
  let modelLabel = $derived(modelOptions.find((o) => o.value === model)?.label ?? model);
  let controls = $derived(messageStore.getControlDescriptors(sessionId));

  /** What the subtitle shows besides the model: the mode always (tinted, since
   *  it governs what the agent may do), every other control only when it is
   *  off its default. The popover is where the full set lives. */
  let subtitleItems = $derived(controls.flatMap((ctl) => {
    const value = messageStore.getControlValue(sessionId, ctl.id);
    const isMode = ctl.id === CONTROL_IDS.permissionMode;
    if (!isMode && value === ctl.default) return [];
    const option = ctl.options.find((o) => o.value === value);
    return [{ id: ctl.id, label: option?.label ?? value, tone: isMode ? option?.tone : undefined }];
  }));

  $effect(() => { messageStore.loadControls(sessionId); });

  // ── Plan usage ("runway") for the session's provider ──
  let usage = $derived(usageStore.get(agentType));
  let usageLoading = $derived(usageStore.loading[agentType] ?? false);
  // Opening the popover is the moment the numbers matter — refresh unless
  // they are only seconds old.
  $effect(() => {
    if (open) usageStore.refresh(sessionId, { providerId: agentType, minAgeMs: 15_000 }).catch(() => {});
  });

  /** Same thresholds as the context-window meter so the two read alike. */
  function usageTextClass(fraction: number): string {
    const pct = fraction * 100;
    return pct > 85 ? 'text-red-400' : pct > 70 ? 'text-orange-400' : pct > 40 ? 'text-yellow-400' : 'text-green-400';
  }
  function usageBarClass(fraction: number): string {
    const pct = fraction * 100;
    return pct > 85 ? 'bg-red-400' : pct > 70 ? 'bg-orange-400' : pct > 40 ? 'bg-yellow-400' : 'bg-green-500';
  }

  /** Adapters pick a tone per option; the theme colours live here so no
   *  provider ships CSS classes. */
  const toneClasses: Record<ControlTone, string> = {
    muted: 'text-muted-foreground/50 border-muted-foreground/20',
    neutral: 'text-foreground/80 border-border',
    info: 'text-blue-400 border-blue-400/40',
    warning: 'text-yellow-400 border-yellow-400/40',
    accent: 'text-purple-400 border-purple-400/50',
    'accent-soft': 'text-purple-300/70 border-purple-300/30',
    success: 'text-green-400 border-green-400/40',
    highlight: 'text-cyan-400 border-cyan-400/50',
  };

  function toneClass(tone?: ControlTone): string {
    return toneClasses[tone ?? 'neutral'];
  }

  async function switchModel(modelId: string) {
    if (modelId === model) return;
    // Reflect the choice immediately — the live SDK switch is slow (or a
    // no-op) while the session is idle between turns.
    const prev = messageStore.getModel(sessionId);
    messageStore.setModelOverride(sessionId, modelId);
    try {
      await window.groveBench.setModel(sessionId, modelId);
    } catch (e) {
      messageStore.setModelOverride(sessionId, prev);
      console.error('Failed to switch model:', e);
    }
  }

  function choose(controlId: string, value: string) {
    if (messageStore.getControlValue(sessionId, controlId) === value) return;
    messageStore.setControl(sessionId, controlId, value).catch((e) => console.error(`Failed to set ${controlId}:`, e));
  }

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
    window.groveBench.listAdapters().then((list) => {
      adapters = list.map((a) => ({ id: a.id, displayName: a.displayName }));
    }).catch(() => {});
  });

  onDestroy(() => {
    window.removeEventListener('click', handleClickOutside);
    window.removeEventListener('keydown', handleKeydown, true);
  });
</script>

<div class="relative" bind:this={rootRef}>
  <!-- Two-line trigger: agent on top; model, mode, and any non-default
       control values underneath. -->

  <button
    onclick={() => open = !open}
    class="flex items-center gap-2 pl-1.5 pr-1 py-0.5 border border-border whitespace-nowrap text-left transition-colors hover:bg-accent {open ? 'bg-accent' : ''}"
    title="Agent settings — agent, model, and session controls"
    aria-haspopup="dialog"
    aria-expanded={open}
  >
    <span class="w-1.5 h-1.5 shrink-0 bg-primary" aria-hidden="true"></span>
    <span class="flex flex-col gap-px leading-snug">
      <span class="text-foreground font-medium">{agentName}</span>
      <span class="text-muted-foreground/80 text-[11px]">
        {modelLabel || 'Provider default'}
        {#each subtitleItems as item (item.id)}
          <span class="text-muted-foreground/40">{' · '}</span><span class={item.tone ? toneClass(item.tone).split(' ')[0] : ''}>{item.label}</span>
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

  {#if open}
    <div
      class="absolute bottom-full left-0 mb-2 bg-popover border border-border shadow-xl p-3 text-xs z-50"
      role="dialog"
      aria-label="Agent settings"
    >
      <div class="flex items-center justify-between mb-2">
        <span class="font-medium text-foreground">Agent settings</span>
        <span class="text-muted-foreground/60 text-[10px]">
          {#each Object.entries(CONTROL_SHORTCUTS) as [id, key] (id)}
            {@const label = controls.find((c) => c.id === id)?.label}
            {#if label}<kbd class="text-foreground/70">{key}</kbd> {label.toLowerCase()}&nbsp;&nbsp;{/if}
          {/each}
        </span>
      </div>

      <div class="flex gap-3 overflow-x-auto max-w-[80vw]">
        <!-- Agent + plan usage -->
        <div class="min-w-44">
          <div class="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Agent</div>
          {#each adapters.length > 0 ? adapters : [{ id: agentType, displayName: agentName }] as a (a.id)}
            {@const current = a.id === agentType}
            <button
              disabled={!current}
              class="w-full text-left px-2 py-1 border-l-2 transition-colors
                {current ? 'border-primary text-foreground bg-accent/50' : 'border-transparent text-muted-foreground/50 cursor-not-allowed'}"
              title={current ? 'Current agent' : 'The agent is chosen when a session is created'}
            >
              {a.displayName}
            </button>
          {/each}

          <!-- Runway: how much of each plan window is used and when it resets -->
          <div class="mt-3 pt-2 border-t border-border/60" data-testid="usage">
            <div class="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">
              <span>Usage</span>
              {#if usage?.plan}<span class="normal-case tracking-normal text-muted-foreground/40">{usage.plan} plan</span>{/if}
            </div>
            {#if usage && usage.available && usage.windows.length > 0}
              {#each usage.windows as w (w.id)}
                <div
                  class="py-1"
                  title={w.resetsAt ? `Resets ${new Date(w.resetsAt * 1000).toLocaleString()}` : undefined}
                >
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-muted-foreground">{w.label}</span>
                    <span class="font-medium {usageTextClass(w.utilization)}">{Math.round(w.utilization * 100)}%</span>
                  </div>
                  <div class="h-1 mt-1 bg-muted-foreground/20">
                    <div class="h-full transition-all {usageBarClass(w.utilization)}" style:width="{Math.min(100, w.utilization * 100)}%"></div>
                  </div>
                  {#if w.resetsAt}
                    <div class="text-[10px] text-muted-foreground/60 mt-0.5">resets {formatResetTime(w.resetsAt)}</div>
                  {/if}
                </div>
              {/each}
            {:else if usage && !usage.available}
              <div class="py-1 text-muted-foreground/50">Plan usage isn't reported for this sign-in (API key or third-party provider).</div>
            {:else if usageLoading}
              <div class="py-1 text-muted-foreground/50">Loading usage…</div>
            {:else}
              <div class="py-1 text-muted-foreground/50">No usage reported yet. Available once the agent has connected.</div>
            {/if}
          </div>
        </div>

        <!-- Model -->
        <div class="min-w-32">
          <div class="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Model</div>
          {#each modelOptions as opt (opt.value)}
            {@const current = opt.value === model}
            <button
              onclick={() => switchModel(opt.value)}
              class="w-full text-left px-2 py-1 border-l-2 transition-colors hover:bg-accent hover:text-accent-foreground
                {current ? 'border-primary text-foreground bg-accent/50' : 'border-transparent text-muted-foreground'}"
              title={opt.contextWindow ? `${Math.round(opt.contextWindow / 1000)}k context` : undefined}
            >
              {opt.label}
            </button>
          {:else}
            <div class="px-2 py-1 text-muted-foreground/50">{model || 'Provider default'}</div>
          {/each}
        </div>

        <!-- One column per adapter-declared control -->
        {#each controls as ctl (ctl.id)}
          {@const value = messageStore.getControlValue(sessionId, ctl.id)}
          <div class="min-w-32">
            <div class="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">
              {ctl.label}
              {#if CONTROL_SHORTCUTS[ctl.id]}<span class="normal-case tracking-normal text-muted-foreground/40">{CONTROL_SHORTCUTS[ctl.id]}</span>{/if}
            </div>
            {#each ctl.options as opt (opt.value)}
              {@const current = opt.value === value}
              <button
                onclick={() => choose(ctl.id, opt.value)}
                class="w-full text-left px-2 py-1 border-l-2 transition-colors hover:bg-accent
                  {current ? `bg-accent/50 ${toneClass(opt.tone).split(' ')[0]} border-current` : 'border-transparent text-muted-foreground'}"
                title={opt.description}
              >
                {opt.label}
              </button>
            {/each}
          </div>
        {/each}
      </div>

      <div class="flex justify-end mt-3 pt-2 border-t border-border">
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
