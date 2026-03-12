<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';

  let { sessionId }: { sessionId: string } = $props();

  let model = $derived(messageStore.getModel(sessionId));
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let mode = $derived(messageStore.getMode(sessionId));
  let usage = $derived(messageStore.getUsage(sessionId));
  let systemInfo = $derived(messageStore.getSystemInfo(sessionId));
  let contextWindow = $derived(messageStore.getContextWindow(sessionId));
  let turns = $derived(messageStore.getTurns(sessionId));

  // Context is input_tokens = current context window usage (system + tools + messages)
  let usedTokens = $derived(usage.inputTokens);
  let freeTokens = $derived(Math.max(0, contextWindow - usedTokens));
  let usedPercent = $derived(Math.min((usedTokens / contextWindow) * 100, 100));
  let showContext = $derived(usedTokens > 0);

  // Cache proportion for segmented bar
  let cachePercent = $derived((usage.cacheReadTokens / contextWindow) * 100);
  let freshPercent = $derived(Math.max(0, usedPercent - cachePercent));

  // Color gradient based on usage percentage
  // 0-40%: green, 40-60%: yellow, 60-80%: orange, 80-100%: red
  function usageColor(pct: number): string {
    if (pct <= 40) return 'rgb(34, 197, 94)';       // green-500
    if (pct <= 60) return 'rgb(234, 179, 8)';        // yellow-500
    if (pct <= 80) return 'rgb(249, 115, 22)';       // orange-500
    return 'rgb(239, 68, 68)';                        // red-500
  }

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

  let contextExpanded = $state(false);

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
    default: 'text-green-400 border-green-400/40',
    plan: 'text-yellow-400 border-yellow-400/40',
    acceptEdits: 'text-purple-400 border-purple-400/40',
  };

  function handleKeydown(e: KeyboardEvent) {
    if (e.altKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      messageStore.cycleMode(sessionId);
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="flex items-center gap-4 px-4 py-1 bg-card border-t border-b border-border text-xs text-muted-foreground shrink-0">
  {#if model}
    <span>{model}</span>
  {/if}

  <button
    onclick={() => messageStore.cycleMode(sessionId)}
    class="flex items-center gap-1.5 px-1.5 py-0.5 border transition-colors hover:bg-accent {modeColors[mode] ?? modeColors.default}"
    title="Change mode (Alt+M)"
  >
    {modeLabels[mode] ?? mode}
  </button>

  <span class="flex items-center gap-1.5">
    {#if isRunning}
      <span class="w-1.5 h-1.5 bg-primary animate-pulse"></span>
      <span class="text-primary">running</span>
    {:else}
      <span class="w-1.5 h-1.5 bg-muted-foreground/60"></span>
      <span>idle</span>
    {/if}
  </span>

  {#if lastResult?.totalCostUsd !== undefined}
    <span>${lastResult.totalCostUsd.toFixed(4)}</span>
  {/if}

  {#if lastResult?.durationMs !== undefined}
    <span>{(lastResult.durationMs / 1000).toFixed(1)}s</span>
  {/if}

  {#if showContext}
    <div class="relative ml-auto">
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
              <span>Input (context size)</span>
              <span class="font-medium" style:color={textColor}>{formatTokens(usage.inputTokens)}</span>
            </div>
            <div class="flex justify-between">
              <span>Output (cumulative)</span>
              <span class="text-foreground">{formatTokens(usage.outputTokens)}</span>
            </div>
            {#if usage.cacheReadTokens > 0}
              <div class="flex justify-between">
                <span>Cache read</span>
                <span class="text-blue-400">{formatTokens(usage.cacheReadTokens)}</span>
              </div>
            {/if}
            {#if usage.cacheCreationTokens > 0}
              <div class="flex justify-between">
                <span>Cache write</span>
                <span class="text-foreground">{formatTokens(usage.cacheCreationTokens)}</span>
              </div>
            {/if}
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
  </span>
</div>
