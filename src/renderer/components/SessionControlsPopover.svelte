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
  import { draftStore } from '../stores/draft.svelte.js';
  import { usageStore } from '../stores/usage.svelte.js';
  import { formatResetTime } from '../lib/reset-time.js';
  import { toneClass } from '../lib/control-tones.js';
  // The same scale as the context meter, so the two read alike.
  import { usageTextClass, usageBarClass } from '../lib/usage-tone.js';
  import { CONTROL_SHORTCUTS, type ControlOption } from '../../shared/types.js';
  import { controlHint, controlSummary } from '../lib/control-hint.js';
  import AgentSettingsTrigger from './AgentSettingsTrigger.svelte';

  export interface ModelOption { value: string; label: string; contextWindow?: number }

  let { sessionId, modelOptions = [] }: { sessionId: string; modelOptions?: ModelOption[] } = $props();

  let open = $state(false);
  /** Option under the pointer or focus, explained in the footer. Removing
   *  the popover fires no mouseleave, so closing it clears this too. */
  let hovered = $state<ControlOption | null>(null);
  $effect(() => { if (!open) hovered = null; });
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
  let hint = $derived(controlHint(controls, (id) => messageStore.getControlValue(sessionId, id), hovered));

  /** The mode, and any other control off its default, for the button. */
  let summary = $derived(controlSummary(controls, (id) => messageStore.getControlValue(sessionId, id)));

  $effect(() => { messageStore.loadControls(sessionId); });

  // ── Plan usage ("runway") for the session's provider ──
  let usage = $derived(usageStore.get(agentType));
  let usageLoading = $derived(usageStore.loading[agentType] ?? false);
  // Opening the popover is the moment the numbers matter — refresh unless
  // they are only seconds old.
  $effect(() => {
    if (open) usageStore.refresh(sessionId, { providerId: agentType, minAgeMs: 15_000 }).catch(() => {});
  });


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

  /** A conversation keeps the agent it started with (its history is that
   *  agent's own session). Picking another starts a new conversation with it
   *  in the same project, as a draft. */
  function startWithAgent(adapterId: string) {
    if (!session) return;
    open = false;
    draftStore.open(session.repoPath, { agentId: adapterId });
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as Node;
    if (open && rootRef && target.isConnected && !rootRef.contains(target)) open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    // Every conversation's pane stays mounted: one left open in a hidden
    // pane must not swallow Escape meant for what is on screen.
    if (open && e.key === 'Escape' && (rootRef?.checkVisibility?.() ?? true)) {
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
  <AgentSettingsTrigger
    {agentName}
    {modelLabel}
    mode={summary.mode}
    details={summary.details}
    {open}
    onclick={() => open = !open}
  />

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
              onclick={() => { if (!current) startWithAgent(a.id); }}
              class="w-full text-left px-2 py-1 border-l-2 transition-colors group/agent flex items-center justify-between gap-2
                {current ? 'border-primary text-foreground bg-accent/50 cursor-default' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'}"
              title={current ? 'This conversation\'s agent' : `Start a new conversation in this project with ${a.displayName}. This one keeps its agent.`}
              aria-current={current ? 'true' : undefined}
            >
              {a.displayName}
              {#if !current}<span class="text-[10px] text-muted-foreground/50 group-hover/agent:text-primary">new ↗</span>{/if}
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
                    <span class="font-medium {usageTextClass(w.utilization * 100)}">{Math.round(w.utilization * 100)}%</span>
                  </div>
                  <div class="h-1 mt-1 bg-muted-foreground/20">
                    <div class="h-full transition-all {usageBarClass(w.utilization * 100)}" style:width="{Math.min(100, w.utilization * 100)}%"></div>
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
            {#each ctl.options as opt, i (opt.value)}
              {@const current = opt.value === value}
              {#if opt.group && opt.group !== ctl.options[i - 1]?.group}
                <!-- Options from another source (e.g. Grove's own modes) sit
                     below a divider with their source as the heading. -->
                <div class="mt-1.5 pt-1.5 border-t border-border/60 px-2 text-[10px] uppercase tracking-wide text-muted-foreground/60" title="Not a {agentName} option">
                  {opt.group}
                </div>
              {/if}
              <button
                onclick={() => choose(ctl.id, opt.value)}
                class="w-full text-left px-2 py-1 border-l-2 transition-colors hover:bg-accent
                  {current ? `bg-accent/50 ${toneClass(opt.tone).split(' ')[0]} border-current` : 'border-transparent text-muted-foreground'}"
                onmouseenter={() => hovered = opt}
                onmouseleave={() => hovered = null}
                onfocus={() => hovered = opt}
                onblur={() => hovered = null}
              >
                {opt.label}
              </button>
            {/each}
          </div>
        {/each}
      </div>

      <!-- Choices apply on click, so there is no Done button: the hint gets
           the full width. Two lines stay reserved so a longer hint can't
           push the columns up under the pointer (the popover grows upward). -->
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
