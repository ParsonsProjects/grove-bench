<script lang="ts">
  /**
   * The conversation's goal, pinned at the top of the Thread tab: one line on
   * what it is trying to get done. Written once after the first reply by the
   * conversation's agent; Edit replaces it with your own words and Refresh
   * writes a new one. Close hides it for this conversation; Settings >
   * Tending turns it off everywhere.
   */
  import { tick, untrack } from 'svelte';
  import { goalStore } from '../stores/goals.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { hasAgentReply } from '$lib/message-view.js';

  let { sessionId }: { sessionId: string } = $props();

  let goal = $derived(goalStore.get(sessionId));
  let generating = $derived(goalStore.isGenerating(sessionId));
  let error = $derived(goalStore.error(sessionId));
  let replied = $derived(hasAgentReply(messageStore.getMessages(sessionId)));
  let running = $derived(messageStore.getIsRunning(sessionId));

  let editing = $state(false);
  let expanded = $state(false);
  let draft = $state('');
  let input = $state<HTMLInputElement>();

  $effect(() => {
    const id = sessionId;
    untrack(() => { void goalStore.load(id); });
  });

  // With no goal yet, the first turn's end writes one; until it ends there
  // is nothing to show. A goal you cleared keeps its (empty) bar.
  let visible = $derived(
    settingsStore.current.showConversationGoal
      && goalStore.isLoaded(sessionId)
      && !goal.hidden
      && (!!goal.text || generating || editing || (replied && (goal.source !== null || !running))),
  );

  async function startEdit() {
    goalStore.clearError(sessionId);
    draft = goal.text ?? '';
    editing = true;
    await tick();
    input?.focus();
    input?.select();
  }

  function commit() {
    if (!editing) return;
    editing = false;
    const next = draft.trim();
    if (next !== (goal.text ?? '')) void goalStore.save(sessionId, next);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      // Only cancels the edit: the Escape doesn't reach other handlers.
      e.preventDefault();
      e.stopPropagation();
      editing = false;
    }
  }

  const ICON_BUTTON = 'shrink-0 p-0.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:hover:text-muted-foreground';
</script>

{#if visible}
  <div class="flex items-start gap-2 px-4 py-1 border-b border-border bg-card/40 text-xs shrink-0 min-w-0" data-testid="conversation-goal">
    <span class="flex items-center gap-1 py-0.5 text-muted-foreground shrink-0">
      <!-- A pixel flag on its pole. -->
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 24 24" class="shrink-0" aria-hidden="true"><path d="M4 2h2v20H4Zm2 1h14v2H6Zm12 2h2v6h-2ZM6 11h14v2H6Z"/></svg>
      Goal
    </span>

    {#if editing}
      <input
        bind:this={input}
        bind:value={draft}
        onkeydown={handleKeydown}
        onblur={commit}
        type="text"
        maxlength={500}
        placeholder="What should this conversation get done?"
        aria-label="Conversation goal"
        class="flex-1 min-w-0 bg-transparent border border-input px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-ring placeholder:text-muted-foreground"
      />
    {:else if goal.text}
      <button
        type="button"
        onclick={() => { expanded = !expanded; }}
        aria-expanded={expanded}
        title={expanded ? 'Show one line' : goal.text}
        class="flex-1 min-w-0 py-0.5 text-left text-foreground/90 {expanded ? 'whitespace-normal break-words' : 'truncate'} {generating ? 'opacity-60' : ''}"
      >{goal.text}</button>
    {:else if generating}
      <span class="flex-1 min-w-0 py-0.5 truncate text-muted-foreground animate-pulse">Writing a goal…</span>
    {:else}
      <span class="flex-1 min-w-0 py-0.5 truncate text-muted-foreground">No goal yet</span>
    {/if}

    {#if !editing}
      {#if error}
        <span class="py-0.5 text-destructive truncate max-w-[40%]" title={error} role="status">{error}</span>
      {/if}
      <div class="flex items-center gap-0.5 py-0.5 shrink-0">
        <button type="button" class={ICON_BUTTON} onclick={startEdit} title="Edit the goal" aria-label="Edit the goal">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button
          type="button"
          class={ICON_BUTTON}
          onclick={() => goalStore.refresh(sessionId)}
          disabled={generating}
          title="Write a new goal from the conversation so far (one background model call)"
          aria-label="Refresh the goal"
        >
          <svg class="w-3.5 h-3.5 {generating ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
        <button
          type="button"
          class={ICON_BUTTON}
          onclick={() => goalStore.setHidden(sessionId, true)}
          title="Hide the goal for this conversation"
          aria-label="Hide the goal"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
    {/if}
  </div>
{/if}
