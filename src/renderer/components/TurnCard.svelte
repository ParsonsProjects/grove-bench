<script lang="ts">
  /**
   * One turn in the Summary view: your prompt; a strip that says what the
   * agent did, with its steps folded behind it; its answer and anything that
   * needs you; then the files it changed, its time and its cost. Messages stay
   * in the order they came: folding the steps only hides them. Each step is
   * one line (TurnStep); while the turn runs, only its last few show. A
   * command that failed and then passed when run again links to that run,
   * and back.
   * OutputPanel draws each message through `row`, so search, bookmarks and
   * the reader's place work as in the other views.
   */
  import type { Snippet } from 'svelte';
  import type { ChatMessage } from '../stores/messages.svelte.js';
  import type { MessageViewMode } from '$lib/message-view.js';
  import {
    formatTurnTime, isWorkStep, retryLinks, showsImagesFolded, tallyTurn,
    type StepMark, type Turn, type TurnStatus,
  } from '$lib/turns.js';
  import { formatSentTime } from '$lib/message-dates.js';
  import { formatUsd } from '../../shared/limits.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import CopyButton from './CopyButton.svelte';
  import TurnStep from './TurnStep.svelte';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';

  let {
    sessionId,
    turn,
    status,
    notes,
    folded,
    onfold,
    workOpen,
    onwork,
    allSteps = false,
    onallsteps,
    showCost = true,
    row,
    live,
  }: {
    sessionId: string;
    turn: Turn;
    status: TurnStatus;
    /** The thread's notes written while working (narrationIds): steps. */
    notes: ReadonlySet<string>;
    /** Drawn as one line. */
    folded: boolean;
    onfold: (folded: boolean) => void;
    /** Its steps are shown. */
    workOpen: boolean;
    onwork: (open: boolean) => void;
    /** While it runs, show all its steps, not just the last LIVE_STEPS. */
    allSteps?: boolean;
    onallsteps?: () => void;
    /** Off on a plan, whose cost isn't billed (coveredByPlan). */
    showCost?: boolean;
    /** Draws one message: in the view mode given, or as `content` draws it
     *  (a step's line). */
    row: Snippet<[ChatMessage, MessageViewMode, Snippet | undefined]>;
    /** The live reply, thinking or working line, while this turn runs. */
    live?: Snippet;
  } = $props();

  let card = $state<HTMLElement>();

  let links = $derived(retryLinks(turn.msgs));
  let tally = $derived(tallyTurn(turn.msgs, links));
  let running = $derived(status === 'working' || status === 'attention');
  let hasWork = $derived(turn.msgs.some((m) => isWorkStep(m, notes)));

  /** A turn's end shows in its strip and footer, unless it went wrong. */
  let shown = $derived(turn.msgs.filter((m) => m.kind !== 'result' || m.isError));

  /** While a turn runs, only its last few steps show; the earlier ones are
   *  one line that shows them all (onallsteps). */
  const LIVE_STEPS = 5;
  let earlierSteps = $derived.by(() => {
    if (!running || allSteps || !workOpen) return 0;
    return Math.max(0, shown.filter((m) => isWorkStep(m, notes)).length - LIVE_STEPS);
  });

  /** Runs of steps and of what stays in view, in order, and where earlier
   *  steps are left out. With the steps folded, only a step's images stay
   *  (showsImagesFolded). */
  type Segment = { kind: 'work' | 'view'; msgs: ChatMessage[] } | { kind: 'earlier'; count: number };
  let segments = $derived.by(() => {
    const out: Segment[] = [];
    let skip = earlierSteps;
    for (const msg of shown) {
      const step = isWorkStep(msg, notes);
      if (step && skip > 0) {
        if (skip === earlierSteps) out.push({ kind: 'earlier', count: earlierSteps });
        skip--;
        continue;
      }
      if (step && !workOpen && !showsImagesFolded(msg)) continue;
      const kind = step && workOpen ? 'work' : 'view';
      const last = out[out.length - 1];
      if (last && last.kind === kind) last.msgs.push(msg);
      else out.push({ kind, msgs: [msg] });
    }
    return out;
  });

  /** How a message in view is drawn: in full, or a folded step's images
   *  alone, as Focus draws them. (Steps shown are TurnStep lines.) */
  function modeFor(msg: ChatMessage): MessageViewMode {
    return isWorkStep(msg, notes) ? 'focus' : 'detailed';
  }

  let time = $derived(turn.prompt?.sentAt !== undefined ? formatSentTime(turn.prompt.sentAt) : '');
  let took = $derived(turn.result?.durationMs !== undefined ? formatTurnTime(turn.result.durationMs) : '');
  let cost = $derived(showCost && turn.result?.totalCostUsd !== undefined ? formatUsd(turn.result.totalCostUsd) : '');
  let cutOff = $derived(turn.msgs.some((m) => m.kind === 'cut_off'));

  let label = $derived.by(() => {
    switch (status) {
      case 'working': return 'Working';
      case 'attention': return 'Waiting for you';
      case 'error': return took ? `Ended with an error after ${took}` : 'Ended with an error';
      case 'ended': return cutOff ? 'Cut off' : 'Worked';
      default: return took ? `Worked ${took}` : 'Worked';
    }
  });

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let edited = $derived([...tally.edits]);

  /** The prompt on one line, for the folded turn. */
  let promptLine = $derived.by(() => {
    const p = turn.prompt;
    if (!p) return '';
    const first = p.text.trim().split('\n')[0];
    if (first) return first;
    return p.images?.length || p.files?.length || p.attachments?.length ? 'Attached files' : '';
  });
  let foldedMeta = $derived([
    edited.length ? plural(edited.length, 'file', 'files') + ' changed' : '',
    took,
    cost,
  ].filter(Boolean).join(' · '));

  /** The pixel trail: a square per step, up to this many. */
  const MAX_MARKS = 40;
  function markClass(m: StepMark): string {
    if (m.pending) return 'bg-status-working motion-safe:animate-pulse';
    if (m.failed) return 'bg-status-error';
    switch (m.kind) {
      case 'edit': return 'bg-primary';
      case 'shell': return 'bg-cyan-400';
      case 'thinking': return 'bg-purple-400';
      case 'other': return 'bg-yellow-400';
      default: return 'bg-muted-foreground/50';
    }
  }

  /** The answer, to copy: what the agent wrote outside its notes. */
  let answer = $derived(
    turn.msgs.filter((m): m is Extract<ChatMessage, { kind: 'text' }> => m.kind === 'text' && !notes.has(m.id)).map((m) => m.text).join('\n\n'),
  );

  /** Files shown in the footer; the rest are counted. */
  const MAX_FILES = 6;

  function openFile(path: string) {
    window.groveBench.openInEditor(sessionId, path).catch(() => {});
  }

  /** Scroll to the other run of a command, and mark it for a moment. */
  function showRun(id: string) {
    const el = card?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-1', 'ring-ring');
    setTimeout(() => el.classList.remove('ring-1', 'ring-ring'), 1500);
  }

  const EDGE: Record<TurnStatus, string> = {
    working: 'border-l-status-working',
    attention: 'border-l-status-attention',
    error: 'border-l-status-error',
    done: 'border-l-border',
    ended: 'border-l-border',
  };
</script>

<section
  bind:this={card}
  data-turn={turn.id}
  class="my-2 bg-card border border-border border-l-2 {EDGE[status]} [&>*:first-child]:border-t-0"
>
  {#if folded && turn.prompt}
    <button
      type="button"
      data-msg-id={turn.prompt.id}
      class="w-full flex items-center gap-2 px-3 py-1 text-xs text-left hover:bg-accent/50"
      aria-expanded="false"
      title="Open this turn"
      onclick={() => onfold(false)}
    >
      <ChevronRightIcon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span class="text-primary select-none" aria-hidden="true">&gt;</span>
      <span class="flex-1 min-w-0 truncate text-muted-foreground">{promptLine}</span>
      {#if foldedMeta}<span class="shrink-0 text-caption text-muted-foreground">{foldedMeta}</span>{/if}
      {@render statusMark()}
      {#if time}<time class="shrink-0 text-caption text-muted-foreground tabular-nums">{time}</time>{/if}
    </button>
  {:else}
    {#if turn.prompt}
      <!-- The prompt's own tint and edge give way to the card's. -->
      <div class="flex items-start bg-primary/8 [&_.user-prompt]:bg-transparent [&_.user-prompt]:border-l-0 [&_.user-prompt]:my-0">
        <div class="flex-1 min-w-0">{@render row(turn.prompt, 'detailed', undefined)}</div>
        {#if !running}
          <Button
            variant="quiet"
            size="icon-2xs"
            class="mt-2.5 mr-1 shrink-0"
            title="Fold this turn to one line"
            aria-label="Fold this turn"
            aria-expanded="true"
            onclick={() => onfold(true)}
          ><ChevronUpIcon /></Button>
        {/if}
      </div>
    {/if}

    {#if hasWork || running}
      <button
        type="button"
        class="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 border-t border-border text-xs text-muted-foreground text-left hover:bg-accent/50"
        aria-expanded={workOpen}
        title={workOpen ? 'Hide the steps' : 'Show the steps'}
        onclick={() => onwork(!workOpen)}
      >
        <ChevronRightIcon class="size-3 shrink-0 transition-transform {workOpen ? 'rotate-90' : ''}" aria-hidden="true" />
        <span class="flex items-center gap-1.5 text-foreground">{@render statusMark()}{label}</span>
        {#if tally.marks.length}
          <span class="flex flex-wrap items-center gap-0.5" aria-hidden="true">
            {#each tally.marks.slice(0, MAX_MARKS) as mark (mark.id)}
              <span class="block size-1.5 {markClass(mark)}" title={mark.label}></span>
            {/each}
            {#if tally.marks.length > MAX_MARKS}
              <span class="text-micro ml-0.5">+{tally.marks.length - MAX_MARKS}</span>
            {/if}
          </span>
        {/if}
        <span class="flex flex-wrap gap-x-3">
          {#if tally.filesRead}<span>{plural(tally.filesRead, 'file', 'files')} read</span>{/if}
          {#if tally.searches}<span>{plural(tally.searches, 'search', 'searches')}</span>{/if}
          {#if edited.length}
            <span>{plural(edited.length, 'file', 'files')} changed <span class="text-green-400">+{tally.add}</span> <span class="text-red-400">−{tally.del}</span></span>
          {/if}
          {#if tally.commands}
            <span>
              {plural(tally.commands, 'command', 'commands')}{#if tally.failed},
                <span class="text-destructive">{tally.failed} failed</span>{#if tally.passedOnRetry === tally.failed},
                  <span class="text-green-400">passed on retry</span>{:else if tally.passedOnRetry},
                  <span class="text-green-400">{tally.passedOnRetry} passed on retry</span>{/if}{/if}
            </span>
          {/if}
          {#if tally.other}<span>{plural(tally.other, 'other tool', 'other tools')}</span>{/if}
        </span>
      </button>
    {/if}

    {#each segments as seg (seg.kind === 'earlier' ? 'earlier' : seg.msgs[0].id)}
      {#if seg.kind === 'earlier'}
        <div class="border-t border-border px-3 py-0.5 bg-background/40 text-xs">
          <Button variant="quiet" size="inline" onclick={() => onallsteps?.()}>
            {seg.count === 1 ? 'Show 1 earlier step' : `Show ${seg.count} earlier steps`}
          </Button>
        </div>
      {:else if seg.kind === 'work'}
        <div class="border-t border-border px-3 py-1 bg-background/40">
          {#each seg.msgs as msg (msg.id)}
            {#snippet step()}
              <TurnStep {sessionId} {msg} link={links.get(msg.id)} onlink={showRun} />
            {/snippet}
            {@render row(msg, 'summary', step)}
          {/each}
        </div>
      {:else}
        <div class="border-t border-border px-3 py-1.5">
          {#each seg.msgs as msg (msg.id)}
            {@render row(msg, modeFor(msg), undefined)}
          {/each}
        </div>
      {/if}
    {/each}

    {#if live}
      <div class="border-t border-border px-3 py-1">{@render live()}</div>
    {/if}

    {#if edited.length || took || cost || answer}
      <div class="flex flex-wrap items-center gap-1.5 px-3 py-1 border-t border-border text-caption text-muted-foreground">
        {#if edited.length}
          <span class="mr-0.5">{running ? 'Changed so far' : 'Changed'}</span>
          {#each edited.slice(0, MAX_FILES) as [path, lines] (path)}
            <button
              type="button"
              class="max-w-full truncate border border-border bg-background px-1.5 text-foreground hover:border-primary/50"
              title="Open {path} in your editor"
              onclick={() => openFile(path)}
            >{path} <span class="text-green-400">+{lines.add}</span> <span class="text-red-400">−{lines.del}</span></button>
          {/each}
          {#if edited.length > MAX_FILES}
            <span title={edited.slice(MAX_FILES).map(([p]) => p).join('\n')}>and {edited.length - MAX_FILES} more</span>
          {/if}
        {/if}
        <span class="flex-1"></span>
        {#if !running}
          {#if took}<span>{took}</span>{/if}
          {#if cost}<span>{cost}</span>{/if}
          {#if answer}<CopyButton text={answer} />{/if}
        {/if}
      </div>
    {/if}
  {/if}
</section>

{#snippet statusMark()}
  {#if status === 'working'}
    <Pulse size="sm" label="Working" />
  {:else if status === 'attention'}
    <Pulse tone="attention" size="sm" label="Waiting for you" />
  {:else}
    <span
      class="inline-block size-2 shrink-0 {status === 'done' ? 'bg-status-unread' : status === 'error' ? 'bg-status-error' : 'bg-muted-foreground'}"
      aria-hidden="true"
    ></span>
  {/if}
{/snippet}
