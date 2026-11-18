<script lang="ts">
  /**
   * The thread's linked projects (docs/linked-projects-plan.md), one
   * lozenge each after the branch's (StatusBarLinkedItem). Read only:
   * committing, pushing and PRs in a linked project are the agent's or
   * yours. Keeps their state read while the bar shows the thread
   * (linkedStore), and again at the end of each turn.
   */
  import { store } from '../stores/sessions.svelte.js';
  import { linkedStore } from '../stores/linked.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import StatusBarLinkedItem from './StatusBarLinkedItem.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let linkedRepos = $derived(store.sessions.find((s) => s.id === sessionId)?.linkedRepos ?? []);
  let statuses = $derived(linkedStore.get(sessionId));
  let isRunning = $derived(messageStore.getIsRunning(sessionId));

  $effect(() => {
    if (linkedRepos.length === 0) return;
    return linkedStore.watch(sessionId);
  });

  // A turn may have committed, pushed or opened a PR in a linked project.
  let prevRunning = $state(false);
  $effect(() => {
    if (prevRunning && !isRunning && linkedRepos.length > 0) void linkedStore.refresh(sessionId);
    prevRunning = isRunning;
  });
</script>

{#if linkedRepos.length > 0}
  {#each statuses as s (s.repoPath)}
    <StatusBarLinkedItem {sessionId} status={s} />
  {/each}
{/if}
