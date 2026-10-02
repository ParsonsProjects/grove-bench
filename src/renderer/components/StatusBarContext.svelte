<script lang="ts">
  /**
   * The context meter: how full the agent's context window is, with the
   * token breakdown and the Summarise / Start fresh actions in its popover.
   */
  import { messageStore } from '../stores/messages.svelte.js';
  import { contextUsage, formatTokens } from '../lib/context-usage.js';
  import { usageTextClass, usageBarClass } from '../lib/usage-tone.js';
  import StatusBarPopover from './StatusBarPopover.svelte';

  let { sessionId, contextWindow }: { sessionId: string; contextWindow: number } = $props();

  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let usage = $derived(messageStore.getUsage(sessionId));
  let systemInfo = $derived(messageStore.getSystemInfo(sessionId));
  let turns = $derived(messageStore.getTurns(sessionId));

  let { usedTokens, freeTokens, usedPercent } = $derived(contextUsage(usage, contextWindow));
  let showContext = $derived(usedTokens > 0);

  // The whole used length takes the fill colour. Cached tokens take up room
  // like any others (with prompt caching they are nearly all of it), so the
  // cache split is listed in the popover, not drawn in the bar where it would
  // hide the warning colour.
  let usedTextClass = $derived(usageTextClass(usedPercent));
  let usedBarClass = $derived(usageBarClass(usedPercent));

  let contextExpanded = $state(false);
  /** "Start fresh" asks once before clearing; closing the popover cancels. */
  let confirmClear = $state(false);
  $effect(() => { if (!contextExpanded) confirmClear = false; });
</script>

{#if showContext}
  <StatusBarPopover bind:open={contextExpanded} align="right" class="ml-auto shrink-0" panelClass="bg-popover border border-border shadow-xl p-4 text-xs w-72">
    {#snippet trigger()}
      <button
        onclick={() => contextExpanded = !contextExpanded}
        class="flex flex-col items-end gap-1 leading-snug whitespace-nowrap hover:text-foreground transition-colors"
        title="Context: {formatTokens(usedTokens)} of {formatTokens(contextWindow)} tokens used. Click for details."
        aria-label="Context {usedPercent.toFixed(0)}% used. Click for details."
        aria-expanded={contextExpanded}
      >
        <span class="font-medium transition-colors {usedTextClass}">
          Context {usedPercent.toFixed(0)}%
        </span>
        <!-- Mini bar, coloured by how full it is -->
        <div class="w-16 @3xl:w-24 h-1.5 bg-muted overflow-hidden" data-testid="context-bar">
          <div class="h-full transition-all {usedBarClass}" style:width="{usedPercent}%"></div>
        </div>
      </button>
    {/snippet}

    <div class="flex items-center justify-between mb-1">
      <span class="font-medium text-foreground text-sm">Context</span>
      <span class="font-medium {usedTextClass}">{usedPercent.toFixed(1)}%</span>
    </div>
    <!-- What it is, for someone new to agents. Claude Code's own
         behaviour near the limit: https://code.claude.com/docs/en/how-claude-code-works#when-context-fills-up -->
    <p class="text-muted-foreground mb-3">
      How much the agent can hold in mind at once: your messages, its replies, files it read and command
      output. Near the limit it clears old tool output, then summarises the conversation, so early details
      can be lost.
    </p>

    <div class="w-full h-3 bg-muted overflow-hidden mb-1">
      <div class="h-full transition-all {usedBarClass}" style:width="{usedPercent}%"></div>
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
        <span class="w-2 h-2 inline-block {usedBarClass}"></span>
        Used
      </span>
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
        <span class="font-medium {usedTextClass}">{formatTokens(usedTokens)}</span>
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
        <span class="{usedTextClass} font-medium">{formatTokens(freeTokens)}</span>
      </div>
    </div>

    <!-- System info breakdown -->
    {#if systemInfo.tools.length > 0 || systemInfo.agents.length > 0 || systemInfo.skills.length > 0 || systemInfo.mcpServers.length > 0}
      <div class="border-t border-border pt-2.5 mt-2.5">
        <div class="font-medium text-foreground mb-2">Conversation Info</div>
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

    <!-- Quick actions. Clearing drops the conversation, so it asks first. -->
    <div class="border-t border-border pt-2.5 mt-2.5">
      {#if confirmClear}
        <p class="text-xs text-foreground mb-2" role="alert">
          Clear this conversation? Its messages, and the agent's memory of them, are removed. Your files stay as they are.
        </p>
        <div class="flex gap-2">
          <button
            onclick={() => confirmClear = false}
            class="flex-1 px-2 py-1.5 text-xs border border-border hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onclick={() => { messageStore.sendCommand(sessionId, '/clear'); contextExpanded = false; }}
            disabled={isRunning}
            class="flex-1 px-2 py-1.5 text-xs border border-destructive/60 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear
          </button>
        </div>
      {:else}
        <!-- Stacked: side by side, the labels wrapped onto two lines. -->
        <div class="flex flex-col gap-2">
          <button
            onclick={() => { messageStore.sendCommand(sessionId, '/compact'); contextExpanded = false; }}
            disabled={isRunning}
            class="w-full px-2 py-1.5 text-xs border border-border hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Replace the earlier messages with a summary, so the agent has room to keep going. It keeps the gist, not every detail. (/compact)"
          >
            Summarise to free space
          </button>
          <button
            onclick={() => confirmClear = true}
            disabled={isRunning}
            class="w-full px-2 py-1.5 text-xs border border-border hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Clear the conversation and start again with an empty context. Asks first. (/clear)"
          >
            Start fresh…
          </button>
        </div>
      {/if}
    </div>
  </StatusBarPopover>
{:else}
  <span class="ml-auto"></span>
{/if}
