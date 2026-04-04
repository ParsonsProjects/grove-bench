<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '../stores/sessions.svelte.js';
  import { pipelineStore } from '../stores/pipelines.svelte.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import type { PipelineTemplate } from '../../shared/types.js';

  let { onclose, defaultRepo = '' }: { onclose: () => void; defaultRepo?: string } = $props();

  let open = $state(true);
  let selectedRepo = $state(store.repos[0] || '');
  let branchName = $state('');
  let baseBranch = $state('main');
  let context = $state('');
  let selectedTemplateId = $state('full');
  let creating = $state(false);
  let dialogError = $state('');

  let branches = $state<string[]>([]);
  let loadingBranches = $state(false);

  onMount(() => {
    if (defaultRepo) selectedRepo = defaultRepo;
    fetchBranches();
  });

  async function fetchBranches() {
    if (!selectedRepo) return;
    loadingBranches = true;
    try {
      branches = await window.groveBench.listBranches(selectedRepo);
    } catch { branches = []; }
    loadingBranches = false;
  }

  let selectedTemplate = $derived(
    pipelineStore.templates.find((t) => t.id === selectedTemplateId) ?? pipelineStore.templates[0],
  );

  function canCreate(): boolean {
    return !!selectedRepo && !!branchName.trim() && !!context.trim() && !!selectedTemplateId && !creating;
  }

  async function handleCreate() {
    if (!canCreate()) return;
    creating = true;
    dialogError = '';

    try {
      await pipelineStore.create({
        repoPath: selectedRepo,
        branchName: branchName.trim(),
        baseBranch,
        templateId: selectedTemplateId,
        context: context.trim(),
      });
      open = false;
      onclose();
    } catch (e: any) {
      dialogError = e.message || String(e);
    } finally {
      creating = false;
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onclose();
  }

  $effect(() => {
    if (selectedRepo) fetchBranches();
  });
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>New Pipeline</Dialog.Title>
      <Dialog.Description>Create an orchestrated multi-agent pipeline.</Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4 py-2">
      <!-- Repository -->
      <div class="space-y-1">
        <Label>Repository</Label>
        <Select.Root type="single" bind:value={selectedRepo}>
          <Select.Trigger class="w-full">
            {selectedRepo ? selectedRepo.split(/[/\\]/).pop() : 'Select...'}
          </Select.Trigger>
          <Select.Content>
            {#each store.repos as repo}
              <Select.Item value={repo}>{repo.split(/[/\\]/).pop()}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <!-- Branch Name -->
      <div class="space-y-1">
        <Label>Branch Name</Label>
        <Input bind:value={branchName} placeholder="feature/my-pipeline" />
      </div>

      <!-- Base Branch -->
      <div class="space-y-1">
        <Label>Base Branch</Label>
        <Select.Root type="single" bind:value={baseBranch}>
          <Select.Trigger class="w-full">
            {baseBranch || 'main'}
          </Select.Trigger>
          <Select.Content>
            {#each branches as branch}
              <Select.Item value={branch}>{branch}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <!-- Pipeline Template -->
      <div class="space-y-1">
        <Label>Pipeline Template</Label>
        <Select.Root type="single" bind:value={selectedTemplateId}>
          <Select.Trigger class="w-full">
            {selectedTemplate?.displayName ?? 'Select...'}
          </Select.Trigger>
          <Select.Content>
            {#each pipelineStore.templates as template}
              <Select.Item value={template.id}>
                <span class="font-medium">{template.displayName}</span>
                <span class="text-xs text-muted-foreground ml-2">{template.description}</span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <!-- Stage Preview -->
      {#if selectedTemplate}
        <div class="flex items-center gap-1 text-xs text-muted-foreground">
          {#each selectedTemplate.stages as stage, i}
            {#if i > 0}<span class="mx-0.5">→</span>{/if}
            <span class="px-1.5 py-0.5 rounded bg-muted capitalize" class:border-primary={stage.gate} class:border={stage.gate}>
              {stage.role}{#if stage.gate} ⏸{/if}
            </span>
          {/each}
        </div>
      {/if}

      <!-- Context -->
      <div class="space-y-1">
        <Label>What to build</Label>
        <textarea
          bind:value={context}
          placeholder="Describe what you want the pipeline to implement..."
          class="w-full min-h-[100px] px-3 py-2 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
        ></textarea>
      </div>

      {#if dialogError}
        <p class="text-destructive text-sm">{dialogError}</p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="secondary" onclick={() => { open = false; onclose(); }}>Cancel</Button>
      <Button onclick={handleCreate} disabled={!canCreate()}>
        {creating ? 'Creating…' : 'Create Pipeline'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
