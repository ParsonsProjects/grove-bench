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
  import { store } from '../stores/sessions.svelte.js';
  import GroveEmptyState from './GroveEmptyState.svelte';
  import { conversationAgent } from '$lib/session-sprite-state.js';
  import { isCovered, sameBounds, toBounds, tooltipCovers } from '$lib/preview-viewport.js';
  import { loadErrorHint } from '$lib/preview-text.js';
  import { stripIpcErrorPrefix } from '$lib/mcp-errors.js';
  import { formatAge } from '$lib/format-age.js';
  import type { PreviewBounds } from '../../shared/types.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';

  /** `active`: this conversation is open and its Preview tab is showing. */
  let { sessionId, active }: { sessionId: string; active: boolean } = $props();

  let mode = $derived(previewStore.getMode(sessionId));
  let user = $derived(previewStore.getUser(sessionId));
  let agent = $derived(previewStore.getAgent(sessionId));
  let page = $derived(mode === 'user' ? user : agent);
  let detected = $derived(previewStore.getDetected(sessionId));
  let agentUnseen = $derived(previewStore.hasUnseenAgentActivity(sessionId));
  let agentToolsOn = $derived(settingsStore.current.previewAgentTools ?? true);
  let asleep = $derived(store.sessions.find((s) => s.id === sessionId)?.status === 'sleeping');
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

  // ─── The agent's page: poll for changed frames while it's on screen ───

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

  async function openForAgent(url: string) {
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
  <p class="text-xs mb-4">Open a local dev server, any web address, or an HTML file in this worktree. Links to localhost in the thread open here too; Ctrl+click opens them in your system browser.</p>
  {#if detected.length > 0}
    <SectionLabel class="mb-2">Seen in this thread</SectionLabel>
    <div class="flex flex-col gap-1 items-stretch">
      {#each [...detected].reverse() as url (url)}
        <button onclick={() => go('user', url)} class="px-3 py-1 text-xs font-mono border border-border bg-card hover:border-primary/60 hover:text-foreground truncate">
          {url}
        </button>
      {/each}
    </div>
  {:else}
    <p class="text-xs">Start a dev server in the Terminal tab (Alt+4), or ask the agent to, and its address will show up here.</p>
  {/if}
{/snippet}

{#snippet agentEmptyText()}
  {#if agentToolsOn && asleep}
    <p class="text-xs mb-4">The agent's page closes while the thread is asleep. It opens again when the agent next uses the browser.</p>
  {:else if agentToolsOn}
    <p class="text-xs mb-4">When the agent checks its work in the browser, its page shows here and updates as it clicks and types. It opens local pages only. Try asking: "start the dev server and check the page in the preview".</p>
  {:else}
    <p class="text-xs mb-4">The agent's browser tools are turned off in Settings → Agents (Grovekeepers), so the agent can't open pages here.</p>
  {/if}
  {#if detected.length > 0}
    <SectionLabel class="mb-2">Open for the agent</SectionLabel>
    <div class="flex flex-col gap-1 items-stretch">
      {#each [...detected].reverse() as url (url)}
        <button onclick={() => openForAgent(url)} class="px-3 py-1 text-xs font-mono border border-border bg-card hover:border-primary/60 hover:text-foreground truncate">
          {url}
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

<div class="flex flex-col h-full min-h-0">
  <!-- Toolbar. Not a PanelHeader (it holds the address field), so it
       matches one: same edge, fill, padding and height. -->
  <div class="flex items-center gap-1 px-3 py-1 min-h-8 border-b border-border bg-card/50 shrink-0">
    <Segmented.Root
      bind:value={() => mode, (v) => setMode(v as PreviewMode)}
      class="mr-1"
      aria-label="Which page to show"
    >
      <Segmented.Item value="user" title="Your page: browse and click around yourself">
        <UserIcon />
        Yours
      </Segmented.Item>
      <Segmented.Item value="agent" title="The agent's page: what it opened with its browser tools">
        <BotIcon />
        Agent's
        {#if agentUnseen && mode !== 'agent'}
          <span class="inline-block w-1.5 h-1.5 bg-primary" aria-label="New activity"></span>
        {/if}
      </Segmented.Item>
    </Segmented.Root>

    <Button size="icon-xs" variant="quiet" onclick={() => cmd('back')} disabled={!page?.canGoBack} title="Back (Alt+Left)" aria-label="Back">
      <ArrowLeftIcon />
    </Button>
    <Button size="icon-xs" variant="quiet" onclick={() => cmd('forward')} disabled={!page?.canGoForward} title="Forward (Alt+Right)" aria-label="Forward">
      <ArrowRightIcon />
    </Button>
    {#if page?.loading}
      <Button size="icon-xs" variant="quiet" onclick={() => cmd('stop')} title="Stop loading" aria-label="Stop loading">
        <XIcon />
      </Button>
    {:else}
      <Button size="icon-xs" variant="quiet" onclick={() => cmd('reload')} disabled={!page?.url} title="Reload (F5)" aria-label="Reload">
        <RotateCwIcon />
      </Button>
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
        placeholder={mode === 'user' ? 'localhost:3000, a URL, or a file in this worktree (Ctrl+L)' : "Local URL for the agent's page, e.g. localhost:5173"}
        aria-label="Address"
        class="block w-full h-6 bg-background border border-border px-2 py-0.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60"
      />
    </form>

    {#if mode === 'agent' && agent?.url}
      <Button size="xs" variant="subtle" onclick={openAgentPageInYours} title="Open this address in your page, where you can click around">
        <UserIcon />
        Open in yours
      </Button>
    {/if}
    <Button size="icon-xs" variant="quiet" onclick={() => page?.url && window.groveBench.openExternal(page.url)} disabled={!canOpenExternally} title="Open in system browser" aria-label="Open in system browser">
      <ExternalLinkIcon />
    </Button>
    <Button size="icon-xs" variant="quiet" onclick={() => cmd('devtools')} disabled={!page?.url} title="Developer tools (F12)" aria-label="Developer tools">
      <CodeXmlIcon />
    </Button>
  </div>

  {#if navError}
    <Notice tone="danger" class="shrink-0 border-b border-b-border">
      <p>{navError}</p>
    </Notice>
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
                <GroveEmptyState variant="agent" agent={groveAgent} tab="preview">
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
              <Button size="xs" onclick={() => cmd('reload')}>Reload</Button>
            </div>
          </div>
        {:else if user.error}
          <div class="h-full flex items-center justify-center p-6 text-center">
            <div class="max-w-md">
              <p class="text-sm text-foreground mb-1">Couldn't load the page</p>
              <p class="text-xs text-muted-foreground mb-1 break-all font-mono">{user.error.url}</p>
              <p class="text-xs text-muted-foreground mb-3">{loadErrorHint(user.error)}</p>
              <Button size="xs" onclick={() => cmd('reload')} disabled={user.loading}>
                {user.loading ? 'Loading…' : 'Try again'}
              </Button>
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
                <GroveEmptyState variant="agent" agent={groveAgent} tab="preview">
                  <!-- Full width, so long addresses truncate as without the scene. -->
                  <div class="mt-5 self-stretch">
                    <p class="text-sm text-foreground mb-1">The agent's page</p>
                    {@render agentEmptyText()}
                  </div>
                </GroveEmptyState>
              {:else}
                <BotIcon class="w-6 h-6 mx-auto mb-3 opacity-60" />
                <p class="text-sm text-foreground mb-1">The agent's page</p>
                {@render agentEmptyText()}
              {/if}
            </div>
          </div>
        {:else}
          <div class="flex-1 min-h-0 flex items-center justify-center p-2 overflow-hidden">
            {#if agent.error}
              <div class="max-w-md text-center">
                <p class="text-sm text-foreground mb-1">The agent's page couldn't load</p>
                <p class="text-xs text-muted-foreground mb-1 break-all font-mono">{agent.error.url}</p>
                <p class="text-xs text-muted-foreground">{loadErrorHint(agent.error)}</p>
              </div>
            {:else if agentFrame}
              <img src={agentFrame} alt="The agent's page" class="max-w-full max-h-full object-contain border border-border" draggable="false" />
            {:else}
              <span class="text-xs text-muted-foreground">Loading…</span>
            {/if}
          </div>
          <div class="flex items-center gap-2 px-3 py-1 border-t border-border text-caption text-muted-foreground shrink-0">
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
