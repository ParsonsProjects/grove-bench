<script module lang="ts">
  /** The opening (dock.svelte: nextOpening) it last took the keyboard for:
   *  mounting again for the same one (it moves to the thread you switch
   *  to) leaves the keyboard where it is. */
  let focusedOpening = 0;
</script>

<script lang="ts">
  /**
   * Follow-ups from every project (stores/followUps.svelte): work agents
   * found for later threads. Docked beside the thread you're in (SideDock),
   * or beside the draft or the landing when no thread is open. Start thread
   * fills the New thread draft with one, to look over and send; the agent
   * in that thread marks it done, or closes it if it isn't needed. Each
   * project folds down to its heading (saved), and the list opens where it
   * was scrolled to. One a thread is working on (that thread is still open)
   * shrinks to two lines after the ones not started yet; clicking its title
   * shows the whole card.
   */
  import { followUpsStore } from '../stores/followUps.svelte.js';
  import { draftStore } from '../stores/draft.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { getRepoColor } from '../lib/repo-colors.js';
  import { formatAge } from '../../shared/format-age.js';
  import { ipcErrorText } from '../lib/mcp-errors.js';
  import { followUpPriority, followUpPrompt, type FollowUp, type FollowUpPriority } from '../../shared/follow-ups.js';
  import CopyButton from './CopyButton.svelte';
  import FollowUpPriorityPicker from './FollowUpPriorityPicker.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import ListTodoIcon from '@lucide/svelte/icons/list-todo';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';

  let projects = $derived(followUpsStore.byProject(store.repos));
  // The notice, which details, cards and done lists are open, the folded
  // projects and the scroll position live in the store: the drawer mounts
  // again each time it moves to another dock, and each time it opens.

  function toggle(set: Set<string>, key: string): Set<string> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  function repoColor(repoPath: string): string | null {
    return getRepoColor(store.repos, repoPath, settingsStore.current.repoColors);
  }

  /** An open thread's name, or null for one that is closed or deleted. */
  function threadName(sessionId: string | undefined): string | null {
    if (!sessionId) return null;
    const s = store.sessions.find((x) => x.id === sessionId);
    return s ? s.displayName || s.branch || 'New thread' : null;
  }

  /** The newest open thread started from it. */
  function startedThread(f: FollowUp): string | null {
    const ids = f.startedSessionIds ?? [];
    for (let i = ids.length - 1; i >= 0; i--) {
      if (threadName(ids[i])) return ids[i];
    }
    return null;
  }

  /** What a project's done and closed list is called, from what is in it. */
  function endedWord(ended: readonly FollowUp[]): string {
    const done = ended.filter((f) => f.doneAt !== undefined).length;
    if (done === ended.length) return 'done';
    return done === 0 ? 'closed' : 'done and closed';
  }

  function jumpTo(sessionId: string) {
    store.activeSessionId = sessionId;
    followUpsStore.toggleDrawer(false);
  }

  function startThread(f: FollowUp) {
    if (!store.repos.includes(f.repoPath)) {
      followUpsStore.notice = { tone: 'warning', text: 'Its project was removed. Add the project again to start a thread from it.' };
      return;
    }
    if (!draftStore.openFollowUp(f)) {
      followUpsStore.notice = { tone: 'warning', text: "You're already writing a new thread. Send or discard it, then start this follow-up." };
      return;
    }
    followUpsStore.notice = null;
  }

  async function run(change: () => Promise<void>) {
    try {
      await change();
      followUpsStore.notice = null;
    } catch (e) {
      followUpsStore.notice = { tone: 'danger', text: ipcErrorText(e, "That couldn't be saved.") };
    }
  }

  // Back where the list was scrolled to when it last closed, once per
  // mount, once there is a list to scroll. Before the reveal below, so a
  // follow-up the drawer was opened to show wins.
  let restoredEl: HTMLDivElement | null = null;
  $effect(() => {
    if (!listEl || restoredEl === listEl || !followUpsStore.ready) return;
    restoredEl = listEl;
    listEl.scrollTop = followUpsStore.scrollTop;
  });

  // The follow-up the drawer was opened to show (a board card's link), in view.
  $effect(() => {
    const id = followUpsStore.revealId;
    // Again on each reveal, the same follow-up included.
    void followUpsStore.revealCount;
    if (!listEl || !id) return;
    // Ids are short hex (main/follow-ups.ts), safe in a selector as they are.
    listEl.querySelector<HTMLElement>(`[data-follow-up="${id}"]`)?.scrollIntoView?.({ block: 'nearest' });
  });

  // Focused as it opens, so Esc and the arrow keys work on it.
  let listEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const opening = followUpsStore.opening;
    if (!listEl || opening === focusedOpening) return;
    focusedOpening = opening;
    listEl.focus({ preventScroll: true });
  });

  // Esc closes it from inside only: in the message box beside it, Esc is
  // the box's own.
  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.stopPropagation();
    followUpsStore.toggleDrawer(false);
  }
</script>

{#snippet origin(f: FollowUp)}
  {@const from = threadName(f.fromSessionId)}
  <div class="mt-0.5 text-caption text-muted-foreground">
    {formatAge(f.createdAt)}
    {#if f.fromSessionId && from}
      · from <Button variant="link" size="inline" class="text-caption" onclick={() => jumpTo(f.fromSessionId!)} title="Open the thread that added it">{from}</Button>
    {:else if f.fromLabel}
      · from {f.fromLabel}
    {/if}
    {#if f.fromRepoPath}
      in {store.repoDisplayName(f.fromRepoPath)}
    {/if}
  </div>
{/snippet}

{#snippet openCard(f: FollowUp, started: string | null)}
  {@const long = f.details.length > 220 || f.details.split('\n').length > 4}
  <article
    class="mb-2 border bg-card/80 p-2 {followUpsStore.revealId === f.id ? 'border-ring' : followUpPriority(f) === 'high' ? 'border-amber-500/50' : 'border-border'}"
    aria-label={f.title}
    aria-current={followUpsStore.revealId === f.id ? 'true' : undefined}
    data-follow-up={f.id}
  >
    <div class="flex items-start gap-1">
      <div class="min-w-0 flex-1 text-xs font-medium text-foreground break-words">{f.title}</div>
      {#if started}
        <Button
          variant="quiet"
          size="icon-2xs"
          class="-mt-0.5 -mr-1 shrink-0"
          onclick={() => (followUpsStore.unfolded = toggle(followUpsStore.unfolded, f.id))}
          title="Show it on two lines again: a thread is working on it"
          aria-label="Show less of {f.title}"
        ><ChevronUpIcon /></Button>
      {/if}
    </div>
    {@render origin(f)}
    {#if f.details}
      <p
        class="mt-1 whitespace-pre-wrap break-words text-xs text-foreground/90 {long && !followUpsStore.expanded.has(f.id) ? 'line-clamp-4' : ''}"
      >{f.details}</p>
      {#if long}
        <Button variant="link" size="inline" class="text-caption" onclick={() => (followUpsStore.expanded = toggle(followUpsStore.expanded, f.id))}>
          {followUpsStore.expanded.has(f.id) ? 'Show less' : 'Show more'}
        </Button>
      {/if}
    {/if}
    {#if started}
      <div class="mt-1 text-caption text-muted-foreground">
        Started in <Button variant="link" size="inline" class="text-caption" onclick={() => jumpTo(started)}>{threadName(started)}</Button>
      </div>
    {/if}

    <!-- Wraps in a narrow drawer, so Delete goes under the rest rather
         than past the card's edge. -->
    <div class="mt-1.5 flex flex-wrap items-center gap-1">
      <Button
        variant="subtle-primary"
        size="2xs"
        onclick={() => startThread(f)}
        title="Open a new thread with this follow-up as its first message, to look over and send"
      >{started ? 'Start another' : 'Start thread'}</Button>
      <Button
        variant="subtle"
        size="2xs"
        onclick={() => run(() => followUpsStore.setDone(f.id, true))}
        title="Mark it done: the work is finished"
      >Done</Button>
      <Button
        variant="subtle"
        size="2xs"
        onclick={() => run(() => followUpsStore.close(f.id))}
        title="Close it without doing it: it isn't needed, or won't be done. You can reopen it."
      >Close</Button>
      <CopyButton text={followUpPrompt(f)} class="size-5" />
      <span class="ml-auto flex items-center gap-1">
        <FollowUpPriorityPicker
          value={followUpPriority(f)}
          title={f.title}
          onchange={(p: FollowUpPriority) => run(() => followUpsStore.setPriority(f.id, p))}
        />
        <Button
          variant="quiet-destructive"
          size="2xs"
          onclick={() => run(() => followUpsStore.remove(f.id))}
          title="Delete this follow-up"
        >Delete</Button>
      </span>
    </div>
  </article>
{/snippet}

<!-- One a thread is working on: two lines, as there is nothing to do for
     it until that thread finishes. Its title shows the whole card. -->
{#snippet workingCard(f: FollowUp, started: string)}
  <article
    class="mb-1.5 border px-2 py-1 bg-card/40 {followUpsStore.revealId === f.id ? 'border-ring' : 'border-border/60'}"
    aria-label="{f.title}, in progress"
    aria-current={followUpsStore.revealId === f.id ? 'true' : undefined}
    data-follow-up={f.id}
  >
    <button
      type="button"
      class="w-full flex items-center gap-1.5 min-w-0 text-left text-caption text-foreground/90 hover:text-foreground"
      onclick={() => (followUpsStore.unfolded = toggle(followUpsStore.unfolded, f.id))}
      title="Show all of it"
      aria-expanded="false"
    >
      <span class="w-1.5 h-1.5 shrink-0 bg-status-working" aria-hidden="true"></span>
      <span class="truncate">{f.title}</span>
    </button>
    <div class="flex items-center gap-1 min-w-0 text-micro text-muted-foreground">
      <!-- The thread's name is what gets cut short in a narrow drawer, not
           the words before it. -->
      <span class="shrink-0">In progress in</span>
      <Button
        variant="link"
        size="inline"
        class="min-w-0 shrink justify-start text-micro"
        onclick={() => jumpTo(started)}
        title="Open the thread working on it: {threadName(started)}"
      ><span class="truncate">{threadName(started)}</span></Button>
      <span class="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          variant="quiet"
          size="2xs"
          class="h-4 px-1 text-micro"
          onclick={() => run(() => followUpsStore.setDone(f.id, true))}
          title="Mark it done: the work is finished"
          aria-label="Mark {f.title} done"
        >Done</Button>
        <Button
          variant="quiet"
          size="2xs"
          class="h-4 px-1 text-micro"
          onclick={() => run(() => followUpsStore.close(f.id))}
          title="Close it without doing it: it isn't needed, or won't be done. You can reopen it."
          aria-label="Close {f.title}"
        >Close</Button>
      </span>
    </div>
  </article>
{/snippet}

{#snippet endedCard(f: FollowUp)}
  {@const closed = f.doneAt === undefined}
  {@const bySession = closed ? f.closedBySessionId : f.doneBySessionId}
  {@const by = threadName(bySession)}
  {@const note = closed ? f.closeReason : f.doneNote}
  <article
    class="mt-1 mb-2 border p-2 {followUpsStore.revealId === f.id ? 'border-ring' : 'border-border/60'}"
    aria-label="{f.title}, {closed ? 'closed' : 'done'}"
    aria-current={followUpsStore.revealId === f.id ? 'true' : undefined}
    data-follow-up={f.id}
  >
    <div class="text-xs text-muted-foreground break-words {closed ? '' : 'line-through'}">{f.title}</div>
    <div class="mt-0.5 text-caption text-muted-foreground">
      {closed ? 'Closed' : 'Done'} {formatAge((closed ? f.closedAt : f.doneAt) ?? 0)}
      {#if bySession && by}
        in <Button variant="link" size="inline" class="text-caption" onclick={() => jumpTo(bySession)}>{by}</Button>
      {/if}
    </div>
    {#if note}
      <p class="mt-1 whitespace-pre-wrap break-words text-caption text-foreground/80">{note}</p>
    {/if}
    <div class="mt-1 flex items-center gap-1">
      <Button
        variant="subtle"
        size="2xs"
        onclick={() => run(() => followUpsStore.setDone(f.id, false))}
        title="Open it again"
      >Reopen</Button>
      <Button
        variant="quiet-destructive"
        size="2xs"
        class="ml-auto"
        onclick={() => run(() => followUpsStore.remove(f.id))}
        title="Delete this follow-up"
      >Delete</Button>
    </div>
  </article>
{/snippet}

{#if followUpsStore.drawerOpen}
  <!-- Focusable (tabindex -1) so a click anywhere in it lets Esc close it. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside
    class="flex-1 min-h-0 flex flex-col outline-none"
    aria-label="Follow-ups"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <PanelHeader>
      <h2 class="flex items-center gap-2 font-medium text-foreground">
        <ListTodoIcon class="size-3" />
        Follow-ups
      </h2>
      {#snippet actions()}
        <Button
          variant="quiet"
          size="icon-2xs"
          onclick={() => { followUpsStore.notice = null; followUpsStore.openAdd(store.activeSession?.repoPath ?? draftStore.draft?.repoPath ?? ''); }}
          title="New follow-up: work for a later thread"
          aria-label="New follow-up"
        ><PlusIcon /></Button>
        <Button
          variant="quiet"
          size="icon-2xs"
          onclick={() => followUpsStore.toggleDrawer(false)}
          title="Close (Esc)"
          aria-label="Close follow-ups"
        ><XIcon /></Button>
      {/snippet}
    </PanelHeader>

    <div
      class="flex-1 overflow-y-auto px-3 py-2 outline-none"
      tabindex="-1"
      bind:this={listEl}
      onscroll={() => { if (listEl && restoredEl === listEl) followUpsStore.scrollTop = listEl.scrollTop; }}
    >
      {#if followUpsStore.notice}
        <Notice tone={followUpsStore.notice.tone} class="mb-2 break-words">{followUpsStore.notice.text}</Notice>
      {/if}


      {#if !followUpsStore.ready && followUpsStore.loadFailed}
        <Notice tone="danger" class="break-words">
          Couldn't read your follow-ups. Another program may be holding the file.
          {#snippet actions()}
            <Button variant="link" size="2xs" onclick={() => void followUpsStore.load()}>Try again</Button>
          {/snippet}
        </Notice>
      {:else if !followUpsStore.ready}
        <p class="text-xs text-muted-foreground mt-4 text-center">Loading follow-ups…</p>
      {:else if projects.length === 0}
        <p class="text-xs text-muted-foreground mt-4 text-center">
          No follow-ups yet. When an agent finds work that belongs in a later thread, such as a bug it noticed on the way, it adds it here for you to start when you're ready. To add one yourself, click <span class="text-foreground">+</span> above.
        </p>
      {/if}

      {#each projects as project (project.repoPath)}
        {@const color = repoColor(project.repoPath)}
        {@const name = store.repoDisplayName(project.repoPath)}
        {@const collapsed = followUpsStore.isCollapsed(project.repoPath)}
        {@const waiting = project.open.filter((f) => !startedThread(f))}
        {@const working = project.open.filter((f) => !!startedThread(f))}
        <section class="mt-3 first:mt-0" aria-label={name}>
          <button
            type="button"
            class="w-full flex items-center gap-2 text-left text-xs font-medium text-muted-foreground mb-1 hover:text-foreground transition-colors"
            aria-expanded={!collapsed}
            onclick={() => followUpsStore.toggleCollapsed(project.repoPath)}
            title={collapsed ? `Show ${name}'s follow-ups` : `Fold ${name}'s follow-ups`}
          >
            <ChevronDownIcon class="size-3 shrink-0 transition-transform {collapsed ? '-rotate-90' : ''}" aria-hidden="true" />
            {#if color}
              <span class="inline-block w-2 h-2 shrink-0" style="background-color: {color}"></span>
            {/if}
            <span class="truncate">{name}</span>
            {#if project.open.length > 0}
              <Badge tone="muted" count>{project.open.length}</Badge>
            {/if}
            {#if collapsed && working.length > 0}
              <span class="shrink-0 text-caption font-normal">{working.length} in progress</span>
            {/if}
          </button>

          {#if !collapsed}
            {#if project.open.length === 0}
              <p class="mb-2 text-caption text-muted-foreground">Nothing open.</p>
            {/if}

            {#each waiting as f (f.id)}
              {@render openCard(f, null)}
            {/each}

            {#each working as f (f.id)}
              {@const started = startedThread(f)!}
              {#if followUpsStore.unfolded.has(f.id)}
                {@render openCard(f, started)}
              {:else}
                {@render workingCard(f, started)}
              {/if}
            {/each}

            {#if project.ended.length > 0}
              {@const word = endedWord(project.ended)}
              {@const shown = followUpsStore.showEnded.has(project.repoPath)}
              <Button
                variant="quiet"
                size="2xs"
                class="px-0 text-caption"
                aria-expanded={shown}
                onclick={() => (followUpsStore.showEnded = toggle(followUpsStore.showEnded, project.repoPath))}
              >{shown ? `Hide ${word}` : `Show ${word} (${project.ended.length})`}</Button>
              {#if shown}
                {#each project.ended as f (f.id)}
                  {@render endedCard(f)}
                {/each}
              {/if}
            {/if}
          {/if}
        </section>
      {/each}
    </div>
  </aside>
{/if}
