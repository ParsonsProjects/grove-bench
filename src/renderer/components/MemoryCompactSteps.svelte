<script lang="ts">
  // The model calls of a compaction run, as they start and end: state, files,
  // timings and a button that shows the prompt the call was sent.
  import type { MemoryCompactionStep } from '../../shared/types.js';
  import { Badge, type BadgeTone } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { stepTiming } from '$lib/compaction-steps.js';

  interface Props {
    steps: MemoryCompactionStep[];
    /** The clock running steps' elapsed times are read against (epoch ms). */
    now: number;
    onview: (step: MemoryCompactionStep) => void;
  }

  let { steps, now, onview }: Props = $props();

  // Blue in progress, green done, amber worth a look, red failed.
  const tones: Record<MemoryCompactionStep['state'], BadgeTone> = {
    running: 'info',
    done: 'success',
    rejected: 'warning',
    failed: 'danger',
    'timed out': 'danger',
    cancelled: 'muted',
  };
</script>

<ul class="flex flex-col gap-1 max-h-40 overflow-auto" aria-label="Compaction steps">
  {#each steps as step (step.index)}
    <li class="flex items-center gap-2 px-2 py-1 bg-card border border-border text-xs">
      <Badge tone={tones[step.state]} class="uppercase tracking-wide w-18 justify-center">{step.state}</Badge>
      <div class="flex-1 min-w-0">
        <p class="text-foreground truncate" title={step.label}>{step.label}</p>
        {#if step.detail}
          <p class="text-caption text-muted-foreground truncate" title={step.detail}>{step.detail}</p>
        {/if}
      </div>
      <span class="text-caption text-muted-foreground tabular-nums shrink-0">{stepTiming(step, now)}</span>
      <Button size="2xs" variant="subtle" onclick={() => onview(step)} aria-label="Show the prompt of {step.label}">
        Prompt
      </Button>
    </li>
  {/each}
</ul>
