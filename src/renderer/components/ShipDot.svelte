<script lang="ts">
  /**
   * One step's dot in the branch lozenge's popup (lib/ship-track.ts):
   * filled when the step stands somewhere, hollow when it is to come (bright
   * for the one to take now), and moving while it runs.
   */
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import type { ShipStepState } from '../lib/ship-track.js';

  let { state }: { state: ShipStepState } = $props();

  const DOT: Record<Exclude<ShipStepState, 'running'>, string> = {
    done: 'bg-green-500',
    next: 'border border-foreground',
    failed: 'bg-red-500',
    attention: 'bg-amber-500',
    merged: 'bg-purple-400',
    closed: 'bg-muted-foreground/50',
    todo: 'border border-muted-foreground/50',
  };
</script>

{#if state === 'running'}
  <Pulse size="xs" />
{:else}
  <span class="size-1.5 shrink-0 {DOT[state]}"></span>
{/if}
