<script lang="ts">
  /**
   * The branch lozenge's one icon (lib/ship-track.ts, `stage`): its shape
   * says how far the branch has got (a branch, then the PR: draft, open,
   * merged or closed), its colour the step that matters most now, as the
   * popup's dots (ShipDot) colour each step.
   */
  import GitBranchIcon from '@lucide/svelte/icons/git-branch';
  import GitMergeIcon from '@lucide/svelte/icons/git-merge';
  import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request';
  import GitPullRequestClosedIcon from '@lucide/svelte/icons/git-pull-request-closed';
  import GitPullRequestDraftIcon from '@lucide/svelte/icons/git-pull-request-draft';
  import type { ShipStage, ShipStageIcon, ShipStageState } from '../lib/ship-track.js';

  let { stage, class: className = '' }: { stage: ShipStage; class?: string } = $props();

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

<Icon class="size-3 {TONE[stage.state]} {className}" aria-hidden="true" />
