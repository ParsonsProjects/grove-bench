<script lang="ts">
  import { tick } from 'svelte';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
  import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
  import XIcon from '@lucide/svelte/icons/x';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import CodeXmlIcon from '@lucide/svelte/icons/code-xml';
  import UserIcon from '@lucide/svelte/icons/user';
  import BotIcon from '@lucide/svelte/icons/bot';
  import GlobeIcon from '@lucide/svelte/icons/globe';
  import { previewStore, type PreviewMode } from '../stores/preview.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import GroveEmptyState from './GroveEmptyState.svelte';
  import { conversationAgent } from '$lib/session-sprite-state.js';
  import { isCovered, sameBounds, toBounds, tooltipCovers } from '$lib/preview-viewport.js';
  import { loadErrorHint } from '$lib/preview-text.js';
  import { stripIpcErrorPrefix } from '$lib/mcp-errors.js';
  import { formatAge } from '$lib/format-age.js';
  import type { PreviewBounds } from '../../shared/types.js';

  /** `active`: this conversation is open and its Preview tab is showing. */
  let { sessionId, active }: { sessionId: string; active: boolean } = $props();

  let mode = $derived(previewStore.getMode(sessionId));
  let user = $derived(previewStore.getUser(sessionId));
  let agent = $derived(previewStore.getAgent(sessionId));
  let page = $derived(mode === 'user' ? user : agent);
  let detected = $derived(previewStore.getDetected(sessionId));
  let agentUnseen = $derived(previewStore.hasUnseenAgentActivity(sessionId));
  let agentToolsOn = $derived(settingsStore.current.previewAgentTools ?? true);
  /** The conversation's agent on its bench above the empty pages' text. */
  let groveAgent = $derived(settingsStore.current.groveCharacters ? conversationAgent(sessionId) : null);

  let address = $state('');
  let addressFocused = $state(false);
  let addressEl: HTMLInputElement | undefined = $state();
  let navError = $state('');
  let hostEl: HTMLDivElement | undefined = $state();
  /** Picture of your page shown in its place while an overlay covers it. */
  let snapshot = $state<string | null>(null);
  let agentFrame = $state<string | null>(null);
  /** Re-render "3s ago" labels. */
  let now = $state(Date.now());

  let canOpenExternally = $derived(!!page?.url && /^https?:/i.test(page.url));

  // Keep the address bar on the page's URL unless the user is editing it.
  $effect(() => {
    const url = page?.url ?? '';
    if (!addressFocused) address = url === 'about:blank' ? '' : url;
  });

  $effect(() => {
    // Switching pages clears a stale error from the other one.
    void mode;
    navError = '';
  });

  $effect(() => previewStore.onFocusAddress(sessionId, () => {
    addressEl?.focus();
    addressEl?.select();
  }));

  // ─── Your page: keep the native view over the content area ───

  let userShowable = $derived(!!user?.url && !user.error && !user.crashed);
  let showUserView = $derived(active && mode === 'user' && userShowable);

  $effect(() => {
    if (!showUserView || !hostEl) return;
    const host = hostEl;
    let disposed = false;
    let raf = 0;
    /** What the main process is showing: bounds, or null for hidden. */
    let shown: PreviewBounds | null = null;
    let lastBounds: PreviewBounds | null = null;
    let hiding = false;
    let covered = false;
    let coverDirty = true;
    let lastCoverCheck = 0;

    // Menus and dialogs appear as DOM changes; re-check coverage after them.
    const observer = new MutationObserver(() => { coverDirty = true; });
    observer.observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open', 'data-state'],
    });

    const hideWithSnapshot = async () => {
      hiding = true;
      const url = await window.groveBench.previewSnapshot(sessionId).catch(() => null);
      if (disposed) return;
      if (url) {
        // Decode first so the picture is ready the moment the page goes away.
        const img = new Image();
        img.src = url;
        await img.decode().catch(() => {});
        if (disposed) return;
        snapshot = url;
        await tick();
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        if (disposed) return;
      }
      window.groveBench.previewSetViewport(sessionId, null);
      shown = null;
      hiding = false;
    };

    const frame = (time: number) => {
      raf = requestAnimationFrame(frame);
      if (hiding) return;
      const bounds = toBounds(host.getBoundingClientRect());
      const moved = !sameBounds(bounds, lastBounds);
      lastBounds = bounds;
      if (bounds && (moved || (coverDirty && time - lastCoverCheck > 60))) {
        covered = isCovered(bounds, host, (x, y) => document.elementFromPoint(x, y)) || tooltipCovers(bounds, document);
        coverDirty = false;
        lastCoverCheck = time;
      }
      const want = bounds && !covered ? bounds : null;
      if (sameBounds(want, shown)) return;
      if (want) {
        window.groveBench.previewSetViewport(sessionId, want);
        shown = want;
        // Drop the stand-in picture once the page is back on top of it.
        setTimeout(() => { if (!disposed && shown) snapshot = null; }, 150);
      } else if (shown && covered) {
        hideWithSnapshot();
      } else {
        window.groveBench.previewSetViewport(sessionId, null);
        shown = null;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.groveBench.previewSetViewport(sessionId, null);
      snapshot = null;
    };
  });

  // ─── Claude's page: poll for changed frames while it's on screen ───

  $effect(() => {
    if (!active || mode !== 'agent') return;
    previewStore.setWatchingAgent(sessionId, true);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let version = -1;
    const poll = async () => {
      if (stopped) return;
      try {
        const frame = await window.groveBench.previewAgentFrame(sessionId, version);
        if (frame && !stopped) {
          version = frame.version;
          agentFrame = frame.dataUrl;
        }
      } catch { /* page closed */ }
      if (!stopped) timer = setTimeout(poll, 400);
    };
    poll();
    const clock = setInterval(() => { now = Date.now(); }, 5000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(clock);
      previewStore.setWatchingAgent(sessionId, false);
    };
  });

  $effect(() => {
    if (!agent?.url) agentFrame = null;
  });

  // ─── Actions ───

  function errorText(err: unknown): string {
    return stripIpcErrorPrefix(err instanceof Error ? err.message : String(err));
  }

  async function go(target: PreviewMode, url: string) {
    navError = '';
    try {
      await previewStore.navigate(sessionId, target, url);
      return true;
    } catch (err) {
      navError = errorText(err);
      return false;
    }
  }

  async function submitAddress(e: SubmitEvent) {
    e.preventDefault();
    if (!address.trim()) return;
    if (await go(mode, address)) addressEl?.blur();
  }

  function setMode(next: PreviewMode) {
    previewStore.setMode(sessionId, next);
  }

  async function openAgentPageInYours() {
    if (!agent?.url) return;
    if (await go('user', agent.url)) setMode('user');
  }

  async function openForClaude(url: string) {
    if (await go('agent', url)) setMode('agent');
  }

  function cmd(command: 'back' | 'forward' | 'reload' | 'stop' | 'devtools') {
    previewStore.command(sessionId, mode, command);
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (!active) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if ((ctrl && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'l') || (e.altKey && !ctrl && e.key.toLowerCase() === 'd')) {
      e.preventDefault();
      addressEl?.focus();
      addressEl?.select();
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#snippet userEmptyText()}
  <p class="text-xs mb-4">Open a local dev server, any web address, or an HTML file in this worktree. Links to localhost in the conversation open here too; Ctrl+click opens them in your system browser.</p>
  {#if detected.length > 0}
    <p class="text-[10px] uppercase tracking-wide mb-2">Seen in this conversation</p>
    <div class="flex flex-col gap-1 items-stretch">
      {#each [...detected].reverse() as url (url)}
        <button onclick={() => go('user', url)} class="px-3 py-1 text-xs font-mono border border-border bg-card hover:border-primary/60 hover:text-foreground truncate">
          {url}
        </button>
      {/each}
    </div>
  {:else}
    <p class="text-xs">Start a dev server in the Terminal tab (Alt+4), or ask Claude to, and its address will show up here.</p>
  {/if}
{/snippet}

{#snippet agentEmptyText()}
  {#if agentToolsOn}
    <p class="text-xs mb-4">When Claude checks its work in the browser, its page shows here and updates as it clicks and types. It opens local pages only. Try asking: "start the dev server and check the page in the preview".</p>
  {:else}
    <p class="text-xs mb-4">The agent's browser tools are turned off in Settings, so Claude can't open pages here.</p>
  {/if}
  {#if detected.length > 0}
    <p class="text-[10px] uppercase tracking-wide mb-2">Open for Claude</p>
    <div class="flex flex-col gap-1 items-stretch">
      {#each [...detected].reverse() as url (url)}
        <button onclick={() => openForClaude(url)} class="px-3 py-1 text-xs font-mono border border-border bg-card hover:border-primary/60 hover:text-foreground truncate">
          {url}
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

<div class="flex flex-col h-full min-h-0">
  <!-- Toolbar -->
  <div class="flex items-center gap-1 px-2 py-1 border-b border-border bg-card/50 shrink-0">
    <div class="flex items-center border border-border mr-1" role="group" aria-label="Which page to show">
      <button
        onclick={() => setMode('user')}
        class="flex items-center gap-1 px-2 py-0.5 text-xs transition-colors {mode === 'user' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}"
        title="Your page: browse and click around yourself"
        aria-pressed={mode === 'user'}
      >
        <UserIcon class="w-3 h-3" />
        Yours
      </button>
      <button
        onclick={() => setMode('agent')}
        class="flex items-center gap-1 px-2 py-0.5 text-xs transition-colors {mode === 'agent' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}"
        title="Claude's page: what the agent opened with its browser tools"
        aria-pressed={mode === 'agent'}
      >
        <BotIcon class="w-3 h-3" />
        Claude's
        {#if agentUnseen && mode !== 'agent'}
          <span class="inline-block w-1.5 h-1.5 bg-primary" aria-label="New activity"></span>
        {/if}
      </button>
    </div>

    <button onclick={() => cmd('back')} disabled={!page?.canGoBack} class="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground" title="Back (Alt+Left)" aria-label="Back">
      <ArrowLeftIcon class="w-3.5 h-3.5" />
    </button>
    <button onclick={() => cmd('forward')} disabled={!page?.canGoForward} class="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground" title="Forward (Alt+Right)" aria-label="Forward">
      <ArrowRightIcon class="w-3.5 h-3.5" />
    </button>
    {#if page?.loading}
      <button onclick={() => cmd('stop')} class="p-1 text-muted-foreground hover:text-foreground" title="Stop loading" aria-label="Stop loading">
        <XIcon class="w-3.5 h-3.5" />
      </button>
    {:else}
      <button onclick={() => cmd('reload')} disabled={!page?.url} class="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground" title="Reload (F5)" aria-label="Reload">
        <RotateCwIcon class="w-3.5 h-3.5" />
      </button>
    {/if}

    <form class="flex-1 min-w-0" onsubmit={submitAddress}>
      <input
        bind:this={addressEl}
        bind:value={address}
        onfocus={() => { addressFocused = true; }}
        onblur={() => { addressFocused = false; }}
        onkeydown={(e) => { if (e.key === 'Escape') { addressEl?.blur(); } }}
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder={mode === 'user' ? 'localhost:3000, a URL, or a file in this worktree (Ctrl+L)' : "Local URL for Claude's page, e.g. localhost:5173"}
        aria-label="Address"
        class="w-full bg-background border border-border px-2 py-0.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/60"
      />
    </form>

    {#if mode === 'agent' && agent?.url}
      <button onclick={openAgentPageInYours} class="flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground border border-border" title="Open this address in your page, where you can click around">
        <UserIcon class="w-3 h-3" />
        Open in yours
      </button>
    {/if}
    <button onclick={() => page?.url && window.groveBench.openExternal(page.url)} disabled={!canOpenExternally} class="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground" title="Open in system browser" aria-label="Open in system browser">
      <ExternalLinkIcon class="w-3.5 h-3.5" />
    </button>
    <button onclick={() => cmd('devtools')} disabled={!page?.url} class="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground" title="Developer tools (F12)" aria-label="Developer tools">
      <CodeXmlIcon class="w-3.5 h-3.5" />
    </button>
  </div>

  {#if navError}
    <div class="px-3 py-1 text-xs text-destructive border-b border-border bg-destructive/10 shrink-0" role="alert">{navError}</div>
  {/if}

  <!-- Page area -->
  <div class="flex-1 min-h-0 relative">
    {#if mode === 'user'}
      <div bind:this={hostEl} class="absolute inset-0 overflow-hidden bg-background">
        {#if !user?.url && user?.loading}
          <div class="h-full flex items-center justify-center text-xs text-muted-foreground">Loading…</div>
        {:else if !user?.url}
          <!-- m-auto rather than centring the flex box, so a long list still
               scrolls to its top. -->
          <div class="pixel-bg h-full flex p-6 overflow-auto">
            <div class="m-auto max-w-md text-center text-muted-foreground">
              {#if groveAgent}
                <GroveEmptyState variant="agent" agent={groveAgent}>
                  <!-- Full width, so long addresses truncate as without the scene. -->
                  <div class="mt-5 self-stretch">
                    <p class="text-sm text-foreground mb-1">Preview your app</p>
                    {@render userEmptyText()}
                  </div>
                </GroveEmptyState>
              {:else}
                <GlobeIcon class="w-6 h-6 mx-auto mb-3 opacity-60" />
                <p class="text-sm text-foreground mb-1">Preview your app</p>
                {@render userEmptyText()}
              {/if}
            </div>
          </div>
        {:else if user.crashed}
          <div class="h-full flex items-center justify-center p-6 text-center">
            <div class="max-w-md">
              <p class="text-sm text-foreground mb-1">The page stopped working.</p>
              <p class="text-xs text-muted-foreground mb-3 break-all">{user.url}</p>
              <button onclick={() => cmd('reload')} class="text-xs px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90">Reload</button>
            </div>
          </div>
        {:else if user.error}
          <div class="h-full flex items-center justify-center p-6 text-center">
            <div class="max-w-md">
              <p class="text-sm text-foreground mb-1">Couldn't load the page</p>
              <p class="text-xs text-muted-foreground mb-1 break-all font-mono">{user.error.url}</p>
              <p class="text-xs text-muted-foreground mb-3">{loadErrorHint(user.error)}</p>
              <button onclick={() => cmd('reload')} disabled={user.loading} class="text-xs px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {user.loading ? 'Loading…' : 'Try again'}
              </button>
            </div>
          </div>
        {:else}
          <!-- The page itself is a native view placed over this box. -->
          <div class="h-full flex items-center justify-center text-xs text-muted-foreground">Loading…</div>
        {/if}
        {#if snapshot}
          <img src={snapshot} alt="" class="absolute inset-0 w-full h-full" draggable="false" />
        {/if}
      </div>
    {:else}
      <div class="absolute inset-0 flex flex-col bg-background">
        {#if !agent?.url}
          <div class="pixel-bg flex-1 flex p-6 overflow-auto">
            <div class="m-auto max-w-md text-center text-muted-foreground">
              {#if groveAgent}
                <GroveEmptyState variant="agent" agent={groveAgent}>
                  <!-- Full width, so long addresses truncate as without the scene. -->
                  <div class="mt-5 self-stretch">
                    <p class="text-sm text-foreground mb-1">Claude's page</p>
                    {@render agentEmptyText()}
                  </div>
                </GroveEmptyState>
              {:else}
                <BotIcon class="w-6 h-6 mx-auto mb-3 opacity-60" />
                <p class="text-sm text-foreground mb-1">Claude's page</p>
                {@render agentEmptyText()}
              {/if}
            </div>
          </div>
        {:else}
          <div class="flex-1 min-h-0 flex items-center justify-center p-2 overflow-hidden">
            {#if agent.error}
              <div class="max-w-md text-center">
                <p class="text-sm text-foreground mb-1">Claude's page couldn't load</p>
                <p class="text-xs text-muted-foreground mb-1 break-all font-mono">{agent.error.url}</p>
                <p class="text-xs text-muted-foreground">{loadErrorHint(agent.error)}</p>
              </div>
            {:else if agentFrame}
              <img src={agentFrame} alt="Claude's page" class="max-w-full max-h-full object-contain border border-border shadow-sm" draggable="false" />
            {:else}
              <span class="text-xs text-muted-foreground">Loading…</span>
            {/if}
          </div>
          <div class="flex items-center gap-2 px-3 py-1 border-t border-border text-[11px] text-muted-foreground shrink-0">
            <BotIcon class="w-3 h-3 shrink-0" />
            {#if agent.size}<span class="tabular-nums shrink-0">{agent.size.width}×{agent.size.height}</span>{/if}
            {#if agent.lastAction}
              <span class="truncate min-w-0">· {agent.lastAction.text}</span>
              {#key now}<span class="shrink-0">{formatAge(agent.lastAction.at)}</span>{/key}
            {/if}
            <span class="ml-auto shrink-0">View only</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
