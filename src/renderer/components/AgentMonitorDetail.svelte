<script lang="ts">
  /**
   * The agent monitor's side pane: the selected thread, subagent or
   * background shell, what it is doing, and what you can do about it.
   */
  import { agentMonitorStore as monitor, type MonitorSelection } from '../stores/agentMonitor.svelte.js';
  import type { MonitorCall, MonitorShell, MonitorSubagent, MonitorThread } from '../lib/agent-monitor.js';
  import { AGENT_SPRITES } from '../lib/agent-sprite.js';
  import { formatTokens } from '../lib/context-usage.js';
  import { formatAgentTime } from '../lib/usage-report.js';
  import AgentMonitorDoing from './AgentMonitorDoing.svelte';
  import StatusDot from './StatusDot.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import AppWindowIcon from '@lucide/svelte/icons/app-window';
  import BotIcon from '@lucide/svelte/icons/bot';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import GitBranchIcon from '@lucide/svelte/icons/git-branch';
  import TerminalIcon from '@lucide/svelte/icons/terminal';

  let { selection }: { selection: MonitorSelection | null } = $props();

  type Shown =
    | { kind: 'thread'; t: MonitorThread }
    | { kind: 'subagent'; t: MonitorThread; a: MonitorSubagent }
    | { kind: 'shell'; t: MonitorThread; sh: MonitorShell }
    | { kind: 'none' };

  /** The selection in the latest snapshot; its thread when the subagent or
   *  shell has finished since. */
  let shown = $derived.by((): Shown => {
    const sel = selection;
    const t = sel && monitor.threads.find((x) => x.id === sel.threadId);
    if (!sel || !t) return { kind: 'none' };
    if (sel.kind === 'subagent') {
      const a = t.subagents.find((x) => x.toolUseId === sel.toolUseId);
      return a ? { kind: 'subagent', t, a } : { kind: 'thread', t };
    }
    if (sel.kind === 'shell') {
      const sh = t.shells.find((x) => x.taskId === sel.taskId);
      return sh ? { kind: 'shell', t, sh } : { kind: 'thread', t };
    }
    return { kind: 'thread', t };
  });

  const HEADINGS: Record<Shown['kind'], string> = { thread: 'Thread', subagent: 'Subagent', shell: 'Background', none: 'Details' };
</script>

{#snippet stopIcon()}
  <svg class="size-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="8" height="8" /></svg>
{/snippet}

{#snippet stat(label: string, value: string)}
  <div class="min-w-0">
    <div class="text-micro tracking-wide text-muted-foreground uppercase">{label}</div>
    <div class="truncate tabular-nums text-foreground">{value}</div>
  </div>
{/snippet}

{#snippet recentCalls(calls: MonitorCall[])}
  {#if calls.length > 0}
    <div>
      <SectionLabel as="h3" class="mb-1">Recent tool calls</SectionLabel>
      <ul class="space-y-1">
        <!-- By place: a list redrawn each second, where an id seen twice
             mustn't break it. -->
        {#each calls as c, i (i)}
          <li class="flex min-w-0 items-center gap-1.5">
            <span class="shrink-0 font-medium {c.isError ? 'text-red-400' : 'text-yellow-400'}">{c.name}</span>
            <span class="truncate text-muted-foreground" title={c.summary}>{c.summary}</span>
            {#if c.isError}<span class="ml-auto shrink-0 text-muted-foreground">failed</span>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/snippet}

{#snippet inThread(t: MonitorThread)}
  <p class="text-caption text-muted-foreground">
    In <Button variant="link" size="inline" onclick={() => monitor.select({ kind: 'thread', threadId: t.id })}>{t.title}</Button>, {t.project}
  </p>
{/snippet}

{#snippet now(doing: MonitorThread['doing'], idle: string)}
  <div>
    <SectionLabel as="h3" class="mb-1">Now</SectionLabel>
    <div class="border border-border bg-background px-2 py-1.5"><AgentMonitorDoing {doing} {idle} /></div>
  </div>
{/snippet}

{#snippet errorNotice()}
  {#if monitor.error}<Notice tone="danger" class="break-words">{monitor.error}</Notice>{/if}
{/snippet}

<PanelHeader title={HEADINGS[shown.kind]} />

<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
  {#if shown.kind === 'none'}
    <p class="text-muted-foreground">Pick a row to see what it's doing.</p>

  {:else if shown.kind === 'thread'}
    {@const t = shown.t}
    <div class="space-y-1">
      <div class="flex min-w-0 items-center gap-2">
        <StatusDot state={t.state} />
        <h2 class="truncate text-sm font-medium">{t.title}</h2>
        {#if t.agent}<Badge tone="muted" class="ml-auto">{t.agent}</Badge>{/if}
      </div>
      <p class="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
        <FolderIcon class="size-3 shrink-0" aria-hidden="true" />{t.project}
        {#if t.branch}<GitBranchIcon class="ml-1 size-3 shrink-0" aria-hidden="true" /><span class="truncate">{t.branch}</span>{/if}
      </p>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button variant="subtle" size="xs" onclick={() => monitor.openThread(t.id)}><AppWindowIcon />Open thread</Button>
      {#if t.turnRunning}
        <Button variant="outline-destructive" size="xs" onclick={() => monitor.interrupt(t.id)}>{@render stopIcon()}Interrupt turn</Button>
      {/if}
    </div>
    {@render errorNotice()}

    {#if t.doing.kind === 'waiting'}
      <Notice tone="warning" title="Waiting for you" layout="stacked">
        {#snippet actions()}<Button variant="link" size="2xs" onclick={() => monitor.openThread(t.id)}>Answer in the thread</Button>{/snippet}
        <p>{t.doing.text}</p>
      </Notice>
    {:else}
      {@render now(t.doing, AGENT_SPRITES[t.state].label)}
    {/if}

    {#if t.subagents.length > 0}
      <div>
        <SectionLabel as="h3" class="mb-1">Subagents</SectionLabel>
        <ul class="-mx-1.5">
          {#each t.subagents as a (a.toolUseId)}
            <li>
              <button class="flex w-full min-w-0 items-center gap-2 px-1.5 py-1 text-left hover:bg-accent" onclick={() => monitor.select({ kind: 'subagent', threadId: t.id, toolUseId: a.toolUseId })}>
                <Pulse size="xs" />
                <span class="shrink-0 text-purple-400">{a.type}</span>
                <span class="truncate text-muted-foreground">{a.description}</span>
                <span class="ml-auto shrink-0 text-muted-foreground">&rsaquo;</span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if t.shells.length > 0}
      <div>
        <SectionLabel as="h3" class="mb-1">Background</SectionLabel>
        <ul class="-mx-1.5">
          {#each t.shells as sh (sh.taskId)}
            <li>
              <button class="flex w-full min-w-0 items-center gap-2 px-1.5 py-1 text-left hover:bg-accent" onclick={() => monitor.select({ kind: 'shell', threadId: t.id, taskId: sh.taskId })}>
                <Pulse size="xs" />
                <span class="shrink-0 text-status-working">{sh.kind === 'monitor' ? 'Monitor' : 'Shell'}</span>
                <span class="truncate text-muted-foreground">{sh.description}</span>
                <span class="ml-auto shrink-0 text-muted-foreground">&rsaquo;</span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {@render recentCalls(t.recent)}

  {:else if shown.kind === 'subagent'}
    {@const t = shown.t}
    {@const a = shown.a}
    <div class="space-y-1">
      <div class="flex min-w-0 items-center gap-2">
        <BotIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 class="truncate text-sm font-medium" title={a.description}>{a.description}</h2>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <Badge tone="accent">{a.type}</Badge>
        {#if a.background}<Badge tone="working">background</Badge>{:else}<Badge tone="muted">in the turn</Badge>{/if}
      </div>
      {@render inThread(t)}
    </div>

    <div class="flex flex-wrap gap-2">
      {#if a.hasCall}
        <Button variant="subtle" size="xs" onclick={() => monitor.openSubagent(t.id, a.toolUseId)}><AppWindowIcon />Open its thread</Button>
      {:else}
        <!-- Its Agent call isn't loaded (a workflow, or older than the history
             shown), so it has no thread of its own to open. -->
        <Button variant="subtle" size="xs" onclick={() => monitor.openThread(t.id)}><AppWindowIcon />Open thread</Button>
      {/if}
      {#if a.taskId}
        {@const taskId = a.taskId}
        <Button variant="outline-destructive" size="xs" disabled={a.stopping} class="disabled:cursor-wait" onclick={() => monitor.stopTask(t.id, taskId)}>{@render stopIcon()}{a.stopping ? 'Stopping…' : 'Stop subagent'}</Button>
      {:else if t.turnRunning}
        <Button variant="outline-destructive" size="xs" onclick={() => monitor.interrupt(t.id)}>{@render stopIcon()}Interrupt turn</Button>
      {/if}
    </div>
    {#if !a.background}
      <p class="text-caption text-muted-foreground">The turn waits on this subagent, so it stops only with the turn. Interrupting ends the turn and any other subagent it waits on; background ones keep going.</p>
    {/if}
    {@render errorNotice()}

    {@render now(a.doing, 'Working')}

    <div class="grid grid-cols-3 gap-2">
      {@render stat('Tool calls', String(a.toolUses))}
      {#if a.tokens}{@render stat('Tokens', formatTokens(a.tokens))}{/if}
      {#if a.durationMs}{@render stat('Running for', formatAgentTime(a.durationMs))}{/if}
    </div>

    {#if a.prompt}
      <div>
        <SectionLabel as="h3" class="mb-1">Asked</SectionLabel>
        <p class="max-h-40 overflow-y-auto bg-muted px-2 py-1.5 text-caption whitespace-pre-wrap text-foreground">{a.prompt}</p>
      </div>
    {/if}

    {@render recentCalls(a.recent)}

  {:else if shown.kind === 'shell'}
    {@const t = shown.t}
    {@const sh = shown.sh}
    <div class="space-y-1">
      <div class="flex min-w-0 items-center gap-2">
        <TerminalIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 class="truncate text-sm font-medium" title={sh.description}>{sh.description}</h2>
      </div>
      <Badge tone="working">{sh.kind === 'monitor' ? 'monitor' : 'background shell'}</Badge>
      {@render inThread(t)}
    </div>

    <div class="flex gap-2">
      <Button variant="outline-destructive" size="xs" disabled={sh.stopping} class="disabled:cursor-wait" onclick={() => monitor.stopTask(t.id, sh.taskId)}>{@render stopIcon()}{sh.stopping ? 'Stopping…' : `Stop ${sh.kind}`}</Button>
    </div>
    {@render errorNotice()}

    <p class="text-caption text-muted-foreground">
      The agent left this {sh.kind === 'monitor' ? 'watch' : 'command'} running in the background. It keeps going after the turn ends, until it finishes, you stop it, or the thread's agent stops.
    </p>
  {/if}
</div>
