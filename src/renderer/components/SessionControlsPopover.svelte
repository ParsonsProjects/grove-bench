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
  import { offeredForNew } from '../stores/agents.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { usageStore } from '../stores/usage.svelte.js';
  import { toneClass } from '../lib/control-tones.js';
  import { CONTROL_SHORTCUTS, controlShortcut, type AgentSummary, type ControlOption } from '../../shared/types.js';
  import { controlHint, controlSummary } from '../lib/control-hint.js';
  import AgentSettingsTrigger from './AgentSettingsTrigger.svelte';
  import UsageSection from './UsageSection.svelte';
  import AlphaBadge from './AlphaBadge.svelte';

  export interface ModelOption { value: string; label: string; contextWindow?: number }

  let { sessionId, modelOptions = [] }: { sessionId: string; modelOptions?: ModelOption[] } = $props();

  let open = $state(false);
  /** Option under the pointer or focus, explained in the footer. Removing
   *  the popover fires no mouseleave, so closing it clears this too. */
  let hovered = $state<ControlOption | null>(null);
  $effect(() => { if (!open) hovered = null; });
  let rootRef = $state<HTMLDivElement | null>(null);
  let adapters = $state<Array<Pick<AgentSummary, 'id' | 'displayName' | 'stage'>>>([]);

  let session = $derived(store.sessions.find((s) => s.id === sessionId));
  // Sessions always carry an agentType; the first registered adapter is the
  // default for anything that predates it (demo data, old manifests).
  let agentType = $derived(session?.agentType || adapters[0]?.id || '');
  let agentName = $derived(adapters.find((a) => a.id === agentType)?.displayName || agentType || 'Agent');
  /** The Agent column: this conversation's agent, and the ones a new
   *  conversation can start with (alpha agents once turned on in Settings). */
  let agentChoices = $derived(adapters.filter((a) => a.id === agentType || offeredForNew(a, settingsStore.current.enabledAlphaAgents)));
  let model = $derived(messageStore.getModel(sessionId));
  let modelLabel = $derived(modelOptions.find((o) => o.value === model)?.label ?? model);
  let controls = $derived(messageStore.getControlDescriptors(sessionId));
  let hint = $derived(controlHint(controls, (id) => messageStore.getControlValue(sessionId, id), hovered));

  /** The mode, and any other control off its default, for the button. */
  let summary = $derived(controlSummary(controls, (id) => messageStore.getControlValue(sessionId, id)));

  $effect(() => { messageStore.loadControls(sessionId); });

  // ── Plan usage ("runway") for the session's provider ──
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

  /** The agent picked in the Agent column, waiting for the user to choose
   *  how to switch (or to start a new conversation with it instead). */
  let switchTo = $state<{ id: string; displayName: string } | null>(null);
  let switching = $state(false);
  let switchError = $state('');
  $effect(() => { if (!open) { switchTo = null; switchError = ''; } });
  let running = $derived(messageStore.getIsRunning(sessionId));

  /** Hand this conversation to another agent (main's switchAgent). */
  async function switchAgent(adapterId: string, transcript: boolean) {
    switching = true;
    switchError = '';
    try {
      await window.groveBench.switchAgent(sessionId, adapterId, transcript);
      open = false;
    } catch (e) {
      switchError = e instanceof Error ? e.message : String(e);
    } finally {
      switching = false;
    }
  }

  /** Leave this conversation on its agent and start a new one with
   *  `adapterId` in the same project, as a draft. */
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
      adapters = list.map((a) => ({ id: a.id, displayName: a.displayName, stage: a.stage }));
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
            {@const label = (controls.find((c) => c.id === id) ?? controls.find((c) => c.role === id))?.label}
            {#if label}<kbd class="text-foreground/70">{key}</kbd> {label.toLowerCase()}&nbsp;&nbsp;{/if}
          {/each}
        </span>
      </div>

      <div class="flex gap-3 overflow-x-auto max-w-[80vw]">
        <!-- Agent + plan usage -->
        <div class="min-w-44">
          <div class="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1">Agent</div>
          {#each agentChoices.length > 0 ? agentChoices : [{ id: agentType, displayName: agentName, stage: undefined }] as a (a.id)}
            {@const current = a.id === agentType}
            <button
              onclick={() => { if (!current) switchTo = { id: a.id, displayName: a.displayName }; }}
              class="w-full text-left px-2 py-1 border-l-2 transition-colors group/agent flex items-center justify-between gap-2
                {current ? 'border-primary text-foreground bg-accent/50 cursor-default' : switchTo?.id === a.id ? 'border-primary/50 text-foreground bg-accent' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'}"
              title={current ? 'This conversation\'s agent' : `Switch this conversation to ${a.displayName}, or start a new one with it`}
              aria-current={current ? 'true' : undefined}
            >
              <span>
                {a.displayName}
                {#if a.stage === 'alpha'}<AlphaBadge class="ml-1.5 align-middle" />{/if}
              </span>
              {#if !current}<span class="text-[10px] text-muted-foreground/50 group-hover/agent:text-primary">switch…</span>{/if}
            </button>
          {/each}

          <UsageSection providerId={agentType} {agentName} />
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
              {#if controlShortcut(ctl)}<span class="normal-case tracking-normal text-muted-foreground/40">{controlShortcut(ctl)}</span>{/if}
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

      {#if switchTo}
        {@const target = switchTo}
        <!-- Switching sends this conversation to another provider only if
             the user picks the transcript button, which says so. -->
        <div class="mt-3 pt-2 border-t border-border max-w-[36rem] flex flex-col gap-2" role="group" aria-label="Switch agent">
          <p class="text-foreground">Switch this conversation to {target.displayName}?</p>
          <p class="text-[11px] text-muted-foreground">
            {target.displayName} starts its own session in the same worktree; the thread, files and checkpoints stay.
            To carry on where {agentName} left off, it can get a short transcript with your next message: your messages,
            {agentName}'s replies and the list of files changed, without tool output. That transcript goes to {target.displayName}'s provider.
            {#if running}The turn that is running now stops.{/if}
          </p>
          {#if switchError}<p class="text-[11px] text-destructive" role="alert">{switchError}</p>{/if}
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={switching} onclick={() => switchAgent(target.id, true)}>Switch and send the transcript</button>
            <button type="button" class="px-2 py-1 border border-border hover:bg-accent disabled:opacity-50" disabled={switching} onclick={() => switchAgent(target.id, false)}>Switch without it</button>
            <button type="button" class="px-2 py-1 text-primary hover:underline" onclick={() => startWithAgent(target.id)}>New conversation instead ↗</button>
            <button type="button" class="px-2 py-1 text-muted-foreground hover:text-foreground" onclick={() => { switchTo = null; switchError = ''; }}>Cancel</button>
          </div>
        </div>
      {/if}

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
