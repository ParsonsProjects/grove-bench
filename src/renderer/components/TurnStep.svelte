<script lang="ts">
  /**
   * One step of a turn's work on one line, in a turn card's steps
   * (ThreadTurn): what kind of step (a pixel icon, StepIcon), what it worked
   * on and how it went. Click it for the rest of the step under the line,
   * without its header again (the command's output, the edit's diff, the
   * file read). A note the agent wrote while working is smaller text;
   * thinking shows its first line. A command that failed and then passed
   * when run again links to that run (`link`).
   */
  import type { ChatMessage } from '../stores/messages.svelte.js';
  import ThreadMessage from './ThreadMessage.svelte';
  import ImageAttachments from './ImageAttachments.svelte';
  import MarkdownBlock from './MarkdownBlock.svelte';
  import StepIcon from './StepIcon.svelte';
  import { stepIconFor, type StepIconKind } from '$lib/step-icons.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { toolLabel } from '$lib/tool-names.js';
  import { editLineCounts, type RetryLink } from '$lib/turns.js';
  import { toolViewOf, toolViewSummary } from '../../shared/tool-view.js';

  let {
    sessionId,
    msg,
    link,
    onlink,
  }: {
    sessionId: string;
    msg: ChatMessage;
    /** The other run of this command, when one failed and the other passed. */
    link?: RetryLink;
    onlink?: (to: string) => void;
  } = $props();

  let open = $state(false);

  /** `word` is what the icon stands for, for its tooltip and screen readers. */
  type Line = { icon: StepIconKind; word: string; tone: string; target: string };

  /** What the line says for a tool call or an answered permission. */
  let line = $derived.by((): Line | null => {
    if (msg.kind === 'thinking') {
      return { icon: 'think', word: 'Thought', tone: 'text-purple-400', target: msg.thinking.trim().split('\n')[0] ?? '' };
    }
    if (msg.kind === 'permission') {
      const view = toolViewOf(msg);
      return { icon: 'asked', word: 'Asked you', tone: 'text-muted-foreground', target: `${toolLabel(msg.toolName)} ${toolViewSummary(view)}`.trim() };
    }
    if (msg.kind !== 'tool_call') return null;
    const view = toolViewOf(msg);
    const target = toolViewSummary(view);
    const icon = stepIconFor(view);
    switch (view.kind) {
      case 'read': return { icon, word: 'Read', tone: 'text-muted-foreground', target };
      case 'search': return { icon, word: 'Searched', tone: 'text-muted-foreground', target: view.path && view.pattern ? `${view.pattern} in ${view.path}` : target };
      case 'edit': return { icon, word: view.edits?.length ? 'Edited' : 'Wrote', tone: 'text-primary', target: target || msg.toolName };
      case 'shell': return { icon, word: 'Ran', tone: 'text-cyan-400', target };
      case 'fetch': return { icon, word: 'Fetched', tone: 'text-yellow-400', target };
      case 'web_search': return { icon, word: 'Searched the web', tone: 'text-yellow-400', target };
      default: return { icon, word: 'Used a tool', tone: 'text-yellow-400', target: [toolLabel(msg.toolName), target].filter(Boolean).join(' ') };
    }
  });

  /** Lines of a tool's output, as its block counts them. */
  let outputLines = $derived(msg.kind === 'tool_call' && msg.result ? msg.result.split('\n').length : 0);
  let edit = $derived(msg.kind === 'tool_call' && toolViewOf(msg).kind === 'edit' ? editLineCounts(msg, toolViewOf(msg)) : null);
  let images = $derived(msg.kind === 'tool_call' ? msg.images ?? [] : []);
</script>

{#if msg.kind === 'text'}
  <!-- A note while working: smaller than the answer it leads to. -->
  <div class="py-0.5 pl-5 text-xs text-foreground">
    <MarkdownBlock content={msg.text} {sessionId} />
  </div>
{:else if line}
  <div class="flex items-center gap-2 text-xs leading-5 min-w-0">
    <button
      type="button"
      class="flex-1 min-w-0 flex items-center gap-2 -mx-1 px-1 text-left hover:bg-accent/50"
      aria-expanded={open}
      title={open ? 'Hide this step' : 'Show this step in full'}
      onclick={() => (open = !open)}
    >
      <span class="flex shrink-0 {line.tone}" title={line.word}><StepIcon kind={line.icon} /></span>
      <span class="sr-only">{line.word}:</span>
      <span class="min-w-0 truncate {msg.kind === 'thinking' ? 'italic text-muted-foreground' : 'text-foreground'}">{line.target}</span>
    </button>
    <span class="shrink-0 flex items-center gap-2 text-muted-foreground">
      {#if msg.kind === 'tool_call'}
        {#if msg.pending}
          <span class="flex items-center gap-1.5 text-status-working"><Pulse size="sm" />running</span>
        {:else if msg.isError}
          <span class="text-destructive">failed</span>
        {:else if edit}
          <span><span class="text-green-400">+{edit.add}</span> <span class="text-red-400">−{edit.del}</span></span>
        {:else if outputLines}
          <span>{outputLines === 1 ? '1 line' : `${outputLines} lines`}</span>
        {/if}
      {:else if msg.kind === 'permission'}
        {#if msg.decision === 'allow'}
          <span class="text-green-400">allowed</span>
        {:else}
          <span class="text-destructive">{msg.timedOut ? 'timed out' : 'denied'}</span>
        {/if}
      {/if}
      {#if link?.kind === 'passed'}
        <Button variant="link" size="inline" class="text-green-400" onclick={() => onlink?.(link.to)}>passed on retry ↓</Button>
      {:else if link}
        <Button variant="quiet" size="inline" onclick={() => onlink?.(link.to)}>retry of the run that failed ↑</Button>
      {/if}
    </span>
  </div>
  {#if open}
    <div class="pl-5 pb-1">
      {#if msg.kind === 'thinking'}
        <div class="text-xs text-muted-foreground italic whitespace-pre-wrap">{msg.thinking}</div>
      {:else if msg.kind === 'permission'}
        <!-- What was asked, in full, and why it was decided so. -->
        <div class="text-xs whitespace-pre-wrap break-all">{line.target}</div>
        {#if msg.decisionReason}<div class="text-xs text-muted-foreground mt-0.5">{msg.decisionReason}</div>{/if}
      {:else}
        <ThreadMessage {sessionId} {msg} viewMode="detailed" headless />
      {/if}
    </div>
  {:else if images.length}
    <ImageAttachments {sessionId} {images} class="pl-5 mb-1" />
  {/if}
{:else}
  <!-- A plain status line: small already. -->
  <ThreadMessage {sessionId} {msg} viewMode="summary" />
{/if}
