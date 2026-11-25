<script lang="ts">
  import GitBranchIcon from '@lucide/svelte/icons/git-branch';
  import ListTodoIcon from '@lucide/svelte/icons/list-todo';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import AgentSprite from './AgentSprite.svelte';
  import StatusDot from './StatusDot.svelte';
  import { settingsStore } from '../stores/settings.svelte.js';
  import { prSummary } from '../lib/board.js';
  import { threadSubtitle, SUBTITLE_TONE_CLASS } from '../lib/thread-subtitle.js';
  import { AGENT_SPRITES, type AgentSpriteState } from '../lib/agent-sprite.js';
  import type { PrInfo, SessionStatus } from '../../shared/types.js';
  import type { FollowUp } from '../../shared/follow-ups.js';

  /**
   * A thread on the board: its status (the character or square the sidebar
   * shows), name, project and branch, the line the sidebar shows under it,
   * and its pull request. The card opens the thread. One started from a
   * follow-up names it along the bottom, a button of its own that shows it
   * in the Follow-ups drawer.
   *
   * Cards that need a look stand out, each its own way: one that is unread
   * (a turn finished, or a pull request alert came, since you last looked)
   * has a green edge and says New (green: finished a turn), and one whose
   * pull request needs you has an amber edge (amber: needs you), its badge
   * saying why.
   */
  let { id, name, branch, projectName, projectColor, showProject, state, status, pr, waiting, unread = false, prNeedsYou = false, followUp = null, onopen, onfollowup }: {
    id: string;
    name: string;
    branch: string;
    projectName: string;
    projectColor: string | null;
    /** Off in a project's lane, which already names it. */
    showProject: boolean;
    state: AgentSpriteState;
    /** For the line under the name, which the card works out itself, so a
     *  stream in another thread doesn't touch this card. */
    status: SessionStatus;
    pr: PrInfo | null;
    /** In Needs you: drawn with an amber edge, like a waiting prompt. */
    waiting: boolean;
    /** Unread: a turn finished, or a pull request alert came, since you last looked. */
    unread?: boolean;
    /** Its open pull request has changes asked for, failing checks or conflicts. */
    prNeedsYou?: boolean;
    /** The follow-up the thread was started from, if it was. */
    followUp?: FollowUp | null;
    onopen: () => void;
    onfollowup?: () => void;
  } = $props();

  const subtitle = $derived(threadSubtitle({ id, status }));
  const prBadge = $derived(pr ? prSummary(pr) : null);
  /** Read out in full: the card's lines are cut short when it is narrow. */
  const label = $derived([
    name,
    unread ? 'New since you last looked' : AGENT_SPRITES[state].label,
    subtitle?.text,
    pr && prBadge ? `Pull request #${pr.number}${prNeedsYou ? ' needs you' : ''}: ${prBadge.label}` : '',
  ].filter(Boolean).join('. '));

  const edge = $derived(waiting || (prNeedsYou && !unread) ? 'border-status-attention/60' : unread ? 'border-status-unread/70' : 'border-border');
</script>

<div class="w-full min-w-0 flex flex-col bg-card border {edge}" data-board-card-unread={unread || undefined} data-board-card-pr-needs-you={prNeedsYou || undefined}>
<button
  type="button"
  onclick={onopen}
  class="w-full min-w-0 flex flex-col gap-1 px-2 py-1.5 text-left transition-colors hover:bg-accent
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
    {#if unread}<Badge tone="success" variant="soft" aria-hidden="true">New</Badge>{/if}
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
{#if followUp}
  <button
    type="button"
    onclick={onfollowup}
    class="w-full min-w-0 flex items-center gap-1.5 px-2 py-1 text-left border-t border-border text-caption text-muted-foreground
      transition-colors hover:bg-accent hover:text-foreground
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    title="Started from the follow-up “{followUp.title}”{followUp.doneAt !== undefined ? ', now done' : ''}. Click to show it in Follow-ups"
    aria-label="Started from the follow-up {followUp.title}{followUp.doneAt !== undefined ? ', done' : ''}. Show it in Follow-ups"
    data-board-card-follow-up={followUp.id}
  >
    <ListTodoIcon class="size-3 shrink-0" aria-hidden="true" />
    <span class="truncate min-w-0">{followUp.title}</span>
    {#if followUp.doneAt !== undefined}<span class="shrink-0 text-status-unread">done</span>{/if}
  </button>
{/if}
</div>
