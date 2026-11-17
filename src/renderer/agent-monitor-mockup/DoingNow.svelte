<script lang="ts">
  /**
   * What a thread or subagent is doing, on one line: the tool and what it
   * runs on (yellow, as in the status bar), Thinking (purple), or what it
   * waits for you on (amber). How long it has been, at the end.
   */
  import type { Doing } from './mock-data.js';
  import { duration } from './format.js';

  let { doing, now, idle = 'Ready', showTime = true }: {
    doing: Doing;
    now: number;
    /** The words for a thread or subagent doing nothing. */
    idle?: string;
    showTime?: boolean;
  } = $props();

  let elapsed = $derived(doing.kind === 'idle' ? 0 : now - doing.startedAt);
</script>

<span class="flex min-w-0 items-center gap-1.5">
  {#if doing.kind === 'tool'}
    <span class="shrink-0 font-medium text-yellow-400">{doing.call.name}</span>
    <span class="truncate text-muted-foreground" title={doing.call.summary}>{doing.call.summary}</span>
  {:else if doing.kind === 'thinking'}
    <span class="text-purple-400">Thinking</span>
  {:else if doing.kind === 'writing'}
    <span class="text-foreground">Writing</span>
  {:else if doing.kind === 'waiting'}
    <span class="shrink-0 font-medium text-status-attention">Needs you</span>
    <span class="truncate text-muted-foreground" title={doing.prompt}>{doing.prompt}</span>
  {:else}
    <span class="truncate text-muted-foreground">{idle}</span>
  {/if}
  {#if showTime && doing.kind !== 'idle'}
    <span class="ml-auto shrink-0 pl-1 tabular-nums text-muted-foreground">{duration(elapsed)}</span>
  {/if}
</span>
