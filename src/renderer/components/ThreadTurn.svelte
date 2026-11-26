<script lang="ts">
  /**
   * One turn in the Summary view: your prompt; one summary line saying how
   * the turn went (its time, what its steps came to, its cost), with the
   * steps folded behind it; then its answer and anything that needs you.
   * Messages stay in the order they came: folding the steps only hides them.
   * Each step is one line (TurnStep). While the turn runs, a line under the
   * summary says what the agent is doing now, or what it waits on, and a
   * timer counts from the prompt. A command that failed and then passed when
   * run again links to that run, and back.
   * OutputPanel draws each message through `row`, so search, bookmarks and
   * the reader's place work as in the other views.
   */
  import type { Snippet } from 'svelte';
  import type { ChatMessage } from '../stores/messages.svelte.js';
  import type { MessageViewMode } from '$lib/message-view.js';
  import { formatTurnTime, isWorkStep, retryLinks, showsImagesFolded, tallyTurn, type Turn, type TurnStatus } from '$lib/turns.js';
  import { formatSentTime } from '$lib/message-dates.js';
  import { approvalRequest } from '$lib/tool-names.js';
  import { formatUsd } from '../../shared/limits.js';
  import { toolViewOf, toolViewSummary } from '../../shared/tool-view.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
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
    activity,
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
    /** What the agent is doing now (thinking, running a tool, writing), while
     *  this turn runs. */
    activity?: Snippet;
    /** The reply being written, while this turn runs. */
    live?: Snippet;
  } = $props();

  let section = $state<HTMLElement>();

  let links = $derived(retryLinks(turn.msgs));
  let tally = $derived(tallyTurn(turn.msgs, links));
  let running = $derived(status === 'working' || status === 'attention');
  let hasWork = $derived(turn.msgs.some((m) => isWorkStep(m, notes)));

  /** A turn's end shows in its summary line, unless it went wrong. */
  let shown = $derived(turn.msgs.filter((m) => m.kind !== 'result' || m.isError));

  /** While a turn runs with its steps open, only its last few show; the
   *  earlier ones are one line that shows them all (onallsteps). */
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

  // ─── While it runs: a timer from the prompt, and what it waits on ───
  let now = $state(Date.now());
  $effect(() => {
    if (!running) return;
    now = Date.now();
    const timer = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(timer);
  });
  let elapsed = $derived(running && turn.prompt?.sentAt !== undefined ? formatTurnTime(now - turn.prompt.sentAt) : '');

  /** What the turn waits on, worded as the sidebar words it
   *  (sessionSubtitle), and what it would act on. */
  let waitingFor = $derived.by((): { what: string; target?: string } | null => {
    if (status !== 'attention') return null;
    const msg = turn.msgs.findLast((m) => (m.kind === 'permission' || m.kind === 'question' || m.kind === 'elicitation' || m.kind === 'limit') && !m.resolved);
    switch (msg?.kind) {
      case 'permission': {
        const view = toolViewOf(msg);
        const what = approvalRequest(msg.toolName, view);
        return { what: what.charAt(0).toUpperCase() + what.slice(1), target: toolViewSummary(view) || undefined };
      }
      case 'question': return { what: 'Waiting for your answer' };
      case 'elicitation': return { what: 'Waiting for your input' };
      case 'limit': return { what: 'Paused at a limit' };
      default: return { what: 'Waiting for you' };
    }
  });

  let label = $derived.by(() => {
    switch (status) {
      case 'working': return 'Working';
      case 'attention': return 'Waiting for you';
      case 'error': return took ? `Ended with an error after ${took}` : 'Ended with an error';
      case 'ended': return cutOff ? 'Cut off' : 'Worked';
      default: return took ? `Worked ${took}` : 'Worked';
    }
  });
  const LABEL_TONE: Record<TurnStatus, string> = {
    working: 'text-status-working',
    attention: 'text-status-attention',
    error: 'text-destructive',
    done: 'text-foreground',
    ended: 'text-foreground',
  };

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  let edited = $derived([...tally.edits]);
  /** The files changed, for the count's tooltip. */
  let editedList = $derived(edited.map(([path, l]) => `${path}  +${l.add} −${l.del}`).join('\n'));

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

  /** Scroll to the other run of a command, and mark it for a moment. */
  function showRun(id: string) {
    const el = section?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-1', 'ring-ring');
    setTimeout(() => el.classList.remove('ring-1', 'ring-ring'), 1500);
  }

  /** A dot before each part of the summary line after the first. */
  const DOT = "before:content-['·'] before:mr-2 before:text-muted-foreground";
</script>

<section bind:this={section} data-turn={turn.id} class="my-3">
  {#if folded && turn.prompt}
    <button
      type="button"
      data-msg-id={turn.prompt.id}
      class="w-full flex items-center gap-2 px-3 py-1 border-l-2 border-border text-xs text-left hover:bg-accent/50"
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
      <!-- The prompt as every view draws it, with the fold button in its row. -->
      <div class="flex items-start bg-primary/8 border-l-2 border-primary [&_.user-prompt]:bg-transparent [&_.user-prompt]:border-l-0 [&_.user-prompt]:my-0">
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

    {#if hasWork || running || took || cost}
      <button
        type="button"
        class="w-full flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-xs text-muted-foreground text-left hover:bg-accent/50"
        aria-expanded={workOpen}
        title={workOpen ? 'Hide the steps' : 'Show the steps'}
        onclick={() => onwork(!workOpen)}
      >
        <ChevronRightIcon class="size-3 shrink-0 transition-transform {workOpen ? 'rotate-90' : ''}" aria-hidden="true" />
        <span class="flex items-center gap-1.5 {LABEL_TONE[status]}">{@render statusMark()}{label}{#if elapsed}<span class="tabular-nums">· {elapsed}</span>{/if}</span>
        {#if tally.filesRead}<span class={DOT}>{plural(tally.filesRead, 'file', 'files')} read</span>{/if}
        {#if tally.searches}<span class={DOT}>{plural(tally.searches, 'search', 'searches')}</span>{/if}
        {#if edited.length}
          <span class={DOT} title={editedList}>{plural(edited.length, 'file', 'files')} changed <span class="text-green-400">+{tally.add}</span> <span class="text-red-400">−{tally.del}</span></span>
        {/if}
        {#if tally.commands}
          <span class={DOT}>
            {plural(tally.commands, 'command', 'commands')}{#if tally.failed},
              <span class="text-destructive">{tally.failed} failed</span>{#if tally.passedOnRetry === tally.failed},
                <span class="text-green-400">passed on retry</span>{:else if tally.passedOnRetry},
                <span class="text-green-400">{tally.passedOnRetry} passed on retry</span>{/if}{/if}
          </span>
        {/if}
        {#if tally.other}<span class={DOT}>{plural(tally.other, 'other tool', 'other tools')}</span>{/if}
        {#if cost && !running}<span class={DOT}>{cost}</span>{/if}
      </button>
    {/if}

    {#if running && !workOpen}{@render nowLine()}{/if}

    {#each segments as seg (seg.kind === 'earlier' ? 'earlier' : seg.msgs[0].id)}
      {#if seg.kind === 'earlier'}
        <div class="ml-[18px] pl-3 border-l border-border text-xs">
          <Button variant="quiet" size="inline" onclick={() => onallsteps?.()}>
            {seg.count === 1 ? 'Show 1 earlier step' : `Show ${seg.count} earlier steps`}
          </Button>
        </div>
      {:else if seg.kind === 'work'}
        <!-- The steps hang off the summary line, under its arrow. -->
        <div class="ml-[18px] pl-3 pr-3 py-0.5 border-l border-border">
          {#each seg.msgs as msg (msg.id)}
            {#snippet step()}
              <TurnStep {sessionId} {msg} link={links.get(msg.id)} onlink={showRun} />
            {/snippet}
            {@render row(msg, 'summary', step)}
          {/each}
        </div>
      {:else}
        <div class="px-3 py-1">
          {#each seg.msgs as msg (msg.id)}
            {@render row(msg, modeFor(msg), undefined)}
          {/each}
        </div>
      {/if}
    {/each}

    {#if running && workOpen}{@render nowLine()}{/if}

    {#if live}<div class="px-3">{@render live()}</div>{/if}
  {/if}
</section>

<!-- What the agent is doing now: under the summary line with the steps
     folded, after them with the steps open. -->
{#snippet nowLine()}
  {#if waitingFor}
    <div class="flex items-center gap-2 pl-[30px] pr-3 py-1 text-xs min-w-0">
      <Pulse tone="attention" size="sm" />
      <span class="truncate"><span class="text-status-attention">{waitingFor.what}</span>{#if waitingFor.target}: {waitingFor.target}{/if}</span>
    </div>
  {:else if activity}
    <div class="pl-[30px] pr-3">{@render activity()}</div>
  {/if}
{/snippet}

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
