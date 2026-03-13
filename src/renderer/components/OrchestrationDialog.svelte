<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { orchStore } from '../stores/orchestration.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  let { onclose, defaultRepo = '' }: { onclose: () => void; defaultRepo?: string } = $props();

  let open = $state(true);
  let selectedRepo = $state(defaultRepo || store.repos[0] || '');
  let goal = $state('');
  let baseBranch = $state('');
  let dialogError = $state('');
  let submitting = $state(false);

  async function handlePlan() {
    if (!selectedRepo || !goal.trim()) return;

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
