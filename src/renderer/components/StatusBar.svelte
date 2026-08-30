<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fly } from 'svelte/transition';
  import { messageStore } from '../stores/messages.svelte.js';
  import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';
  import { rateLimitStore } from '../stores/rateLimit.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { prStore } from '../stores/pr.svelte.js';
  import type { PrAlert } from '../stores/pr.svelte.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { buildCreatePrPrompt } from '../lib/pr-prompt.js';
  import { resolveBaseBranch } from '../lib/base-branch.js';
  import CreatePrDialog from './CreatePrDialog.svelte';
  import type { McpServerInfo, ThinkingLevel } from '../../shared/types.js';

  let { sessionId }: { sessionId: string } = $props();

  let prInfo = $derived(prStore.getPr(sessionId));
  let gitSync = $derived(prStore.getSync(sessionId));
  let ghAvailable = $derived(store.prerequisites?.gh?.available === true);
  let createPrOpen = $state(false);
  let pushing = $state(false);
  let pushError = $state('');

  async function doPush() {
    if (pushing) return;
    pushing = true;
    pushError = '';
    try {
      await prStore.push(sessionId);
    } catch (e: any) {
      pushError = e?.message || 'Push failed';
    } finally {
      pushing = false;
    }
  }

  let sessionStatus = $derived(store.sessions.find((s) => s.id === sessionId)?.status);
  let createPrMenuOpen = $state(false);
  let canAgentCreatePr = $derived(sessionStatus === 'running' && !isRunning);

  // ── PR watching: alerts + auto mode (all shown in one popover) ──
  let prAlerts = $derived(prStore.getAlerts(sessionId));
  let prAuto = $derived(prStore.getAuto(sessionId));
  let prPopoverOpen = $state(false);
  let addressingReviews = $state(false);

  // Alerts merge into their popover sections rather than rendering as separate rows
  let ciAlert = $derived(prAlerts.find((a) => a.kind === 'ci_failed') as Extract<PrAlert, { kind: 'ci_failed' }> | undefined);
  let commentsAlert = $derived(prAlerts.find((a) => a.kind === 'new_comments') as Extract<PrAlert, { kind: 'new_comments' }> | undefined);
  let humanAlert = $derived(prAlerts.find((a) => a.kind === 'needs_human') as Extract<PrAlert, { kind: 'needs_human' }> | undefined);

  /** Worst-condition dot color for the collapsed PR badge. */
  let prHealthDot = $derived.by(() => {
    if (!prInfo) return 'bg-muted-foreground/40';
    if (prInfo.state === 'MERGED') return 'bg-purple-400';
    if (prInfo.state === 'CLOSED') return 'bg-red-500';
    if ((prInfo.checks?.failed ?? 0) > 0) return 'bg-red-500';
    if (prInfo.reviewDecision === 'CHANGES_REQUESTED') return 'bg-orange-400';
    if ((prInfo.checks?.pending ?? 0) > 0) return 'bg-yellow-400';
    if (prInfo.reviewDecision === 'APPROVED' || prInfo.checks) return 'bg-green-500';
    return 'bg-muted-foreground/40';
  });

  function fixCi() {
    prStore.fixCiWithAgent(sessionId);
    prPopoverOpen = false;
  }

  async function addressReviews() {
    if (addressingReviews) return;
    addressingReviews = true;
    try {
      const sent = await prStore.addressReviewsWithAgent(sessionId);
      if (sent) prPopoverOpen = false;
    } finally {
      addressingReviews = false;
    }
  }

  /** Hand PR creation to the agent as a turn in this conversation. */
  async function sendAgentPrTurn() {
    const repoPath = store.sessions.find((s) => s.id === sessionId)?.repoPath ?? '';
    const base = await resolveBaseBranch(repoPath);
    const prompt = buildCreatePrPrompt(sessionBranch, base);
    messageStore.addUserMessage(sessionId, prompt);
    window.groveBench.sendMessage(sessionId, prompt);
    store.updateLastActive(sessionId);
  }

  /** Default click: agent turn when the session can take one, manual dialog otherwise. */
  function startCreatePr() {
    createPrMenuOpen = false;
    if (canAgentCreatePr) sendAgentPrTurn();
    else createPrOpen = true;
  }
  let modelPickerOpen = $state(false);
  let modelOptions = $state<Array<{ value: string; label: string; contextWindow?: number }>>([]);

  async function switchModel(modelId: string) {
    modelPickerOpen = false;
    // Reflect the choice immediately — don't wait for the live SDK switch,
    // which is slow (or a no-op) while the session is idle between turns.
    const prev = messageStore.getModel(sessionId);
    messageStore.setModelOverride(sessionId, modelId);
    try {
      await window.groveBench.setModel(sessionId, modelId);
    } catch (e: any) {
      messageStore.setModelOverride(sessionId, prev);
      console.error('Failed to switch model:', e);
    }
  }

  let sessionBranch = $derived(store.sessions.find(s => s.id === sessionId)?.branch ?? '');
  let model = $derived(messageStore.getModel(sessionId));
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let mode = $derived(messageStore.getMode(sessionId));
  let thinkingLevel = $derived(messageStore.getThinkingLevel(sessionId));
  let activity = $derived(messageStore.getActivity(sessionId));
  let usage = $derived(messageStore.getUsage(sessionId));
  let systemInfo = $derived(messageStore.getSystemInfo(sessionId));
  // SDK-reported window wins; before the first result, fall back to the
  // selected model's known window (e.g. 1M for Opus), then 200k.
  let contextWindow = $derived(
    messageStore.contextWindowBySession[sessionId]
      ?? modelOptions.find((o) => o.value === model)?.contextWindow
      ?? 200_000
  );
  let turns = $derived(messageStore.getTurns(sessionId));

  // Total context = input_tokens (non-cached) + cache_read + cache_creation
  // input_tokens from the API only counts tokens NOT served from cache
  let usedTokens = $derived(usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens);
  let freeTokens = $derived(Math.max(0, contextWindow - usedTokens));
  let usedPercent = $derived(Math.min((usedTokens / contextWindow) * 100, 100));
  let showContext = $derived(usedTokens > 0);

  // Cache proportion for segmented bar
  let cachedTokens = $derived(usage.cacheReadTokens + usage.cacheCreationTokens);
  let cachePercent = $derived(Math.min((cachedTokens / contextWindow) * 100, usedPercent));
  let freshPercent = $derived(Math.max(0, usedPercent - cachePercent));

  // Interpolated color for smooth transitions
  function usageColorSmooth(pct: number): string {
    const stops = [
      { at: 0,   r: 34,  g: 197, b: 94  }, // green
      { at: 40,  r: 34,  g: 197, b: 94  }, // green
      { at: 55,  r: 234, g: 179, b: 8   }, // yellow
      { at: 70,  r: 249, g: 115, b: 22  }, // orange
      { at: 85,  r: 239, g: 68,  b: 68  }, // red
      { at: 100, r: 239, g: 68,  b: 68  }, // red
    ];

    // Find surrounding stops
    let lo = stops[0], hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (pct >= stops[i].at && pct <= stops[i + 1].at) {
        lo = stops[i];
        hi = stops[i + 1];
        break;
      }
    }

    const range = hi.at - lo.at || 1;
    const t = (pct - lo.at) / range;
    const r = Math.round(lo.r + (hi.r - lo.r) * t);
    const g = Math.round(lo.g + (hi.g - lo.g) * t);
    const b = Math.round(lo.b + (hi.b - lo.b) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  let barBg = $derived(usageColorSmooth(usedPercent));
  let textColor = $derived(usageColorSmooth(usedPercent));

  // Tailwind class for remaining text — green when plenty, fades as it shrinks
  let remainingColor = $derived(
    usedPercent > 80 ? 'text-red-400' :
    usedPercent > 60 ? 'text-orange-400' :
    usedPercent > 40 ? 'text-yellow-400' :
    'text-green-400'
  );

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  }

  // Poll PR + branch sync status while this status bar is mounted
  $effect(() => prStore.watch(sessionId));

  // Re-fetch PR info when a turn finishes (agent may have committed/pushed/created a PR)
  let prevRunning = $state(false);
  $effect(() => {
    if (prevRunning && !isRunning) {
      prStore.refresh(sessionId, true);
    }
    prevRunning = isRunning;
  });

  let pendingTools = $derived(messageStore.getPendingTools(sessionId));
  let rateLimit = $derived(rateLimitStore.get(sessionId));
  let backgroundTasks = $derived(backgroundTaskStore.get(sessionId));
  let runningBgTasks = $derived(backgroundTasks.filter((t) => t.status === 'running'));

  /** Reset time as a clock time in the user's locale and timezone. */
  function formatResetTime(epoch: number): string {
    const reset = new Date(epoch * 1000);
    if (reset.getTime() <= Date.now()) return 'now';
    const time = reset.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    // Resets more than a day out need the date to be unambiguous
    return reset.getTime() - Date.now() >= 24 * 3600 * 1000
      ? `${reset.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
      : time;
  }
  let contextExpanded = $state(false);
  let tasksExpanded = $state(false);
  let bgTasksExpanded = $state(false);
  let shortcutsOpen = $state(false);
  let mcpExpanded = $state(false);

  // Refs for click-outside detection on popovers
  let modelPickerRef = $state<HTMLDivElement | null>(null);
  let tasksRef = $state<HTMLDivElement | null>(null);
  let bgTasksRef = $state<HTMLDivElement | null>(null);
  let contextRef = $state<HTMLDivElement | null>(null);
  let shortcutsRef = $state<HTMLDivElement | null>(null);
  let mcpRef = $state<HTMLDivElement | null>(null);
  let createPrRef = $state<HTMLDivElement | null>(null);
  let prPopoverRef = $state<HTMLDivElement | null>(null);

  // ─── MCP server control ───

  let mcpServers = $state<McpServerInfo[]>([]);
  let mcpBusy = $state<Record<string, boolean>>({});
  let mcpError = $state<string | null>(null);
  let mcpKnown = $derived(systemInfo.mcpServers);
  let mcpStatuses = $derived(mcpServers.length > 0 ? mcpServers : mcpKnown);
  let mcpDownCount = $derived(mcpStatuses.filter((s) => s.status === 'failed' || s.status === 'needs-auth').length);
  let mcpConnectedCount = $derived(mcpStatuses.filter((s) => s.status === 'connected').length);
  /** ok = nothing down, partial = mixed up/down (orange), down = nothing connected (red). */
  let mcpHealth = $derived<'ok' | 'partial' | 'down'>(
    mcpDownCount === 0 ? 'ok' : mcpConnectedCount > 0 ? 'partial' : 'down',
  );

  async function refreshMcpServers() {
    try {
      const servers = await window.groveBench.listMcpServers(sessionId);
      if (servers.length > 0) {
        mcpServers = servers;
        messageStore.updateMcpServers(sessionId, servers);
        return;
      }
    } catch {
      // fall through to the last known snapshot
    }
    // Live status unavailable (e.g. session stopped) — show the init snapshot
    mcpServers = mcpKnown.map((s) => ({ name: s.name, status: s.status as McpServerInfo['status'] }));
  }

  function toggleMcpPopover() {
    mcpExpanded = !mcpExpanded;
    if (mcpExpanded) {
      mcpError = null;
      refreshMcpServers();
    }
  }

  async function mcpAction(name: string, action: 'reconnect' | 'enable' | 'disable') {
    mcpBusy = { ...mcpBusy, [name]: true };
    mcpError = null;
    try {
      if (action === 'reconnect') {
        await window.groveBench.reconnectMcpServer(sessionId, name);
      } else {
        await window.groveBench.setMcpServerEnabled(sessionId, name, action === 'enable');
      }
    } catch (e: any) {
      mcpError = e?.message ?? `Failed to ${action} ${name}`;
    } finally {
      mcpBusy = { ...mcpBusy, [name]: false };
      await refreshMcpServers();
    }
  }

  let lastResult = $derived.by(() => {
    const msgs = messageStore.getMessages(sessionId);
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].kind === 'result') return msgs[i] as import('../stores/messages.svelte.js').ChatResultMessage;
    }
    return null;
  });

  const modeLabels: Record<string, string> = {
    default: 'Code',
    plan: 'Plan',
    acceptEdits: 'Edit',
  };

  const modeColors: Record<string, string> = {
    default: 'text-blue-400 border-blue-400/40',
    plan: 'text-yellow-400 border-yellow-400/40',
    acceptEdits: 'text-purple-400 border-purple-400/40',
  };

  const thinkingLabels: Record<ThinkingLevel, string> = {
    off: 'No Think',
    low: 'Think: Low',
    medium: 'Think: Med',
    high: 'Think: High',
    adaptive: 'Think: Auto',
  };

  const thinkingColors: Record<ThinkingLevel, string> = {
    off: 'text-muted-foreground/50 border-muted-foreground/20',
    low: 'text-purple-300/70 border-purple-300/30',
    medium: 'text-purple-400/80 border-purple-400/40',
    high: 'text-purple-400 border-purple-400/50',
    adaptive: 'text-cyan-400 border-cyan-400/50',
  };

  function handleKeydown(e: KeyboardEvent) {
    if (e.altKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      messageStore.cycleMode(sessionId);
    }
    if (e.altKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      messageStore.cycleThinkingLevel(sessionId);
    }
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as Node;
    if (modelPickerOpen && modelPickerRef && !modelPickerRef.contains(target)) {
      modelPickerOpen = false;
    }
    if (tasksExpanded && tasksRef && !tasksRef.contains(target)) {
      tasksExpanded = false;
    }
    if (bgTasksExpanded && bgTasksRef && !bgTasksRef.contains(target)) {
      bgTasksExpanded = false;
    }
    if (contextExpanded && contextRef && !contextRef.contains(target)) {
      contextExpanded = false;
    }
    if (shortcutsOpen && shortcutsRef && !shortcutsRef.contains(target)) {
      shortcutsOpen = false;
    }
    if (mcpExpanded && mcpRef && !mcpRef.contains(target)) {
      mcpExpanded = false;
    }
    if (createPrMenuOpen && createPrRef && !createPrRef.contains(target)) {
      createPrMenuOpen = false;
    }
    if (prPopoverOpen && prPopoverRef && !prPopoverRef.contains(target)) {
      prPopoverOpen = false;
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('click', handleClickOutside);
    window.groveBench.getModels().then((models) => {
      modelOptions = models.map((m) => ({ value: m.id, label: m.label, contextWindow: m.contextWindow }));
    });
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('click', handleClickOutside);
  });
</script>

<div class="flex items-center gap-4 px-4 py-1 bg-card border-t border-b border-border text-xs text-muted-foreground shrink-0">
  {#if model}
    <div class="relative" bind:this={modelPickerRef}>
      <button
        onclick={() => modelPickerOpen = !modelPickerOpen}
        class="hover:text-foreground transition-colors"
        title="Change model"
      >
        {model}
      </button>

      {#if modelPickerOpen}
        <div class="absolute bottom-full left-0 mb-2 bg-popover border border-border shadow-xl py-1 text-xs w-48 z-50">
          {#each modelOptions as opt}
            <button
              onclick={() => switchModel(opt.value)}
              class="w-full text-left px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors
                {model === opt.value ? 'text-primary font-medium' : 'text-muted-foreground'}"
            >
              {opt.label}
              {#if model === opt.value}
                <span class="ml-1">*</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <button
    onclick={() => messageStore.cycleMode(sessionId)}
    class="flex items-center gap-1.5 px-1.5 py-0.5 border transition-colors hover:bg-accent {modeColors[mode] ?? modeColors.default}"
    title="Change mode (Alt+M)"
  >
    {modeLabels[mode] ?? mode}
  </button>

  <button
    onclick={() => messageStore.cycleThinkingLevel(sessionId)}
    class="flex items-center gap-1.5 px-1.5 py-0.5 border transition-colors hover:bg-accent
      {thinkingColors[thinkingLevel]}"
    title="Cycle thinking level (Alt+T)"
  >
    {thinkingLabels[thinkingLevel]}
  </button>

  <span class="w-px h-3.5 bg-border"></span>

  <span class="flex items-center gap-1.5">
    {#if isRunning}
      <span class="w-1.5 h-1.5 {activity.activity === 'thinking' ? 'bg-purple-400' : 'bg-primary'} animate-pulse"></span>
      {#if activity.activity === 'thinking'}
        <span class="text-purple-400">thinking</span>
      {:else if activity.activity === 'tool_starting'}
        <span class="text-yellow-400 truncate max-w-32">
          {activity.toolName ?? 'tool'}{#if activity.elapsedSeconds && activity.elapsedSeconds > 0}&nbsp;({Math.round(activity.elapsedSeconds)}s){/if}
        </span>
      {:else if activity.activity === 'generating'}
        <span class="text-primary">writing</span>
      {:else}
        <span class="text-primary">running</span>
      {/if}
    {:else}
      <span class="w-1.5 h-1.5 bg-muted-foreground/60"></span>
      <span>idle</span>
    {/if}
  </span>

  {#if pendingTools.length > 0}
    <div class="relative" bind:this={tasksRef}>
      <button
        onclick={() => tasksExpanded = !tasksExpanded}
        class="flex items-center gap-1 text-yellow-400 hover:text-yellow-300 transition-colors"
        title="Pending tools — click for details"
      >
        <span class="w-1.5 h-1.5 bg-yellow-400 animate-pulse"></span>
        {pendingTools.length} tool{pendingTools.length > 1 ? 's' : ''}
      </button>

      {#if tasksExpanded}
        <div class="absolute bottom-full left-0 mb-2 bg-popover border border-border shadow-xl p-3 text-xs w-80 z-50">
          <div class="font-medium text-foreground mb-2">Pending Tools</div>
          <div class="space-y-1.5 max-h-48 overflow-y-auto">
            {#each pendingTools as task}
              <div class="flex items-center gap-2">
                <span class="w-1.5 h-1.5 bg-yellow-400 animate-pulse shrink-0"></span>
                <span class="text-yellow-400 font-medium shrink-0">{task.toolName}</span>
                <span class="text-muted-foreground truncate flex-1">{task.summary}</span>
                {#if task.elapsedSeconds && task.elapsedSeconds > 0}
                  <span class="text-muted-foreground/60 shrink-0">{Math.round(task.elapsedSeconds)}s</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if rateLimit && rateLimit.status !== 'allowed'}
    <span class="flex items-center gap-1 {rateLimit.status === 'rejected' ? 'text-red-400' : 'text-yellow-400'}">
      <span class="w-1.5 h-1.5 {rateLimit.status === 'rejected' ? 'bg-red-400' : 'bg-yellow-400'} animate-pulse"></span>
      {rateLimit.status === 'rejected' ? 'rate limited' : 'rate warning'}
      {#if rateLimit.utilization}({Math.round(rateLimit.utilization * 100)}%){/if}
      {#if rateLimit.resetsAt}
        <span class="text-muted-foreground" title={new Date(rateLimit.resetsAt * 1000).toLocaleString()}>
          resets {formatResetTime(rateLimit.resetsAt)}
        </span>
      {/if}
    </span>
  {/if}

  {#if backgroundTasks.length > 0}
    <div class="relative" bind:this={bgTasksRef}>
      <button
        onclick={() => bgTasksExpanded = !bgTasksExpanded}
        class="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors"
        title="Background tasks — click for details"
      >
        {#if runningBgTasks.length > 0}
          <span class="w-1.5 h-1.5 bg-blue-400 animate-pulse"></span>
        {:else}
          <span class="w-1.5 h-1.5 bg-blue-400/50"></span>
        {/if}
        {runningBgTasks.length > 0
          ? `${runningBgTasks.length} bg task${runningBgTasks.length > 1 ? 's' : ''}`
          : `${backgroundTasks.length} bg task${backgroundTasks.length > 1 ? 's' : ''}`}
      </button>

      {#if bgTasksExpanded}
        <div class="absolute bottom-full left-0 mb-2 bg-popover border border-border shadow-xl p-3 text-xs w-80 z-50">
          <div class="font-medium text-foreground mb-2">Background Tasks</div>
          <div class="space-y-2 max-h-64 overflow-y-auto">
            {#each backgroundTasks as task}
              <div class="border border-border/50 p-2">
                <div class="flex items-center gap-2 mb-1">
                  {#if task.status === 'running'}
                    <span class="w-1.5 h-1.5 bg-blue-400 animate-pulse shrink-0"></span>
                  {:else if task.status === 'completed'}
                    <span class="w-1.5 h-1.5 bg-green-500 shrink-0"></span>
                  {:else}
                    <span class="w-1.5 h-1.5 bg-red-500 shrink-0"></span>
                  {/if}
                  <span class="text-foreground font-medium truncate flex-1">{task.description || task.taskId}</span>
                  <span class="text-muted-foreground/60 shrink-0 capitalize">{task.status}</span>
                  {#if task.status !== 'running'}
                    <button
                      onclick={() => backgroundTaskStore.remove(sessionId, task.taskId)}
                      class="text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
                      title="Dismiss"
                    >
                      &times;
                    </button>
                  {/if}
                </div>
                {#if task.summary}
                  <p class="text-muted-foreground text-[10px] mb-1 line-clamp-2">{task.summary}</p>
                {/if}
                <div class="flex items-center gap-3 text-[10px] text-muted-foreground/60">
                  {#if task.lastToolName}
                    <span class="text-yellow-400">{task.lastToolName}</span>
                  {/if}
                  {#if task.toolUses > 0}
                    <span>{task.toolUses} tool use{task.toolUses !== 1 ? 's' : ''}</span>
                  {/if}
                  {#if task.totalTokens > 0}
                    <span>{formatTokens(task.totalTokens)} tokens</span>
                  {/if}
                  {#if task.durationMs > 0}
                    <span>{(task.durationMs / 1000).toFixed(1)}s</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <span class="w-px h-3.5 bg-border"></span>

  {#if lastResult?.totalCostUsd !== undefined}
    <span>${lastResult.totalCostUsd.toFixed(4)}</span>
  {/if}

  {#if lastResult?.durationMs !== undefined}
    <span>{(lastResult.durationMs / 1000).toFixed(1)}s</span>
  {/if}

  <span class="w-px h-3.5 bg-border"></span>

  {#if mcpKnown.length > 0}
    <div class="relative" bind:this={mcpRef}>
      <button
        onclick={toggleMcpPopover}
        class="flex items-center gap-1 transition-colors
          {mcpHealth === 'down' ? 'text-red-400 hover:text-red-300'
            : mcpHealth === 'partial' ? 'text-orange-400 hover:text-orange-300'
            : 'text-muted-foreground hover:text-foreground'}"
        title="MCP servers — click to manage connections{mcpDownCount > 0 ? ` (${mcpDownCount} down)` : ''}"
      >
        <span class="w-1.5 h-1.5
          {mcpHealth === 'down' ? 'bg-red-500'
            : mcpHealth === 'partial' ? 'bg-orange-400'
            : 'bg-green-500'}"></span>
        MCP {mcpKnown.length}
      </button>

      {#if mcpExpanded}
        <div class="absolute bottom-full left-0 mb-2 bg-popover border border-border shadow-xl p-3 text-xs w-96 z-50">
          <div class="flex items-center justify-between mb-2">
            <span class="font-medium text-foreground">MCP Servers</span>
            <button
              onclick={refreshMcpServers}
              class="text-muted-foreground/60 hover:text-foreground transition-colors"
              title="Refresh status"
            >
              Refresh
            </button>
          </div>

          {#if mcpError}
            <div class="text-destructive mb-2 break-words">{mcpError}</div>
          {/if}

          <div class="space-y-1.5 max-h-64 overflow-y-auto">
            {#each mcpServers.length > 0 ? mcpServers : mcpKnown as server (server.name)}
              {@const status = server.status}
              <div class="flex items-center gap-2 group">
                <span class="w-1.5 h-1.5 shrink-0
                  {status === 'connected' ? 'bg-green-500'
                    : status === 'pending' ? 'bg-yellow-400 animate-pulse'
                    : status === 'needs-auth' ? 'bg-yellow-500'
                    : status === 'disabled' ? 'bg-muted-foreground/40'
                    : 'bg-red-500'}"
                ></span>
                <div class="flex-1 min-w-0">
                  <div class="font-mono truncate text-foreground" title={'error' in server && server.error ? server.error : server.name}>
                    {server.name}
                  </div>
                  <div class="text-muted-foreground/60 text-[10px]">
                    {status}{#if 'toolCount' in server && server.toolCount !== undefined}&nbsp;· {server.toolCount} tool{server.toolCount === 1 ? '' : 's'}{/if}
                  </div>
                </div>
                {#if status === 'disabled'}
                  <button
                    onclick={() => mcpAction(server.name, 'enable')}
                    disabled={mcpBusy[server.name]}
                    class="px-1.5 py-0.5 border border-border text-green-400 hover:bg-green-400/10 transition-colors shrink-0 disabled:opacity-50"
                    title="Reconnect this server"
                  >
                    Connect
                  </button>
                {:else}
                  <button
                    onclick={() => mcpAction(server.name, 'reconnect')}
                    disabled={mcpBusy[server.name]}
                    class="px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 disabled:opacity-50"
                    title="Restart the connection to this server"
                  >
                    Reconnect
                  </button>
                  <button
                    onclick={() => mcpAction(server.name, 'disable')}
                    disabled={mcpBusy[server.name]}
                    class="px-1.5 py-0.5 border border-border text-destructive hover:bg-destructive/10 transition-colors shrink-0 disabled:opacity-50"
                    title="Disconnect this server for the rest of the session"
                  >
                    Disconnect
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if sessionBranch}
    <span class="text-muted-foreground/70 truncate max-w-40" title={sessionBranch}>
      {sessionBranch}
    </span>
  {/if}

  {#if gitSync.ahead > 0}
    <button
      onclick={doPush}
      disabled={pushing}
      class="flex items-center gap-1 text-yellow-400 hover:text-yellow-300 transition-colors disabled:opacity-50"
      title={pushing ? 'Pushing…' : `${gitSync.ahead} unpushed commit${gitSync.ahead > 1 ? 's' : ''} — click to push`}
    >
      {pushing ? 'pushing…' : `↑${gitSync.ahead}`}
    </button>
  {/if}

  {#if gitSync.behind > 0}
    <span class="text-muted-foreground/70" title="{gitSync.behind} commit{gitSync.behind > 1 ? 's' : ''} behind upstream (as of last fetch)">
      ↓{gitSync.behind}
    </span>
  {/if}

  {#if pushError}
    <span class="text-red-400 truncate max-w-32" title={pushError}>push failed</span>
  {/if}

  {#if prInfo}
    {@const prColor =
      prInfo.state === 'MERGED' ? 'text-purple-400 hover:text-purple-300'
      : prInfo.state === 'CLOSED' ? 'text-red-400 hover:text-red-300'
      : prInfo.isDraft ? 'text-muted-foreground hover:text-foreground'
      : 'text-blue-400 hover:text-blue-300'}
    <div class="relative" bind:this={prPopoverRef}>
      <button
        onclick={() => prPopoverOpen = !prPopoverOpen}
        class="flex items-center gap-1.5 {prColor} transition-colors"
        title="{prInfo.title ? `${prInfo.title} — ` : ''}PR #{prInfo.number}{prAlerts.length > 0 ? ' (new activity)' : ''}: click for checks, reviews, and automation"
      >
        <!-- One dot: color = worst condition, pulse = unseen activity -->
        <span class="w-1.5 h-1.5 {prHealthDot} {prAlerts.length > 0 ? 'animate-pulse' : ''}"></span>
        PR #{prInfo.number}
      </button>

      {#if prPopoverOpen}
        {@const c = prInfo.checks}
        <div
          transition:fly={{ y: 6, duration: 140 }}
          class="absolute bottom-full left-0 mb-2 bg-popover border border-border shadow-xl p-3 text-xs w-96 z-50"
        >
          <!-- Header -->
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium text-foreground truncate" title={prInfo.title}>
              PR #{prInfo.number}{prInfo.title ? ` — ${prInfo.title}` : ''}
            </span>
            <button
              onclick={() => prInfo && window.groveBench.openExternal(prInfo.url)}
              class="text-blue-400 hover:text-blue-300 hover:underline shrink-0"
              title="Open on GitHub"
            >
              Open ↗
            </button>
          </div>
          <div class="text-muted-foreground/70 mt-0.5">
            {prInfo.isDraft ? 'draft' : (prInfo.state ?? 'open').toLowerCase()}
          </div>

          <!-- Status: checks + reviews, alerts merged in as "new" pills -->
          <div class="border-t border-border pt-2 mt-2 space-y-1.5">
            {#if c}
              <div class="flex items-center gap-2 px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors">
                <span class="text-muted-foreground w-14 shrink-0">Checks</span>
                <span class="flex items-center gap-2 flex-1 min-w-0">
                  {#if c.passed > 0}<span class="text-green-400">✓ {c.passed}</span>{/if}
                  {#if c.failed > 0}<span class="text-red-400">✗ {c.failed}</span>{/if}
                  {#if c.pending > 0}<span class="text-yellow-400">● {c.pending}</span>{/if}
                  {#if ciAlert}
                    {@const ci = ciAlert}
                    <button
                      onclick={() => prStore.dismissAlert(sessionId, ci.id)}
                      class="px-1 text-[10px] leading-4 whitespace-nowrap bg-yellow-400/15 text-yellow-400 border border-yellow-400/30 hover:bg-yellow-400/25 transition-colors"
                      title="Failed since you last looked — click to clear"
                    >
                      new
                    </button>
                  {/if}
                </span>
                {#if c.failed > 0}
                  <button
                    onclick={fixCi}
                    disabled={!canAgentCreatePr}
                    class="text-blue-400 hover:text-blue-300 hover:underline shrink-0 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                    title={canAgentCreatePr ? 'Send a turn asking the agent to read the CI logs and fix the failures' : 'The agent must be idle and running'}
                  >
                    fix with agent →
                  </button>
                {/if}
              </div>
              {#if prInfo.failingChecks && prInfo.failingChecks.length > 0}
                <div class="text-muted-foreground/60 pl-16 truncate" title={prInfo.failingChecks.join(', ')}>
                  {prInfo.failingChecks.join(', ')}
                </div>
              {/if}
            {/if}

            {#if prInfo.reviewDecision === 'APPROVED' || prInfo.reviewDecision === 'CHANGES_REQUESTED' || commentsAlert}
              <div class="flex items-center gap-2 px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors">
                <span class="text-muted-foreground w-14 shrink-0">Reviews</span>
                <span class="flex items-center gap-2 flex-1 min-w-0">
                  {#if prInfo.reviewDecision === 'APPROVED'}
                    <span class="text-green-400 whitespace-nowrap">approved</span>
                  {:else if prInfo.reviewDecision === 'CHANGES_REQUESTED'}
                    <span class="text-orange-400 whitespace-nowrap" title="Changes requested">changes</span>
                  {:else}
                    <span class="text-muted-foreground/70">commented</span>
                  {/if}
                  {#if commentsAlert}
                    {@const ca = commentsAlert}
                    <button
                      onclick={() => prStore.dismissAlert(sessionId, ca.id)}
                      class="px-1 text-[10px] leading-4 whitespace-nowrap bg-yellow-400/15 text-yellow-400 border border-yellow-400/30 hover:bg-yellow-400/25 transition-colors"
                      title="{ca.count} new comment{ca.count > 1 ? 's' : ''} since you last looked — click to clear"
                    >
                      {ca.count} new
                    </button>
                  {/if}
                </span>
                {#if prInfo.state === 'OPEN' && (prInfo.reviewDecision === 'CHANGES_REQUESTED' || commentsAlert)}
                  <button
                    onclick={addressReviews}
                    disabled={!canAgentCreatePr || addressingReviews}
                    class="text-blue-400 hover:text-blue-300 hover:underline shrink-0 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                    title={canAgentCreatePr ? 'Fetch the review comments and send a turn asking the agent to address them' : 'The agent must be idle and running'}
                  >
                    {addressingReviews ? 'fetching…' : 'address with agent →'}
                  </button>
                {/if}
              </div>
            {/if}

            {#if humanAlert}
              {@const ha = humanAlert}
              <div class="flex items-center gap-2 px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors text-orange-400">
                <span class="w-1.5 h-1.5 bg-current shrink-0"></span>
                <span class="flex-1" title={ha.reason}>{ha.reason}</span>
                <button
                  onclick={() => prStore.dismissAlert(sessionId, ha.id)}
                  class="text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
                  title="Dismiss"
                >
                  &times;
                </button>
              </div>
            {/if}
          </div>

          <!-- Automation -->
          <div class="border-t border-border pt-2 mt-2">
            <div class="flex items-center gap-2 px-1.5 py-0.5 -mx-1.5 hover:bg-accent/40 transition-colors">
              <span class="text-muted-foreground w-14 shrink-0">Auto</span>
              <label
                class="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
                title="When CI fails on a new commit, send a fix turn automatically — max 2 attempts per commit, then it asks for you"
              >
                <Checkbox
                  class="size-3.5"
                  checked={prAuto.fixCi}
                  onCheckedChange={(v) => prStore.setAuto(sessionId, { fixCi: v === true })}
                />
                fix CI
              </label>
              <label
                class="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
                title="When repo collaborators leave new review feedback, send a turn to address it automatically"
              >
                <Checkbox
                  class="size-3.5"
                  checked={prAuto.addressReviews}
                  onCheckedChange={(v) => prStore.setAuto(sessionId, { addressReviews: v === true })}
                />
                address reviews
              </label>
            </div>
            <p class="text-[10px] text-muted-foreground/60 mt-1.5">
              Auto turns run only while the session is idle; git push / gh may need to be allowed.
            </p>
          </div>
        </div>
      {/if}
    </div>
  {:else if sessionBranch && ghAvailable}
    <div class="relative flex items-center" bind:this={createPrRef}>
      <button
        onclick={startCreatePr}
        disabled={isRunning}
        class="text-blue-400 hover:text-blue-300 hover:underline transition-colors disabled:opacity-50 disabled:no-underline"
        title={canAgentCreatePr
          ? 'Ask the agent to commit, push, and create a pull request in this conversation'
          : 'Push this branch and create a pull request'}
      >
        Create PR
      </button>
      <button
        onclick={() => createPrMenuOpen = !createPrMenuOpen}
        class="ml-0.5 text-blue-400/70 hover:text-blue-300 transition-colors"
        title="Create PR options"
      >
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m18 15-6-6-6 6" />
        </svg>
      </button>

      {#if createPrMenuOpen}
        <div class="absolute bottom-full left-0 mb-2 bg-popover border border-border shadow-xl py-1 text-xs w-48 z-50">
          <button
            onclick={() => { createPrMenuOpen = false; sendAgentPrTurn(); }}
            disabled={!canAgentCreatePr}
            class="w-full text-left px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={canAgentCreatePr ? 'Send a turn asking the agent to commit, push, and open the PR' : 'The agent must be idle and running to take this turn'}
          >
            Create with agent
          </button>
          <button
            onclick={() => { createPrMenuOpen = false; createPrOpen = true; }}
            class="w-full text-left px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors"
            title="Open the PR dialog — title and description prefilled from the branch's commits"
          >
            Create manually…
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if showContext}
    <div class="relative ml-auto" bind:this={contextRef}>
      <button
        onclick={() => contextExpanded = !contextExpanded}
        class="flex items-center gap-2 hover:text-foreground transition-colors"
        title="Context usage — click for details"
      >
        <!-- Mini bar with color-coded fill -->
        <div class="w-24 h-1.5 bg-muted overflow-hidden flex">
          {#if cachePercent > 0}
            <div class="h-full bg-blue-500/70 transition-all" style:width="{cachePercent}%"></div>
          {/if}
          <div class="h-full transition-all" style:width="{freshPercent}%" style:background-color={barBg}></div>
        </div>
        <span style:color={textColor} class="font-medium transition-colors">
          {formatTokens(usedTokens)}/{formatTokens(contextWindow)} ({usedPercent.toFixed(0)}%)
        </span>
      </button>

      {#if contextExpanded}
        <div class="absolute bottom-full right-0 mb-2 bg-popover border border-border shadow-xl p-4 text-xs w-72 z-50">
          <div class="flex items-center justify-between mb-3">
            <span class="font-medium text-foreground text-sm">Context Window</span>
            <span class="font-medium" style:color={textColor}>{usedPercent.toFixed(1)}%</span>
          </div>

          <!-- Large segmented bar -->
          <div class="w-full h-3 bg-muted overflow-hidden flex mb-1">
            {#if cachePercent > 0}
              <div class="h-full bg-blue-500/70 transition-all" style:width="{cachePercent}%" title="Cached"></div>
            {/if}
            <div class="h-full transition-all" style:width="{freshPercent}%" style:background-color={barBg} title="Used"></div>
          </div>

          <!-- Percentage labels under bar -->
          <div class="flex justify-between text-[10px] text-muted-foreground/60 mb-3">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </div>

          <!-- Legend -->
          <div class="flex gap-3 mb-3 text-muted-foreground">
            <span class="flex items-center gap-1">
              <span class="w-2 h-2 inline-block" style:background-color={barBg}></span>
              Used
            </span>
            {#if cachePercent > 0}
              <span class="flex items-center gap-1">
                <span class="w-2 h-2 bg-blue-500/70 inline-block"></span>
                Cached
              </span>
            {/if}
            <span class="flex items-center gap-1">
              <span class="w-2 h-2 bg-muted inline-block"></span>
              Free
            </span>
          </div>

          <!-- Token breakdown -->
          <div class="space-y-1.5 text-muted-foreground mb-3">
            <div class="flex justify-between">
              <span>Context window</span>
              <span class="text-foreground font-medium">{formatTokens(contextWindow)}</span>
            </div>
            <div class="flex justify-between">
              <span>Used (total input)</span>
              <span class="font-medium" style:color={textColor}>{formatTokens(usedTokens)}</span>
            </div>
            <div class="flex justify-between text-[10px] pl-2">
              <span>Non-cached</span>
              <span class="text-foreground">{formatTokens(usage.inputTokens)}</span>
            </div>
            {#if usage.cacheReadTokens > 0}
              <div class="flex justify-between text-[10px] pl-2">
                <span>Cache read</span>
                <span class="text-blue-400">{formatTokens(usage.cacheReadTokens)}</span>
              </div>
            {/if}
            {#if usage.cacheCreationTokens > 0}
              <div class="flex justify-between text-[10px] pl-2">
                <span>Cache write</span>
                <span class="text-foreground">{formatTokens(usage.cacheCreationTokens)}</span>
              </div>
            {/if}
            <div class="flex justify-between">
              <span>Output (cumulative)</span>
              <span class="text-foreground">{formatTokens(usage.outputTokens)}</span>
            </div>
            <div class="flex justify-between border-t border-border pt-1.5 mt-1.5">
              <span>Remaining</span>
              <span class="{remainingColor} font-medium">{formatTokens(freeTokens)}</span>
            </div>
          </div>

          <!-- System info breakdown -->
          {#if systemInfo.tools.length > 0 || systemInfo.agents.length > 0 || systemInfo.skills.length > 0 || systemInfo.mcpServers.length > 0}
            <div class="border-t border-border pt-2.5 mt-2.5">
              <div class="font-medium text-foreground mb-2">Session Info</div>
              <div class="space-y-1.5 text-muted-foreground">
                {#if systemInfo.tools.length > 0}
                  <div class="flex justify-between">
                    <span>Tools</span>
                    <span class="text-foreground">{systemInfo.tools.length}</span>
                  </div>
                {/if}
                {#if systemInfo.agents.length > 0}
                  <div class="flex justify-between">
                    <span>Agents</span>
                    <span class="text-foreground">{systemInfo.agents.length}</span>
                  </div>
                {/if}
                {#if systemInfo.skills.length > 0}
                  <div class="flex justify-between">
                    <span>Skills</span>
                    <span class="text-foreground">{systemInfo.skills.length}</span>
                  </div>
                {/if}
                {#if systemInfo.slashCommands.length > 0}
                  <div class="flex justify-between">
                    <span>Commands</span>
                    <span class="text-foreground">{systemInfo.slashCommands.length}</span>
                  </div>
                {/if}
                {#if systemInfo.mcpServers.length > 0}
                  <div class="flex justify-between">
                    <span>MCP servers</span>
                    <span class="text-foreground">{systemInfo.mcpServers.length}</span>
                  </div>
                {/if}
                {#if turns > 0}
                  <div class="flex justify-between">
                    <span>Turns</span>
                    <span class="text-foreground">{turns}</span>
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          <!-- Expandable tool list -->
          {#if systemInfo.tools.length > 0}
            <details class="mt-2.5 border-t border-border pt-2.5">
              <summary class="text-muted-foreground cursor-pointer hover:text-foreground">
                Tool list ({systemInfo.tools.length})
              </summary>
              <div class="mt-1.5 max-h-32 overflow-y-auto space-y-0.5 text-muted-foreground">
                {#each systemInfo.tools as tool}
                  <div class="font-mono text-[10px] truncate">{tool}</div>
                {/each}
              </div>
            </details>
          {/if}

          <!-- Per-server MCP status and connect/disconnect controls live in the
               status bar's dedicated MCP popover, not here. -->

          <!-- Quick actions -->
          <div class="border-t border-border pt-2.5 mt-2.5 flex gap-2">
            <button
              onclick={() => { messageStore.sendCommand(sessionId, '/compact'); contextExpanded = false; }}
              disabled={isRunning}
              class="flex-1 px-2 py-1.5 text-xs border border-border hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Compact conversation to free context"
            >
              /compact
            </button>
            <button
              onclick={() => { messageStore.sendCommand(sessionId, '/clear'); contextExpanded = false; }}
              disabled={isRunning}
              class="flex-1 px-2 py-1.5 text-xs border border-border hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Clear conversation and start fresh"
            >
              /clear
            </button>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <span class="ml-auto"></span>
  {/if}

  <div class="relative" bind:this={shortcutsRef}>
    <button
      onclick={() => shortcutsOpen = !shortcutsOpen}
      class="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
      title="Keyboard shortcuts"
    >
      Keys
    </button>

    {#if shortcutsOpen}
      <div class="absolute bottom-full right-0 mb-2 bg-popover border border-border shadow-xl p-3 text-xs w-56 z-50">
        <div class="font-medium text-foreground mb-2">Keyboard Shortcuts</div>
        <div class="space-y-1.5 text-muted-foreground">
          <div class="flex justify-between"><span>Session finder</span><kbd class="text-foreground">Ctrl+R</kbd></div>
          <div class="flex justify-between"><span>Search messages</span><kbd class="text-foreground">Ctrl+F</kbd></div>
          <div class="flex justify-between"><span>Cycle mode</span><kbd class="text-foreground">Alt+M</kbd></div>
          <div class="flex justify-between"><span>Cycle thinking level</span><kbd class="text-foreground">Alt+T</kbd></div>
          <div class="flex justify-between"><span>Activity tab</span><kbd class="text-foreground">Alt+1</kbd></div>
          <div class="flex justify-between"><span>Changes tab</span><kbd class="text-foreground">Alt+2</kbd></div>
          <div class="flex justify-between"><span>Terminal tab</span><kbd class="text-foreground">Alt+3</kbd></div>
        </div>
      </div>
    {/if}
  </div>
</div>

{#if createPrOpen}
  <CreatePrDialog {sessionId} onclose={() => createPrOpen = false} />
{/if}
