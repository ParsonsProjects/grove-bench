<script lang="ts">
  import GitBranchIcon from '@lucide/svelte/icons/git-branch';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import AgentSprite from './AgentSprite.svelte';
  import StatusDot from './StatusDot.svelte';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { prSummary } from '../lib/board.js';
  import { SUBTITLE_TONE_CLASS } from '../lib/thread-subtitle.js';
  import { AGENT_SPRITES, type AgentSpriteState } from '../lib/agent-sprite.js';
  import type { SessionSubtitle } from '../lib/session-subtitle.js';
  import type { PrInfo } from '../../shared/types.js';

  /**
   * A thread on the board: its status (the character or square the sidebar
   * shows), name, project and branch, the line the sidebar shows under it,
   * and its pull request. The whole card opens the thread.
   */
  let { id, name, branch, projectName, projectColor, showProject, state, subtitle, pr, waiting, onopen }: {
    id: string;
    name: string;
    branch: string;
    projectName: string;
    projectColor: string | null;
    /** Off in a project's lane, which already names it. */
    showProject: boolean;
    state: AgentSpriteState;
    subtitle: SessionSubtitle | null;
    pr: PrInfo | null;
    /** In Needs you: drawn with an amber edge, like a waiting prompt. */
    waiting: boolean;
    onopen: () => void;
  } = $props();

  const prBadge = $derived(pr ? prSummary(pr) : null);
  /** Read out in full: the card's lines are cut short when it is narrow. */
  const label = $derived([
    name,
    AGENT_SPRITES[state].label,
    subtitle?.text,
    pr && prBadge ? `Pull request #${pr.number}: ${prBadge.label}` : '',
  ].filter(Boolean).join('. '));
</script>

<button
  type="button"
  onclick={onopen}
  class="w-full min-w-0 flex flex-col gap-1 px-2 py-1.5 text-left bg-card border transition-colors hover:bg-accent
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
    {waiting ? 'border-status-attention/60' : 'border-border'}"
  title="{label}. Click to open the thread"
  aria-label={label}
  data-board-card={id}
>
  <span class="flex items-center gap-2 min-w-0 w-full">
    {#if settingsStore.current.groveCharacters}
      <AgentSprite {state} seed={id} {projectColor} />
    {:else}
      <StatusDot {state} />
    {/if}
    <span class="flex-1 min-w-0 truncate text-xs font-medium text-foreground">{name}</span>
  </span>
  <span class="flex items-center gap-1.5 min-w-0 w-full text-caption text-muted-foreground">
    {#if showProject}
      {#if projectColor}<span class="w-1.5 h-1.5 shrink-0" style="background-color: {projectColor}" aria-hidden="true"></span>{/if}
      <span class="truncate max-w-[45%] shrink-0">{projectName}</span>
    {/if}
    {#if branch}
      <GitBranchIcon class="size-3 shrink-0" aria-hidden="true" />
      <span class="truncate min-w-0">{branch}</span>
    {/if}
  </span>
  {#if subtitle}
    <span class="w-full truncate text-caption {SUBTITLE_TONE_CLASS[subtitle.tone]}">{subtitle.text}</span>
  {/if}
  {#if pr && prBadge}
    <span class="flex items-center gap-1.5 min-w-0 text-caption text-muted-foreground">
      <span class="shrink-0">#{pr.number}</span>
      <Badge tone={prBadge.tone} class="truncate">{prBadge.label}</Badge>
    </span>
  {/if}
</button>
