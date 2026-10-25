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
  import { MCP_SIGN_IN_TIMEOUT_MS, isMcpServerDown, type McpServerContextCost, type McpServerInfo } from '../../shared/types.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
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

  /** Live status, kept in the store so a reconnect main runs in the
   *  background (from another thread) shows here too. */
  let mcpServers = $derived(messageStore.getLiveMcpServers(sessionId));
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
  let mcpDownCount = $derived(mcpStatuses.filter((s) => isMcpServerDown(s.status)).length);
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
        messageStore.updateMcpServers(sessionId, servers);
        return;
      }
    } catch {
      // fall through to the last known snapshot
    }
    // Live status unavailable (e.g. session stopped) — show the last known one
    messageStore.clearLiveMcpServers(sessionId);
  }

  /** Refresh also reconnects the servers that are down, here and in the
   *  other threads on this agent (in the background), so a sign-in finished
   *  anywhere reaches every thread without a restart. */
  async function refreshFromButton() {
    mcpRefreshing = true;
    mcpError = null;
    try {
      if (mcpControls.reconnect) await window.groveBench.reconnectDownMcpServers(sessionId).catch(() => {});
      await refreshMcpServers();
    } finally {
      mcpRefreshing = false;
    }
  }

  /** Once `name` is connected here after a sign-in or Reconnect, reconnect it
   *  in the other threads on this agent where it is still down. They share
   *  the sign-in but don't pick it up by themselves. Only live status counts:
   *  the last known one may be from before. */
  function reconnectElsewhere(name: string) {
    if (!mcpControls.reconnect) return;
    if (mcpServers.find((s) => s.name === name)?.status !== 'connected') return;
    window.groveBench.reconnectDownMcpServers(sessionId, name).catch(() => {});
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
    if (action === 'reconnect') reconnectElsewhere(name);
  }

  /** Poll interval while waiting for a browser sign-in to land (for up to
   *  MCP_SIGN_IN_TIMEOUT_MS). */
  const MCP_SIGN_IN_POLL_MS = 2000;

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
    let reconnected = false;
    try {
      const result = await window.groveBench.authenticateMcpServer(sessionId, name);
      if (!result.authUrl) {
        mcpNotice = `${name} did not need a browser sign-in. Reconnecting...`;
        await window.groveBench.reconnectMcpServer(sessionId, name).catch(() => {});
        reconnected = true;
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
      if (reconnected) reconnectElsewhere(name);
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
          if (status === 'connected') {
            mcpNotice = `${pending} signed in and connected.`;
            reconnectElsewhere(pending);
          }
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

  onDestroy(() => {
    stopSignInPoll();
    // The pane goes when the agent stops: its live status goes with it, so
    // a resumed thread doesn't show the old agent's.
    messageStore.clearLiveMcpServers(sessionId);
  });
</script>

{#if mcpRows.length > 0}
  <StatusBarPopover bind:open={mcpExpanded} anchored={false} panelClass="w-96">
    {#snippet trigger()}
      <button
        onclick={toggleMcpPopover}
        class="flex items-center gap-1 whitespace-nowrap transition-colors
          {mcpHealth === 'down' ? 'text-red-400 hover:text-red-300'
            : mcpHealth === 'partial' ? 'text-amber-500 hover:text-amber-400'
            : 'text-muted-foreground hover:text-foreground'}"
        title="MCP servers — click to manage connections{mcpDownCount > 0 ? ` (${mcpDownCount} down)` : ''}"
        aria-expanded={mcpExpanded}
      >
        <span class="w-1.5 h-1.5
          {mcpHealth === 'down' ? 'bg-red-500'
            : mcpHealth === 'partial' ? 'bg-amber-500'
            : 'bg-green-500'}"></span>
        MCP {mcpRows.length}
      </button>
    {/snippet}

    <div class="flex items-center justify-between mb-2">
      <span class="font-medium text-foreground">MCP Servers</span>
      {#if mcpControls.list}
        <Button
          variant="quiet"
          size="inline"
          onclick={refreshFromButton}
          disabled={mcpRefreshing}
          title="Reconnect servers that are down, here and in your other threads on this agent, then check each server's status"
        >
          {mcpRefreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      {/if}
    </div>

    {#if mcpError}
      <Notice tone="danger" class="mb-2 break-words">{mcpError}</Notice>
    {:else if mcpNotice}
      <Notice tone="warning" class="mb-2 break-words">{mcpNotice}</Notice>
    {/if}

    <div class="space-y-2 max-h-80 overflow-y-auto">
      {#each mcpRows as server (server.name)}
        {@const status = server.status}
        {@const source = server.origin}
        {@const cost = mcpCost[server.name]}
        {@const tools = server.tools ?? []}
        <div class="group">
          <div class="flex items-center gap-2">
            {#if status === 'pending'}
              <Pulse size="xs" />
            {:else}
              <span class="w-1.5 h-1.5 shrink-0
                {status === 'connected' ? 'bg-green-500'
                  : status === 'needs-auth' ? 'bg-amber-500'
                  : status === 'disabled' ? 'bg-muted-foreground/40'
                  : 'bg-red-500'}"
              ></span>
            {/if}
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="font-mono truncate text-foreground" title={server.name}>{server.name}</span>
                {#if source}
                  <Badge tone="muted">{source}</Badge>
                {/if}
              </div>
              <div class="text-muted-foreground text-micro flex items-center gap-1 flex-wrap">
                <span>{status}</span>
                {#if server.toolCount !== undefined}
                  <span>·</span>
                  {#if tools.length > 0}
                    <Button
                      variant="quiet"
                      size="inline"
                      onclick={() => (mcpToolsOpen = { ...mcpToolsOpen, [server.name]: !mcpToolsOpen[server.name] })}
                      class="underline decoration-dotted underline-offset-2"
                      title={mcpToolsOpen[server.name] ? 'Hide tools' : 'Show tools'}
                    >{server.toolCount} tool{server.toolCount === 1 ? '' : 's'}</Button>
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
                <Button
                  variant="subtle-primary"
                  size="2xs"
                  onclick={() => mcpAction(server.name, 'enable')}
                  disabled={mcpBusy[server.name]}
                  title="Connect this server again"
                >
                  Connect
                </Button>
              {/if}
            {:else}
              {#if status === 'needs-auth'}
                <!-- Reconnect can't start a sign-in (Claude Code rejects it
                     with "Server status: needs-auth"), so offer the sign-in first.
                     Reconnect finishes one the agent won't pick up by itself. -->
                {#if mcpControls.signIn}
                <Button
                  variant="default"
                  size="2xs"
                  onclick={() => mcpSignIn(server.name)}
                  disabled={mcpBusy[server.name] || mcpSigningIn[server.name]}
                  title={mcpNeedsAuthHint(server.name)}
                >
                  {mcpSigningIn[server.name] ? 'Waiting...' : 'Sign in'}
                </Button>
                {/if}
                {#if mcpControls.reconnect && mcpSignInOpened[server.name] && !mcpSigningIn[server.name]}
                <Button
                  variant="subtle"
                  size="2xs"
                  onclick={() => mcpAction(server.name, 'reconnect')}
                  disabled={mcpBusy[server.name]}
                  title="Connect again once you have signed in"
                >
                  Reconnect
                </Button>
                {/if}
              {:else if mcpControls.reconnect}
                <!-- Green after a failure, as the next thing to try. -->
                <Button
                  variant={status === 'failed' ? 'subtle-primary' : 'subtle'}
                  size="2xs"
                  onclick={() => mcpAction(server.name, 'reconnect')}
                  disabled={mcpBusy[server.name]}
                  title="Restart the connection to this server"
                >
                  Reconnect
                </Button>
              {/if}
              {#if mcpControls.toggle}
                <!-- How long a disconnect lasts is the agent's to say. -->
                <Button
                  variant="outline-destructive"
                  size="2xs"
                  onclick={() => mcpAction(server.name, 'disable')}
                  disabled={mcpBusy[server.name]}
                  title={mcpSupport?.disconnectHint ?? 'Disconnect this server'}
                >
                  Disconnect
                </Button>
              {/if}
            {/if}
          </div>

          {#if server.error}
            <div class="mt-1 ml-3.5 flex items-start gap-1 text-micro text-red-400">
              <span class="flex-1 min-w-0 break-words line-clamp-3 font-mono" title={server.error}>{server.error}</span>
              <CopyButton text={server.error} class="size-5 shrink-0" />
            </div>
          {/if}

          {#if mcpToolsOpen[server.name] && tools.length > 0}
            <ul class="mt-1 ml-3.5 space-y-0.5 max-h-40 overflow-y-auto border-l border-border/60 pl-2">
              {#each tools as tool (tool.name)}
                <li class="text-micro flex items-center gap-1 min-w-0" title={tool.description || tool.name}>
                  <span class="font-mono truncate text-foreground/90">{tool.name}</span>
                  {#if tool.destructive}
                    <Badge tone="danger">destructive</Badge>
                  {:else if tool.readOnly}
                    <Badge tone="muted">read-only</Badge>
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
