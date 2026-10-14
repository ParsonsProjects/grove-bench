<script lang="ts">
  /**
   * The main pane for a draft conversation: a large message box in the
   * middle of the pane, the draft's options (agent, model, mode, where it
   * runs) along its foot, and what will happen under it. Sending the first
   * message starts the conversation. Replaces the old New Conversation dialog.
   */
  import { onMount } from 'svelte';
  import { store } from '../stores/sessions.svelte.js';
  import { draftStore } from '../stores/draft.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { prerequisitesStore } from '../stores/prerequisites.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { agentReady, gitReady } from '../../shared/prerequisites.js';
  import { controlHint } from '../lib/control-hint.js';
  import ApiKeyField from './ApiKeyField.svelte';
  import CommandLine from './CommandLine.svelte';
  import GroveEmptyState from './GroveEmptyState.svelte';
  import GitIdentityNotice from './GitIdentityNotice.svelte';
  import GitNotice from './GitNotice.svelte';
  import DraftStatusBar from './DraftStatusBar.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';

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

  let signInError = $state('');
  /** Start the agent briefly to see whether signing in worked. */
  async function checkSignIn() {
    signInError = '';
    try {
      await prerequisitesStore.checkSignIn(agentId);
      if (store.prerequisites?.agents[agentId]?.authenticated === false) signInError = `${agentName} still isn't signed in.`;
    } catch (e) {
      signInError = e instanceof Error ? e.message : String(e);
    }
  }

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
    !!draft && credentials === 'ready'
      && (start?.kind !== 'existing' || !!start.branch),
  );

  /** Set when credentials go from missing to ready in this draft, so the
   *  user sees that the Re-check or the saved key worked. */
  let credentialsFound = $state(false);
  let wasMissing = false;
  $effect(() => {
    if (credentials === 'missing') wasMissing = true;
    else if (credentials === 'ready' && wasMissing) {
      wasMissing = false;
      credentialsFound = true;
    }
  });
  const credentialsNote = $derived.by(() => {
    if (!credentialsFound || !agentStatus) return '';
    if (agentStatus.apiKey?.saved) {
      return agentStatus.apiKey.unverified
        ? 'API key saved. The first message will show whether it works.'
        : 'API key saved. You\'re ready to start.';
    }
    return `Signed in${agentStatus.email ? ` as ${agentStatus.email}` : ''}. You're ready to start.`;
  });

  /** Git isn't installed (or is too old): every project runs without it. */
  const gitMissing = $derived(!!store.prerequisites && !gitReady(store.prerequisites));

  /** Why Start is off, in words, for its tooltip and for Enter. */
  const startBlocker = $derived.by(() => {
    if (!draft) return null;
    if (credentials === 'missing') return 'Add credentials above to start.';
    if (credentials === 'checking') return 'Checking credentials…';
    if (credentials === 'no-agent') return 'No agent is available to start this thread.';
    if (start?.kind === 'existing' && !start.branch) return 'Pick a branch or pull request first.';
    return null;
  });
  /** Enter was pressed while Start was off: say why under the message box. */
  let nudged = $state(false);
  $effect(() => {
    if (!startBlocker) nudged = false;
  });

  /** A project used without git: not a repository, or git isn't installed. */
  const folderProject = $derived(!!draft && store.isFolderProject(draft.repoPath));

  /** One line on what sending will do, so nothing about it is a surprise. */
  const plan = $derived.by(() => {
    if (!start) return '';
    if (start.kind === 'folder' && folderProject) {
      return 'The agent will work in the project folder itself, without git, so its edits land in place and can\'t be rewound.';
    }
    if (start.kind === 'folder') return 'The agent will work in the project folder itself, on the branch it has checked out.';
    if (start.kind === 'existing') {
      return start.pr
        ? `The agent will open pull request #${start.pr.number} (${start.branch}) in a separate copy.`
        : `The agent will open ${start.branch} in a separate copy.`;
    }
    const from = start.baseBranch.trim() || 'the default branch';
    if (draftStore.onGroupBranch) {
      return `The agent will work on ${start.branchName.trim()}, the group's branch, in a separate copy: the project's own branch if it has one, else a new one from ${from}.`;
    }
    return start.branchName.trim()
      ? `The agent will work on a new branch, ${start.branchName.trim()}, from ${from}, in a separate copy.`
      : `The agent will work on a new branch from ${from}, in a separate copy. The branch is named from your message after the first reply.`;
  });

  /** Git has no name and email for this project, so the agent's commits
   *  would fail. Said before the first message rather than mid-task. */
  let identityMissing = $state(false);
  $effect(() => {
    const repo = draft?.repoPath;
    identityMissing = false;
    if (!repo || store.isFolderProject(repo)) return;
    let stale = false;
    window.groveBench.hasGitIdentity(repo)
      .then((ok) => { if (!stale) identityMissing = !ok; })
      .catch(() => {});
    return () => { stale = true; };
  });

  /** The mode the conversation will start in, in words. */
  const modeHint = $derived(controlHint(draftStore.descriptors, (id) => draftStore.controlValue(id), null));

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
      else if (startBlocker) nudged = true;
    }
  }
</script>

{#if draft}
<div class="flex flex-col h-full bg-background">
  <PanelHeader title="New thread">
    <span class="truncate text-muted-foreground">in {store.repoDisplayName(draft.repoPath)}{agentName ? ` · ${agentName}` : ''}</span>
    {#snippet actions()}
      <Button variant="quiet" size="xs" onclick={() => draftStore.discard()} title="Discard this draft">
        Discard
      </Button>
    {/snippet}
  </PanelHeader>

  <!-- The column sits in the middle while it fits, with auto margins
       rather than centring, so a tall one scrolls from its top. The
       options' menus open downwards, or upwards when that fits better. -->
  <div class="pixel-bg flex-1 min-h-0 flex flex-col text-muted-foreground relative overflow-y-auto px-6">
    <div class="relative z-10 m-auto w-full max-w-2xl flex flex-col gap-4 py-8">
      {#if credentials === 'checking'}
        <div class="flex items-center justify-center gap-2 text-sm">
          <Pulse motion="spin" tone="muted" size="sm" />
          Checking credentials…
        </div>
      {:else if credentials === 'no-agent'}
        <div class="self-center w-full max-w-sm flex flex-col gap-3 bg-background border border-border p-4">
          <p class="text-sm text-foreground">No agent is available to start this thread.</p>
          <p class="text-xs text-muted-foreground">Grove Bench couldn't load its list of agents. Try again, or restart the app if it keeps happening.</p>
          <div class="flex justify-end">
            <Button variant="secondary" size="sm" onclick={retryAgents}>Try again</Button>
          </div>
        </div>
      {:else if credentials === 'missing'}
        {@const cli = agentStatus?.cliSignIn}
        {@const installed = agentStatus?.available !== false}
        {@const needsInstall = !installed && !!agentStatus?.installRequired}
        {@const signedOut = installed && agentStatus?.authenticated === false && !agentStatus?.apiKey?.saved}
        <div class="self-center w-full max-w-md flex flex-col gap-4 bg-background border border-border p-4">
          <p class="text-sm text-foreground">
            {#if needsInstall}
              {agentName} isn't installed on this computer.
            {:else if agentStatus?.apiKey?.saved && agentStatus.apiKey.rejected}
              {agentName} couldn't sign in with the saved API key.
            {:else if signedOut}
              {agentName} isn't signed in.
            {:else}
              Add credentials for {agentName} to start.
            {/if}
          </p>
          {#if signedOut && agentStatus?.authMessage && !/^authentication required\.?$/i.test(agentStatus.authMessage.trim())}
            <p class="text-xs text-muted-foreground -mt-2" data-testid="auth-message">{agentName} said: {agentStatus.authMessage}</p>
          {/if}
          {#if cli && cli.cliName !== agentName}
            <p class="text-xs text-muted-foreground -mt-2">{agentName} runs on {cli.cliName}, so it signs in the same way.</p>
          {/if}
          {#if !installed && agentStatus?.installCommand}
            <section class="flex flex-col gap-1.5" aria-label="Install {cli?.cliName ?? agentName}">
              <p class="text-xs font-medium text-foreground">Install {cli?.cliName ?? agentName}</p>
              <p class="text-xs text-muted-foreground">Copy this into a terminal (PowerShell) and run it, then click <span class="text-foreground">Re-check</span>.</p>
              <CommandLine command={agentStatus.installCommand} label="Install command" />
            </section>
          {/if}
          {#if cli}
            <!-- Two ways in, subscription first: most people have a plan, not
                 an API key, and a key is billed separately. -->
            <section class="flex flex-col gap-1.5" aria-label="Sign in with {cli.cliName}">
              <p class="text-xs font-medium text-foreground">
                Use your {cli.accountLabel}{#if cli.accountDetail}{' '}<span class="font-normal text-muted-foreground">({cli.accountDetail})</span>{/if}
              </p>
              {#if installed}
                <p class="text-xs text-muted-foreground">
                  Run <code class="text-foreground">{cli.command}</code> in a terminal and sign in when it asks. Then click <span class="text-foreground">{agentStatus?.signInCheckable ? 'Check sign-in' : 'Re-check'}</span>.
                </p>
                <CommandLine command={cli.command} label="Sign-in command" />
              {:else}
                <p class="text-xs text-muted-foreground">
                  Install {cli.cliName}, run <code class="text-foreground">{cli.command}</code> in a terminal and sign in when it asks. Then click <span class="text-foreground">Re-check</span>.
                </p>
                <Button
                  variant="external"
                  size="inline"
                  class="self-start text-xs"
                  onclick={() => window.groveBench.openExternal(cli.setupUrl)}
                >
                  How to install {cli.cliName}
                </Button>
              {/if}
            </section>
          {/if}
          {#if agentStatus?.apiKey}
            <section class="flex flex-col gap-1.5" aria-label="Use an API key">
              {#if cli}<p class="text-xs font-medium text-foreground">Or use an API key</p>{/if}
              {#key agentId}
                <ApiKeyField adapterId={agentId} autofocus />
              {/key}
            </section>
          {/if}
          {#if !cli && !agentStatus?.apiKey && !agentStatus?.installCommand}
            <p class="text-sm text-muted-foreground">
              {agentStatus?.authErrorMessage ?? agentStatus?.errorMessage ?? 'Could not check the agent\'s credentials.'}
            </p>
          {/if}
          {#if signInError}
            <p class="text-xs text-destructive" role="alert">{signInError}</p>
          {/if}
          <div class="flex justify-end gap-2">
            {#if installed && agentStatus?.signInCheckable}
              <Button variant="secondary" size="sm" onclick={checkSignIn}>Check sign-in</Button>
            {:else}
              <Button variant="secondary" size="sm" onclick={() => prerequisitesStore.refresh()}>Re-check</Button>
            {/if}
          </div>
        </div>
      {:else if settingsStore.current.groveCharacters}
        <GroveEmptyState variant="draft">
          <p class="font-pixel text-base mt-5 text-foreground/90">New thread in {store.repoDisplayName(draft.repoPath)}</p>
        </GroveEmptyState>
      {:else}
        <p class="text-center text-lg text-foreground/90">New thread in {store.repoDisplayName(draft.repoPath)}</p>
      {/if}

      <!-- The message box, with the options and Start along its foot. -->
      <div class="bg-card border border-input has-[textarea:focus]:ring-1 has-[textarea:focus]:ring-ring">
        <textarea
          bind:this={textEl}
          value={draft.text}
          oninput={(e) => draftStore.setText(e.currentTarget.value)}
          onkeydown={handleKeydown}
          spellcheck={settingsStore.current.spellcheck}
          rows="6"
          aria-label="First message"
          placeholder="What should the agent work on? Include a ticket ID if there is one. (Enter to start, Shift+Enter for a new line)"
          class="block w-full bg-transparent px-4 py-3 text-sm text-foreground field-sizing-content min-h-40 max-h-[45vh]
            placeholder:text-muted-foreground resize-none focus:outline-none font-mono"
        ></textarea>
        <div class="flex items-center gap-3 px-3 py-1.5 border-t border-border">
          <DraftStatusBar />
          <Button
            variant="default"
            size="sm"
            onclick={() => draftStore.start()}
            disabled={!canStart}
            title={startBlocker ?? `Start the thread${draft.text.trim() ? ' and send this message' : ''}`}
            class="ml-auto"
          >
            Start
          </Button>
        </div>
      </div>
      {#if nudged && startBlocker}
        <p class="-mt-2 text-xs text-amber-500" role="status">{startBlocker}</p>
      {/if}
      {#if draftStore.error}
        <Notice tone="danger">
          <p>{draftStore.error}</p>
        </Notice>
      {/if}

      <!-- What sending will do, then what changed or still needs doing first. -->
      {#if credentials === 'ready'}
        <div class="flex flex-col items-center gap-1 text-center text-xs text-muted-foreground">
          <p class="max-w-lg">{plan}</p>
          {#if modeHint}
            <p class="max-w-lg">Mode: <span class="text-foreground/80">{modeHint.label}</span>. {modeHint.description}.</p>
          {/if}
          <p class="max-w-lg mt-1">{folderProject ? 'Change the agent, model or mode' : 'Change the agent, model, mode or branch'} under the message box. Nothing is created until you send.</p>
          {#if credentialsNote}
            <p class="text-green-400 mt-2" role="status">✓ {credentialsNote}</p>
          {/if}
          {#if gitMissing}
            <div class="mt-2 w-full max-w-md text-left"><GitNotice boxed /></div>
          {/if}
          {#if identityMissing}
            <div class="mt-2 w-full max-w-md text-left"><GitIdentityNotice beforeStart /></div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
{/if}
