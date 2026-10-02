<script lang="ts">
  /**
   * The sidebar's Groups section: conversations that belong to one piece of
   * work, usually across projects, listed together. Each conversation still
   * runs in its own project; it shows here as well as in Conversations and
   * Projects. Also hosts the group name dialog, which the conversation menu
   * opens too (groupStore.nameRequest).
   */
  import { untrack, type Snippet } from 'svelte';
  import { store } from '../stores/sessions.svelte.js';
  import { groupStore, groupName, type GroupNameRequest } from '../stores/groups.svelte.js';
  import { draftStore } from '../stores/draft.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import ContextMenu from './ContextMenu.svelte';
  import AttentionCounts from './AttentionCounts.svelte';
  import SidebarSection from './SidebarSection.svelte';
  import type { TriageCounts } from '../lib/session-triage.js';

  type Session = (typeof store.sessions)[number];

  let {
    row,
    rowVisible,
    countsFor,
    stopSessions,
    filterLabel,
  }: {
    /** The sidebar's conversation row: session, show project, label
     *  override, show group. */
    row: Snippet<[Session, boolean, string | null, boolean]>;
    /** Whether a conversation passes the sidebar's filter. */
    rowVisible: (s: Session) => boolean;
    /** A header's attention counts, as the project headers count them. */
    countsFor: (sessions: Session[]) => TriageCounts;
    /** The sidebar's Close Conversation: stops conversations and keeps them,
     *  asking first if any is mid-turn. */
    stopSessions: (ids: string[]) => void;
    /** The active triage filter's label, or null when showing all. */
    filterLabel: string | null;
  } = $props();

  // Shown once there is a group, or once there are two projects to work
  // across, and never before the saved groups are read.
  // Offered once there are conversations to group, across more than one project.
  let visible = $derived(groupStore.ready && (groupStore.groups.length > 0 || (store.repos.length > 1 && store.sessions.length > 0)));

  /** Folded groups. Kept for this run only, like the Projects tree's branches. */
  let collapsed = $state<Record<string, boolean>>({});

  function toggle(id: string) {
    collapsed = { ...collapsed, [id]: !collapsed[id] };
  }

  /** Every grouped conversation, for the section heading's counts. */
  let grouped = $derived(groupStore.groups.flatMap((g) => groupStore.members(g.id)));

  /** Open a draft that joins the group, in the project it most likely needs. */
  function newConversationIn(groupId: string) {
    draftStore.open(groupStore.nextProject(groupId), { group: { groupId } });
  }

  let menu = $state<{ x: number; y: number; groupId: string } | null>(null);

  function openMenu(e: MouseEvent, groupId: string) {
    e.preventDefault();
    menu = { x: e.clientX, y: e.clientY, groupId };
  }

  function menuItems(groupId: string) {
    const open = groupStore.members(groupId).filter((s) => store.isOpenTab(s));
    return [
      { label: 'New conversation in group', icon: 'add', action: () => newConversationIn(groupId) },
      { label: 'Rename group', icon: 'rename', action: () => { groupStore.nameRequest = { kind: 'rename', groupId }; } },
      // Done with the piece of work: every conversation leaves the working set.
      ...(open.length > 0
        ? [{ label: 'Close all conversations', icon: 'close', action: () => stopSessions(open.map((s) => s.id)) }]
        : []),
      { label: 'Ungroup', icon: 'ungroup', action: () => groupStore.ungroup(groupId), separator: true },
    ];
  }

  // ─── Name dialog ───

  let nameValue = $state('');

  function initialName(req: GroupNameRequest): string {
    if (req.kind === 'rename') return groupStore.get(req.groupId)?.name ?? '';
    const session = req.sessionId ? store.sessions.find((s) => s.id === req.sessionId) : null;
    return session?.displayName ?? '';
  }

  // Fill the field each time the dialog opens.
  $effect(() => {
    const req = groupStore.nameRequest;
    if (req) nameValue = untrack(() => initialName(req));
  });

  function confirmName() {
    const req = groupStore.nameRequest;
    if (!req) return;
    groupStore.nameRequest = null;
    if (req.kind === 'rename') {
      groupStore.rename(req.groupId, nameValue);
      return;
    }
    if (req.sessionId) {
      groupStore.create(nameValue, [req.sessionId]);
    } else {
      // From the header: the group is made when its first conversation
      // starts, so a draft that is discarded leaves no empty group.
      draftStore.open('', { group: { newGroupName: groupName(nameValue) } });
    }
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); confirmName(); }
  }
</script>

{#if visible}
  <!-- The Projects heading comes next, so this one sticks just above it. -->
  <SidebarSection panel="groupsSection" label="Groups" count={groupStore.groups.length} counts={countsFor(grouped)} below={1}>
    {#snippet actions()}
      <button
        type="button"
        onclick={() => { groupStore.nameRequest = { kind: 'new' }; }}
        class="w-5 h-5 shrink-0 flex items-center justify-center text-muted-foreground/70 hover:text-primary hover:bg-sidebar-accent transition-colors"
        title="New group: conversations in different projects that belong to one piece of work"
        aria-label="New group"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      </button>
    {/snippet}

    <div class="pt-1 pb-2">
      {#if groupStore.groups.length === 0}
        <p class="text-xs text-muted-foreground/50 pl-4 py-1">Right-click a conversation to start a group</p>
      {/if}
      {#each groupStore.groups as group (group.id)}
        {@const members = groupStore.members(group.id)}
        {@const shown = members.filter(rowVisible)}
        {@const isCollapsed = !!collapsed[group.id]}
        <div class="mb-3" data-group={group.id}>
          <div
            class="flex items-center justify-between group px-1 py-1"
            oncontextmenu={(e) => openMenu(e, group.id)}
            role="presentation"
          >
            <button
              type="button"
              onclick={() => toggle(group.id)}
              aria-expanded={!isCollapsed}
              class="flex items-center gap-1.5 min-w-0 flex-1 text-left hover:text-foreground transition-colors"
              title={isCollapsed ? 'Expand group' : 'Collapse group'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-muted-foreground/60 transition-transform" style={isCollapsed ? 'transform: rotate(-90deg)' : ''} aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              <span class="text-xs font-medium text-muted-foreground truncate" title={group.name}>{group.name}</span>
              <!-- The rows shown, like a project header's count. -->
              {#if shown.length}
                <span class="text-xs text-muted-foreground/40 shrink-0">{shown.length}</span>
              {/if}
              <AttentionCounts counts={countsFor(members)} />
            </button>
            <div class="flex items-center gap-0.5">
              <!-- Ungroup keeps the conversations, so it's not a bin, and not an ✕ either:
                   a row's ✕ just below closes its conversation. -->
              <button
                type="button"
                onclick={() => groupStore.ungroup(group.id)}
                class="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-all opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                title="Ungroup (the conversations stay)"
                aria-label="Ungroup {group.name}"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="8" height="6" x="5" y="4" rx="1"/><rect width="8" height="6" x="11" y="14" rx="1"/></svg>
              </button>
              <button
                type="button"
                onclick={() => newConversationIn(group.id)}
                class="w-5 h-5 flex items-center justify-center text-muted-foreground/70 hover:text-primary hover:bg-sidebar-accent transition-colors"
                title="New conversation in {group.name}"
                aria-label="New conversation in {group.name}"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
              </button>
            </div>
          </div>

          {#if !isCollapsed}
            <!-- A group spans projects, so each row names its project. -->
            {#each shown as session (session.id)}
              {@render row(session, true, null, false)}
            {/each}
            {#if shown.length === 0}
              <p class="text-xs text-muted-foreground/40 pl-4 py-1">
                {#if members.length === 0}
                  Its conversations are in projects that didn't load
                {:else}
                  No conversations match "{filterLabel}"
                {/if}
              </p>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  </SidebarSection>
{/if}

{#if menu}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    items={menuItems(menu.groupId)}
    label="Group"
    onclose={() => menu = null}
  />
{/if}

{#if groupStore.nameRequest}
  {@const renaming = groupStore.nameRequest.kind === 'rename'}
  <Dialog.Root open={true} onOpenChange={(o) => { if (!o) groupStore.nameRequest = null; }}>
    <Dialog.Content class="max-w-xs">
      <Dialog.Header>
        <Dialog.Title>{renaming ? 'Rename Group' : 'New Group'}</Dialog.Title>
        {#if !renaming}
          <Dialog.Description>
            Conversations in different projects that belong to one piece of work. Each one keeps its own project and agent.
          </Dialog.Description>
        {/if}
      </Dialog.Header>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={nameValue}
        onkeydown={handleNameKeydown}
        placeholder="e.g. Billing"
        aria-label="Group name"
        class="w-full text-sm bg-card border border-border px-2 py-1.5 text-foreground focus:outline-none focus:border-primary"
        autofocus
      />
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => groupStore.nameRequest = null}>Cancel</Button>
        <Button onclick={confirmName}>{renaming ? 'Rename' : 'Create'}</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
