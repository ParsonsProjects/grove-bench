<script lang="ts">
  /**
   * Options for a draft conversation, along the foot of its message box
   * (DraftPane). Same layout as a running one's status bar: agent settings
   * on the left, project / branch stack next to it. Everything here can
   * still change because nothing exists yet; sending the first message
   * fixes the agent, the project and where it runs. The box sits in the
   * middle of the pane, so its menus open downwards, or upwards when they
   * only fit there (placeInPane). They fade in, as they may open either way.
   */
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import { store } from '../stores/sessions.svelte.js';
  import { draftStore } from '../stores/draft.svelte.js';
  import DraftAgentControl from './DraftAgentControl.svelte';
  import DraftStartPicker from './DraftStartPicker.svelte';
  import DraftSkillsButton from './DraftSkillsButton.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { menuItem, menuPanel } from '$lib/components/ui/menu/index.js';
  import { placeInPane } from '../lib/keep-in-viewport.js';
  import XIcon from '@lucide/svelte/icons/x';

  /** After a skill is picked, so the message box takes the cursor back. */
  let { onskill }: { onskill?: () => void } = $props();

  let pickerOpen = $state(false);
  let projectMenuOpen = $state(false);
  let stackRef = $state<HTMLDivElement | null>(null);

  const draft = $derived(draftStore.draft);
  const start = $derived(draft?.start);
  /** The group the conversation joins, or starts, when it starts. */
  const groupName = $derived(draftStore.groupName);
  const newGroup = $derived(!!draft?.newGroupName);

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
    if (draftStore.onGroupBranch) return `the group's branch · ${from}, or continued if the project has it`;
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
<!-- A container like the conversation bar, so the shared Agent settings
     button sizes its model name from this row. The row is narrower than the
     button's wide breakpoint, so the name keeps its short width here rather
     than widening with some outer container. -->
<div class="@container flex-1 min-w-0 flex items-center gap-4 text-xs text-muted-foreground">
  <DraftAgentControl />

  <span class="w-px self-stretch bg-border"></span>

  <div class="relative flex flex-col gap-px leading-snug min-w-0" bind:this={stackRef}>
    <span class="flex items-center gap-1 min-w-0">
      {#if store.repos.length > 1}
        <button
          type="button"
          onclick={() => { projectMenuOpen = !projectMenuOpen; pickerOpen = false; }}
          class="text-muted-foreground hover:text-foreground truncate max-w-32 transition-colors"
          title="Project: {draft.repoPath}. Click to change"
          aria-haspopup="menu"
          aria-expanded={projectMenuOpen}
        >
          {store.repoDisplayName(draft.repoPath)}
        </button>
      {:else}
        <span class="text-muted-foreground truncate max-w-32" title={draft.repoPath}>{store.repoDisplayName(draft.repoPath)}</span>
      {/if}
      <span class="text-muted-foreground/30 shrink-0">/</span>
      <button
        type="button"
        onclick={() => { pickerOpen = !pickerOpen; projectMenuOpen = false; }}
        class="text-foreground/80 hover:text-foreground truncate max-w-56 transition-colors border-b border-dashed border-muted-foreground/40"
        title="Where this thread runs. Click to pick a branch, a pull request or the project folder"
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
      >
        {whereLabel}
      </button>
    </span>
    <span class="text-caption text-muted-foreground truncate max-w-80">{whereDetail}</span>

    {#if pickerOpen}
      <div transition:fade={{ duration: 120 }} use:placeInPane class="absolute top-full left-0 mt-2 z-50">
        <DraftStartPicker onclose={() => pickerOpen = false} />
      </div>
    {/if}

    {#if projectMenuOpen}
      <div transition:fade={{ duration: 120 }} use:placeInPane class="{menuPanel()} absolute top-full left-0 mt-2 z-50 min-w-48" role="menu" aria-label="Project">
        {#each store.repos as repo (repo)}
          <button
            type="button"
            role="menuitem"
            onclick={() => { draftStore.setRepo(repo); projectMenuOpen = false; }}
            class={menuItem({ selected: repo === draft.repoPath })}
            title={repo}
          >
            <span class="truncate">{store.repoDisplayName(repo)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if groupName}
    <span class="w-px self-stretch bg-border"></span>
    <span class="flex items-center gap-1 min-w-0 text-caption" title={newGroup ? `Starts the group ${groupName}` : `Joins the group ${groupName} when it starts`}>
      <span class="text-muted-foreground shrink-0">{newGroup ? 'New group' : 'Group'}</span>
      <span class="text-foreground/80 truncate max-w-32">{groupName}</span>
      <Button
        variant="quiet"
        size="icon-2xs"
        onclick={() => draftStore.leaveGroup()}
        title="Start it outside the group"
        aria-label="Don't add to {groupName}"
      >
        <XIcon />
      </Button>
    </span>
  {/if}

  <DraftSkillsButton onpick={onskill} />

</div>
{/if}
