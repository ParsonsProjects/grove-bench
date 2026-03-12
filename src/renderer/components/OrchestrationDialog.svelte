<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import { orchStore } from '../stores/orchestration.svelte.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import type { OrchTask } from '../../shared/types.js';

  let { onclose, defaultRepo = '' }: { onclose: () => void; defaultRepo?: string } = $props();

  let open = $state(true);
  let selectedRepo = $state(defaultRepo || store.repos[0] || '');
  let goal = $state('');
  let baseBranch = $state('');
  let dialogError = $state('');

  // Two-step flow: 'input' → 'review'
  let step = $state<'input' | 'review'>('input');
  let planning = $state(false);
  let jobId = $state<string | null>(null);
  let tasks = $state<OrchTask[]>([]);
  let approving = $state(false);

  async function handlePlan() {
    if (!selectedRepo || !goal.trim()) return;

    planning = true;
    dialogError = '';

    try {
      const result = await window.groveBench.createOrchJob({
        repoPath: selectedRepo,
        goal: goal.trim(),
        baseBranch: baseBranch.trim() || undefined,
      });
      jobId = result.jobId;

      // Subscribe to events and wait for plan completion
      const unsub = window.groveBench.onOrchEvent(result.jobId, (event) => {
        if (event.type === 'orch_plan_complete') {
          tasks = event.tasks;
          step = 'review';
          planning = false;
          unsub();
        } else if (event.type === 'orch_plan_error') {
          dialogError = event.error;
          planning = false;
          unsub();
        }
      });
    } catch (e: any) {
      dialogError = e.message || String(e);
      planning = false;
    }
  }

  async function handleApprove() {
    if (!jobId) return;
    approving = true;
    dialogError = '';

    try {
      // Collect edited tasks
      const edits = tasks.map((t) => ({
        id: t.id,
        instruction: t.instruction,
        description: t.description,
        branchName: t.branchName,
      }));

      await window.groveBench.approveOrchPlan(jobId, edits);

      // Add job to the store
      const jobs = await window.groveBench.listOrchJobs();
      const job = jobs.find((j) => j.id === jobId);
      if (job) {
        orchStore.addJob(job);
        orchStore.activeJobId = job.id;

        // Also add each task's session to the session store as they spawn
        orchStore.subscribe(job.id);
      }

      open = false;
      onclose();
    } catch (e: any) {
      dialogError = e.message || String(e);
    } finally {
      approving = false;
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
      <Dialog.Title>{step === 'input' ? 'Orchestrate' : 'Review Plan'}</Dialog.Title>
      <Dialog.Description>
        {step === 'input'
          ? 'Describe a goal and the orchestrator will decompose it into parallel agent tasks.'
          : `${tasks.length} tasks planned. Review and edit before launching.`}
      </Dialog.Description>
    </Dialog.Header>

    {#if step === 'input'}
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
            disabled={!selectedRepo || !goal.trim() || planning}
          >
            {planning ? 'Planning...' : 'Plan'}
          </Button>
        </Dialog.Footer>
      </div>
    {:else}
      <!-- Plan review step -->
      <div class="flex flex-col gap-3 mt-4 max-h-[60vh] overflow-auto">
        {#each tasks as task, i}
          <div class="border border-border p-3">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs text-muted-foreground font-medium">Task {i + 1}</span>
              <span class="text-xs text-muted-foreground font-mono">{task.branchName}</span>
            </div>
            <div class="mb-2">
              <Label class="mb-1 block text-xs">Description</Label>
              <input
                type="text"
                bind:value={task.description}
                class="w-full bg-background border border-input px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <Label class="mb-1 block text-xs">Instruction</Label>
              <textarea
                bind:value={task.instruction}
                class="w-full bg-background border border-input px-2 py-1 text-sm min-h-[60px] max-h-[120px] resize-y focus:outline-none focus:ring-1 focus:ring-ring"
              ></textarea>
            </div>
            <div class="flex gap-2 mt-1 text-xs text-muted-foreground">
              {#if task.scope.length > 0}
                <span>Scope: {task.scope.slice(0, 3).join(', ')}{task.scope.length > 3 ? '...' : ''}</span>
              {/if}
              {#if task.dependsOn.length > 0}
                <span>Depends on: {task.dependsOn.join(', ')}</span>
              {/if}
              <span>{task.parallelizable ? 'Parallel' : 'Sequential'}</span>
            </div>
          </div>
        {/each}

        {#if dialogError}
          <div class="bg-destructive/10 border border-destructive/50 p-2 text-xs text-destructive">
            {dialogError}
          </div>
        {/if}

        <Dialog.Footer>
          <Button variant="secondary" onclick={() => { step = 'input'; tasks = []; dialogError = ''; }}>
            Back
          </Button>
          <Button
            onclick={handleApprove}
            disabled={approving || tasks.length === 0}
          >
            {approving ? 'Launching...' : `Approve & Launch (${tasks.length} tasks)`}
          </Button>
        </Dialog.Footer>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
