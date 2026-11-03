<script lang="ts">
  /**
   * The branch's one icon (lib/ship-track.ts, `stage`), in the status bar's
   * branch lozenge and the sidebar's thread rows (prStore.branchShip feeds
   * both): its shape says how far the branch has got (a branch, then the
   * PR: draft, open, merged or closed), its colour the step that matters
   * most now, as the popup's dots (ShipDot) colour each step. `todo` has no
   * colour of its own: it takes the text colour around it.
   *
   * 12px by default, for the lozenge's text-xs; `iconClass` sizes it for
   * elsewhere (docs/ui-kit.md). Other attributes (a label, a test id) go on
   * the wrapper.
   */
  import GitBranchIcon from '@lucide/svelte/icons/git-branch';
  import GitMergeIcon from '@lucide/svelte/icons/git-merge';
  import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request';
  import GitPullRequestClosedIcon from '@lucide/svelte/icons/git-pull-request-closed';
  import GitPullRequestDraftIcon from '@lucide/svelte/icons/git-pull-request-draft';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils.js';
  import type { ShipStage, ShipStageIcon, ShipStageState } from '../lib/ship-track.js';

  let {
    stage,
    stale = false,
    alert = false,
    iconClass = '',
    class: className = '',
    ...rest
  }: {
    stage: ShipStage;
    /** The last GitHub fetch failed, so it may be old: dimmed. */
    stale?: boolean;
    /** PR activity you haven't looked at yet: pulsing. */
    alert?: boolean;
    iconClass?: string;
  } & HTMLAttributes<HTMLSpanElement> = $props();

  const ICON: Record<ShipStageIcon, typeof GitBranchIcon> = {
    branch: GitBranchIcon,
    draft: GitPullRequestDraftIcon,
    pr: GitPullRequestIcon,
    merged: GitMergeIcon,
    closed: GitPullRequestClosedIcon,
  };

  const TONE: Record<ShipStageState, string> = {
    done: 'text-green-500',
    running: 'text-status-working animate-pulse',
    failed: 'text-red-500',
    attention: 'text-amber-500',
    merged: 'text-purple-400',
    closed: 'text-muted-foreground/50',
    todo: '',
  };

  let Icon = $derived(ICON[stage.icon]);
</script>

<!-- Dimming and the alert pulse are on the wrapper: the pulse only fades to
     half, so on the icon itself a dimmed icon would hold still, checks
     running too. -->
<span {...rest} class={cn('flex shrink-0', alert && 'animate-pulse', stale && 'opacity-50', className)}>
  <Icon class={cn('size-3', TONE[stage.state], iconClass)} aria-hidden="true" />
</span>
