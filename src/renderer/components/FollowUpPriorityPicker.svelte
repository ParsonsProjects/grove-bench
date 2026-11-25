<script lang="ts">
  import * as Select from '$lib/components/ui/select/index.js';
  import {
    FOLLOW_UP_PRIORITIES,
    FOLLOW_UP_PRIORITY_LABELS,
    isFollowUpPriority,
    type FollowUpPriority,
  } from '../../shared/follow-ups.js';

  /**
   * A follow-up's priority as a small chip that opens a list to change it:
   * on the board's follow-up cards and in the Follow-ups drawer. High wears
   * amber (BRAND.md: amber needs you), so it stands out in a column; normal
   * and low stay quiet.
   *
   * It always shows the saved priority: the Select reads `value` through a
   * function binding rather than keeping the pick itself, so it changes
   * once main has saved it, and a pick that couldn't be saved goes back
   * (and can be picked again to retry).
   */
  let { value, title, onchange }: {
    value: FollowUpPriority;
    /** The follow-up's title, for the label read out. */
    title: string;
    onchange: (priority: FollowUpPriority) => void;
  } = $props();

  const TONE: Record<FollowUpPriority, string> = {
    high: 'text-amber-500 border-amber-500/50',
    normal: 'text-muted-foreground border-border',
    low: 'text-muted-foreground/80 border-border border-dashed',
  };
</script>

<Select.Root
  type="single"
  bind:value={() => value, (v: string) => { if (isFollowUpPriority(v) && v !== value) onchange(v); }}
>
  <Select.Trigger
    class="data-[size=default]:h-5 gap-0.5 px-1 py-0 text-micro font-medium shadow-none dark:bg-transparent [&_svg]:size-2.5 {TONE[value]}"
    aria-label="Priority of {title}: {FOLLOW_UP_PRIORITY_LABELS[value]}. Change it"
    title="Priority: how soon to pick it up. Click to change it"
    data-follow-up-priority={value}
  >{FOLLOW_UP_PRIORITY_LABELS[value]}</Select.Trigger>
  <Select.Content>
    {#each FOLLOW_UP_PRIORITIES as p (p)}
      <Select.Item value={p} label={FOLLOW_UP_PRIORITY_LABELS[p]} />
    {/each}
  </Select.Content>
</Select.Root>
