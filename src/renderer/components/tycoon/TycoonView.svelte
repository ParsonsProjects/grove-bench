<script lang="ts">
  import { store } from '../../stores/sessions.svelte.js';
  import { messageStore } from '../../stores/messages.svelte.js';
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { getRepoColor } from '../../lib/repo-colors.js';
  import WorkspacePane from '../WorkspacePane.svelte';
  import DeveloperDesk from './DeveloperDesk.svelte';
  import SpeechBubble from './SpeechBubble.svelte';
  import type { SessionStatus } from '../../../shared/types.js';

  interface Session {
    id: string;
    branch: string;
    repoPath: string;
    status: SessionStatus;
    displayName?: string | null;
  }

  interface Props {
    openSessions: Session[];
    pendingBySession: Record<string, boolean>;
    sessionCompletedWhileInactive: Record<string, boolean>;
    dragTabId: string | null;
    dropTargetId: string | null;
    onCloseTab: (id: string) => void;
    onOpenContextMenu: (e: MouseEvent, id: string) => void;
    onTabDragStart: (e: DragEvent, id: string) => void;
    onTabDragOver: (e: DragEvent, id: string) => void;
    onTabDrop: (e: DragEvent, id: string) => void;
    onTabDragEnd: () => void;
    onTabDragLeave: (id: string) => void;
  }

  let {
    openSessions,
    pendingBySession,
    sessionCompletedWhileInactive,
    dragTabId,
    dropTargetId,
    onCloseTab,
    onOpenContextMenu,
    onTabDragStart,
    onTabDragOver,
    onTabDrop,
    onTabDragEnd,
    onTabDragLeave,
  }: Props = $props();

  // Track DOM elements for each desk so the bubble's tail can anchor to the active one.
  let deskEls = $state<Record<string, HTMLElement | null>>({});

  // Whether the speech bubble is open. Independent of store.activeSessionId so the
  // user can dismiss the bubble without losing which session was last selected.
  let bubbleOpen = $state(false);

  // The session the bubble is currently anchored to.
  let bubbleSessionId = $derived(bubbleOpen ? store.activeSessionId : null);

  let bubbleAnchor = $derived(bubbleSessionId ? (deskEls[bubbleSessionId] ?? null) : null);

  function activate(id: string) {
    if (store.activeSessionId === id && bubbleOpen) {
      // Clicking the open dev again dismisses the bubble.
      bubbleOpen = false;
      return;
    }
    store.activeSessionId = id;
    bubbleOpen = true;
    if (sessionCompletedWhileInactive[id]) {
      delete sessionCompletedWhileInactive[id];
    }
  }

  function closeBubble() {
    bubbleOpen = false;
  }

  function branchIndex(session: Session): string {
    const siblings = store.sessionsForRepo(session.repoPath).filter((s) => s.branch === session.branch);
    if (siblings.length <= 1) return '';
    const idx = siblings.findIndex((s) => s.id === session.id);
    return `#${idx + 1} `;
  }

  function labelFor(session: Session): string {
    return session.displayName || (branchIndex(session) + session.branch);
  }
</script>

<div class="flex-1 min-h-0 relative tycoon-floor overflow-auto">
  {#if openSessions.length === 0 && store.sessions.length === 0}
    <div class="absolute inset-0 flex items-center justify-center tycoon-empty-office">
      <div class="text-center">
        <p class="mb-2">The office is empty.</p>
        <p class="text-xs">Add a repository and create an agent to hire your first developer.</p>
      </div>
    </div>
  {:else if openSessions.length === 0}
    <div class="absolute inset-0 flex items-center justify-center tycoon-empty-office">
      <p class="text-xs">No developers at their desks. Open a session from the sidebar.</p>
    </div>
  {:else}
    <div class="p-6 grid gap-6" style="grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));">
      {#each openSessions as session (session.id)}
        {@const running = messageStore.getIsRunning(session.id)}
        {@const isActive = store.activeSessionId === session.id && bubbleOpen}
        {@const needsAttention = !isActive && !running && (sessionCompletedWhileInactive[session.id] ?? false)}
        {@const accent = getRepoColor(store.repos, session.repoPath, settingsStore.current.repoColors)}
        <DeveloperDesk
          {session}
          repoLabel={store.repos.length > 1 ? store.repoDisplayName(session.repoPath) : null}
          label={labelFor(session)}
          {isActive}
          {running}
          pending={pendingBySession[session.id] ?? false}
          {needsAttention}
          accentColor={accent ?? 'var(--primary)'}
          isDragging={dragTabId === session.id}
          isDragOver={dropTargetId === session.id && dragTabId !== session.id}
          onActivate={() => activate(session.id)}
          onClose={() => onCloseTab(session.id)}
          onContextMenu={(e) => onOpenContextMenu(e, session.id)}
          onDragStart={(e) => onTabDragStart(e, session.id)}
          onDragOver={(e) => onTabDragOver(e, session.id)}
          onDrop={(e) => onTabDrop(e, session.id)}
          onDragEnd={onTabDragEnd}
          onDragLeave={() => onTabDragLeave(session.id)}
          elBind={(el) => { deskEls[session.id] = el; }}
        />
      {/each}
    </div>
  {/if}

  <!-- Speech bubble: always mounted so the WorkspacePanes inside stay subscribed. -->
  <SpeechBubble
    visible={bubbleOpen && bubbleSessionId !== null}
    anchorEl={bubbleAnchor}
    onClose={closeBubble}
  >
    {#each store.sessions as session (session.id)}
      <div class="flex-1 min-h-0" class:hidden={bubbleSessionId !== session.id}>
        {#if session.status === 'running' || session.status === 'starting' || session.status === 'installing' || session.status === 'error'}
          <WorkspacePane sessionId={session.id} />
        {:else}
          <div class="flex items-center justify-center h-full text-muted-foreground">
            <div class="w-4 h-4 bg-primary animate-pulse"></div>
            <span class="ml-3 text-sm">Starting agent...</span>
          </div>
        {/if}
      </div>
    {/each}
  </SpeechBubble>
</div>
