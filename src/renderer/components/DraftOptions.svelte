<script lang="ts">
  /**
   * A draft thread's options: agent settings, where it runs (project and
   * branch) and the group it joins. Everything here can still change
   * because nothing exists yet; sending the first message fixes the agent,
   * the project and where it runs. DraftPane shows them one of two ways:
   *
   * - `column`, beside the message box when the pane has room: each option
   *   under its own label, with nothing cut short.
   * - `strip`, one row along the top of the box otherwise. It never wraps:
   *   the names are cut short instead (their tooltips have them whole).
   *
   * Skills and Start stay at the box's foot either way, so they never move.
   * The menus open downwards, or upwards when they only fit there, and are
   * kept inside the pane sideways (placeInPane). They fade in, as they may
   * open either way.
   */
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import { store } from '../stores/sessions.svelte.js';
  import { draftStore } from '../stores/draft.svelte.js';
  import DraftAgentControl from './DraftAgentControl.svelte';
  import DraftStartPicker from './DraftStartPicker.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import { menuItem, menuPanel } from '$lib/components/ui/menu/index.js';
  import { placeInPane } from '../lib/keep-in-viewport.js';
  import XIcon from '@lucide/svelte/icons/x';

  let { layout = 'strip' }: { layout?: 'strip' | 'column' } = $props();
  const column = $derived(layout === 'column');

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
    return start.branchName.trim() ? from : `${from} · named from your message`;
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

<!-- Project / branch, the detail under them, and their menus. In the
     column the names wrap rather than being cut short. -->
{#snippet where(d: NonNullable<typeof draft>)}
  <div class="relative flex flex-col gap-px leading-snug min-w-0" bind:this={stackRef}>
    <span class="flex items-center gap-1 min-w-0 {column ? 'flex-wrap' : ''}">
      {#if store.repos.length > 1}
        <button
          type="button"
          onclick={() => { projectMenuOpen = !projectMenuOpen; pickerOpen = false; }}
          class="text-muted-foreground hover:text-foreground truncate transition-colors {column ? 'max-w-full' : 'max-w-32'}"
          title="Project: {d.repoPath}. Click to change"
          aria-haspopup="menu"
          aria-expanded={projectMenuOpen}
        >
          {store.repoDisplayName(d.repoPath)}
        </button>
      {:else}
        <span class="text-muted-foreground truncate {column ? 'max-w-full' : 'max-w-32'}" title={d.repoPath}>{store.repoDisplayName(d.repoPath)}</span>
      {/if}
      <span class="text-muted-foreground/30 shrink-0">/</span>
      <button
        type="button"
        onclick={() => { pickerOpen = !pickerOpen; projectMenuOpen = false; }}
        class="text-foreground/80 hover:text-foreground text-left transition-colors border-b border-dashed border-muted-foreground/40
          {column ? 'max-w-full break-all' : 'truncate max-w-56'}"
        title="Where this thread runs: {whereLabel}. Click to pick a branch, a pull request or the project folder"
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
      >
        {whereLabel}
      </button>
    </span>
    <span class="text-caption text-muted-foreground {column ? '' : 'truncate max-w-80'}" title={column ? undefined : whereDetail}>{whereDetail}</span>

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
            class={menuItem({ selected: repo === d.repoPath })}
            title={repo}
          >
            <span class="truncate">{store.repoDisplayName(repo)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet group(name: string)}
  <span class="flex items-center gap-1 min-w-0 text-caption" title={newGroup ? `Starts the group ${name}` : `Joins the group ${name} when it starts`}>
    {#if !column}<span class="text-muted-foreground shrink-0">{newGroup ? 'New group' : 'Group'}</span>{/if}
    <span class="text-foreground/80 {column ? 'break-all' : 'truncate max-w-32'}">{name}</span>
    <Button
      variant="quiet"
      size="icon-2xs"
      onclick={() => draftStore.leaveGroup()}
      title="Start it outside the group"
      aria-label="Don't add to {name}"
    >
      <XIcon />
    </Button>
  </span>
{/snippet}

{#if draft}
  {#if column}
    <!-- A container, so the Agent settings button sizes its model name
         from the column's width. -->
    <div class="@container flex flex-col bg-card/60 border border-border text-xs text-muted-foreground" role="group" aria-label="Thread options">
      <div class="flex flex-col items-start gap-1.5 px-3 py-2 min-w-0">
        <SectionLabel>Agent</SectionLabel>
        <DraftAgentControl fit />
      </div>
      <div class="flex flex-col gap-1.5 px-3 py-2 min-w-0 border-t border-border">
        <SectionLabel>Runs in</SectionLabel>
        {@render where(draft)}
      </div>
      {#if groupName}
        <div class="flex flex-col gap-1.5 px-3 py-2 min-w-0 border-t border-border">
          <SectionLabel>{newGroup ? 'New group' : 'Group'}</SectionLabel>
          {@render group(groupName)}
        </div>
      {/if}
    </div>
  {:else}
    <div class="@container flex items-center gap-x-4 px-3 py-1.5 min-w-0 border-b border-border text-xs text-muted-foreground" role="group" aria-label="Thread options">
      <DraftAgentControl fit />
      <span class="w-px self-stretch bg-border shrink-0"></span>
      {@render where(draft)}
      {#if groupName}
        <span class="w-px self-stretch bg-border shrink-0"></span>
        {@render group(groupName)}
      {/if}
    </div>
  {/if}
{/if}
