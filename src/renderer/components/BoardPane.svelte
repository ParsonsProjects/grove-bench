<script lang="ts">
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import AlphaBadge from './AlphaBadge.svelte';
  import BoardCard from './BoardCard.svelte';
  import BoardFollowUpCard from './BoardFollowUpCard.svelte';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { prStore } from '../stores/pr.svelte.js';
  import { groupStore } from '../stores/groups.svelte.js';
  import { boardStore } from '../stores/board.svelte.js';
  import { followUpsStore } from '../stores/followUps.svelte.js';
  import { draftStore } from '../stores/draft.svelte.js';
  import { sessionSpriteState } from '../lib/session-sprite-state.js';
  import { getRepoColor } from '../lib/repo-colors.js';
  import { threadSubtitle } from '../lib/thread-subtitle.js';
  import { threadLabel } from '../lib/thread-label.js';
  import { ipcErrorText } from '../lib/mcp-errors.js';
  import {
    BOARD_COLUMNS,
    BOARD_COLUMN_LABELS,
    BOARD_COLUMN_HINTS,
    BOARD_LANES,
    BOARD_LANE_LABELS,
    BOARD_SORTS,
    BOARD_SORT_LABELS,
    BOARD_SORT_HINTS,
    boardStage,
    boardFollowUps,
    boardLanes,
    isBoardLanes,
    isBoardSort,
    matchesBoardQuery,
    prNeedsYou,
    sortBoardThreads,
    type BoardColumn,
  } from '../lib/board.js';
  import type { FollowUp, FollowUpPriority } from '../../shared/follow-ups.js';
  import type { SessionStatus } from '../../shared/types.js';

  /**
   * The board (alpha): work for later as follow-ups, then every open thread
   * as a card, in a column by stage. Lanes split it into a row per project
   * or per group. A thread's card opens it; a follow-up's Start thread opens
   * the new thread with it as the first message. Either closes the board.
   * Shown in the main pane in place of a thread (App.svelte), from the
   * sidebar's List / Board switch. Thread cards in each column follow the
   * Sort choice; follow-ups go highest priority first.
   */

  /** What a column says when it has no card (with lanes off). */
  const EMPTY: Record<BoardColumn, string> = {
    'follow-ups': 'Nothing for later. Agents add follow-ups here, and + adds one yourself.',
    working: 'No agent is working.',
    'needs-you': 'Nothing is waiting for you.',
    review: 'Nothing to review.',
    done: 'No merged or closed pull requests.',
  };

  /** Column headings' marks and counts wear the status colour for the two
   *  stages that are a status; the rest stay quiet. */
  const COLUMN_TONE: Partial<Record<BoardColumn, { mark: string; text: string }>> = {
    working: { mark: 'bg-status-working motion-safe:animate-pulse', text: 'text-status-working' },
    'needs-you': { mark: 'bg-status-attention motion-safe:animate-pulse', text: 'text-status-attention' },
  };

  type ThreadItem = {
    kind: 'thread';
    id: string;
    repoPath: string;
    column: BoardColumn;
    branch: string;
    name: string;
    projectName: string;
    state: ReturnType<typeof sessionSpriteState>;
    pr: ReturnType<typeof prStore.getPr>;
    /** For the card's own line under the name (threadSubtitle), worked out
     *  in the card so a stream in one thread updates that card alone. */
    status: SessionStatus;
    /** The follow-up it was started from, if it was. */
    followUp: FollowUp | null;
    /** Unread: a turn finished, or a pull request alert came, since you last looked. */
    unread: boolean;
    /** Its open pull request has changes asked for, failing checks or conflicts. */
    prNeedsYou: boolean;
    lastActiveAt: number;
  };
  type FollowUpItem = {
    kind: 'follow-up';
    id: string;
    repoPath: string;
    column: BoardColumn;
    followUp: FollowUp;
    startedBefore: boolean;
    projectName: string;
  };
  type Item = ThreadItem | FollowUpItem;

  const threads = $derived(sortBoardThreads(store.openConversations.flatMap((session): ThreadItem[] => {
    const pr = prStore.getPr(session.id);
    const state = sessionSpriteState(session);
    const stage = boardStage(state, pr);
    if (!stage) return [];
    return [{
      kind: 'thread',
      id: session.id,
      repoPath: session.repoPath,
      column: stage,
      branch: session.branch,
      name: threadLabel(session),
      projectName: store.repoDisplayName(session.repoPath),
      state,
      pr,
      status: session.status,
      followUp: followUpsStore.startedFrom(session.id) ?? null,
      unread: state === 'unread',
      prNeedsYou: prNeedsYou(pr),
      lastActiveAt: session.lastActiveAt ?? session.createdAt ?? 0,
    }];
  }), boardStore.sort));

  const openThreadIds = $derived(new Set(store.openConversations.map((s) => s.id)));

  const followUps = $derived(boardFollowUps(followUpsStore.list, store.repos, (id) => openThreadIds.has(id)).map(
    ({ followUp, startedBefore }): FollowUpItem => ({
      kind: 'follow-up',
      id: `follow-up:${followUp.id}`,
      repoPath: followUp.repoPath,
      column: 'follow-ups',
      followUp,
      startedBefore,
      projectName: store.repoDisplayName(followUp.repoPath),
    }),
  ));

  // With no filter, no card's line is worked out here: only the cards do that.
  const shown = $derived.by((): Item[] => {
    const all = [...followUps, ...threads];
    const query = boardStore.query.trim();
    if (!query) return all;
    return all.filter((item) => matchesBoardQuery(query, item.kind === 'thread'
      ? [item.name, item.branch, item.projectName, threadSubtitle(item)?.text, item.pr ? `#${item.pr.number}` : null, item.followUp?.title]
      : [item.followUp.title, item.followUp.details, item.projectName]));
  });

  const lanes = $derived(boardLanes(shown, boardStore.lanes, {
    repos: store.repos,
    repoName: (path) => store.repoDisplayName(path),
    groups: groupStore.groups,
  }));

  const counts = $derived(Object.fromEntries(BOARD_COLUMNS.map((c) => [c, shown.filter((i) => i.column === c).length])) as Record<BoardColumn, number>);

  const repoColor = (path: string) => getRepoColor(store.repos, path, settingsStore.current.repoColors);
  const showProject = $derived(boardStore.lanes !== 'project' && store.repos.length > 1);
  /** Nothing to draw: no open thread, and no follow-up once they are read
   *  (until then the column says it is loading, or that it couldn't read them). */
  const empty = $derived(threads.length === 0 && followUps.length === 0 && followUpsStore.ready);
  /** A follow-up belongs to a project, so there has to be one to add it to. */
  const canAddFollowUp = $derived(store.repos.length > 0);

  /** What the Follow-ups column says with no card in it. */
  const followUpsEmpty = $derived(
    followUpsStore.ready ? EMPTY['follow-ups']
      : followUpsStore.loadFailed ? "Couldn't read your follow-ups."
        : 'Loading follow-ups…',
  );

  /** Why the last follow-up action didn't happen, until the next one. */
  let notice = $state<{ tone: 'warning' | 'danger'; text: string } | null>(null);

  function startFollowUp(f: FollowUp) {
    // A new thread being written is only shown, so the follow-up would be
    // lost from view: say so here instead, as the drawer does.
    if (draftStore.hasMessage) {
      notice = { tone: 'warning', text: "You're already writing a new thread. Send or discard it, then start this follow-up." };
      return;
    }
    notice = null;
    draftStore.openFollowUp(f);
  }

  async function save(change: () => Promise<void>) {
    try {
      await change();
      notice = null;
    } catch (e) {
      notice = { tone: 'danger', text: ipcErrorText(e, "That couldn't be saved.") };
    }
  }

  const markDone = (f: FollowUp) => save(() => followUpsStore.setDone(f.id, true));
  const close = (f: FollowUp) => save(() => followUpsStore.close(f.id));
  const setPriority = (f: FollowUp, priority: FollowUpPriority) => save(() => followUpsStore.setPriority(f.id, priority));
</script>

<div class="flex flex-col h-full min-h-0 bg-background" data-board>
  <!-- wrap: Lanes, Sort and the filter go to a row of their own when the
       pane is too narrow for them beside the title. -->
  <PanelHeader wrap>
    <!-- Not PanelHeader's title, which gives way first: the count does here. -->
    <span class="shrink-0 font-medium text-foreground">Board</span>
    <AlphaBadge />
    <span class="text-caption text-muted-foreground truncate">
      {threads.length} open {threads.length === 1 ? 'thread' : 'threads'}, {followUps.length} {followUps.length === 1 ? 'follow-up' : 'follow-ups'}
    </span>
    {#snippet actions()}
      <span class="flex items-center gap-1.5">
        <span id="board-lanes-label" class="text-caption text-muted-foreground">Lanes</span>
        <Segmented.Root
          value={boardStore.lanes}
          onValueChange={(v) => { if (isBoardLanes(v)) boardStore.setLanes(v); }}
          aria-labelledby="board-lanes-label"
        >
          {#each BOARD_LANES as lane (lane)}
            <Segmented.Item value={lane}>{BOARD_LANE_LABELS[lane]}</Segmented.Item>
          {/each}
        </Segmented.Root>
      </span>
      <span class="flex items-center gap-1.5">
        <span id="board-sort-label" class="text-caption text-muted-foreground">Sort</span>
        <Segmented.Root
          value={boardStore.sort}
          onValueChange={(v) => { if (isBoardSort(v)) boardStore.setSort(v); }}
          aria-labelledby="board-sort-label"
        >
          {#each BOARD_SORTS as sort (sort)}
            <Segmented.Item value={sort} title={BOARD_SORT_HINTS[sort]}>{BOARD_SORT_LABELS[sort]}</Segmented.Item>
          {/each}
        </Segmented.Root>
      </span>
      <input
        type="search"
        bind:value={boardStore.query}
        placeholder="Filter cards"
        aria-label="Filter cards"
        class="h-6 w-44 px-2 bg-transparent border border-input text-xs text-foreground placeholder:text-muted-foreground
          outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
      />
    {/snippet}
  </PanelHeader>

  {#if empty}
    <div class="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
      <p class="font-pixel text-base text-foreground/90">No open threads</p>
      <p class="text-xs text-muted-foreground">Start one with New thread in the sidebar (Ctrl+N), or add a follow-up for later. Their cards show up here.</p>
      {#if canAddFollowUp}
        <Button variant="subtle" size="xs" onclick={() => followUpsStore.openAdd()}>
          <PlusIcon />New follow-up
        </Button>
      {/if}
    </div>
  {:else}
    <div class="flex-1 min-h-0 overflow-auto px-3 pb-3">
      {#if notice}
        <Notice tone={notice.tone} class="mt-3 break-words">
          {notice.text}
          {#snippet actions()}
            {#if notice?.tone === 'warning'}
              <Button variant="link" size="2xs" onclick={() => draftStore.show()}>Show it</Button>
            {/if}
          {/snippet}
        </Notice>
      {/if}
      {#if !followUpsStore.ready && followUpsStore.loadFailed}
        <Notice tone="danger" class="mt-3 break-words">
          Couldn't read your follow-ups. Another program may be holding the file.
          {#snippet actions()}
            <Button variant="link" size="2xs" onclick={() => void followUpsStore.load()}>Try again</Button>
          {/snippet}
        </Notice>
      {/if}
      {#if shown.length === 0 && boardStore.query.trim()}
        <p class="pt-3 text-xs text-muted-foreground" role="status">No cards match "{boardStore.query.trim()}".</p>
      {/if}
      <div
        class="grid grid-cols-[repeat(5,minmax(13rem,1fr))] gap-1.5 min-w-[67rem]
          {boardStore.lanes === 'none' ? 'grid-rows-[auto_1fr] min-h-full' : ''}"
      >
        <!-- Column headings, kept in view while the lanes scroll. -->
        {#each BOARD_COLUMNS as column (column)}
          {@const tone = COLUMN_TONE[column]}
          <div class="sticky top-0 z-10 bg-background pt-3 pb-1 px-1 flex flex-col gap-0.5" title={BOARD_COLUMN_HINTS[column]}>
            <!-- One height for every heading, the Follow-ups one with its + included. -->
            <span class="flex items-center gap-1.5 h-5">
              {#if tone}<span class="w-1.5 h-1.5 shrink-0 {tone.mark}" aria-hidden="true"></span>{/if}
              <SectionLabel as="h2">{BOARD_COLUMN_LABELS[column]}</SectionLabel>
              <span class="text-micro font-bold {tone?.text ?? 'text-muted-foreground'}">{counts[column]}</span>
              {#if column === 'follow-ups'}
                <Button
                  variant="quiet"
                  size="icon-2xs"
                  class="ml-auto"
                  onclick={() => followUpsStore.openAdd()}
                  disabled={!canAddFollowUp}
                  title={canAddFollowUp ? 'New follow-up: work for a later thread' : 'Add a project first: a follow-up belongs to one'}
                  aria-label="New follow-up"
                ><PlusIcon /></Button>
              {/if}
            </span>
            <span class="text-caption text-muted-foreground truncate">{BOARD_COLUMN_HINTS[column]}</span>
          </div>
        {/each}

        {#each lanes as lane (lane.key)}
          {#if lane.label !== null}
            <div class="col-span-5 flex items-center gap-1.5 pt-2 min-w-0" data-board-lane={lane.key}>
              {#each lane.repoPaths as path (path)}
                {@const color = repoColor(path)}
                {#if color}<span class="w-2 h-2 shrink-0" style="background-color: {color}" aria-hidden="true"></span>{/if}
              {/each}
              <h3 class="text-xs font-medium truncate {lane.key === 'no-group' ? 'text-muted-foreground' : 'text-foreground'}">{lane.label}</h3>
              <span class="text-caption text-muted-foreground shrink-0">{lane.cards.length} {lane.cards.length === 1 ? 'card' : 'cards'}</span>
              <span class="flex-1 h-px bg-border" aria-hidden="true"></span>
            </div>
          {/if}
          {#each BOARD_COLUMNS as column (column)}
            {@const inCell = lane.cards.filter((c: Item) => c.column === column)}
            <section
              aria-label={lane.label ? `${lane.label}: ${BOARD_COLUMN_LABELS[column]}` : BOARD_COLUMN_LABELS[column]}
              class="flex flex-col gap-1 p-1 min-h-11 min-w-0 bg-sidebar border border-border"
              data-board-column={column}
            >
              {#each inCell as item (item.id)}
                {#if item.kind === 'follow-up'}
                  <BoardFollowUpCard
                    followUp={item.followUp}
                    startedBefore={item.startedBefore}
                    projectName={item.projectName}
                    projectColor={repoColor(item.repoPath)}
                    {showProject}
                    onstart={() => startFollowUp(item.followUp)}
                    ondone={() => void markDone(item.followUp)}
                    onclose={() => void close(item.followUp)}
                    onpriority={(p: FollowUpPriority) => void setPriority(item.followUp, p)}
                  />
                {:else}
                  <BoardCard
                    id={item.id}
                    name={item.name}
                    branch={item.branch}
                    projectName={item.projectName}
                    projectColor={repoColor(item.repoPath)}
                    {showProject}
                    state={item.state}
                    status={item.status}
                    pr={item.pr}
                    waiting={column === 'needs-you'}
                    unread={item.unread}
                    prNeedsYou={item.prNeedsYou}
                    followUp={item.followUp}
                    onopen={() => boardStore.openThread(item.id)}
                    onfollowup={() => { if (item.followUp) followUpsStore.reveal(item.followUp.id); }}
                  />
                {/if}
              {:else}
                {#if boardStore.lanes === 'none' && !boardStore.query.trim()}
                  <p class="px-1 py-2 text-caption text-muted-foreground">{column === 'follow-ups' ? followUpsEmpty : EMPTY[column]}</p>
                {/if}
              {/each}
            </section>
          {/each}
        {/each}
      </div>
    </div>
  {/if}
</div>
