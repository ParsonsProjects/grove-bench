<script lang="ts">
  /**
   * One turn in the Summary view: your prompt; one summary line saying how
   * the turn went (its time, what its steps came to, its cost), with the
   * steps folded behind it; then its answer and anything that needs you.
   * Messages stay in the order they came: folding the steps only hides them.
   * Each step is one line (TurnStep). While the turn runs, a line under the
   * summary says what the agent is doing now, or what it waits on, a timer
   * counts from the prompt, and the newest text it wrote shows in one slot
   * at the bottom, replaced in place, rather than each note showing and then
   * folding away when the next step starts. A command that failed and then passed when
   * run again links to that run, and back.
   * OutputPanel draws each message through `row`, so search, bookmarks and
   * the reader's place work as in the other views.
   */
  import type { Snippet } from 'svelte';
  import type { ChatMessage } from '../stores/messages.svelte.js';
  import type { MessageViewMode } from '$lib/message-view.js';
  import { formatTurnTime, isWorkStep, retryLinks, showsImagesFolded, tallyTurn, type Turn, type TurnStatus } from '$lib/turns.js';
  import { writtenImageOf } from '$lib/written-image.js';
  import { formatSentTime } from '$lib/message-dates.js';
  import { approvalRequest } from '$lib/tool-names.js';
  import { formatUsd } from '../../shared/limits.js';
  import { toolViewOf, toolViewSummary } from '../../shared/tool-view.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import TurnStep from './TurnStep.svelte';
  import StepIcon from './StepIcon.svelte';
  import ImageAttachments from './ImageAttachments.svelte';
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
    visible = true,
    streaming = false,
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
    /** Its thread is on screen: the timer only ticks then. */
    visible?: boolean;
    /** A reply is being written (`live` draws it). */
    streaming?: boolean;
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
  /** A step, folded behind the summary line: while the turn runs, its text
   *  too (isWorkStep), shown meanwhile in the slot at the bottom. */
  const isStep = (msg: ChatMessage) => isWorkStep(msg, notes, running);
  let hasWork = $derived(turn.msgs.some(isStep));

  /** A turn's end shows in its summary line, unless it went wrong. */
  let shown = $derived(turn.msgs.filter((m) => m.kind !== 'result' || m.isError));

  /** While a turn runs with its steps open, only its last few show; the
   *  earlier ones are one line that shows them all (onallsteps). */
  const LIVE_STEPS = 5;
  let earlierSteps = $derived.by(() => {
    if (!running || allSteps || !workOpen) return 0;
    return Math.max(0, shown.filter(isStep).length - LIVE_STEPS);
  });

  /** Runs of steps and of what stays in view, in order, and where earlier
   *  steps are left out. With the steps folded, only a step's images stay
   *  (showsImagesFolded). */
  type Segment = { kind: 'work' | 'view'; msgs: ChatMessage[] } | { kind: 'earlier'; count: number };
  let segments = $derived.by(() => {
    const out: Segment[] = [];
    let skip = earlierSteps;
    for (const msg of shown) {
      const step = isStep(msg);
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

  /** While the turn runs with its steps folded: the newest text it wrote,
   *  in one slot at the bottom (a note now, maybe its answer later). */
  let latestText = $derived(running && !workOpen ? turn.msgs.findLast((m) => m.kind === 'text') : undefined);

  let time = $derived(turn.prompt?.sentAt !== undefined ? formatSentTime(turn.prompt.sentAt) : '');
  let took = $derived(turn.result?.durationMs !== undefined ? formatTurnTime(turn.result.durationMs) : '');
  let cost = $derived(showCost && turn.result?.totalCostUsd !== undefined ? formatUsd(turn.result.totalCostUsd) : '');
  let cutOff = $derived(turn.msgs.some((m) => m.kind === 'cut_off'));

  // ─── While it runs: a timer from the prompt, and what it waits on ───
  let now = $state(Date.now());
  $effect(() => {
    // A hidden thread's timer waits: it catches up when shown.
    if (!running || !visible) return;
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
  /** The folded turn's time and cost, after its files changed. */
  let foldedMeta = $derived([took, cost].filter(Boolean).join(' · '));
  let filesChanged = $derived(`${plural(edited.length, 'file', 'files')} changed`);
  /** What the commands came to, in words, for the tooltip and screen readers. */
  let commandsText = $derived.by(() => {
    let text = plural(tally.commands, 'command', 'commands');
    if (tally.failed) text += `, ${tally.failed} failed`;
    if (tally.failed && tally.passedOnRetry === tally.failed) text += ', passed on retry';
    else if (tally.passedOnRetry) text += `, ${tally.passedOnRetry} passed on retry`;
    return text;
  });

  /** The step a retry link just scrolled to, marked for a moment (TurnStep). */
  let flashId = $state<string | null>(null);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(flashTimer));

  /** Scroll to the other run of a command, and mark it for a moment. */
  function showRun(id: string) {
    section?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flashId = id;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashId = null; }, 1500);
  }

  /** A folded step's images: those its tool returned, and an image file it
   *  wrote (writtenImageOf). */
  function writtenImage(msg: ChatMessage) {
    return msg.kind === 'tool_call' ? writtenImageOf(toolViewOf(msg), msg.pending, msg.isError) : null;
  }

  /** The summary line's layout, as a button or, with no steps, as text. */
  const SUMMARY = 'flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-xs text-muted-foreground';
  /** A dot before each part of the summary line after the first. */
  const DOT = "before:content-['·'] before:mr-1 before:text-muted-foreground";
  /** A count on the summary line: its icon and number together. */
  const COUNT = 'inline-flex items-center gap-1';
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
      {#if edited.length}
        <span class="shrink-0 inline-flex items-center gap-1 text-caption text-muted-foreground" title={filesChanged}>
          <span class="sr-only">{filesChanged}</span><StepIcon kind="edit" class="text-primary" /><span aria-hidden="true">{edited.length}</span>
        </span>
      {/if}
      {#if foldedMeta}<span class="shrink-0 text-caption text-muted-foreground {edited.length ? DOT : ''}">{foldedMeta}</span>{/if}
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

    {#if hasWork || running}
      <button
        type="button"
        class="w-full {SUMMARY} text-left hover:bg-accent/50"
        aria-expanded={workOpen}
        title={workOpen ? 'Hide the steps' : 'Show the steps'}
        onclick={() => onwork(!workOpen)}
      >{@render summary(true)}</button>
    {:else if took || cost}
      <!-- Nothing to open: the line only says how the turn went. -->
      <div class={SUMMARY}>{@render summary(false)}</div>
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
              <TurnStep {sessionId} {msg} link={links.get(msg.id)} onlink={showRun} flash={flashId === msg.id} />
            {/snippet}
            {@render row(msg, 'summary', step)}
          {/each}
        </div>
      {:else}
        <div class="px-3 py-1">
          {#each seg.msgs as msg (msg.id)}
            {#if isStep(msg)}
              <!-- A folded step with images: just them, as Focus shows a tool's. -->
              {#snippet images()}
                {@const written = writtenImage(msg)}
                {#if msg.kind === 'tool_call' && msg.images?.length}<ImageAttachments {sessionId} images={msg.images} class="mb-1" />{/if}
                {#if written}<ImageAttachments {sessionId} images={[written]} hideUnavailable class="mb-1" />{/if}
              {/snippet}
              {@render row(msg, 'focus', images)}
            {:else}
              {@render row(msg, 'detailed', undefined)}
            {/if}
          {/each}
        </div>
      {/if}
    {/each}

    {#if running && workOpen}{@render nowLine()}{/if}

    {#if running && !workOpen}
      <!-- The newest text, in one place: the reply being written, else the
           last thing written, replaced as the next comes. -->
      {#if streaming && live}
        <div class="px-3">{@render live()}</div>
      {:else if latestText}
        <div class="px-3 py-1">{@render row(latestText, 'detailed', undefined)}</div>
      {/if}
    {:else if live}
      <div class="px-3">{@render live()}</div>
    {/if}
  {/if}
</section>

<!-- The summary line's contents. `open`: it opens the steps, so it has the
     arrow; without, a gap keeps it in line with the others. -->
{#snippet summary(open: boolean)}
        {#if open}
          <ChevronRightIcon class="size-3 shrink-0 transition-transform {workOpen ? 'rotate-90' : ''}" aria-hidden="true" />
        {:else}
          <span class="size-3 shrink-0" aria-hidden="true"></span>
        {/if}
        <span class="flex items-center gap-1.5 {LABEL_TONE[status]}">{@render statusMark()}{label}{#if elapsed}<span class="tabular-nums">· {elapsed}</span>{/if}</span>
        <!-- Each count is an icon and a number; the words are in its tooltip
             and for screen readers. -->
        {#if tally.filesRead}
          {@const text = `${plural(tally.filesRead, 'file', 'files')} read`}
          <span class="{DOT} {COUNT}" title={text}><span class="sr-only">{text}</span><StepIcon kind="read" /><span aria-hidden="true">{tally.filesRead}</span></span>
        {/if}
        {#if tally.searches}
          {@const text = plural(tally.searches, 'search', 'searches')}
          <span class="{DOT} {COUNT}" title={text}><span class="sr-only">{text}</span><StepIcon kind="search" /><span aria-hidden="true">{tally.searches}</span></span>
        {/if}
        {#if edited.length}
          <span class="{DOT} {COUNT}" title={`${filesChanged}:\n${editedList}`}>
            <span class="sr-only">{filesChanged}</span><StepIcon kind="edit" class="text-primary" /><span aria-hidden="true">{edited.length}</span>
            {#if tally.add || tally.del}<span class="text-green-400">+{tally.add}</span><span class="text-red-400">−{tally.del}</span>{/if}
          </span>
        {/if}
        {#if tally.commands}
          <span class="{DOT} {COUNT}" title={commandsText}>
            <span class="sr-only">{commandsText}</span><StepIcon kind="run" class="text-cyan-400" /><span aria-hidden="true">{tally.commands}</span>
            {#if tally.failed}
              <span aria-hidden="true">(<span class="text-destructive">{tally.failed} failed</span>{#if tally.passedOnRetry}{' '}<span class="text-green-400">→ {tally.passedOnRetry === tally.failed ? '' : `${tally.passedOnRetry} `}passed</span>{/if})</span>
            {/if}
          </span>
        {/if}
        {#if tally.other}
          {@const text = plural(tally.other, 'other tool', 'other tools')}
          <span class="{DOT} {COUNT}" title={text}><span class="sr-only">{text}</span><StepIcon kind="tool" class="text-yellow-400" /><span aria-hidden="true">{tally.other}</span></span>
        {/if}
        {#if cost && !running}<span class={DOT}>{cost}</span>{/if}
{/snippet}

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
