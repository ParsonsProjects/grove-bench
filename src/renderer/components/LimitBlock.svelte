<script lang="ts">
  /** A thread paused at one of the user's limits (Settings > Limits): why,
   *  and whether to go on for another round of it or stop the turn. */
  import { messageStore } from '../stores/messages.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { limitGrantText, limitReachedText, limitSetting, type LimitKind } from '../../shared/limits.js';
  import { PERMISSION_TIMEOUT_MINUTES } from '../../shared/types.js';

  let {
    sessionId,
    requestId,
    limit,
    used,
    reachedAt,
    resolved,
    decision,
    timedOut = false,
  }: {
    sessionId: string;
    requestId: string;
    limit: LimitKind;
    used: number;
    reachedAt: number;
    resolved: boolean;
    decision?: 'continue' | 'stop';
    timedOut?: boolean;
  } = $props();

  let busy = $state(false);

  const spend = $derived(limit === 'dailySpend' || limit === 'threadSpend');
  // The grant is the setting as it is now: Continue gives another round of it.
  const grant = $derived(limitGrantText(limit, limitSetting(settingsStore.current, limit)));

  const resolvedLabel = $derived(
    decision === 'continue' ? `continued for ${grant}`
      : timedOut ? `stopped: no answer within ${PERMISSION_TIMEOUT_MINUTES} minutes`
        : 'stopped',
  );

  async function respond(choice: 'continue' | 'stop') {
    if (busy || resolved) return;
    busy = true;
    try {
      await messageStore.respondToLimit(sessionId, requestId, choice);
    } finally {
      busy = false;
    }
  }
</script>

<div class="py-1 my-1 border-l-4 {resolved ? 'border-border' : 'border-amber-400'} pl-3" data-testid="limit-block">
  <div class="flex items-center gap-2 text-xs">
    <span class="{resolved ? 'text-muted-foreground' : 'text-amber-400'} font-bold">limit reached</span>
  </div>
  <p class="text-sm text-foreground mt-1">{limitReachedText(limit, used, reachedAt)}</p>
  {#if spend && !resolved}
    <p class="text-xs text-muted-foreground mt-0.5">Spend is the agent's own estimate, counted when each turn ends.</p>
  {/if}

  {#if resolved}
    <div class="text-xs mt-2 text-muted-foreground">{resolvedLabel}</div>
  {:else}
    <div class="flex flex-wrap items-center gap-2 mt-2">
      <Button variant="outline" size="sm" onclick={() => respond('continue')} disabled={busy} class="text-amber-400 border-amber-400 hover:bg-amber-900/30">
        Continue for {grant}
      </Button>
      <Button variant="ghost" size="sm" onclick={() => respond('stop')} disabled={busy}>Stop the turn</Button>
      <button type="button" class="text-xs text-primary hover:underline" onclick={() => settingsStore.openAt('limits')}>
        Change limits
      </button>
    </div>
  {/if}
</div>
