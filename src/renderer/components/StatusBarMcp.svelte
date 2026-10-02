<script lang="ts">
  /**
   * The MCP badge and its popover: each server's status, tools and context
   * cost, with the controls the conversation's agent supports. Reports its
   * server count and health to the bar, which keeps a failing server in
   * view on a narrow bar.
   */
  import { onMount, onDestroy, untrack } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { formatMcpActionError, mcpNeedsAuthHint } from '../lib/mcp-errors.js';
  import { formatTokens } from '../lib/context-usage.js';
  import type { McpServerContextCost, McpServerInfo } from '../../shared/types.js';
  import CopyButton from './CopyButton.svelte';
  import StatusBarPopover from './StatusBarPopover.svelte';

  /** ok = nothing down, partial = some down (orange), down = none connected (red). */
  type McpHealth = 'ok' | 'partial' | 'down';

  let {
    sessionId,
    count = $bindable(0),
    health = $bindable<McpHealth>('ok'),
  }: { sessionId: string; count?: number; health?: McpHealth } = $props();

  let session = $derived(store.sessions.find((s) => s.id === sessionId));
  let sessionStatus = $derived(session?.status);
  let sessionAgentType = $derived(session?.agentType);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let systemInfo = $derived(messageStore.getSystemInfo(sessionId));
  let mcpExpanded = $state(false);

  let mcpServers = $state<McpServerInfo[]>([]);
  let mcpBusy = $state<Record<string, boolean>>({});
  let mcpError = $state<string | null>(null);
  /** Non-error guidance shown in the popup (e.g. "finish signing in in your browser"). */
  let mcpNotice = $state<string | null>(null);
  /** Servers with a browser sign-in in flight; we poll until they connect. */
  let mcpSigningIn = $state<Record<string, boolean>>({});
  let mcpSignInPoll: ReturnType<typeof setInterval> | null = null;
  /** Servers whose sign-in page was opened. Once nothing reconnects them on
   *  their own, they get a Reconnect button to finish with. */
  let mcpSignInOpened = $state<Record<string, boolean>>({});
  /** A Refresh click in flight. */
  let mcpRefreshing = $state(false);
  /** Context-window cost per server, fetched while the popover is open. */
  let mcpCost = $state<Record<string, McpServerContextCost>>({});
  /** Servers whose tool list is expanded in the popover. */
  let mcpToolsOpen = $state<Record<string, boolean>>({});
  let mcpKnown = $derived(systemInfo.mcpServers);
  /** What this conversation's agent supports for MCP. Until the agent list
   *  loads every control is offered, as before; once it has, an agent with no
   *  MCP support shows none. */
  let mcpSupport = $derived(agentsStore.loaded ? agentsStore.get(sessionAgentType ?? agentsStore.defaultId)?.mcp : undefined);
  let mcpControls = $derived(
    agentsStore.loaded
      ? mcpSupport?.controls ?? { list: false, reconnect: false, toggle: false, signIn: false, contextCost: false }
      : { list: true, reconnect: true, toggle: true, signIn: true, contextCost: true },
  );
  /** Rows for the popover: live status when fetched, else what system_init
   *  reported, normalized to the same shape. */
  let mcpRows = $derived<McpServerInfo[]>(
    mcpServers.length > 0
      ? mcpServers
      : mcpKnown.map((s) => ({ name: s.name, status: s.status as McpServerInfo['status'] })),
  );
  let mcpStatuses = $derived(mcpServers.length > 0 ? mcpServers : mcpKnown);
  let mcpDownCount = $derived(mcpStatuses.filter((s) => s.status === 'failed' || s.status === 'needs-auth').length);
  let mcpConnectedCount = $derived(mcpStatuses.filter((s) => s.status === 'connected').length);
  /** ok = nothing down, partial = mixed up/down (orange), down = nothing connected (red). */
  let mcpHealth = $derived<McpHealth>(
    mcpDownCount === 0 ? 'ok' : mcpConnectedCount > 0 ? 'partial' : 'down',
  );

  async function refreshMcpServers() {
    if (mcpExpanded && mcpControls.contextCost) refreshMcpCost();
    if (!mcpControls.list) return;
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

  async function refreshFromButton() {
    mcpRefreshing = true;
    try {
      await refreshMcpServers();
    } finally {
      mcpRefreshing = false;
    }
  }

  async function refreshMcpCost() {
    try {
      const costs = await window.groveBench.getMcpContextCost(sessionId);
      mcpCost = Object.fromEntries(costs.map((c) => [c.serverName, c]));
    } catch { /* keep the last figures */ }
  }

  // The status dot is only as fresh as the last fetch. Refresh when a turn
  // ends, so a server that dropped mid-turn shows up without opening the popover.
  let mcpWasRunning = false;
  $effect(() => {
    const running = isRunning;
    const turnEnded = mcpWasRunning && !running;
    mcpWasRunning = running;
    if (turnEnded) untrack(() => { if (mcpRows.length > 0 || mcpControls.list) refreshMcpServers(); });
  });

  // Not every agent reports its servers when it starts. One that can list
  // them gets asked once it is running, so the badge appears either way.
  let mcpListedOnStart = false;
  $effect(() => {
    if (sessionStatus !== 'running' || !mcpControls.list || mcpListedOnStart) return;
    mcpListedOnStart = true;
    untrack(() => { if (mcpKnown.length === 0) refreshMcpServers(); });
  });

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
    mcpNotice = null;
    try {
      if (action === 'reconnect') {
        await window.groveBench.reconnectMcpServer(sessionId, name);
      } else {
        await window.groveBench.setMcpServerEnabled(sessionId, name, action === 'enable');
      }
    } catch (e) {
      mcpError = formatMcpActionError(e, action, name);
    } finally {
      mcpBusy = { ...mcpBusy, [name]: false };
      await refreshMcpServers();
    }
  }

  /** Poll interval / budget while waiting for a browser sign-in to land. */
  const MCP_SIGN_IN_POLL_MS = 2000;
  const MCP_SIGN_IN_TIMEOUT_MS = 3 * 60 * 1000;

  /**
   * Kick off OAuth for a `needs-auth` server. The main process opens the auth
   * URL in the system browser. When the provider redirects back to the agent
   * (`callbackExpected`), the CLI finishes the handshake and reconnects on its
   * own, so we just poll status until the server leaves `needs-auth`. When it
   * doesn't (claude.ai connectors), nothing reconnects the server until the
   * user clicks Reconnect.
   */
  async function mcpSignIn(name: string) {
    mcpBusy = { ...mcpBusy, [name]: true };
    mcpError = null;
    mcpNotice = null;
    try {
      const result = await window.groveBench.authenticateMcpServer(sessionId, name);
      if (!result.authUrl) {
        mcpNotice = `${name} did not need a browser sign-in. Reconnecting...`;
        await window.groveBench.reconnectMcpServer(sessionId, name).catch(() => {});
        return;
      }
      mcpSignInOpened = { ...mcpSignInOpened, [name]: true };
      if (result.callbackExpected) {
        mcpNotice = `Finish signing in to ${name} in your browser. It will reconnect automatically.`;
        startSignInPoll(name);
      } else {
        mcpNotice = `Authorize ${name} in your browser, then click Reconnect.`;
      }
    } catch (e) {
      mcpError = formatMcpActionError(e, 'reconnect', name);
    } finally {
      mcpBusy = { ...mcpBusy, [name]: false };
      await refreshMcpServers();
    }
  }

  /** When each pending sign-in stops being waited on. */
  const mcpSignInDeadlines = new Map<string, number>();

  function startSignInPoll(name: string) {
    mcpSigningIn = { ...mcpSigningIn, [name]: true };
    mcpSignInDeadlines.set(name, Date.now() + MCP_SIGN_IN_TIMEOUT_MS);
    if (mcpSignInPoll) return; // one ticker serves every pending sign-in
    mcpSignInPoll = setInterval(async () => {
      await refreshMcpServers();
      for (const pending of Object.keys(mcpSigningIn)) {
        const status = mcpStatuses.find((s) => s.name === pending)?.status;
        const timedOut = Date.now() > (mcpSignInDeadlines.get(pending) ?? 0);
        if (status && status !== 'needs-auth' && status !== 'pending') {
          const { [pending]: _, ...rest } = mcpSigningIn;
          mcpSigningIn = rest;
          mcpSignInDeadlines.delete(pending);
          if (status === 'connected') mcpNotice = `${pending} signed in and connected.`;
        } else if (timedOut) {
          const { [pending]: _, ...rest } = mcpSigningIn;
          mcpSigningIn = rest;
          mcpSignInDeadlines.delete(pending);
          mcpNotice = `Still waiting on ${pending}. Finish signing in, then click Reconnect.`;
        }
      }
      if (Object.keys(mcpSigningIn).length === 0) stopSignInPoll();
    }, MCP_SIGN_IN_POLL_MS);
  }

  function stopSignInPoll() {
    if (mcpSignInPoll) clearInterval(mcpSignInPoll);
    mcpSignInPoll = null;
  }

  $effect(() => { count = mcpRows.length; });
  $effect(() => { health = mcpHealth; });

  onMount(() => {
    // The controls depend on what the agent supports (loaded once).
    agentsStore.load();
  });

  onDestroy(stopSignInPoll);
</script>

{#if mcpRows.length > 0}
  <StatusBarPopover bind:open={mcpExpanded} anchored={false} panelClass="bg-popover border border-border shadow-xl p-3 text-xs w-96">
    {#snippet trigger()}
      <button
        onclick={toggleMcpPopover}
        class="flex items-center gap-1 whitespace-nowrap transition-colors
          {mcpHealth === 'down' ? 'text-red-400 hover:text-red-300'
            : mcpHealth === 'partial' ? 'text-orange-400 hover:text-orange-300'
            : 'text-muted-foreground hover:text-foreground'}"
        title="MCP servers — click to manage connections{mcpDownCount > 0 ? ` (${mcpDownCount} down)` : ''}"
        aria-expanded={mcpExpanded}
      >
        <span class="w-1.5 h-1.5
          {mcpHealth === 'down' ? 'bg-red-500'
            : mcpHealth === 'partial' ? 'bg-orange-400'
            : 'bg-green-500'}"></span>
        MCP {mcpRows.length}
      </button>
    {/snippet}

    <div class="flex items-center justify-between mb-2">
      <span class="font-medium text-foreground">MCP Servers</span>
      {#if mcpControls.list}
        <button
          onclick={refreshFromButton}
          disabled={mcpRefreshing}
          class="text-muted-foreground/60 hover:text-foreground transition-colors disabled:opacity-50"
          title="Check each server's status again (does not reconnect)"
        >
          {mcpRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      {/if}
    </div>

    {#if mcpError}
      <div class="text-destructive mb-2 break-words">{mcpError}</div>
    {:else if mcpNotice}
      <div class="text-yellow-500 mb-2 break-words">{mcpNotice}</div>
    {/if}

    <div class="space-y-2 max-h-80 overflow-y-auto">
      {#each mcpRows as server (server.name)}
        {@const status = server.status}
        {@const source = server.origin}
        {@const cost = mcpCost[server.name]}
        {@const tools = server.tools ?? []}
        <div class="group">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 shrink-0
              {status === 'connected' ? 'bg-green-500'
                : status === 'pending' ? 'bg-yellow-400 animate-pulse'
                : status === 'needs-auth' ? 'bg-yellow-500'
                : status === 'disabled' ? 'bg-muted-foreground/40'
                : 'bg-red-500'}"
            ></span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="font-mono truncate text-foreground" title={server.name}>{server.name}</span>
                {#if source}
                  <span class="shrink-0 text-[9px] text-muted-foreground border border-border/60 px-1 leading-tight">{source}</span>
                {/if}
              </div>
              <div class="text-muted-foreground/60 text-[10px] flex items-center gap-1 flex-wrap">
                <span>{status}</span>
                {#if server.toolCount !== undefined}
                  <span>·</span>
                  {#if tools.length > 0}
                    <button
                      onclick={() => (mcpToolsOpen = { ...mcpToolsOpen, [server.name]: !mcpToolsOpen[server.name] })}
                      class="hover:text-foreground underline decoration-dotted underline-offset-2"
                      title={mcpToolsOpen[server.name] ? 'Hide tools' : 'Show tools'}
                    >{server.toolCount} tool{server.toolCount === 1 ? '' : 's'}</button>
                  {:else}
                    <span>{server.toolCount} tool{server.toolCount === 1 ? '' : 's'}</span>
                  {/if}
                {/if}
                {#if cost && cost.tokens > 0}
                  <span>·</span>
                  <span title="Context used by this server's tool definitions (estimate)">~{formatTokens(cost.tokens)} tokens</span>
                {:else if cost && cost.deferredTokens > 0}
                  <span>·</span>
                  <span title="The agent loads these tools only when it searches for them">loaded on demand</span>
                {/if}
              </div>
            </div>
            <!-- Only the controls this agent supports (see McpSupport). -->
            {#if status === 'disabled'}
              {#if mcpControls.toggle}
                <button
                  onclick={() => mcpAction(server.name, 'enable')}
                  disabled={mcpBusy[server.name]}
                  class="px-1.5 py-0.5 border border-border text-green-400 hover:bg-green-400/10 transition-colors shrink-0 disabled:opacity-50"
                  title="Connect this server again"
                >
                  Connect
                </button>
              {/if}
            {:else}
              {#if status === 'needs-auth'}
                <!-- Reconnect can't start a sign-in (Claude Code rejects it
                     with "Server status: needs-auth"), so offer the sign-in first.
                     Reconnect finishes one the agent won't pick up by itself. -->
                {#if mcpControls.signIn}
                <button
                  onclick={() => mcpSignIn(server.name)}
                  disabled={mcpBusy[server.name] || mcpSigningIn[server.name]}
                  class="px-1.5 py-0.5 border border-yellow-500/40 text-yellow-500 hover:bg-yellow-500/10 transition-colors shrink-0 disabled:opacity-50"
                  title={mcpNeedsAuthHint(server.name)}
                >
                  {mcpSigningIn[server.name] ? 'Waiting...' : 'Sign in'}
                </button>
                {/if}
                {#if mcpControls.reconnect && mcpSignInOpened[server.name] && !mcpSigningIn[server.name]}
                <button
                  onclick={() => mcpAction(server.name, 'reconnect')}
                  disabled={mcpBusy[server.name]}
                  class="px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 disabled:opacity-50"
                  title="Connect again once you have signed in"
                >
                  Reconnect
                </button>
                {/if}
              {:else if mcpControls.reconnect}
                <button
                  onclick={() => mcpAction(server.name, 'reconnect')}
                  disabled={mcpBusy[server.name]}
                  class="px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 disabled:opacity-50"
                  title="Restart the connection to this server"
                >
                  Reconnect
                </button>
              {/if}
              {#if mcpControls.toggle}
                <!-- How long a disconnect lasts is the agent's to say. -->
                <button
                  onclick={() => mcpAction(server.name, 'disable')}
                  disabled={mcpBusy[server.name]}
                  class="px-1.5 py-0.5 border border-border text-destructive hover:bg-destructive/10 transition-colors shrink-0 disabled:opacity-50"
                  title={mcpSupport?.disconnectHint ?? 'Disconnect this server'}
                >
                  Disconnect
                </button>
              {/if}
            {/if}
          </div>

          {#if server.error}
            <div class="mt-1 ml-3.5 flex items-start gap-1 text-[10px] text-red-400/90">
              <span class="flex-1 min-w-0 break-words line-clamp-3 font-mono" title={server.error}>{server.error}</span>
              <CopyButton text={server.error} class="size-5 shrink-0" />
            </div>
          {/if}

          {#if mcpToolsOpen[server.name] && tools.length > 0}
            <ul class="mt-1 ml-3.5 space-y-0.5 max-h-40 overflow-y-auto border-l border-border/60 pl-2">
              {#each tools as tool (tool.name)}
                <li class="text-[10px] flex items-center gap-1 min-w-0" title={tool.description || tool.name}>
                  <span class="font-mono truncate text-foreground/90">{tool.name}</span>
                  {#if tool.destructive}
                    <span class="shrink-0 text-[9px] text-red-400 border border-red-400/40 px-1 leading-tight">destructive</span>
                  {:else if tool.readOnly}
                    <span class="shrink-0 text-[9px] text-muted-foreground border border-border/60 px-1 leading-tight">read-only</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  </StatusBarPopover>
{/if}
