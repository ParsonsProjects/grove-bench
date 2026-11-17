<script lang="ts">
  /**
   * The agent monitor mockup (docs/agent-monitor-plan.md): every thread in
   * every project, its subagents and background shells, what each is running
   * now, and the processes under each agent. Made-up data that moves on every
   * second (monitor.svelte.ts). Shown as its own window
   * (/agent-monitor.html) or as a dialog over the demo app
   * (/agent-monitor-dialog.html, MonitorDialog.svelte). Dev server only.
   */
  import { onMount, type Snippet } from 'svelte';
  import { monitor, isActive, flattenProcesses, treeBytes, type Selection } from './monitor.svelte.js';
  import { AGENT_HOST_PID, type MockThread, type TaskStatus } from './mock-data.js';
  import { bytes, duration } from './format.js';
  import { formatTokens } from '../lib/context-usage.js';
  import type { AgentSpriteState } from '$lib/agent-sprite.js';
  import DoingNow from './DoingNow.svelte';
  import MonitorDetail from './MonitorDetail.svelte';
  import StatusDot from '../components/StatusDot.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import ActivityIcon from '@lucide/svelte/icons/activity';
  import BotIcon from '@lucide/svelte/icons/bot';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
  import SearchIcon from '@lucide/svelte/icons/search';
  import TerminalIcon from '@lucide/svelte/icons/terminal';
  import XIcon from '@lucide/svelte/icons/x';

  let { heading, onclose, class: className = '' }: {
    /** The title, in place of the window's own (a dialog's Dialog.Title). */
    heading?: Snippet;
    /** Shows a close button at the end of the toolbar (the dialog). */
    onclose?: () => void;
    class?: string;
  } = $props();

  let view = $state<'agents' | 'processes'>('agents');
  let show = $state<'running' | 'all'>('running');
  let query = $state('');

  onMount(() => {
    const timer = setInterval(() => monitor.tick(), 1000);
    return () => clearInterval(timer);
  });

  /** Name | Doing now | Time | Tokens | Memory | Stop */
  const AGENT_COLS = 'grid grid-cols-[minmax(16rem,1fr)_minmax(0,1.5fr)_4.5rem_3.5rem_4.5rem_1.25rem] items-center gap-x-3';
  /** Process | PID | Thread | Memory | Running for | End */
  const PROCESS_COLS = 'grid grid-cols-[minmax(14rem,1.3fr)_3.5rem_minmax(0,1fr)_4.5rem_5rem_1.25rem] items-center gap-x-3';
  /** Indents by depth, on Tailwind's spacing scale. */
  const INDENT = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20'];
  const indent = (depth: number) => INDENT[Math.min(depth, INDENT.length - 1)];

  const IDLE: Partial<Record<AgentSpriteState, string>> = {
    unread: 'Finished, not seen yet',
    ready: 'Ready',
    sleeping: 'Sleeping: no agent running',
    stopped: 'Closed',
    error: 'Failed',
  };

  const TASK_IDLE: Record<TaskStatus, string> = {
    running: 'Running',
    stopping: 'Stopping…',
    completed: 'Done',
    failed: 'Failed',
    stopped: 'Stopped',
  };

  function search(t: MockThread): string {
    const doing = (d: MockThread['doing']) => (d.kind === 'tool' ? `${d.call.name} ${d.call.summary}` : d.kind === 'waiting' ? d.prompt : '');
    return [
      t.title, t.project, t.branch, t.agent, doing(t.doing),
      ...t.subagents.flatMap((a) => [a.type, a.description, doing(a.doing)]),
      ...t.shells.map((sh) => sh.description),
      ...t.processes.map((p) => `${p.name} ${p.pid}`),
    ].join('\n').toLowerCase();
  }

  let q = $derived(query.trim().toLowerCase());
  let shown = $derived(monitor.threads.filter((t) => (view === 'processes' ? t.processes.length > 0 : show === 'all' || isActive(t)) && (!q || search(t).includes(q))));
  let projects = $derived.by(() => {
    const byProject = new Map<string, MockThread[]>();
    for (const t of shown) byProject.set(t.project, [...(byProject.get(t.project) ?? []), t]);
    return [...byProject];
  });

  let working = $derived(monitor.threads.filter((t) => t.state === 'working').length);
  let waiting = $derived(monitor.threads.filter((t) => t.state === 'permission').length);
  let subagents = $derived(monitor.threads.reduce((n, t) => n + t.subagents.filter((a) => a.status === 'running').length, 0));
  let shells = $derived(monitor.threads.reduce((n, t) => n + t.shells.filter((sh) => sh.status === 'running').length, 0));
  let processCount = $derived(monitor.threads.reduce((n, t) => n + t.processes.length, 0));
  let memory = $derived(monitor.threads.reduce((n, t) => n + treeBytes(t.processes), 0));
  let sampledAgo = $derived(Math.max(0, Math.floor((monitor.now - monitor.sampledAt) / 1000)));

  const rowClass = (sel: Selection) =>
    `relative h-7 px-3 text-xs ${monitor.isSelected(sel) ? 'bg-accent' : 'hover:bg-accent/50'}`;
</script>

{#snippet stopIcon()}
  <svg class="size-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="8" height="8" /></svg>
{/snippet}

{#snippet taskDot(status: TaskStatus)}
  {#if status === 'running' || status === 'stopping'}
    <Pulse size="xs" />
  {:else if status === 'failed'}
    <Pulse size="xs" tone="error" motion="none" />
  {:else}
    <Pulse size="xs" tone="muted" motion="none" />
  {/if}
{/snippet}

<!-- A row is one button to select it, under the cells; its Stop sits above. -->
{#snippet selectButton(sel: Selection, label: string)}
  <button class="absolute inset-0 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring" aria-label="Show {label}" onclick={() => monitor.select(sel)}></button>
{/snippet}

<div class="flex flex-col bg-background text-xs text-foreground {className}">
  <!-- The toolbar -->
  <header class="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-card/50 px-3">
    <ActivityIcon class="size-4 text-muted-foreground" aria-hidden="true" />
    {#if heading}{@render heading()}{:else}<h1 class="text-sm font-medium">Agent monitor</h1>{/if}
    <Badge tone="warning" title="Made-up data. The buttons change it, nothing else.">mockup</Badge>
    <Segmented.Root bind:value={view} aria-label="Show">
      <Segmented.Item value="agents">Agents</Segmented.Item>
      <Segmented.Item value="processes">Processes</Segmented.Item>
    </Segmented.Root>
    {#if view === 'agents'}
      <Segmented.Root bind:value={show} aria-label="Threads">
        <Segmented.Item value="running">Running</Segmented.Item>
        <Segmented.Item value="all">All threads</Segmented.Item>
      </Segmented.Root>
    {/if}
    <div class="flex-1"></div>
    <div class="relative w-72">
      <SearchIcon class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input bind:value={query} placeholder="Filter threads, tools, processes" class="h-7 pl-7 text-xs md:text-xs" aria-label="Filter" data-monitor-filter />
    </div>
    {#if onclose}
      <Button variant="quiet" size="icon-xs" title="Close (Esc)" aria-label="Close" onclick={onclose}><XIcon /></Button>
    {/if}
  </header>

  <!-- Totals across every project, whatever the filter -->
  <div class="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-3 py-1.5 text-caption text-muted-foreground" data-testid="monitor-totals">
    <span class="flex items-center gap-1.5"><Pulse size="xs" motion={working ? 'pulse' : 'none'} tone={working ? 'working' : 'muted'} /><span class="text-foreground tabular-nums">{working}</span> working</span>
    <span class="flex items-center gap-1.5"><Pulse size="xs" tone={waiting ? 'attention' : 'muted'} motion={waiting ? 'pulse' : 'none'} /><span class="text-foreground tabular-nums">{waiting}</span> waiting on you</span>
    <span class="flex items-center gap-1.5"><BotIcon class="size-3" aria-hidden="true" /><span class="text-foreground tabular-nums">{subagents}</span> subagent{subagents === 1 ? '' : 's'}</span>
    <span class="flex items-center gap-1.5"><TerminalIcon class="size-3" aria-hidden="true" /><span class="text-foreground tabular-nums">{shells}</span> background</span>
    <span class="ml-auto"><span class="text-foreground tabular-nums">{processCount}</span> processes, <span class="text-foreground tabular-nums">{bytes(memory)}</span></span>
  </div>

  <div class="flex min-h-0 flex-1">
    <main class="min-w-0 flex-1 overflow-y-auto">
      {#if view === 'agents'}
        <div class="{AGENT_COLS} sticky top-0 z-20 h-6 border-b border-border bg-background px-3 text-micro tracking-wide text-muted-foreground uppercase" aria-hidden="true">
          <span>Thread</span><span>Doing now</span><span class="text-right">Time</span><span class="text-right">Tokens</span><span class="text-right">Memory</span><span></span>
        </div>
      {:else}
        <div class="{PROCESS_COLS} sticky top-0 z-20 h-6 border-b border-border bg-background px-3 text-micro tracking-wide text-muted-foreground uppercase" aria-hidden="true">
          <span>Process</span><span class="text-right">PID</span><span>Thread</span><span class="text-right">Memory</span><span class="text-right">Running for</span><span></span>
        </div>
        <div class="flex items-center gap-2 border-b border-border px-3 py-1.5 text-caption text-muted-foreground">
          <span>Under the agent host (node.exe, PID {AGENT_HOST_PID}). Executables only: Windows' process counters don't give command lines.</span>
          <span class="ml-auto shrink-0 tabular-nums">Sampled {sampledAgo}s ago</span>
          <Button variant="quiet" size="icon-2xs" title="Sample again" aria-label="Sample again" onclick={() => monitor.sample()}><RefreshIcon /></Button>
        </div>
      {/if}

      {#if projects.length === 0}
        <div class="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <p class="font-pixel text-base text-foreground">{q ? 'Nothing matches' : 'Nothing running'}</p>
          <p class="text-muted-foreground">{q ? `No thread, tool or process matches “${query.trim()}”.` : 'No agent is working, waiting on you or running anything in the background.'}</p>
          {#if !q && view === 'agents'}<Button variant="link" size="inline" onclick={() => (show = 'all')}>Show all threads</Button>{/if}
        </div>
      {/if}

      {#each projects as [project, threads] (project)}
        <section aria-label={project}>
          <SectionLabel as="h2" class="border-b border-border/50 px-3 pt-2.5 pb-1">{project}</SectionLabel>
          <ul>
            {#each threads as t (t.id)}
              {#if view === 'agents'}
                {@const sel: Selection = { kind: 'thread', threadId: t.id }}
                <li class="{AGENT_COLS} {rowClass(sel)}" data-testid="monitor-thread">
                  {@render selectButton(sel, t.title)}
                  <span class="pointer-events-none flex min-w-0 items-center gap-2">
                    <StatusDot state={t.state} />
                    <span class="truncate font-medium">{t.title}</span>
                    <span class="shrink-0 text-caption text-muted-foreground">{t.agent}</span>
                  </span>
                  <span class="pointer-events-none min-w-0"><DoingNow doing={t.doing} now={monitor.now} idle={t.error ? `Failed: ${t.error}` : IDLE[t.state]} /></span>
                  <span class="pointer-events-none text-right tabular-nums text-muted-foreground">{t.turnStartedAt ? duration(monitor.now - t.turnStartedAt) : ''}</span>
                  <span class="pointer-events-none text-right tabular-nums text-muted-foreground">{t.turnTokens ? formatTokens(t.turnTokens) : ''}</span>
                  <span class="pointer-events-none text-right tabular-nums text-muted-foreground">{t.processes.length ? bytes(treeBytes(t.processes)) : ''}</span>
                  <span class="relative z-10 flex justify-end">
                    {#if t.state === 'working'}
                      <Button variant="quiet-destructive" size="icon-2xs" title="Interrupt the turn" aria-label="Interrupt the turn in {t.title}" onclick={() => monitor.interrupt(t.id)}>{@render stopIcon()}</Button>
                    {/if}
                  </span>
                </li>

                {#each t.subagents.filter((a) => show === 'all' || a.status === 'running' || a.status === 'stopping') as a (a.id)}
                  {@const subSel: Selection = { kind: 'subagent', threadId: t.id, id: a.id }}
                  <li class="{AGENT_COLS} {rowClass(subSel)}" data-testid="monitor-subagent">
                    {@render selectButton(subSel, a.description)}
                    <span class="pointer-events-none flex min-w-0 items-center gap-2 pl-4">
                      {@render taskDot(a.status)}
                      <BotIcon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span class="shrink-0 text-purple-400">{a.type}</span>
                      <span class="truncate text-muted-foreground">{a.description}</span>
                    </span>
                    <span class="pointer-events-none min-w-0"><DoingNow doing={a.doing} now={monitor.now} idle={TASK_IDLE[a.status]} /></span>
                    <span class="pointer-events-none text-right tabular-nums text-muted-foreground">{a.status === 'running' ? duration(monitor.now - a.startedAt) : ''}</span>
                    <span class="pointer-events-none text-right tabular-nums text-muted-foreground">{formatTokens(a.tokens)}</span>
                    <span class="pointer-events-none text-right text-muted-foreground" title="Runs inside its thread's agent process">shared</span>
                    <span class="relative z-10 flex justify-end">
                      {#if a.status === 'running' || a.status === 'stopping'}
                        {#if a.background}
                          <Button variant="quiet-destructive" size="icon-2xs" disabled={a.status === 'stopping'} class="disabled:cursor-wait" title={a.status === 'stopping' ? 'Stopping…' : 'Stop this subagent'} aria-label="Stop {a.description}" onclick={() => monitor.stopSubagent(t.id, a.id)}>{@render stopIcon()}</Button>
                        {:else}
                          <Button variant="quiet-destructive" size="icon-2xs" disabled class="disabled:cursor-not-allowed" title="Runs inside the turn: interrupt the turn to stop it" aria-label="Can't stop {a.description} on its own">{@render stopIcon()}</Button>
                        {/if}
                      {/if}
                    </span>
                  </li>
                {/each}

                {#each t.shells.filter((sh) => show === 'all' || sh.status === 'running' || sh.status === 'stopping') as sh (sh.taskId)}
                  {@const shellSel: Selection = { kind: 'shell', threadId: t.id, taskId: sh.taskId }}
                  <li class="{AGENT_COLS} {rowClass(shellSel)}" data-testid="monitor-shell">
                    {@render selectButton(shellSel, sh.description)}
                    <span class="pointer-events-none flex min-w-0 items-center gap-2 pl-4">
                      {@render taskDot(sh.status)}
                      {#if sh.kind === 'monitor'}
                        <EyeIcon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span class="shrink-0 text-status-working">Monitor</span>
                      {:else}
                        <TerminalIcon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span class="shrink-0 text-status-working">Shell</span>
                      {/if}
                      <span class="truncate text-muted-foreground">{sh.description}</span>
                    </span>
                    <span class="pointer-events-none truncate text-muted-foreground">{sh.status === 'running' ? 'In the background' : TASK_IDLE[sh.status]}</span>
                    <span class="pointer-events-none text-right tabular-nums text-muted-foreground">{sh.status === 'running' ? duration(monitor.now - sh.startedAt) : ''}</span>
                    <span></span>
                    <span class="pointer-events-none text-right text-muted-foreground" title="The agent doesn't say which process is this shell's">?</span>
                    <span class="relative z-10 flex justify-end">
                      {#if sh.status === 'running' || sh.status === 'stopping'}
                        <Button variant="quiet-destructive" size="icon-2xs" disabled={sh.status === 'stopping'} class="disabled:cursor-wait" title={sh.status === 'stopping' ? 'Stopping…' : `Stop this ${sh.kind}`} aria-label="Stop {sh.description}" onclick={() => monitor.stopShell(t.id, sh.taskId)}>{@render stopIcon()}</Button>
                      {/if}
                    </span>
                  </li>
                {/each}
              {:else}
                {#each flattenProcesses(t) as { p, depth } (p.pid)}
                  {@const procSel: Selection = { kind: 'process', threadId: t.id, pid: p.pid }}
                  <li class="{PROCESS_COLS} {rowClass(procSel)}" data-testid="monitor-process">
                    {@render selectButton(procSel, `${p.name} ${p.pid}`)}
                    <span class="pointer-events-none flex min-w-0 items-center gap-2 {indent(depth)}">
                      {#if depth === 0}<StatusDot state={t.state} />{:else}<span class="text-muted-foreground" aria-hidden="true">└</span>{/if}
                      <span class="truncate {depth === 0 ? 'font-medium' : ''}">{p.name}</span>
                      {#if depth === 0}<span class="shrink-0 text-caption text-muted-foreground">{t.agent}</span>{/if}
                    </span>
                    <span class="pointer-events-none text-right tabular-nums text-muted-foreground">{p.pid}</span>
                    <span class="pointer-events-none truncate text-muted-foreground">{depth === 0 ? t.title : ''}</span>
                    <span class="pointer-events-none text-right tabular-nums {p.bytes > 250 * 1024 * 1024 ? 'text-foreground' : 'text-muted-foreground'}">{bytes(p.bytes)}</span>
                    <span class="pointer-events-none text-right tabular-nums text-muted-foreground">{duration(monitor.now - p.startedAt)}</span>
                    <span class="relative z-10 flex justify-end">
                      {#if depth > 0}
                        <Button variant="quiet-destructive" size="icon-2xs" title="End this process and what it started" aria-label="End {p.name} {p.pid}" onclick={() => monitor.askEnd(t.id, p.pid)}>{@render stopIcon()}</Button>
                      {/if}
                    </span>
                  </li>
                {/each}
              {/if}
            {/each}
          </ul>
        </section>
      {/each}
    </main>

    <aside class="flex w-[22rem] shrink-0 flex-col border-l border-border bg-card/30" aria-label="Details">
      <MonitorDetail onprocesses={() => (view = 'processes')} />
    </aside>
  </div>

  {#if monitor.toast}
    <div class="fixed right-4 bottom-4 z-50 max-w-sm border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl" role="status">{monitor.toast}</div>
  {/if}
</div>
