<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { formatAge } from '../../shared/format-age.js';
  import type { FollowUp } from '../../shared/follow-ups.js';

  /**
   * A follow-up in the board's first column: work for a later thread, not
   * started yet. A dashed edge, like the new thread's mark in the sidebar:
   * nothing is running for it. Start thread opens the new thread with it as
   * the first message (draftStore.openFollowUp), as the drawer does.
   */
  let { followUp, startedBefore, projectName, projectColor, showProject, onstart, ondone }: {
    followUp: FollowUp;
    /** A thread was started from it and closed before the work was done. */
    startedBefore: boolean;
    projectName: string;
    projectColor: string | null;
    /** Off in a project's lane, which already names it. */
    showProject: boolean;
    onstart: () => void;
    ondone: () => void;
  } = $props();
</script>

<article
  class="w-full min-w-0 flex flex-col gap-1 px-2 py-1.5 bg-card border border-dashed border-input"
  aria-label="Follow-up: {followUp.title}"
  data-board-follow-up={followUp.id}
>
  <h4 class="text-xs font-medium text-foreground line-clamp-2 break-words" title={followUp.title}>{followUp.title}</h4>
  {#if followUp.details}
    <p class="text-caption text-muted-foreground line-clamp-2 break-words" title={followUp.details}>{followUp.details}</p>
  {/if}
  <span class="flex items-center gap-1.5 min-w-0 text-caption text-muted-foreground">
    {#if showProject}
      {#if projectColor}<span class="w-1.5 h-1.5 shrink-0" style="background-color: {projectColor}" aria-hidden="true"></span>{/if}
      <span class="truncate max-w-[45%] shrink-0">{projectName}</span>
      <span class="text-muted-foreground/40" aria-hidden="true">·</span>
    {/if}
    <span class="truncate">
      {formatAge(followUp.createdAt)}{#if startedBefore}{' · '}<span class="text-foreground/80">started before</span>{/if}{#if followUp.fromLabel}{' · '}from {followUp.fromLabel}{/if}
    </span>
  </span>
  <span class="flex items-center gap-1 pt-0.5">
    <Button
      variant="subtle-primary"
      size="2xs"
      onclick={onstart}
      title="Open a new thread with this follow-up as its first message, to look over and send"
    >{startedBefore ? 'Start another' : 'Start thread'}</Button>
    <Button variant="subtle" size="2xs" onclick={ondone} title="Mark it done">Done</Button>
  </span>
</article>
