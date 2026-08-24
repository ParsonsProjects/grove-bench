<script lang="ts">
  import { store } from '../../stores/sessions.svelte.js';
  import { messageStore } from '../../stores/messages.svelte.js';
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { getRepoColor } from '../../lib/repo-colors.js';
  import { developerAppearance, buildSprite } from '../../lib/tycoon-appearance.js';

  interface Props {
    session: { id: string; branch: string; repoPath: string; status: string; displayName?: string | null };
    onopen: (id: string) => void;
  }

  let { session, onopen }: Props = $props();

  let appearance = $derived(developerAppearance(session.id));
  let sprite = $derived(buildSprite(appearance));
  let repoColor = $derived(getRepoColor(store.repos, session.repoPath, settingsStore.current.repoColors));

  let label = $derived(session.displayName || session.branch);

  // Mutually exclusive status, in the same priority order as the sidebar rows.
  let mood = $derived.by((): 'error' | 'setup' | 'waiting' | 'working' | 'done' | 'idle' => {
    if (session.status === 'error') return 'error';
    if (session.status === 'starting' || session.status === 'installing') return 'setup';
    if (messageStore.hasPendingPermission(session.id)) return 'waiting';
    if (messageStore.getIsRunning(session.id)) return 'working';
    if (store.needsAttention[session.id]) return 'done';
    return 'idle';
  });

  let isActive = $derived(store.activeSessionId === session.id);
</script>

<button
  type="button"
  class="desk group"
  class:desk-active={isActive}
  onclick={() => onopen(session.id)}
  title="{label} — {mood === 'working' ? 'working' : mood === 'waiting' ? 'waiting for you' : mood === 'error' ? 'error' : mood === 'setup' ? 'setting up' : mood === 'done' ? 'finished a task' : 'idle'}"
>
  <!-- Status bubble floating above the developer's head -->
  {#if mood !== 'idle'}
    <span class="mood mood-{mood}" aria-hidden="true">
      {#if mood === 'working'}
        <span class="dot d1"></span><span class="dot d2"></span><span class="dot d3"></span>
      {:else if mood === 'waiting'}?
      {:else if mood === 'error'}!
      {:else if mood === 'setup'}z<span class="z2">z</span><span class="z3">z</span>
      {:else if mood === 'done'}✓{/if}
    </span>
  {/if}

  <svg viewBox="0 0 16 15" class="scene" shape-rendering="crispEdges" aria-hidden="true">
    <!-- Developer (12×11 sprite, centered) -->
    {#each sprite as p ((p.x << 8) | p.y)}
      <rect x={p.x + 2} y={p.y} width="1" height="1" fill={p.color} />
    {/each}

    <!-- Monitor seen from behind, sitting on the desk -->
    <rect x="4" y="6.5" width="8" height="4.5" class="screen-glow" class:glow-on={mood === 'working'} fill="none" stroke-width="1" />
    <rect x="5" y="7" width="6" height="4" fill="#191922" />
    <rect x="5" y="7" width="6" height="0.5" fill="#2c2c3a" />

    <!-- Desk -->
    <rect x="0.5" y="11" width="15" height="1" fill="#8a5f38" />
    <rect x="0.5" y="12" width="15" height="2" fill="#63431f" />
    <rect x="1.5" y="12.5" width="5" height="0.5" fill="#54371a" />
  </svg>

  <span class="desk-label">
    {#if repoColor}<span class="repo-dot" style="background-color: {repoColor}"></span>{/if}
    <span class="desk-name">{label}</span>
  </span>
  <span class="desk-repo">{store.repoDisplayName(session.repoPath)}</span>
</button>

<style>
  .desk {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 8.5rem;
    padding: 1.5rem 0.5rem 0.5rem;
    border: 2px solid transparent;
    background: transparent;
    transition: background-color 0.15s, border-color 0.15s;
  }
  .desk:hover {
    background: color-mix(in oklab, var(--accent) 45%, transparent);
    border-color: var(--border);
  }
  .desk-active {
    border-color: var(--primary);
  }

  .scene {
    width: 6.5rem;
    height: auto;
    image-rendering: pixelated;
  }

  .screen-glow {
    stroke: transparent;
  }
  .glow-on {
    stroke: #6fb7ff;
    animation: tycoon-glow 1.6s ease-in-out infinite;
  }
  @keyframes tycoon-glow {
    0%, 100% { opacity: 0.15; }
    50% { opacity: 0.55; }
  }

  .desk-label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    max-width: 100%;
    margin-top: 0.35rem;
    font-size: 0.7rem;
    color: var(--foreground);
  }
  .repo-dot {
    width: 0.4rem;
    height: 0.4rem;
    flex-shrink: 0;
  }
  .desk-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .desk-repo {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.6rem;
    color: var(--muted-foreground);
  }

  /* ─── Status bubble ─── */
  .mood {
    position: absolute;
    top: 0.15rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    min-width: 1.5rem;
    height: 1.15rem;
    padding: 0 0.3rem;
    background: #f4f4f0;
    color: #1a1a24;
    border: 2px solid #1a1a24;
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1;
  }
  /* Pixel bubble tail */
  .mood::after {
    content: '';
    position: absolute;
    bottom: -0.35rem;
    left: 50%;
    transform: translateX(-50%);
    width: 0.35rem;
    height: 0.35rem;
    background: #1a1a24;
  }

  .mood-waiting { color: #b45309; animation: mood-pulse 1s ease-in-out infinite; }
  .mood-error { color: #b91c1c; }
  .mood-done { color: #15803d; animation: mood-pulse 0.8s ease-in-out infinite; }
  @keyframes mood-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  /* Typing dots while the agent is running */
  .dot {
    width: 0.25rem;
    height: 0.25rem;
    background: #1a1a24;
    animation: mood-typing 1.2s ease-in-out infinite;
  }
  .d2 { animation-delay: 0.2s; }
  .d3 { animation-delay: 0.4s; }
  @keyframes mood-typing {
    0%, 60%, 100% { opacity: 0.25; }
    30% { opacity: 1; }
  }

  /* Zzz while the worktree/agent is being set up */
  .mood-setup { font-style: italic; }
  .mood-setup .z2 { animation: mood-pulse 2s ease-in-out infinite; }
  .mood-setup .z3 { animation: mood-pulse 2s ease-in-out 0.5s infinite; }
</style>
