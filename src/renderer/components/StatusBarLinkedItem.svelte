<script lang="ts">
  /**
   * One linked project's lozenge in the status bar (StatusBarLinked): its
   * name, the branch its worktree has checked out, uncommitted files,
   * ahead/behind and the PR, and a popup that says the same in words, with
   * the commits not yet on the project's default branch.
   */
  import type { LinkedProjectStatus } from '../../shared/types.js';
  import { store } from '../stores/sessions.svelte.js';
  import { lozenge } from '../lib/lozenge.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Link2 from '@lucide/svelte/icons/link-2';
  import StatusBarPopover from './StatusBarPopover.svelte';

  let { sessionId, status: s }: { sessionId: string; status: LinkedProjectStatus } = $props();

  let open = $state(false);
  let name = $derived(store.repoDisplayName(s.repoPath));

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  let syncText = $derived.by(() => {
    if (!s.sync) return "Couldn't read what's pushed";
    if (s.sync.ahead > 0 || s.sync.behind > 0) {
      return [s.sync.ahead > 0 && `${s.sync.ahead} to push`, s.sync.behind > 0 && `${s.sync.behind} to pull`].filter(Boolean).join(' · ');
    }
    return s.sync.upstream ? 'Up to date with origin' : 'Not pushed yet';
  });

  /** The PR's state on its badge, as the branch popup shows it. */
  let badge = $derived.by((): { tone: 'neutral' | 'muted' | 'accent'; label: string } | null => {
    const pr = s.pr;
    if (!pr) return null;
    if (pr.state === 'MERGED') return { tone: 'accent', label: 'merged' };
    if (pr.state === 'CLOSED') return { tone: 'muted', label: 'closed' };
    if (pr.isDraft) return { tone: 'muted', label: 'draft' };
    return { tone: 'neutral', label: 'open' };
  });

  /** The lozenge's words, for its tooltip and label. */
  let summary = $derived.by(() => {
    if (s.missing) return `${name}: its worktree is gone`;
    const parts = [`${name} / ${s.branch ?? 'no branch'}`];
    if (s.uncommitted) parts.push(plural(s.uncommitted, 'uncommitted file'));
    if (s.sync && (s.sync.ahead > 0 || s.sync.behind > 0)) parts.push(syncText);
    if (s.pr) parts.push(`PR #${s.pr.number} ${badge?.label ?? ''}`.trim());
    return parts.join(', ');
  });
</script>

<StatusBarPopover bind:open label="Linked project {name}" panelClass="w-80" testid="linked-popup" class="flex min-w-0">
  {#snippet trigger()}
    <button
      onclick={() => (open = !open)}
      class={lozenge({ open, class: 'max-w-full' })}
      title="{summary}. This thread also works in {name}, through its own worktree"
      aria-label="Linked project {summary}"
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="linked-project"
    >
      <Link2 class="size-3" />
      <span class="truncate max-w-16 @2xl:max-w-24">{name}</span>
      {#if s.missing}
        <span class="text-status-attention">gone</span>
      {:else}
        <span class="truncate max-w-16 @4xl:max-w-32 text-muted-foreground">{s.branch ?? 'no branch'}</span>
        {#if s.uncommitted}<span class="text-foreground" data-testid="linked-uncommitted">±{s.uncommitted}</span>{/if}
        {#if s.sync && s.sync.ahead > 0}<span>↑{s.sync.ahead}</span>{/if}
        {#if s.sync && s.sync.behind > 0}<span>↓{s.sync.behind}</span>{/if}
        {#if s.pr}<span class="text-foreground">#{s.pr.number}</span>{/if}
      {/if}
    </button>
  {/snippet}

  <div class="flex items-center gap-1 min-w-0 mb-2">
    <span class="font-medium text-foreground truncate" title={s.repoPath}>{name}</span>
    <span class="shrink-0 text-muted-foreground">·</span>
    <span class="truncate text-muted-foreground">{s.branch ?? 'no branch'}</span>
    {#if s.base}<span class="shrink-0 text-muted-foreground">→ {s.base}</span>{/if}
  </div>

  {#if s.missing}
    <p class="text-status-attention">This thread's worktree of {name} is gone. The next start-up tidy drops it.</p>
  {:else}
    <ul class="space-y-1">
      <li data-testid="linked-changes">
        {s.uncommitted === null ? "Couldn't read its changes" : s.uncommitted === 0 ? 'No uncommitted changes' : `${plural(s.uncommitted, 'file')} changed and not committed`}
      </li>
      <li>{syncText}</li>
      {#if s.base && s.unmerged !== null}
        <li>{s.unmerged === 0 ? `Nothing on it that ${s.base} doesn't have` : `${plural(s.unmerged, 'commit')} not on ${s.base}`}</li>
      {/if}
    </ul>
    {#if s.pr}
      <div class="flex items-center gap-2 min-w-0 mt-2">
        <span class="font-medium text-foreground shrink-0">#{s.pr.number}</span>
        {#if s.pr.title}<span class="truncate text-foreground" title={s.pr.title}>{s.pr.title}</span>{/if}
        {#if badge}<Badge tone={badge.tone} class="shrink-0">{badge.label}</Badge>{/if}
        <Button
          variant="external"
          size="icon-2xs"
          class="ml-auto shrink-0"
          onclick={() => window.groveBench.openExternal(s.pr!.url)}
          title="Open #{s.pr.number} on GitHub"
          aria-label="Open #{s.pr.number} on GitHub"
        >
          <ExternalLink />
        </Button>
      </div>
    {/if}
  {/if}

  <p class="mt-2 text-muted-foreground">The agent works in {name} through this worktree, on the thread's branch name. Commit, push and open PRs there yourself, or ask the agent.</p>

  <div class="flex items-center mt-2 pt-2 border-t border-border">
    <Button
      variant="quiet"
      size="xs"
      class="ml-auto"
      disabled={s.missing}
      onclick={() => { open = false; void window.groveBench.openSessionFolder(sessionId, s.repoPath); }}
      title={s.path}
    >
      Open folder
    </Button>
  </div>
</StatusBarPopover>
