<script lang="ts">
  /**
   * A header's attention counts (project or group): how many of its
   * conversations need you, are working, or are unread, with the same dots
   * as the sidebar's filter chips. A count of zero isn't shown.
   */
  import type { TriageCounts } from '../lib/session-triage.js';

  let { counts }: { counts: TriageCounts } = $props();
</script>

{#if counts['needs-you']}
  <span class="flex items-center gap-0.5 text-[10px] text-amber-500 shrink-0" title="{counts['needs-you']} need{counts['needs-you'] === 1 ? 's' : ''} you"><span class="w-1.5 h-1.5 bg-amber-500"></span>{counts['needs-you']}</span>
{/if}
{#if counts.working}
  <span class="flex items-center gap-0.5 text-[10px] text-primary shrink-0" title="{counts.working} working"><span class="w-1.5 h-1.5 bg-primary"></span>{counts.working}</span>
{/if}
{#if counts.unread}
  <span class="flex items-center gap-0.5 text-[10px] text-green-400 shrink-0" title="{counts.unread} unread"><span class="w-1.5 h-1.5 bg-green-400"></span>{counts.unread}</span>
{/if}
