<script lang="ts">
  /**
   * Status bar for a draft conversation. Same layout as a running one: agent
   * settings on the left, project / branch stack next to it. Everything here
   * can still change because nothing exists yet; sending the first message
   * fixes the agent, the project and where it runs.
   */
  import { onMount, onDestroy } from 'svelte';
  import { fly } from 'svelte/transition';
  import { store } from '../stores/sessions.svelte.js';
  import { draftStore } from '../stores/draft.svelte.js';
  import DraftAgentControl from './DraftAgentControl.svelte';
  import DraftStartPicker from './DraftStartPicker.svelte';

  let pickerOpen = $state(false);
  let projectMenuOpen = $state(false);
  let stackRef = $state<HTMLDivElement | null>(null);

  const draft = $derived(draftStore.draft);
  const start = $derived(draft?.start);

  const whereLabel = $derived.by(() => {
    if (!start) return '';
    if (start.kind === 'folder') return 'project folder';
    if (start.kind === 'existing') return start.pr ? `#${start.pr.number} ${start.branch}` : start.branch;
    return start.branchName.trim() || 'new branch';
  });

  const whereDetail = $derived.by(() => {
    if (!start) return '';
    if (start.kind === 'folder') {
      return draft && store.isFolderProject(draft.repoPath) ? 'no separate copy · no git' : 'no separate copy · its current branch';
    }
    if (start.kind === 'existing') return start.pr ? start.pr.title : 'existing branch · separate copy';
    const from = start.baseBranch.trim() ? `from ${start.baseBranch.trim()}` : 'from the default branch';
    return start.branchName.trim() ? from : `${from} · named after the first reply`;
  });

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as Node;
    if ((pickerOpen || projectMenuOpen) && stackRef && target.isConnected && !stackRef.contains(target)) {
      pickerOpen = false;
      projectMenuOpen = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((pickerOpen || projectMenuOpen) && e.key === 'Escape') {
      e.stopPropagation();
      pickerOpen = false;
      projectMenuOpen = false;
    }
  }

  onMount(() => {
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKeydown, true);
  });

  onDestroy(() => {
    window.removeEventListener('click', handleClickOutside);
    window.removeEventListener('keydown', handleKeydown, true);
  });
</script>

{#if draft}
<div class="flex items-center gap-4 px-4 py-1 bg-card border-t border-b border-border text-xs text-muted-foreground shrink-0">
  <DraftAgentControl />

  <span class="w-px self-stretch bg-border"></span>

  <div class="relative flex flex-col gap-px leading-snug min-w-0" bind:this={stackRef}>
    <span class="flex items-center gap-1 min-w-0">
      {#if store.repos.length > 1}
        <button
          type="button"
          onclick={() => { projectMenuOpen = !projectMenuOpen; pickerOpen = false; }}
          class="text-muted-foreground/70 hover:text-foreground truncate max-w-32 transition-colors"
          title="Project: {draft.repoPath}. Click to change"
          aria-haspopup="menu"
          aria-expanded={projectMenuOpen}
        >
          {store.repoDisplayName(draft.repoPath)}
        </button>
      {:else}
        <span class="text-muted-foreground/50 truncate max-w-32" title={draft.repoPath}>{store.repoDisplayName(draft.repoPath)}</span>
      {/if}
      <span class="text-muted-foreground/30 shrink-0">/</span>
      <button
        type="button"
        onclick={() => { pickerOpen = !pickerOpen; projectMenuOpen = false; }}
        class="text-foreground/80 hover:text-foreground truncate max-w-56 transition-colors border-b border-dashed border-muted-foreground/40"
        title="Where this conversation runs. Click to pick a branch, a pull request or the project folder"
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
      >
        {whereLabel}
      </button>
    </span>
    <span class="text-[11px] text-muted-foreground/60 truncate max-w-80">{whereDetail}</span>

    {#if pickerOpen}
      <div transition:fly={{ y: 6, duration: 140 }} class="absolute bottom-full left-0 mb-2 z-50">
        <DraftStartPicker onclose={() => pickerOpen = false} />
      </div>
    {/if}

    {#if projectMenuOpen}
      <div transition:fly={{ y: 6, duration: 140 }} class="absolute bottom-full left-0 mb-2 z-50 min-w-48 bg-popover border border-border shadow-xl p-1" role="menu" aria-label="Project">
        {#each store.repos as repo (repo)}
          <button
            type="button"
            role="menuitem"
            onclick={() => { draftStore.setRepo(repo); projectMenuOpen = false; }}
            class="w-full text-left px-2 py-1 hover:bg-accent truncate {repo === draft.repoPath ? 'text-foreground bg-accent/50' : 'text-muted-foreground'}"
            title={repo}
          >
            {store.repoDisplayName(repo)}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <span class="ml-auto text-[11px] text-muted-foreground/50 text-right">Nothing is created until you send</span>
</div>
{/if}
