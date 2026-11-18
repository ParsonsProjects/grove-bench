<script lang="ts">
  /**
   * What opens the agent monitor: a button in the title bar, before Help,
   * with an activity icon and the counts. inject-trigger.ts puts it there on
   * the mockup page without changing the app's code; in the app it would be
   * in TitleBar.svelte.
   *
   * It counts threads the way the sidebar's filter chips do (the same
   * sessionSpriteState, triageForSprite and triageCounts), so its numbers
   * can't disagree with theirs, and shows them with the chips' marks
   * (AttentionCounts): amber needs you, blue working.
   */
  import { store } from '../stores/sessions.svelte.js';
  import { sessionSpriteState } from '../lib/session-sprite-state.js';
  import { triageCounts, triageForSprite } from '../lib/session-triage.js';
  import AttentionCounts from '../components/AttentionCounts.svelte';
  import ActivityIcon from '@lucide/svelte/icons/activity';

  let { onopen }: { onopen: () => void } = $props();

  let counts = $derived(triageCounts(store.sessions.map((s) => ({ state: triageForSprite(sessionSpriteState(s)), todo: false }))));
  let needsYou = $derived(counts['needs-you']);
  let working = $derived(counts.working);
  /** Only the two the monitor is about: unread and To do stay with the chips. */
  let shown = $derived({ ...counts, unread: 0, todo: 0 });

  let title = $derived.by(() => {
    const parts = [needsYou ? `${needsYou} need${needsYou === 1 ? 's' : ''} you` : '', working ? `${working} working` : ''].filter(Boolean);
    return `Agent monitor (Ctrl+Shift+A): ${parts.length ? parts.join(', ') : 'nothing running'}`;
  });
</script>

<!-- Out of the title bar's drag region, like its other buttons. -->
<button
  onclick={onopen}
  class="no-drag flex h-full items-center gap-1.5 px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
  {title}
  aria-label={title}
  data-monitor-trigger
>
  <ActivityIcon class="size-3.5" aria-hidden="true" />
  <AttentionCounts counts={shown} />
</button>

<style>
  .no-drag {
    -webkit-app-region: no-drag;
  }
</style>
