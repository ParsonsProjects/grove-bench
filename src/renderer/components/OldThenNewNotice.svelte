<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import type { EditDiff } from '../lib/edit-diff.js';

  /** Says a shown edit is the old text, then the new (EditDiff.linedUp
   *  false), or some of its replacements are (partly). When only the quick
   *  try gave up, it offers the full one. */
  let {
    diff,
    label,
    onCompare,
  }: {
    diff: EditDiff;
    /** The button's accessible name, when a page shows several. */
    label?: string;
    /** Work the edit out in full (fullEditDiff with no known diff). */
    onCompare: () => void;
  } = $props();
</script>

{#snippet compare()}<Button size="2xs" variant="link" aria-label={label ?? 'Compare line by line'} onclick={onCompare}>Compare line by line</Button>{/snippet}

<Notice tone="neutral" class="mb-1" actions={diff.quick ? compare : undefined}>
  {#if diff.partly}
    <p>Some replacements have too many changes to compare line by line{diff.quick ? ' without a pause' : ''}, so they show the old text, then the new.</p>
  {:else if diff.quick}
    <p>Too many changes to compare line by line without a pause, so this shows the old text, then the new.</p>
  {:else}
    <p>Too many changes to compare line by line, so this shows the old text, then the new.</p>
  {/if}
</Notice>
