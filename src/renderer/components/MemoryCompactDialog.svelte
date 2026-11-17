<script lang="ts">
  // Shown when Compact is pressed, before anything runs: the agent, a model
  // for this run, and the planning prompt as it would be sent now.
  import type { MemoryCompactionPreview } from '../../shared/types.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { effectiveCompactTimeoutSeconds } from '../../shared/compact-timeout.js';
  import { defaultModelChoices, DEFAULT_MODEL_VALUE } from '$lib/model-choices.js';
  import { formatFileSize } from '$lib/file-attachments.js';
  import { formatStepDuration } from '$lib/compaction-steps.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import MemoryPromptView from './MemoryPromptView.svelte';

  interface Props {
    preview: MemoryCompactionPreview;
    /** Start the run; `model` is for this run only, undefined for the preview's. */
    onstart: (model: string | undefined) => void;
    oncancel: () => void;
  }

  let { preview, onstart, oncancel }: Props = $props();

  let models = $state<Array<{ id: string; label: string }>>([]);
  let picked = $state(DEFAULT_MODEL_VALUE);

  $effect(() => {
    const agentId = preview.agentId;
    let stale = false;
    window.groveBench.getModels(agentId)
      .then((list) => { if (!stale) models = list; })
      .catch(() => { /* the picker keeps Default only */ });
    return () => { stale = true; };
  });

  const choices = $derived(defaultModelChoices(models, '', preview.model));
  const pickedLabel = $derived(choices.find((c) => c.value === picked)?.label ?? picked);
  const timeoutSeconds = $derived(effectiveCompactTimeoutSeconds(settingsStore.current.memoryCompactTimeoutSeconds));
  const canStart = $derived(!preview.unavailable && preview.plan !== null);
  const planBytes = $derived(preview.plan
    ? new TextEncoder().encode(preview.plan.systemPrompt).length + new TextEncoder().encode(preview.plan.userMessage).length
    : 0);

  function start() {
    if (!canStart) return;
    onstart(picked === DEFAULT_MODEL_VALUE ? undefined : picked);
  }
</script>

<Dialog.Root open={true} onOpenChange={(o) => { if (!o) oncancel(); }}>
  <Dialog.Content class="sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Compact Memory</Dialog.Title>
      <Dialog.Description>
        {preview.fileCount} {preview.fileCount === 1 ? 'file' : 'files'} ({formatFileSize(preview.totalBytes)}).
        One planning call, then up to {preview.maxGroups} merge steps, {preview.parallelMerges} at a time.
        Each call stops after {formatStepDuration(timeoutSeconds * 1000)}. A snapshot is saved before anything changes, so Undo can revert the run.
      </Dialog.Description>
    </Dialog.Header>

    {#if preview.unavailable}
      <Notice tone="danger"><p>{preview.unavailable}</p></Notice>
    {/if}

    <div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
      <span class="text-muted-foreground">Agent</span>
      <div class="min-w-0">
        <p class="text-foreground">{preview.agentName}</p>
        <p class="text-caption text-muted-foreground">The agent of this project's most recently used thread.</p>
      </div>

      <Label for="memory-compact-model" class="text-muted-foreground font-normal">Model</Label>
      <div class="min-w-0">
        <Select.Root type="single" value={picked} onValueChange={(v: string) => { if (v) picked = v; }}>
          <Select.Trigger id="memory-compact-model" class="w-72" aria-label="Model for this compaction run">
            {pickedLabel}
          </Select.Trigger>
          <Select.Content>
            {#each choices as choice (choice.value)}
              <Select.Item value={choice.value} label={choice.label} />
            {/each}
          </Select.Content>
        </Select.Root>
        <p class="text-caption text-muted-foreground mt-1">
          Default is this agent's Background model (Settings, Agents). A model picked here is for this run only.
        </p>
      </div>
    </div>

    {#if preview.plan}
      <details open class="text-xs">
        <summary class="cursor-pointer text-muted-foreground hover:text-foreground select-none">
          Planning prompt ({formatFileSize(planBytes)})
        </summary>
        <div class="mt-2">
          <MemoryPromptView systemPrompt={preview.plan.systemPrompt} userMessage={preview.plan.userMessage} />
        </div>
      </details>
      <p class="text-caption text-muted-foreground">
        Each merge step's prompt is built from the plan's reply. The Memory panel lists the steps as they run, with their prompts and timings.
      </p>
    {:else}
      <p class="text-xs text-muted-foreground">There are no repo, conventions or architecture notes to compact.</p>
    {/if}

    <Dialog.Footer>
      <Button variant="secondary" onclick={oncancel}>Cancel</Button>
      <Button onclick={start} disabled={!canStart}>Start</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
