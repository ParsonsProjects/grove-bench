<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { prerequisitesStore } from '../stores/prerequisites.svelte.js';
  import { agentsStore } from '../stores/agents.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { agentReady } from '../../shared/prerequisites.js';
  import { deriveSessionName } from '../../shared/session-name.js';
  import type { CreateSessionOpts, OpenPrSummary } from '../../shared/types.js';
  import ApiKeyField from './ApiKeyField.svelte';
  import { trackEvent } from '../lib/analytics.js';
  import { resolveBaseBranch } from '../lib/base-branch.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  let { onclose, defaultRepo = '' }: { onclose: () => void; defaultRepo?: string } = $props();

  let open = $state(true);
  let selectedRepo = $state(store.repos[0] || '');

  // The agent this conversation runs: the default agent unless another is
  // picked. The picker only shows when more than one agent is registered.
  // Until the agent list loads, fall back to the agents in the last check.
  let pickedAgent = $state('');
  let agentsLoading = $state(true);
  const agentId = $derived(
    pickedAgent || agentsStore.defaultId || Object.keys(store.prerequisites?.agents ?? {})[0] || '',
  );
  const agentStatus = $derived(agentId ? store.prerequisites?.agents[agentId] : undefined);
  // Plan mode is only offered for agents that have permission modes at all.
  // One that has modes but not Plan on its model falls back to its default.
  const offersModes = $derived(!!agentsStore.get(agentId)?.capabilities?.permissionModes);

  // Credentials are checked here, not at app startup. A cached "ready" is
  // trusted (a bad key still surfaces as an auth error in the conversation);
  // anything else gets a fresh check before the key form shows.
  const credentials = $derived.by(() => {
    const status = store.prerequisites;
    if (status && agentId && agentReady(status, agentId)) return 'ready';
    if (prerequisitesStore.checking || (!agentId && agentsLoading)) return 'checking';
    return 'missing';
  });

  // One fresh check per open, as soon as we know which agent is meant.
  let checkedOnOpen = false;
  $effect(() => {
    if (checkedOnOpen || !agentId) return;
    checkedOnOpen = true;
    if (credentials !== 'ready') prerequisitesStore.refresh();
  });

  onMount(() => {
    if (defaultRepo) selectedRepo = defaultRepo;
    agentsStore.load().finally(() => { agentsLoading = false; });
  });

  /** What the conversation is for: new work on a new branch, or work on a
   *  branch that already exists (reviewing a PR, or picking a branch up). */
  let intent = $state<'new' | 'existing'>('new');
  /** First message, sent as soon as the conversation exists. Optional: it can
   *  also be typed in the conversation. A new branch is named from it. */
  let prompt = $state('');
  let promptEl: HTMLTextAreaElement | undefined = $state();
  let creating = $state(false);
  let dialogError = $state('');

  // ── New work ──
  let showOptions = $state(false);
  let branchName = $state('');
  let baseBranch = $state('');
  // Last auto-filled value — only overwrite the field while the user hasn't edited it
  let autoBaseBranch = '';
  /** Run in the project folder itself (direct): no worktree, no new branch. */
  let inProjectFolder = $state(false);
  let baseDropdownOpen = $state(false);
  let baseDropdownEl: HTMLDivElement | undefined = $state();
  let baseSearch = $state('');

  // ── Existing branch ──
  type Picked = { kind: 'pr'; pr: OpenPrSummary } | { kind: 'branch'; name: string };
  let picked = $state<Picked | null>(null);
  let pickSearch = $state('');
  let prs = $state<OpenPrSummary[]>([]);
  let loadingPrs = $state(false);
  let prsError = $state('');
  let planMode = $state(false);
  // Once the user sets Plan mode themselves, picking stops changing it.
  let planModeTouched = false;

  // Branches serve both tabs: base branch suggestions and the existing list.
  let branches = $state<string[]>([]);
  let loadingBranches = $state(false);
  let branchesError = $state('');
  // Repos already requested, so switching tabs doesn't refetch.
  let branchesFor = '';
  let prsFor = '';

  function handleWindowClick(e: MouseEvent) {
    if (baseDropdownOpen && baseDropdownEl && !baseDropdownEl.contains(e.target as Node)) {
      baseDropdownOpen = false;
    }
  }

  /** Branches another conversation in this project already has checked out.
   *  Git allows a branch in only one worktree at a time. */
  const usedBranches = $derived(new Set(
    store.sessions.filter((s) => s.repoPath === selectedRepo).map((s) => s.branch),
  ));

  /** Loose match: every space-separated token must appear somewhere in the text. */
  function looseMatch(text: string, query: string): boolean {
    const lower = text.toLowerCase();
    return query.split(/\s+/).every((token) => lower.includes(token));
  }

  // Fork PRs have no branch in this repo to check out, so they aren't listed.
  const reviewablePrs = $derived(prs.filter((p) => !p.isCrossRepository && !usedBranches.has(p.headRefName)));
  const forkPrCount = $derived(prs.filter((p) => p.isCrossRepository).length);
  const plainBranches = $derived.by(() => {
    const prHeads = new Set(reviewablePrs.map((p) => p.headRefName));
    return branches.filter((b) => !usedBranches.has(b) && !prHeads.has(b));
  });

  const pickQuery = $derived(pickSearch.toLowerCase().trim());
  const filteredPrs = $derived(pickQuery
    ? reviewablePrs.filter((p) => looseMatch(`#${p.number} ${p.title} ${p.headRefName} ${p.author}`, pickQuery))
    : reviewablePrs);
  const filteredBranches = $derived(pickQuery ? plainBranches.filter((b) => looseMatch(b, pickQuery)) : plainBranches);

  const filteredBaseBranches = $derived.by(() => {
    const q = (baseSearch || baseBranch).toLowerCase().trim();
    if (!q) return branches;
    return branches.filter((b) => looseMatch(b, q));
  });

  async function loadBranches(repo: string) {
    if (branchesFor === repo) return;
    branchesFor = repo;
    loadingBranches = true;
    branchesError = '';
    try {
      const list = await window.groveBench.listBranches(repo);
      if (repo === selectedRepo) branches = list;
    } catch (e: any) {
      if (repo === selectedRepo) {
        branches = [];
        branchesError = e?.message || String(e);
      }
    } finally {
      if (repo === selectedRepo) loadingBranches = false;
    }
  }

  async function loadPrs(repo: string) {
    if (prsFor === repo) return;
    prsFor = repo;
    loadingPrs = true;
    prsError = '';
    try {
      const list = await window.groveBench.listOpenPrs(repo);
      if (repo === selectedRepo) prs = list;
    } catch {
      if (repo === selectedRepo) {
        prs = [];
        prsError = 'Pull requests could not be listed. Check that the GitHub CLI is installed and signed in.';
      }
    } finally {
      if (repo === selectedRepo) loadingPrs = false;
    }
  }

  /** Prefill the base branch with the settings override or the repo's default branch. */
  async function fetchDefaultBaseBranch(repo: string) {
    const detected = await resolveBaseBranch(repo);
    if (repo !== selectedRepo) return; // repo changed while awaiting
    if (!baseBranch.trim() || baseBranch === autoBaseBranch) {
      baseBranch = detected;
      autoBaseBranch = detected;
    }
  }

  $effect(() => {
    if (credentials !== 'ready') return;
    const repo = selectedRepo;
    const wantPrs = intent === 'existing';
    if (!repo) return;
    untrack(() => {
      const repoChanged = branchesFor !== repo;
      loadBranches(repo);
      if (repoChanged) fetchDefaultBaseBranch(repo);
      if (wantPrs) loadPrs(repo);
    });
  });

  function selectRepo(repo: string) {
    if (repo === selectedRepo) return;
    selectedRepo = repo;
    branches = [];
    prs = [];
    picked = null;
    prsError = '';
    branchesError = '';
  }

  function pick(p: Picked) {
    picked = p;
    // Opening a PR is usually a review; picking a branch is usually more work.
    if (!planModeTouched) planMode = p.kind === 'pr';
  }

  function isPicked(p: Picked): boolean {
    if (!picked || picked.kind !== p.kind) return false;
    return p.kind === 'pr'
      ? picked.kind === 'pr' && picked.pr.number === p.pr.number
      : picked.kind === 'branch' && picked.name === p.name;
  }

  /** Whether the conversation will run in a new worktree (so dependency
   *  install matters). */
  const createsWorktree = $derived(intent === 'existing' || !inProjectFolder);

  function canCreate(): boolean {
    if (!selectedRepo || creating) return false;
    if (intent === 'existing') return !!picked;
    return true;
  }

  function buildOpts(): { opts: CreateSessionOpts; mode: 'new' | 'existing' | 'direct' } {
    const base = { repoPath: selectedRepo, ...(agentId ? { adapterType: agentId } : {}) };
    if (intent === 'existing' && picked) {
      const branch = picked.kind === 'pr' ? picked.pr.headRefName : picked.name;
      return {
        opts: { ...base, branchName: branch, useExisting: true, ...(offersModes && planMode ? { permissionMode: 'plan' as const } : {}) },
        mode: 'existing',
      };
    }
    if (inProjectFolder) return { opts: { ...base, branchName: '', direct: true }, mode: 'direct' };
    // An empty branch name gets a placeholder that is renamed after the first reply.
    return { opts: { ...base, branchName: branchName.trim(), baseBranch: baseBranch.trim() || undefined }, mode: 'new' };
  }

  async function handleCreate() {
    if (!canCreate()) return;
    creating = true;
    dialogError = '';
    const text = prompt.trim();

    try {
      const { opts, mode } = buildOpts();
      const result = await window.groveBench.createSession(opts);
      trackEvent('session_created', {
        mode,
        withPrompt: !!text,
        ...(mode === 'new' ? { autoBranch: !opts.branchName } : {}),
        ...(intent === 'existing' && picked ? { picked: picked.kind, planMode: !!opts.permissionMode } : {}),
      });
      // Direct sessions are ready immediately; worktree sessions go through
      // starting → installing → running, so start with the correct initial status.
      const direct = mode === 'direct';
      // Name the row from the message straight away; the automatic name
      // replaces it after the first reply.
      const placeholderName = text ? deriveSessionName(text) : null;
      store.addSession({
        id: result.id,
        branch: result.branch,
        repoPath: selectedRepo,
        status: direct ? 'running' : 'starting',
        agentType: result.agentType,
        createdAt: Date.now(),
        ...(direct ? { direct: true } : {}),
        ...(placeholderName ? { displayName: placeholderName } : {}),
      });
      // Main holds a prompt sent during setup until the agent is ready.
      if (text) {
        messageStore.addUserMessage(result.id, text);
        window.groveBench.sendMessage(result.id, text);
        store.updateLastActive(result.id);
      }
      open = false;
      onclose();
    } catch (e: any) {
      dialogError = e.message || String(e);
    } finally {
      creating = false;
    }
  }

  function handlePromptKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handleCreate();
    }
  }

  // The message box takes focus whenever it appears: on open, and after the
  // credentials step or a tab switch brings it back.
  $effect(() => {
    promptEl?.focus();
  });

  /** The dialog focuses its first control (the project picker) on open;
   *  send focus to the message box instead when it is showing. */
  function handleOpenAutoFocus(e: Event) {
    if (!promptEl) return;
    e.preventDefault();
    promptEl.focus();
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      open = false;
      onclose();
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-md" onOpenAutoFocus={handleOpenAutoFocus}>
    <Dialog.Header>
      <Dialog.Title>New Conversation</Dialog.Title>
      <Dialog.Description>
        {credentials === 'missing'
          ? 'Add credentials to start a conversation.'
          : 'Describe new work, or pick a branch or pull request.'}
      </Dialog.Description>
    </Dialog.Header>

    {#if agentsStore.list.length > 1}
      <div class="mt-4">
        <Label class="mb-1 block">Agent</Label>
        <Select.Root type="single" value={agentId} onValueChange={(v) => { if (v) pickedAgent = v; }}>
          <Select.Trigger class="w-full" aria-label="Agent">
            {agentsStore.get(agentId)?.displayName ?? agentId}
          </Select.Trigger>
          <Select.Content>
            {#each agentsStore.list as agent (agent.id)}
              <Select.Item value={agent.id} label={agent.displayName} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    {/if}

    {#if credentials === 'checking'}
      <div class="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <span class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
        Checking credentials…
      </div>
    {:else if credentials === 'missing'}
      <div class="flex flex-col gap-3 mt-4">
        {#if agentStatus?.apiKey}
          <!-- Keyed so switching agent clears a half-typed key and its error -->
          {#key agentId}
            <ApiKeyField adapterId={agentId} autofocus />
          {/key}
          <p class="text-xs text-muted-foreground">
            Signed in with the CLI in a terminal instead? Re-check.
          </p>
        {:else}
          <p class="text-sm text-muted-foreground">
            {agentStatus?.authErrorMessage ?? agentStatus?.errorMessage ?? 'Could not check the agent\'s credentials.'}
          </p>
        {/if}

        <Dialog.Footer>
          <Button variant="secondary" onclick={() => { open = false; onclose(); }}>
            Cancel
          </Button>
          <Button variant="secondary" onclick={() => prerequisitesStore.refresh()}>
            Re-check
          </Button>
        </Dialog.Footer>
      </div>
    {:else}
    <div class="flex flex-col gap-3 mt-4">
      <div>
        <Label for="repo" class="mb-1 block">Project</Label>
        {#if store.repos.length === 1}
          <div class="w-full bg-secondary text-muted-foreground px-3 py-2 text-sm border border-input">
            {store.repoDisplayName(store.repos[0])}
          </div>
        {:else}
          <Select.Root type="single" value={selectedRepo} onValueChange={(v) => { if (v) selectRepo(v); }}>
            <Select.Trigger class="w-full">
              {store.repoDisplayName(selectedRepo) || 'Select project'}
            </Select.Trigger>
            <Select.Content>
              {#each store.repos as repo}
                <Select.Item value={repo} label={store.repoDisplayName(repo)} />
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
      </div>

      <div class="flex overflow-hidden border border-input" role="group" aria-label="Start from">
        <Button
          variant={intent === 'new' ? 'default' : 'secondary'}
          class="flex-1 rounded-none border-0"
          size="sm"
          aria-pressed={intent === 'new'}
          onclick={() => intent = 'new'}
        >
          New work
        </Button>
        <Button
          variant={intent === 'existing' ? 'default' : 'secondary'}
          class="flex-1 rounded-none border-0"
          size="sm"
          aria-pressed={intent === 'existing'}
          onclick={() => intent = 'existing'}
        >
          Existing branch
        </Button>
      </div>

      {#if intent === 'existing'}
        <div>
          <Label for="pick-search" class="mb-1 block">Pull request or branch</Label>
          <Input id="pick-search" type="text" bind:value={pickSearch} placeholder="Search by number, title, branch or author" />
          <div class="mt-1 max-h-56 overflow-y-auto border border-input p-1" aria-label="Pull requests and branches">
            {#if (loadingPrs || loadingBranches) && filteredPrs.length === 0 && filteredBranches.length === 0}
              <div class="px-2 py-4 text-sm text-muted-foreground text-center">Loading…</div>
            {:else if filteredPrs.length === 0 && filteredBranches.length === 0}
              <div class="px-2 py-4 text-sm text-muted-foreground text-center">
                {pickQuery ? 'Nothing matches' : 'No branches available'}
              </div>
            {:else}
              {#if filteredPrs.length > 0}
                <div class="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Open pull requests</div>
                {#each filteredPrs as pr (pr.number)}
                  {@const item = { kind: 'pr' as const, pr }}
                  <button
                    type="button"
                    class="w-full text-left px-2 py-1.5 text-sm hover:bg-accent transition-colors flex flex-col {isPicked(item) ? 'bg-accent' : ''}"
                    aria-pressed={isPicked(item)}
                    onclick={() => pick(item)}
                  >
                    <span class="truncate"><span class="text-muted-foreground">#{pr.number}</span> {pr.title}</span>
                    <span class="truncate text-xs text-muted-foreground">
                      {pr.headRefName}{pr.author ? ` · ${pr.author}` : ''}{pr.isDraft ? ' · draft' : ''}
                    </span>
                  </button>
                {/each}
              {/if}
              {#if filteredBranches.length > 0}
                <div class="px-2 pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Branches</div>
                {#each filteredBranches as name (name)}
                  {@const item = { kind: 'branch' as const, name }}
                  <button
                    type="button"
                    class="w-full text-left px-2 py-1.5 text-sm hover:bg-accent transition-colors truncate {isPicked(item) ? 'bg-accent' : ''}"
                    aria-pressed={isPicked(item)}
                    onclick={() => pick(item)}
                  >
                    {name}
                  </button>
                {/each}
              {/if}
            {/if}
          </div>
          {#if prsError}
            <p class="text-xs text-muted-foreground mt-1">{prsError}</p>
          {/if}
          {#if branchesError}
            <p class="text-xs text-destructive mt-1">{branchesError}</p>
          {/if}
          {#if forkPrCount > 0}
            <p class="text-xs text-muted-foreground mt-1">
              {forkPrCount === 1 ? '1 pull request from a fork is' : `${forkPrCount} pull requests from forks are`} not listed yet.
            </p>
          {/if}
        </div>

        {#if offersModes}
          <label class="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <Checkbox bind:checked={planMode} onCheckedChange={() => { planModeTouched = true; }} aria-label="Start in Plan mode" />
            Start in Plan mode (explores without editing files)
          </label>
        {/if}

        <div>
          <Label for="first-message" class="mb-1 block">First message (optional)</Label>
          <textarea
            id="first-message"
            bind:value={prompt}
            onkeydown={handlePromptKeydown}
            rows="2"
            placeholder="e.g. Review this PR and list anything that needs fixing"
            class="w-full resize-y bg-background border border-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          ></textarea>
        </div>
      {:else}
        <div>
          <Label for="first-message" class="mb-1 block">What should the agent work on?</Label>
          <textarea
            id="first-message"
            bind:this={promptEl}
            bind:value={prompt}
            onkeydown={handlePromptKeydown}
            rows="4"
            placeholder="Describe the task. Include a ticket ID if there is one."
            class="w-full resize-y bg-background border border-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          ></textarea>
          <p class="text-xs text-muted-foreground mt-1">
            Enter to start, Shift+Enter for a new line.
            {#if !inProjectFolder && !branchName.trim()}
              The branch is named from this after the first reply.
            {/if}
          </p>
        </div>

        <div>
          <button
            type="button"
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={showOptions}
            onclick={() => showOptions = !showOptions}
          >
            <svg class="h-3 w-3 transition-transform {showOptions ? 'rotate-90' : ''}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            Options
            {#if !showOptions && (branchName.trim() || inProjectFolder)}
              <span class="text-foreground/70">· {inProjectFolder ? 'project folder' : branchName.trim()}</span>
            {/if}
          </button>

          {#if showOptions}
            <div class="flex flex-col gap-3 mt-2 pl-4 border-l border-border">
              <label class="flex items-start gap-2 text-sm cursor-pointer select-none">
                <Checkbox bind:checked={inProjectFolder} aria-label="Work in the project folder" class="mt-0.5" />
                <span>
                  Work in the project folder
                  <span class="block text-xs text-muted-foreground">No separate copy. The agent edits the folder's current branch in place.</span>
                </span>
              </label>

              {#if !inProjectFolder}
                <div>
                  <Label for="branch" class="mb-1 block">Branch name</Label>
                  <Input
                    id="branch"
                    type="text"
                    bind:value={branchName}
                    placeholder="Named automatically"
                  />
                </div>

                <div>
                  <Label for="base" class="mb-1 block">Base branch</Label>
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="relative" bind:this={baseDropdownEl} onkeydown={(e) => {
                    if (e.key === 'Escape') { baseDropdownOpen = false; }
                  }}>
                    <div class="flex items-center bg-background border border-input">
                      <input
                        id="base"
                        type="text"
                        class="flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                        placeholder={loadingBranches ? 'Loading branches…' : 'branch, tag, or commit hash'}
                        bind:value={baseBranch}
                        onfocus={() => { baseDropdownOpen = true; baseSearch = ''; }}
                        oninput={() => { baseSearch = baseBranch; baseDropdownOpen = true; }}
                      />
                      <button
                        type="button"
                        class="px-2 py-2 text-muted-foreground hover:text-foreground shrink-0"
                        onclick={() => { baseDropdownOpen = !baseDropdownOpen; baseSearch = ''; }}
                        aria-label="Toggle branch list"
                      >
                        <svg class="h-4 w-4 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                      </button>
                    </div>
                    {#if baseDropdownOpen && branches.length > 0}
                      <div class="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border shadow-md overflow-hidden">
                        <div class="max-h-48 overflow-y-auto p-1">
                          {#each filteredBaseBranches as branch}
                            <button
                              type="button"
                              class="w-full text-left px-2 py-1.5 text-sm hover:bg-accent transition-colors flex items-center gap-2 {branch === baseBranch ? 'bg-accent' : ''}"
                              onclick={() => { baseBranch = branch; baseDropdownOpen = false; baseSearch = ''; }}
                            >
                              {#if branch === baseBranch}
                                <svg class="h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                              {:else}
                                <span class="w-4 shrink-0"></span>
                              {/if}
                              <span class="truncate">{branch}</span>
                            </button>
                          {:else}
                            <div class="px-2 py-4 text-sm text-muted-foreground text-center">No branches match</div>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if createsWorktree && !settingsStore.current.autoInstallDeps}
        <p class="text-xs text-muted-foreground">
          New worktrees don't include node_modules. The agent may need to run npm install first.
        </p>
      {/if}

      {#if dialogError}
        <div class="bg-destructive/10 border border-destructive/50 p-2 text-xs text-destructive">
          {dialogError}
        </div>
      {/if}

      <Dialog.Footer>
        <Button variant="secondary" onclick={() => { open = false; onclose(); }}>
          Cancel
        </Button>
        <Button
          onclick={handleCreate}
          disabled={!canCreate()}
        >
          {#if creating}
            <span class="inline-flex items-center gap-1.5">
              <span class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
              Starting…
            </span>
          {:else}
            Start
          {/if}
        </Button>
      </Dialog.Footer>
    </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
