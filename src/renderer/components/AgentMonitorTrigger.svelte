<script lang="ts">
  /**
   * Opens the agent monitor, from the title bar before Help: an activity
   * icon and the counts of threads that need you (amber) and are working
   * (blue). It counts them the way the sidebar's filter chips do
   * (sessionSpriteState, triageForSprite, triageCounts) and draws them with
   * the chips' marks (AttentionCounts), so the two never disagree.
   */
  import { store } from '../stores/sessions.svelte.js';
  import { agentMonitorStore } from '../stores/agentMonitor.svelte.js';
  import { sessionSpriteState } from '../lib/session-sprite-state.js';
  import { triageCounts, triageForSprite } from '../lib/session-triage.js';
  import AttentionCounts from './AttentionCounts.svelte';
  import ActivityIcon from '@lucide/svelte/icons/activity';

  let counts = $derived(triageCounts(store.sessions.map((s) => ({ state: triageForSprite(sessionSpriteState(s)), todo: false }))));
  /** Only the two the monitor is about: unread and To do stay with the chips. */
  let shown = $derived({ ...counts, unread: 0, todo: 0 });

  let title = $derived.by(() => {
    const needsYou = counts['needs-you'];
    const parts = [needsYou ? `${needsYou} need${needsYou === 1 ? 's' : ''} you` : '', counts.working ? `${counts.working} working` : ''].filter(Boolean);
    return `Agent monitor (Ctrl+Shift+A): ${parts.length ? parts.join(', ') : 'nothing running'}`;
  });
</script>

<button
  onclick={() => agentMonitorStore.toggle()}
  class="win-btn flex h-full items-center gap-1.5 px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
  {title}
  aria-label={title}
  aria-haspopup="dialog"
  data-testid="agent-monitor-trigger"
>
  <ActivityIcon class="size-3.5" aria-hidden="true" />
  <AttentionCounts counts={shown} />
</button>

<style>
  /* Out of the title bar's drag region, like its other buttons. */
  .win-btn {
    -webkit-app-region: no-drag;
  }
</style>
