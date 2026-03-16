<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { orchStore } from '../stores/orchestration.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { onMount } from 'svelte';
  import type { DockerStatus } from '../../shared/types.js';

  let { onclose, defaultRepo = '' }: { onclose: () => void; defaultRepo?: string } = $props();

  let open = $state(true);
  let selectedRepo = $state(defaultRepo || store.repos[0] || '');
  let goal = $state('');
  let baseBranch = $state('main');
  let dialogError = $state('');
  let submitting = $state(false);
  let dockerStatus = $state<DockerStatus | null>(null);
  let dockerChecked = $state(false);
  let proceedWithoutDocker = $state(false);
  let tokenInput = $state('');
  let savingToken = $state(false);

  // Check Docker status immediately when the dialog opens
  onMount(() => {
    window.groveBench.checkDocker().then((status) => {
      dockerStatus = status;
      dockerChecked = true;
    });
  });

  async function handlePlan() {
    if (!selectedRepo || !goal.trim()) return;

    // If Docker isn't available/authed and user hasn't acknowledged, block submission
    if (dockerChecked && dockerStatus && (!dockerStatus.available || !dockerStatus.hasAuth) && !proceedWithoutDocker) {
      return;
    }

    submitting = true;
    dialogError = '';

    try {
      const result = await window.groveBench.createOrchJob({
        repoPath: selectedRepo,
        goal: goal.trim(),
        baseBranch: baseBranch.trim() || undefined,
      });

      // Close dialog immediately
      open = false;
      onclose();

      // Add the orchestrator session as a regular session with orchJobId
      store.addSession({
        id: result.planSessionId,
        branch: `orch: ${goal.trim().slice(0, 40)}`,
        repoPath: selectedRepo,
        status: 'running',
        direct: true,
        orchJobId: result.jobId,
      });

      // Set fixed orchestrator mode so the status bar shows it correctly
      messageStore.setModeLocal(result.planSessionId, 'orchestrator');

      // Add job to orch store (for kanban data)
      const jobs = await window.groveBench.listOrchJobs();
      const job = jobs.find((j) => j.id === result.jobId);
      if (job) {
        orchStore.addJob(job);
      }

      // Focus the orchestrator session like any regular session
      store.activeSessionId = result.planSessionId;
    } catch (e: any) {
      dialogError = e.message || String(e);
      submitting = false;
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      open = false;
      onclose();
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Orchestrate</Dialog.Title>
      <Dialog.Description>
        Describe a goal and the orchestrator will decompose it into parallel agent tasks.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-3 mt-4">
      <div>
        <Label for="orch-repo" class="mb-1 block">Repository</Label>
        {#if store.repos.length === 1}
          <div class="w-full bg-secondary text-muted-foreground px-3 py-2 text-sm border border-input">
            {store.repoDisplayName(store.repos[0])}
          </div>
        {:else}
          <Select.Root type="single" value={selectedRepo} onValueChange={(v) => { selectedRepo = v; }}>
            <Select.Trigger class="w-full">
              {store.repoDisplayName(selectedRepo) || 'Select repository'}
            </Select.Trigger>
            <Select.Content>
              {#each store.repos as repo}
                <Select.Item value={repo} label={store.repoDisplayName(repo)} />
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
      </div>

      <div>
        <Label for="orch-goal" class="mb-1 block">Goal</Label>
        <textarea
          id="orch-goal"
          bind:value={goal}
          placeholder="e.g. Refactor the auth module to use JWT and add comprehensive tests"
          class="w-full bg-background border border-input px-3 py-2 text-sm min-h-[80px] max-h-[200px] resize-y focus:outline-none focus:ring-1 focus:ring-ring"
          autofocus
        ></textarea>
      </div>

      <div>
        <Label for="orch-base" class="mb-1 block">Base Branch (optional)</Label>
        <input
          id="orch-base"
          type="text"
          bind:value={baseBranch}
          placeholder="defaults to current HEAD"
          class="w-full bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {#if dockerChecked && dockerStatus?.available && dockerStatus.hasAuth}
        <div class="bg-green-500/10 border border-green-500/50 p-2 text-xs text-green-200 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-green-500 shrink-0"></span>
          Docker isolation enabled — subtasks will run in containers
        </div>
      {:else if dockerChecked && dockerStatus && (!dockerStatus.available || !dockerStatus.hasAuth) && !proceedWithoutDocker}
        <div class="bg-yellow-500/10 border border-yellow-500/50 p-3 text-xs text-yellow-200 space-y-2">
          {#if !dockerStatus.available}
            <p class="font-medium">Docker not available</p>
          {:else}
            <p class="font-medium">Docker container auth not configured</p>
          {/if}
          <p>Subtask agents will run in-process with software-level path validation
          but no container boundary.</p>
          {#if dockerStatus.available && !dockerStatus.hasAuth}
            <p>To enable Docker isolation, run <code class="font-mono bg-black/30 px-1 rounded select-all">claude setup-token</code> in your terminal and paste the token below:</p>
            <div class="flex gap-1.5">
              <input
                type="password"
                bind:value={tokenInput}
                placeholder="sk-ant-oat01-..."
                class="flex-1 bg-background border border-input px-2 py-1 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-ring rounded"
              />
              <Button
                variant="default"
                size="sm"
                class="h-auto py-1 text-[11px]"
                disabled={!tokenInput.trim() || savingToken}
                onclick={async () => {
                  savingToken = true;
                  try {
                    await window.groveBench.saveDockerToken(tokenInput.trim());
                    dockerStatus = await window.groveBench.checkDocker();
                    tokenInput = '';
                  } catch { /* ignore */ }
                  savingToken = false;
                }}
              >
                {savingToken ? '...' : 'Save'}
              </Button>
            </div>
          {/if}
          <div class="flex gap-2 pt-1">
            <Button variant="secondary" size="sm" onclick={() => { proceedWithoutDocker = true; handlePlan(); }}>
              Continue without Docker
            </Button>
            <Button variant="ghost" size="sm" onclick={() => { open = false; onclose(); }}>Cancel</Button>
          </div>
        </div>
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
          onclick={handlePlan}
          disabled={!selectedRepo || !goal.trim() || submitting}
        >
          {submitting ? 'Creating...' : 'Plan'}
        </Button>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
