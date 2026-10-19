<script lang="ts">
  /**
   * A header's attention counts (project or group): how many of its
   * conversations need you, are working, are unread, or are flagged To do,
   * with the same marks as the sidebar's filter chips. A count of zero isn't
   * shown.
   */
  import type { TriageCounts } from '../lib/session-triage.js';
  import TodoMark from './TodoMark.svelte';

  let { counts }: { counts: TriageCounts } = $props();
</script>

{#if counts['needs-you']}
  <span class="flex items-center gap-0.5 text-micro text-status-attention shrink-0" title="{counts['needs-you']} need{counts['needs-you'] === 1 ? 's' : ''} you"><span class="w-1.5 h-1.5 bg-status-attention"></span>{counts['needs-you']}</span>
{/if}
{#if counts.working}
  <span class="flex items-center gap-0.5 text-micro text-status-working shrink-0" title="{counts.working} working"><span class="w-1.5 h-1.5 bg-status-working"></span>{counts.working}</span>
{/if}
{#if counts.unread}
  <span class="flex items-center gap-0.5 text-micro text-status-unread shrink-0" title="{counts.unread} unread"><span class="w-1.5 h-1.5 bg-status-unread"></span>{counts.unread}</span>
{/if}
{#if counts.todo}
  <span class="flex items-center gap-0.5 text-micro text-foreground/80 shrink-0" title="{counts.todo} to do"><TodoMark />{counts.todo}</span>
{/if}
