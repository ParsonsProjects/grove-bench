<script lang="ts">
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import AlphaBadge from './AlphaBadge.svelte';
  import BoardCard from './BoardCard.svelte';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { prStore } from '../stores/pr.svelte.js';
  import { groupStore } from '../stores/groups.svelte.js';
  import { boardStore } from '../stores/board.svelte.js';
  import { sessionSpriteState } from '../lib/session-sprite-state.js';
  import { getRepoColor } from '../lib/repo-colors.js';
  import { threadSubtitle } from '../lib/thread-subtitle.js';
  import {
    BOARD_STAGES,
    BOARD_STAGE_LABELS,
    BOARD_STAGE_HINTS,
    BOARD_LANES,
    BOARD_LANE_LABELS,
    boardStage,
    boardLanes,
    matchesBoardQuery,
    type BoardLanes,
    type BoardStage,
  } from '../lib/board.js';

  /**
   * The board (alpha): every open thread as a card, in a column by stage.
   * Lanes split it into a row per project or per group. A card opens its
   * thread, which closes the board. Shown in the main pane in place of a
   * thread (App.svelte), from the sidebar's List / Board switch.
   */

  /** What a column says when it has no card (with lanes off). */
  const EMPTY: Record<BoardStage, string> = {
    working: 'No agent is working.',
    'needs-you': 'Nothing is waiting for you.',
    review: 'Nothing to review.',
    done: 'No merged or closed pull requests.',
  };

  const all = $derived(store.openConversations.flatMap((session) => {
    const pr = prStore.getPr(session.id);
    const state = sessionSpriteState(session);
    const stage = boardStage(state, pr);
    if (!stage) return [];
    const name = session.displayName || session.branch || 'New thread';
    const projectName = store.repoDisplayName(session.repoPath);
    const subtitle = threadSubtitle(session);
    return [{ id: session.id, repoPath: session.repoPath, branch: session.branch, name, projectName, state, stage, pr, subtitle }];
  }));

  const shown = $derived(all.filter((c) => matchesBoardQuery(boardStore.query, [
    c.name,
    c.branch,
    c.projectName,
    c.subtitle?.text,
    c.pr ? `#${c.pr.number}` : null,
  ])));

  const lanes = $derived(boardLanes(shown, boardStore.lanes, {
    repos: store.repos,
    repoName: (path) => store.repoDisplayName(path),
    groups: groupStore.groups,
  }));

  const counts = $derived(Object.fromEntries(BOARD_STAGES.map((s) => [s, shown.filter((c) => c.stage === s).length])) as Record<BoardStage, number>);

  const repoColor = (path: string) => getRepoColor(store.repos, path, settingsStore.current.repoColors);

  /** Column headings' marks and counts wear the status colour for the two
   *  stages that are a status; Review and Done stay quiet. */
  const STAGE_TONE: Partial<Record<BoardStage, { mark: string; text: string }>> = {
    working: { mark: 'bg-status-working motion-safe:animate-pulse', text: 'text-status-working' },
    'needs-you': { mark: 'bg-status-attention motion-safe:animate-pulse', text: 'text-status-attention' },
  };
</script>

<div class="flex flex-col h-full min-h-0 bg-background" data-board>
  <PanelHeader title="Board">
    <AlphaBadge />
    <span class="text-caption text-muted-foreground truncate">
      {all.length} open {all.length === 1 ? 'thread' : 'threads'}
    </span>
    {#snippet actions()}
      <span class="flex items-center gap-1.5">
        <span id="board-lanes-label" class="text-caption text-muted-foreground">Lanes</span>
        <Segmented.Root
          value={boardStore.lanes}
          onValueChange={(v) => { if (v) boardStore.lanes = v as BoardLanes; }}
          aria-labelledby="board-lanes-label"
        >
          {#each BOARD_LANES as lane (lane)}
            <Segmented.Item value={lane}>{BOARD_LANE_LABELS[lane]}</Segmented.Item>
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

  {#if all.length === 0}
    <div class="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
      <p class="font-pixel text-base text-foreground/90">No open threads</p>
      <p class="text-xs text-muted-foreground">Start one with New thread in the sidebar (Ctrl+N). Its card shows up here.</p>
    </div>
  {:else}
    <div class="flex-1 min-h-0 overflow-auto px-3 pb-3">
      {#if shown.length === 0}
        <p class="pt-3 text-xs text-muted-foreground" role="status">No cards match "{boardStore.query.trim()}".</p>
      {/if}
      <div
        class="grid grid-cols-[repeat(4,minmax(13rem,1fr))] gap-1.5 min-w-[54rem]
          {boardStore.lanes === 'none' ? 'grid-rows-[auto_1fr] min-h-full' : ''}"
      >
        <!-- Column headings, kept in view while the lanes scroll. -->
        {#each BOARD_STAGES as stage (stage)}
          {@const tone = STAGE_TONE[stage]}
          <div class="sticky top-0 z-10 bg-background pt-3 pb-1 px-1 flex flex-col gap-0.5" title={BOARD_STAGE_HINTS[stage]}>
            <span class="flex items-center gap-1.5">
              {#if tone}<span class="w-1.5 h-1.5 shrink-0 {tone.mark}" aria-hidden="true"></span>{/if}
              <SectionLabel as="h2">{BOARD_STAGE_LABELS[stage]}</SectionLabel>
              <span class="text-micro font-bold {tone?.text ?? 'text-muted-foreground'}">{counts[stage]}</span>
            </span>
            <span class="text-caption text-muted-foreground truncate">{BOARD_STAGE_HINTS[stage]}</span>
          </div>
        {/each}

        {#each lanes as lane (lane.key)}
          {#if lane.label !== null}
            <div class="col-span-4 flex items-center gap-1.5 pt-2 min-w-0" data-board-lane={lane.key}>
              {#each lane.repoPaths as path (path)}
                {@const color = repoColor(path)}
                {#if color}<span class="w-2 h-2 shrink-0" style="background-color: {color}" aria-hidden="true"></span>{/if}
              {/each}
              <h3 class="text-xs font-medium truncate {lane.key === 'no-group' ? 'text-muted-foreground' : 'text-foreground'}">{lane.label}</h3>
              <span class="text-caption text-muted-foreground shrink-0">{lane.cards.length} {lane.cards.length === 1 ? 'card' : 'cards'}</span>
              <span class="flex-1 h-px bg-border" aria-hidden="true"></span>
            </div>
          {/if}
          {#each BOARD_STAGES as stage (stage)}
            {@const inCell = lane.cards.filter((c) => c.stage === stage)}
            <section
              aria-label={lane.label ? `${lane.label}: ${BOARD_STAGE_LABELS[stage]}` : BOARD_STAGE_LABELS[stage]}
              class="flex flex-col gap-1 p-1 min-h-11 min-w-0 bg-sidebar border border-border"
              data-board-column={stage}
            >
              {#each inCell as card (card.id)}
                <BoardCard
                  id={card.id}
                  name={card.name}
                  branch={card.branch}
                  projectName={card.projectName}
                  projectColor={repoColor(card.repoPath)}
                  showProject={boardStore.lanes !== 'project' && store.repos.length > 1}
                  state={card.state}
                  subtitle={card.subtitle}
                  pr={card.pr}
                  waiting={stage === 'needs-you'}
                  onopen={() => boardStore.openThread(card.id)}
                />
              {:else}
                {#if boardStore.lanes === 'none' && shown.length > 0}
                  <p class="px-1 py-2 text-caption text-muted-foreground">{EMPTY[stage]}</p>
                {/if}
              {/each}
            </section>
          {/each}
        {/each}
      </div>
    </div>
  {/if}
</div>
