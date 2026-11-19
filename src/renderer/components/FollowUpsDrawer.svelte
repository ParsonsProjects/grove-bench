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
   * in that thread marks it done.
   */
  import { followUpsStore } from '../stores/followUps.svelte.js';
  import { draftStore } from '../stores/draft.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { getRepoColor } from '../lib/repo-colors.js';
  import { formatAge } from '../../shared/format-age.js';
  import { ipcErrorText } from '../lib/mcp-errors.js';
  import { followUpPrompt, type FollowUp } from '../../shared/follow-ups.js';
  import CopyButton from './CopyButton.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import XIcon from '@lucide/svelte/icons/x';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import ListTodoIcon from '@lucide/svelte/icons/list-todo';

  let projects = $derived(followUpsStore.byProject(store.repos));
  // The notice, and which details and done lists are open, live in the
  // store: the drawer mounts again each time it moves to another dock.

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

  // The follow-up the drawer was opened to show (a board card's link), in view.
  $effect(() => {
    const id = followUpsStore.revealId;
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
  </div>
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

    <div class="flex-1 overflow-y-auto px-3 py-2 outline-none" tabindex="-1" bind:this={listEl}>
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
        <section class="mt-3 first:mt-0" aria-label={store.repoDisplayName(project.repoPath)}>
          <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1">
            {#if color}
              <span class="inline-block w-2 h-2 shrink-0" style="background-color: {color}"></span>
            {/if}
            <span class="truncate">{store.repoDisplayName(project.repoPath)}</span>
            {#if project.open.length > 0}
              <Badge tone="muted" count>{project.open.length}</Badge>
            {/if}
          </div>

          {#if project.open.length === 0}
            <p class="mb-2 text-caption text-muted-foreground">Nothing open.</p>
          {/if}

          {#each project.open as f (f.id)}
            {@const started = startedThread(f)}
            {@const long = f.details.length > 220 || f.details.split('\n').length > 4}
            <article
              class="mb-2 border bg-card/80 p-2 {followUpsStore.revealId === f.id ? 'border-ring' : 'border-border'}"
              aria-label={f.title}
              aria-current={followUpsStore.revealId === f.id ? 'true' : undefined}
              data-follow-up={f.id}
            >
              <div class="text-xs font-medium text-foreground break-words">{f.title}</div>
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

              <div class="mt-1.5 flex items-center gap-1">
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
                  title="Mark it done"
                >Done</Button>
                <CopyButton text={followUpPrompt(f)} class="size-5" />
                <Button
                  variant="quiet-destructive"
                  size="2xs"
                  class="ml-auto"
                  onclick={() => run(() => followUpsStore.remove(f.id))}
                  title="Delete this follow-up"
                >Delete</Button>
              </div>
            </article>
          {/each}

          {#if project.done.length > 0}
            <Button
              variant="quiet"
              size="2xs"
              class="px-0 text-caption"
              aria-expanded={followUpsStore.showDone.has(project.repoPath)}
              onclick={() => (followUpsStore.showDone = toggle(followUpsStore.showDone, project.repoPath))}
            >{followUpsStore.showDone.has(project.repoPath) ? 'Hide done' : `Show done (${project.done.length})`}</Button>
            {#if followUpsStore.showDone.has(project.repoPath)}
              {#each project.done as f (f.id)}
                {@const by = threadName(f.doneBySessionId)}
                <article
                  class="mt-1 mb-2 border p-2 {followUpsStore.revealId === f.id ? 'border-ring' : 'border-border/60'}"
                  aria-label={f.title}
                  aria-current={followUpsStore.revealId === f.id ? 'true' : undefined}
                  data-follow-up={f.id}
                >
                  <div class="text-xs text-muted-foreground line-through break-words">{f.title}</div>
                  <div class="mt-0.5 text-caption text-muted-foreground">
                    Done {formatAge(f.doneAt ?? 0)}
                    {#if f.doneBySessionId && by}
                      in <Button variant="link" size="inline" class="text-caption" onclick={() => jumpTo(f.doneBySessionId!)}>{by}</Button>
                    {/if}
                  </div>
                  {#if f.doneNote}
                    <p class="mt-1 whitespace-pre-wrap break-words text-caption text-foreground/80">{f.doneNote}</p>
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
              {/each}
            {/if}
          {/if}
        </section>
      {/each}
    </div>
  </aside>
{/if}
