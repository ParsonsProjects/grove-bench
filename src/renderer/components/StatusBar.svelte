<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import type { PrInfo } from '../../shared/types.js';

  let { sessionId }: { sessionId: string } = $props();

  let prInfo = $state<PrInfo | null>(null);
  let modelPickerOpen = $state(false);

  const modelOptions = [
    { value: 'claude-opus-4-6', label: 'Opus 4.6' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  ];

  async function switchModel(modelId: string) {
    modelPickerOpen = false;
    try {
      await window.groveBench.setModel(sessionId, modelId);
      messageStore.setModelOverride(sessionId, modelId);
    } catch (e: any) {
      console.error('Failed to switch model:', e);
    }
  }

  let model = $derived(messageStore.getModel(sessionId));
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let mode = $derived(messageStore.getMode(sessionId));
  let thinking = $derived(messageStore.getThinking(sessionId));
  let activity = $derived(messageStore.getActivity(sessionId));
  let usage = $derived(messageStore.getUsage(sessionId));
  let systemInfo = $derived(messageStore.getSystemInfo(sessionId));
  let contextWindow = $derived(messageStore.getContextWindow(sessionId));
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

  // Re-fetch PR info when a turn finishes (agent may have created/pushed a PR)
  let prevRunning = $state(false);
  $effect(() => {
    if (prevRunning && !isRunning) {
      window.groveBench.getPrInfo(sessionId).then((info) => {
        prInfo = info;
      });
    }
    prevRunning = isRunning;
  });

  let devServers = $derived(messageStore.getDevServers(sessionId));
  let pendingTools = $derived(messageStore.getPendingTools(sessionId));
  let rateLimit = $derived(messageStore.getRateLimit(sessionId));
  let backgroundTasks = $derived(messageStore.getBackgroundTasks(sessionId));
  let runningBgTasks = $derived(backgroundTasks.filter((t) => t.status === 'running'));

  function formatResetTime(epoch: number): string {
    const now = Date.now() / 1000;
    const diff = epoch - now;
    if (diff <= 0) return 'now';
    if (diff < 60) return `${Math.round(diff)}s`;
    if (diff < 3600) return `${Math.round(diff / 60)}m`;
    return `${Math.round(diff / 3600)}h`;
  }
  let contextExpanded = $state(false);
  let tasksExpanded = $state(false);
  let bgTasksExpanded = $state(false);

  // Refs for click-outside detection on popovers
  let modelPickerRef = $state<HTMLDivElement | null>(null);
  let tasksRef = $state<HTMLDivElement | null>(null);
  let bgTasksRef = $state<HTMLDivElement | null>(null);
  let contextRef = $state<HTMLDivElement | null>(null);

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
    orchestrator: 'Orchestrator',
  };

  const modeColors: Record<string, string> = {
    default: 'text-green-400 border-green-400/40',
    plan: 'text-yellow-400 border-yellow-400/40',
    acceptEdits: 'text-purple-400 border-purple-400/40',
    orchestrator: 'text-cyan-400 border-cyan-400/40',
  };

  function handleKeydown(e: KeyboardEvent) {
    if (e.altKey && e.key.toLowerCase() === 'm' && mode !== 'orchestrator') {
      e.preventDefault();
      messageStore.cycleMode(sessionId);
    }
    if (e.altKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      messageStore.setThinking(sessionId, !messageStore.getThinking(sessionId));
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
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('click', handleClickOutside);
    window.groveBench.getPrInfo(sessionId).then((info) => {
      prInfo = info;
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

  {#if prInfo}
    <button
      onclick={() => prInfo && window.groveBench.openExternal(prInfo.url)}
      class="text-blue-400 hover:text-blue-300 hover:underline transition-colors"
      title="Open PR #{prInfo.number} on GitHub"
    >
      PR #{prInfo.number}
    </button>
  {/if}

  {#if mode === 'orchestrator'}
    <span
      class="flex items-center gap-1.5 px-1.5 py-0.5 border {modeColors.orchestrator}"
      title="Orchestrator session — mode is fixed"
    >
      Orchestrator
    </span>
  {:else}
    <button
      onclick={() => messageStore.cycleMode(sessionId)}
      class="flex items-center gap-1.5 px-1.5 py-0.5 border transition-colors hover:bg-accent {modeColors[mode] ?? modeColors.default}"
      title="Change mode (Alt+M)"
    >
      {modeLabels[mode] ?? mode}
    </button>
  {/if}

  <button
    onclick={() => messageStore.setThinking(sessionId, !thinking)}
    class="flex items-center gap-1.5 px-1.5 py-0.5 border transition-colors hover:bg-accent
      {thinking ? 'text-purple-400 border-purple-400/40' : 'text-muted-foreground/50 border-muted-foreground/20'}"
    title="Toggle extended thinking (Alt+T)"
  >
    {thinking ? 'Thinking' : 'No Think'}
  </button>

  <span class="flex items-center gap-1.5">
    {#if isRunning}
      <span class="w-1.5 h-1.5 bg-primary animate-pulse"></span>
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
        title="Background tasks — click for details"
      >
        <span class="w-1.5 h-1.5 bg-yellow-400 animate-pulse"></span>
        {pendingTools.length} task{pendingTools.length > 1 ? 's' : ''}
      </button>

      {#if tasksExpanded}
        <div class="absolute bottom-full left-0 mb-2 bg-popover border border-border shadow-xl p-3 text-xs w-80 z-50">
          <div class="font-medium text-foreground mb-2">Running Tasks</div>
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
        <span class="text-muted-foreground">resets {formatResetTime(rateLimit.resetsAt)}</span>
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
              <div class="border border-border/50 p-2 rounded-sm">
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

  {#if lastResult?.totalCostUsd !== undefined}
    <span>${lastResult.totalCostUsd.toFixed(4)}</span>
  {/if}

  {#if lastResult?.durationMs !== undefined}
    <span>{(lastResult.durationMs / 1000).toFixed(1)}s</span>
  {/if}

  {#if devServers.length > 0}
    {#each devServers as server}
      <span class="flex items-center gap-1">
        <span class="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
        <button
          onclick={() => window.groveBench.openExternal(server.url)}
          class="text-green-400 hover:text-green-300 hover:underline transition-colors"
          title="Open {server.url} in browser"
        >
          :{server.port}
        </button>
        <button
          onclick={() => { window.groveBench.killPort(server.port); messageStore.removeDevServer(sessionId, server.port); }}
          class="text-muted-foreground/40 hover:text-destructive transition-colors"
          title="Kill server on port {server.port}"
        >
          &times;
        </button>
      </span>
    {/each}
  {/if}

  {#if showContext}
    <div class="relative ml-auto" bind:this={contextRef}>
      <button
        onclick={() => contextExpanded = !contextExpanded}
        class="flex items-center gap-2 hover:text-foreground transition-colors"
        title="Context usage — click for details"
      >
        <!-- Mini bar with color-coded fill -->
        <div class="w-24 h-1.5 bg-muted rounded-full overflow-hidden flex">
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
          <div class="w-full h-3 bg-muted rounded overflow-hidden flex mb-1">
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
              <span class="w-2 h-2 rounded-sm inline-block" style:background-color={barBg}></span>
              Used
            </span>
            {#if cachePercent > 0}
              <span class="flex items-center gap-1">
                <span class="w-2 h-2 rounded-sm bg-blue-500/70 inline-block"></span>
                Cached
              </span>
            {/if}
            <span class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-sm bg-muted inline-block"></span>
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

          {#if systemInfo.mcpServers.length > 0}
            <details class="mt-2 border-t border-border pt-2">
              <summary class="text-muted-foreground cursor-pointer hover:text-foreground">
                MCP servers ({systemInfo.mcpServers.length})
              </summary>
              <div class="mt-1.5 max-h-24 overflow-y-auto space-y-0.5">
                {#each systemInfo.mcpServers as server}
                  <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full {server.status === 'connected' ? 'bg-green-500' : 'bg-yellow-500'}"></span>
                    <span class="font-mono text-[10px] text-muted-foreground truncate">{server.name}</span>
                  </div>
                {/each}
              </div>
            </details>
          {/if}

          <!-- Quick actions -->
          <div class="border-t border-border pt-2.5 mt-2.5 flex gap-2">
            <button
              onclick={() => { messageStore.sendCommand(sessionId, '/compact'); contextExpanded = false; }}
              disabled={isRunning}
              class="flex-1 px-2 py-1.5 text-xs border border-border rounded hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Compact conversation to free context"
            >
              /compact
            </button>
            <button
              onclick={() => { messageStore.sendCommand(sessionId, '/clear'); contextExpanded = false; }}
              disabled={isRunning}
              class="flex-1 px-2 py-1.5 text-xs border border-border rounded hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

  <span class="text-muted-foreground/40 flex gap-3">
    <span>Ctrl+R find</span>
    <span>Ctrl+F search</span>
    <span>Alt+M mode</span>
    <span>Alt+T think</span>
  </span>
</div>
