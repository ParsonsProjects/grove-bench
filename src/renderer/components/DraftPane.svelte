<script lang="ts">
  /**
   * The main pane for a draft conversation: what will happen, the draft's
   * status bar (agent, model, mode, where it runs) and the message box.
   * Sending the first message starts the conversation. Replaces the old
   * New Conversation dialog.
   */
  import { onMount } from 'svelte';
  import { store } from '../stores/sessions.svelte.js';
  import { draftStore } from '../stores/draft.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { prerequisitesStore } from '../stores/prerequisites.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { agentReady } from '../../shared/prerequisites.js';
  import ApiKeyField from './ApiKeyField.svelte';
  import GroveEmptyState from './GroveEmptyState.svelte';
  import DraftStatusBar from './DraftStatusBar.svelte';
  import { Button } from '$lib/components/ui/button/index.js';

  let textEl = $state<HTMLTextAreaElement | null>(null);

  const draft = $derived(draftStore.draft);
  const agentId = $derived(draft?.agentId ?? '');
  const agentName = $derived(agentsStore.get(agentId)?.displayName ?? agentId);
  const agentStatus = $derived(agentId ? store.prerequisites?.agents[agentId] : undefined);

  // Credentials are checked here, not at app startup. A cached "ready" is
  // trusted (a bad key still surfaces as an auth error in the conversation);
  // anything else gets a fresh check before the key form shows.
  // Whether loading the agent list has finished (or failed), so a draft with
  // no agent shows why instead of waiting forever.
  let agentsTried = $state(agentsStore.loaded);
  const credentials = $derived.by(() => {
    const status = store.prerequisites;
    if (status && agentId && agentReady(status, agentId)) return 'ready';
    if (!agentId) return agentsTried ? 'no-agent' : 'checking';
    if (prerequisitesStore.checking) return 'checking';
    return 'missing';
  });

  function retryAgents() {
    agentsTried = false;
    agentsStore.refresh().finally(() => {
      agentsTried = true;
      void draftStore.loadAgentInfo();
    });
  }

  // One fresh check per agent, as soon as we know which agent is meant.
  let checkedFor = '';
  $effect(() => {
    if (!agentId || checkedFor === agentId) return;
    checkedFor = agentId;
    if (credentials !== 'ready') prerequisitesStore.refresh();
  });

  const start = $derived(draft?.start);
  const canStart = $derived(
    !!draft && credentials === 'ready' && !draftStore.starting
      && (start?.kind !== 'existing' || !!start.branch),
  );

  /** One line on what sending will do, so nothing about it is a surprise. */
  const plan = $derived.by(() => {
    if (!start) return '';
    if (start.kind === 'folder') return 'The agent will work in the project folder itself, on the branch it has checked out.';
    if (start.kind === 'existing') {
      return start.pr
        ? `The agent will open pull request #${start.pr.number} (${start.branch}) in a separate copy.`
        : `The agent will open ${start.branch} in a separate copy.`;
    }
    const from = start.baseBranch.trim() || 'the default branch';
    return start.branchName.trim()
      ? `The agent will work on a new branch, ${start.branchName.trim()}, from ${from}, in a separate copy.`
      : `The agent will work on a new branch from ${from}, in a separate copy. The branch is named from your message after the first reply.`;
  });

  onMount(() => {
    agentsStore.load().finally(() => { agentsTried = true; });
    textEl?.focus();
  });

  // Focus the message box once credentials are sorted.
  $effect(() => {
    if (credentials === 'ready') textEl?.focus();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (canStart) draftStore.start();
    }
  }
</script>

{#if draft}
<div class="flex flex-col h-full bg-background">
  <div class="flex items-center gap-2 border-b border-border bg-card/50 shrink-0 px-4 py-1.5 text-xs">
    <span class="font-medium text-foreground">New conversation</span>
    <span class="text-muted-foreground/60">in {store.repoDisplayName(draft.repoPath)}{agentName ? ` · ${agentName}` : ''}</span>
    <button
      type="button"
      onclick={() => draftStore.discard()}
      class="ml-auto text-muted-foreground hover:text-foreground transition-colors"
      title="Discard this draft"
    >
      Discard
    </button>
  </div>

  <div class="pixel-bg flex-1 min-h-0 flex items-center justify-center text-muted-foreground relative overflow-y-auto px-6">
    {#if credentials === 'checking'}
      <div class="flex items-center gap-2 text-sm relative z-10">
        <span class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
        Checking credentials…
      </div>
    {:else if credentials === 'no-agent'}
      <div class="relative z-10 w-full max-w-sm flex flex-col gap-3 bg-background border border-border p-4">
        <p class="text-sm text-foreground">No agent is available to start this conversation.</p>
        <p class="text-xs text-muted-foreground">Grove Bench couldn't load its list of agents. Try again, or restart the app if it keeps happening.</p>
        <div class="flex justify-end">
          <Button variant="secondary" size="sm" onclick={retryAgents}>Try again</Button>
        </div>
      </div>
    {:else if credentials === 'missing'}
      <div class="relative z-10 w-full max-w-sm flex flex-col gap-3 bg-background border border-border p-4">
        <p class="text-sm text-foreground">Add credentials for {agentName} to start.</p>
        {#if agentStatus?.apiKey}
          {#key agentId}
            <ApiKeyField adapterId={agentId} autofocus />
          {/key}
          <p class="text-xs text-muted-foreground">Signed in with the CLI in a terminal instead? Re-check.</p>
        {:else}
          <p class="text-sm text-muted-foreground">
            {agentStatus?.authErrorMessage ?? agentStatus?.errorMessage ?? 'Could not check the agent\'s credentials.'}
          </p>
        {/if}
        <div class="flex justify-end">
          <Button variant="secondary" size="sm" onclick={() => prerequisitesStore.refresh()}>Re-check</Button>
        </div>
      </div>
    {:else if settingsStore.current.groveCharacters}
      <GroveEmptyState variant="draft">
        <p class="text-sm mt-5 mb-2 text-foreground/80">New conversation in {store.repoDisplayName(draft.repoPath)}</p>
        <p class="text-xs text-muted-foreground max-w-md">{plan}</p>
        <p class="text-xs text-muted-foreground/70 mt-2 max-w-md">Change the agent, model, mode or branch in the bar below before you send.</p>
      </GroveEmptyState>
    {:else}
      <div class="relative z-10 text-center">
        <p class="text-sm mb-2 text-foreground/80">New conversation in {store.repoDisplayName(draft.repoPath)}</p>
        <p class="text-xs max-w-md">{plan}</p>
      </div>
    {/if}
  </div>

  {#if draftStore.error}
    <div class="bg-destructive/10 border-t border-destructive/50 px-4 py-2 text-xs text-destructive shrink-0" role="alert">
      {draftStore.error}
    </div>
  {/if}

  <DraftStatusBar />

  <div class="bg-background border-t border-border flex flex-col shrink-0">
    <div class="flex gap-2 items-end px-4 pb-3 pt-2">
      <textarea
        bind:this={textEl}
        value={draft.text}
        oninput={(e) => draftStore.setText(e.currentTarget.value)}
        onkeydown={handleKeydown}
        spellcheck={settingsStore.current.spellcheck}
        rows="2"
        aria-label="First message"
        placeholder="What should the agent work on? Include a ticket ID if there is one. (Enter to start, Shift+Enter for a new line)"
        class="flex-1 bg-card border border-input px-3 py-2 text-sm text-foreground
          placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring font-mono"
      ></textarea>
      <Button
        variant="outline"
        onclick={() => draftStore.start()}
        disabled={!canStart}
        title="Start the conversation{draft.text.trim() ? ' and send this message' : ''}"
        class="text-primary border-primary hover:bg-primary/10 h-auto"
      >
        {draftStore.starting ? 'Starting…' : 'Start'}
      </Button>
    </div>
  </div>
</div>
{/if}
