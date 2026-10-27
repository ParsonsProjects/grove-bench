<script lang="ts">
  /**
   * The MCP drawer: each server's status, tools and context cost, with the
   * controls the conversation's agent supports. Its lozenge is the bar's
   * MCP · Skills one (StatusBarCapabilities), which opens it through
   * `drawerOpen` and shows the server count and health reported here.
   *
   * The drawer slides out on the right like the Skills drawer (a bits-ui
   * modal dialog), so it has room for long tool lists and errors. It is
   * drawn here rather than once in App, because the sign-in poll and its
   * notices belong to this thread and must outlive the drawer: close it
   * mid sign-in and the server still reconnects, and opening it again
   * shows where the sign-in got to. It closes when another thread opens.
   */
  import { onMount, onDestroy, untrack } from 'svelte';
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { fly, fade } from 'svelte/transition';
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
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import { prefersReducedMotion } from '$lib/utils.js';
  import XIcon from '@lucide/svelte/icons/x';
  import CopyButton from './CopyButton.svelte';

  /** ok = nothing down, partial = some down (orange), down = none connected (red). */
  type McpHealth = 'ok' | 'partial' | 'down';

  let {
    sessionId,
    count = $bindable(0),
    health = $bindable<McpHealth>('ok'),
    connected = $bindable(0),
    drawerOpen = $bindable(false),
  }: {
    sessionId: string;
    count?: number;
    health?: McpHealth;
    /** How many servers are connected. */
    connected?: number;
    drawerOpen?: boolean;
  } = $props();

  let session = $derived(store.sessions.find((s) => s.id === sessionId));
  let sessionStatus = $derived(session?.status);
  let sessionAgentType = $derived(session?.agentType);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  let systemInfo = $derived(messageStore.getSystemInfo(sessionId));
  const motion = prefersReducedMotion() ? 0 : 1;

  /** Live status, kept in the store so a reconnect main runs in the
   *  background (from another thread) shows here too. */
  let mcpServers = $derived(messageStore.getLiveMcpServers(sessionId));
  let mcpBusy = $state<Record<string, boolean>>({});
  let mcpError = $state<string | null>(null);
  /** Non-error guidance shown in the drawer (e.g. "finish signing in in your browser"). */
  let mcpNotice = $state<string | null>(null);
  /** Servers with a browser sign-in in flight; we poll until they connect. */
  let mcpSigningIn = $state<Record<string, boolean>>({});
  let mcpSignInPoll: ReturnType<typeof setInterval> | null = null;
  /** Servers whose sign-in page was opened. Once nothing reconnects them on
   *  their own, they get a Reconnect button to finish with. */
  let mcpSignInOpened = $state<Record<string, boolean>>({});
  /** A Refresh click in flight. */
  let mcpRefreshing = $state(false);
  /** Context-window cost per server, fetched while the drawer is open. */
  let mcpCost = $state<Record<string, McpServerContextCost>>({});
  /** Servers whose tool list is expanded in the drawer. */
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
  /** Rows for the drawer: live status when fetched, else what system_init
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
    if (drawerOpen && mcpControls.contextCost) void refreshMcpCost();
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
  // ends, so a server that dropped mid-turn shows up without opening the drawer.
  let mcpWasRunning = false;
  $effect(() => {
    const running = isRunning;
    const turnEnded = mcpWasRunning && !running;
    mcpWasRunning = running;
    if (turnEnded) untrack(() => { if (mcpRows.length > 0 || mcpControls.list) void refreshMcpServers(); });
  });

  // Not every agent reports its servers when it starts. One that can list
  // them gets asked once it is running, so the badge appears either way.
  let mcpListedOnStart = false;
  $effect(() => {
    if (sessionStatus !== 'running' || !mcpControls.list || mcpListedOnStart) return;
    mcpListedOnStart = true;
    untrack(() => { if (mcpKnown.length === 0) void refreshMcpServers(); });
  });

  // Opening the drawer starts clean and reads the servers' status afresh.
  let drawerWasOpen = false;
  $effect(() => {
    const open = drawerOpen;
    if (open && !drawerWasOpen) {
      untrack(() => {
        mcpError = null;
        void refreshMcpServers();
      });
    }
    drawerWasOpen = open;
  });

  // The drawer lists this thread's servers. Every pane stays mounted, so
  // when another thread opens with it up (Ctrl+Tab, say) it closes rather
  // than show this thread's servers over that one. It closes when the list
  // empties too, so it can't reopen by itself when servers come back.
  $effect(() => {
    if (drawerOpen && (store.activeSessionId !== sessionId || mcpRows.length === 0)) drawerOpen = false;
  });

  /** Focus goes back to the bar, unless another thread is now open: that
   *  thread has it, and this one's bar is hidden. */
  function keepOtherThreadFocus(e: Event) {
    if (store.activeSessionId !== sessionId) e.preventDefault();
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
    const checkSignIns = async () => {
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
    };
    mcpSignInPoll = setInterval(() => void checkSignIns(), MCP_SIGN_IN_POLL_MS);
  }

  function stopSignInPoll() {
    if (mcpSignInPoll) clearInterval(mcpSignInPoll);
    mcpSignInPoll = null;
  }

  $effect(() => { count = mcpRows.length; });
  $effect(() => { health = mcpHealth; });
  $effect(() => { connected = mcpConnectedCount; });

  onMount(() => {
    // The controls depend on what the agent supports (loaded once).
    void agentsStore.load();
  });

  onDestroy(() => {
    stopSignInPoll();
    // The pane goes when the agent stops: its live status goes with it, so
    // a resumed thread doesn't show the old agent's.
    messageStore.clearLiveMcpServers(sessionId);
  });
</script>

<DialogPrimitive.Root bind:open={drawerOpen}>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay forceMount>
      {#snippet child({ props, open })}
        {#if open}
          <div {...props} class="fixed inset-0 z-40 bg-black/40" transition:fade={{ duration: 150 * motion }}></div>
        {/if}
      {/snippet}
    </DialogPrimitive.Overlay>
    <DialogPrimitive.Content forceMount onCloseAutoFocus={keepOtherThreadFocus}>
      {#snippet child({ props, open })}
        {#if open}
          <div
            {...props}
            class="fixed top-0 right-0 z-50 h-full w-[32rem] max-w-[90vw] bg-card border-l border-border shadow-xl flex flex-col outline-none"
            transition:fly={{ x: 400, duration: 200 * motion }}
          >
            <PanelHeader>
              <DialogPrimitive.Title class="font-medium text-foreground">MCP servers</DialogPrimitive.Title>
              {#snippet actions()}
                <Button size="icon-2xs" variant="quiet" onclick={() => (drawerOpen = false)} title="Close (Esc)" aria-label="Close MCP servers">
                  <XIcon />
                </Button>
              {/snippet}
            </PanelHeader>
            <div class="flex-1 overflow-y-auto px-4 py-3 text-xs">
              {@render serverList()}
            </div>
          </div>
        {/if}
      {/snippet}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>

<!-- The drawer's body: how many are up and Refresh, any notice, then a row
     per server. -->
{#snippet serverList()}
  <div class="flex items-center justify-between mb-3">
    <span class="text-muted-foreground">{mcpConnectedCount} of {mcpRows.length} connected</span>
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

  <div class="space-y-3">
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
          <ul class="mt-1 ml-3.5 space-y-0.5 border-l border-border/60 pl-2">
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
{/snippet}
