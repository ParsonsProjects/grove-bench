<script lang="ts">
  /**
   * What a thread or subagent is doing, on one line, in the agent monitor:
   * the tool and its target (yellow, as in the status bar), Thinking
   * (purple), Writing, or what it waits for you on (amber). How long the
   * tool has run goes at the end.
   */
  import type { MonitorDoing } from '../lib/agent-monitor.js';
  import { formatAgentTime } from '../lib/usage-report.js';

  let { doing, idle = 'Ready' }: {
    doing: MonitorDoing;
    /** The words for one doing nothing. */
    idle?: string;
  } = $props();
</script>

<span class="flex min-w-0 items-center gap-1.5">
  {#if doing.kind === 'tool'}
    <span class="shrink-0 font-medium text-yellow-400">{doing.name}</span>
    <span class="truncate text-muted-foreground" title={doing.summary}>{doing.summary}</span>
    {#if doing.seconds}<span class="ml-auto shrink-0 pl-1 tabular-nums text-muted-foreground">{formatAgentTime(doing.seconds * 1000)}</span>{/if}
  {:else if doing.kind === 'thinking'}
    <span class="text-purple-400">Thinking</span>
  {:else if doing.kind === 'writing'}
    <span class="text-status-working">Writing</span>
  {:else if doing.kind === 'working'}
    <span class="text-status-working">Working</span>
  {:else if doing.kind === 'waiting'}
    <span class="shrink-0 font-medium text-status-attention">Needs you</span>
    <span class="truncate text-muted-foreground" title={doing.text}>{doing.text}</span>
  {:else}
    <span class="truncate text-muted-foreground">{idle}</span>
  {/if}
</span>
