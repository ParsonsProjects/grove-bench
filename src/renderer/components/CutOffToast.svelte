<script lang="ts">
  /**
   * At launch, the threads whose turns were cut off when Grove Bench last
   * stopped (shared/cut-off.ts): Continue all, or show the first. Each thread
   * keeps its own notice, so closing this loses nothing. It goes once every
   * one is answered (continued, dismissed, or a new prompt).
   */
  import { fly } from 'svelte/transition';
  import PlayIcon from '@lucide/svelte/icons/play';
  import XIcon from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { cutOffReasonText } from '../../shared/cut-off.js';
  import type { CutOff } from '../../shared/types.js';

  let { threads, onContinueAll, onShow, onClose }: {
    /** The cut-off threads still unanswered, in sidebar order. */
    threads: { id: string; name: string; cutOff: CutOff }[];
    onContinueAll: () => void;
    onShow: () => void;
    onClose: () => void;
  } = $props();

  const MAX_NAMES = 3;

  let one = $derived(threads.length === 1);
  let names = $derived.by(() => {
    const shown = threads.slice(0, MAX_NAMES).map((t) => t.name);
    const more = threads.length - shown.length;
    if (more > 0) return `${shown.join(', ')} and ${more} more`;
    return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : (shown[0] ?? '');
  });
  // Said once when they all stopped the same way, as a quit cuts every one.
  let why = $derived.by(() => {
    const first = threads[0]?.cutOff;
    if (!first || threads.some((t) => t.cutOff.reason !== first.reason)) return null;
    return cutOffReasonText(first.reason, first.at, threads.length > 1);
  });
</script>

{#if threads.length > 0}
  <!-- Placed by the toast stack in App.svelte. -->
  <div transition:fly={{ y: 8, duration: 140 }} data-testid="cut-off-toast">
    <div class="bg-popover border border-border shadow-xl">
      <Notice tone="warning" title={one ? '1 turn was cut off' : `${threads.length} turns were cut off`} layout="stacked">
        {#snippet actions()}
          <Button size="xs" variant="subtle-primary" onclick={onContinueAll} title="Ask each agent to check where it got to and carry on">
            <PlayIcon />
            {one ? 'Continue' : 'Continue all'}
          </Button>
          <Button size="xs" variant="subtle" onclick={onShow}>{one ? 'Show it' : 'Show them'}</Button>
        {/snippet}
        <div class="flex items-start gap-2">
          <p class="flex-1">
            {#if why}{why}{:else}Grove Bench stopped before these agents finished.{/if}
            {one ? 'Thread' : 'Threads'}: {names}.
          </p>
          <Button size="icon-2xs" variant="quiet" aria-label="Close" title="Close. Each thread keeps its notice." onclick={onClose}>
            <XIcon />
          </Button>
        </div>
      </Notice>
    </div>
  </div>
{/if}
