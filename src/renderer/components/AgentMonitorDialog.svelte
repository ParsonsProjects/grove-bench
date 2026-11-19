<script lang="ts">
  /**
   * The agent monitor: every open thread in every project, what its agent
   * and subagents are doing, and the shells and monitors it left running,
   * with a way to stop each and to jump to it. Opened from the title bar
   * (AgentMonitorTrigger) or Ctrl+Shift+A; loads on first use (App.svelte).
   *
   * Its rows are agentMonitorStore's snapshot, read again every second while
   * it is open. Processes and memory aren't here yet: they need sampling in
   * main (docs/agent-monitor-plan.md).
   */
  import { untrack } from 'svelte';
  import { agentMonitorStore as monitor, MONITOR_REFRESH_MS, type MonitorSelection } from '../stores/agentMonitor.svelte.js';
  import { isActive, searchText, type MonitorThread } from '../lib/agent-monitor.js';
  import { AGENT_SPRITES } from '../lib/agent-sprite.js';
  import { triageForSprite } from '../lib/session-triage.js';
  import AgentMonitorDoing from './AgentMonitorDoing.svelte';
  import AgentMonitorDetail from './AgentMonitorDetail.svelte';
  import StatusDot from './StatusDot.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import ActivityIcon from '@lucide/svelte/icons/activity';
  import BotIcon from '@lucide/svelte/icons/bot';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import SearchIcon from '@lucide/svelte/icons/search';
  import TerminalIcon from '@lucide/svelte/icons/terminal';
  import XIcon from '@lucide/svelte/icons/x';

  // Read the threads now and every second while open. untrack: refresh reads
  // every thread's state, which this effect mustn't rerun on.
  $effect(() => {
    if (!monitor.open) return;
    untrack(() => monitor.refresh());
    const timer = setInterval(() => monitor.refresh(), MONITOR_REFRESH_MS);
    return () => clearInterval(timer);
  });

  /** Name | Doing now | Stop */
  const COLS = 'grid grid-cols-[minmax(14rem,1fr)_minmax(0,1.6fr)_1.25rem] items-center gap-x-3';

  let q = $derived(monitor.query.trim().toLowerCase());
  let shown = $derived(monitor.threads.filter((t) => (monitor.show === 'all' || isActive(t)) && (!q || searchText(t).includes(q))));
  /** Grouped by project, in the order the threads come. */
  let projects = $derived.by(() => {
    const byRepo = new Map<string, MonitorThread[]>();
    for (const t of shown) byRepo.set(t.repoPath, [...(byRepo.get(t.repoPath) ?? []), t]);
    return [...byRepo.values()];
  });

  // Counted as the title bar and the sidebar's chips count them (starting up
  // and installing are working too), so the three agree.
  let working = $derived(monitor.threads.filter((t) => triageForSprite(t.state) === 'working').length);
  let waiting = $derived(monitor.threads.filter((t) => triageForSprite(t.state) === 'needs-you').length);
  let subagents = $derived(monitor.threads.reduce((n, t) => n + t.subagents.length, 0));
  let shells = $derived(monitor.threads.reduce((n, t) => n + t.shells.length, 0));

  /** What the side pane shows: the selection, else the first row. */
  let selection = $derived.by((): MonitorSelection | null => {
    const sel = monitor.selection;
    if (sel && monitor.threads.some((t) => t.id === sel.threadId)) return sel;
    return shown[0] ? { kind: 'thread', threadId: shown[0].id } : null;
  });

  function isSelected(s: MonitorSelection): boolean {
    const cur = selection;
    if (!cur || cur.kind !== s.kind || cur.threadId !== s.threadId) return false;
    if (cur.kind === 'subagent' && s.kind === 'subagent') return cur.toolUseId === s.toolUseId;
    if (cur.kind === 'shell' && s.kind === 'shell') return cur.taskId === s.taskId;
    return true;
  }

  const rowClass = (sel: MonitorSelection) => `relative h-7 px-3 ${isSelected(sel) ? 'bg-accent' : 'hover:bg-accent/50'}`;

  /** Opens with the cursor in the filter box, so typing narrows the list. */
  let filterInput = $state<HTMLInputElement | null>(null);
  function focusFilter(e: Event) {
    e.preventDefault();
    filterInput?.focus();
  }
</script>

{#snippet stopIcon()}
  <svg class="size-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="8" height="8" /></svg>
{/snippet}

<!-- A row is one button to select it, under the cells; its Stop sits above. -->
{#snippet selectButton(sel: MonitorSelection, label: string)}
  <button class="absolute inset-0 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring" aria-label="Show {label}" onclick={() => monitor.select(sel)}></button>
{/snippet}

<Dialog.Root bind:open={monitor.open}>
  <Dialog.Content
    class="flex h-[85vh] max-h-[90vh] w-[95vw] flex-col gap-0 overflow-hidden p-0 text-xs sm:max-w-6xl"
    showCloseButton={false}
    onOpenAutoFocus={focusFilter}
  >
    <header class="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-card/50 px-3">
      <ActivityIcon class="size-4 text-muted-foreground" aria-hidden="true" />
      <Dialog.Title class="text-sm font-medium">Agent monitor</Dialog.Title>
      <Dialog.Description class="sr-only">What every thread's agent and subagents are running, in every project.</Dialog.Description>
      <Segmented.Root bind:value={monitor.show} aria-label="Threads">
        <Segmented.Item value="running">Running</Segmented.Item>
        <Segmented.Item value="all">All threads</Segmented.Item>
      </Segmented.Root>
      <div class="flex-1"></div>
      <div class="relative w-72">
        <SearchIcon class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input bind:ref={filterInput} bind:value={monitor.query} placeholder="Filter threads, tools, files" class="h-7 pl-7 text-xs md:text-xs" aria-label="Filter" />
      </div>
      <Button variant="quiet" size="icon-xs" title="Close (Esc)" aria-label="Close" onclick={() => (monitor.open = false)}><XIcon /></Button>
    </header>

    <!-- Totals across every project, whatever the filter -->
    <div class="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-3 py-1.5 text-caption text-muted-foreground" data-testid="monitor-totals">
      <span class="flex items-center gap-1.5"><Pulse size="xs" tone={working ? 'working' : 'muted'} motion={working ? 'pulse' : 'none'} /><span class="tabular-nums text-foreground">{working}</span> working</span>
      <span class="flex items-center gap-1.5"><Pulse size="xs" tone={waiting ? 'attention' : 'muted'} motion={waiting ? 'pulse' : 'none'} /><span class="tabular-nums text-foreground">{waiting}</span> waiting on you</span>
      <span class="flex items-center gap-1.5"><BotIcon class="size-3" aria-hidden="true" /><span class="tabular-nums text-foreground">{subagents}</span> subagent{subagents === 1 ? '' : 's'}</span>
      <span class="flex items-center gap-1.5"><TerminalIcon class="size-3" aria-hidden="true" /><span class="tabular-nums text-foreground">{shells}</span> in the background</span>
    </div>

    <div class="flex min-h-0 flex-1">
      <div class="min-w-0 flex-1 overflow-y-auto">
        <div class="{COLS} sticky top-0 z-20 h-6 border-b border-border bg-background px-3 text-micro tracking-wide text-muted-foreground uppercase" aria-hidden="true">
          <span>Thread</span><span>Doing now</span><span></span>
        </div>

        {#if projects.length === 0}
          <div class="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <p class="font-pixel text-base text-foreground">{q ? 'Nothing matches' : 'Nothing running'}</p>
            <p class="text-muted-foreground">{q ? `No thread, tool or subagent matches “${monitor.query.trim()}”.` : 'No agent is working, waiting on you or running anything in the background.'}</p>
            {#if !q && monitor.show === 'running'}<Button variant="link" size="inline" onclick={() => (monitor.show = 'all')}>Show all threads</Button>{/if}
          </div>
        {/if}

        {#each projects as threads (threads[0].repoPath)}
          <section aria-label={threads[0].project}>
            <SectionLabel as="h2" class="border-b border-border/50 px-3 pt-2.5 pb-1">{threads[0].project}</SectionLabel>
            <ul>
              {#each threads as t (t.id)}
                {@const sel: MonitorSelection = { kind: 'thread', threadId: t.id }}
                <li class="{COLS} {rowClass(sel)}" data-testid="monitor-thread">
                  {@render selectButton(sel, t.title)}
                  <span class="pointer-events-none flex min-w-0 items-center gap-2">
                    <StatusDot state={t.state} />
                    <span class="truncate font-medium">{t.title}</span>
                    {#if t.agent}<span class="shrink-0 text-caption text-muted-foreground">{t.agent}</span>{/if}
                  </span>
                  <span class="pointer-events-none min-w-0"><AgentMonitorDoing doing={t.doing} idle={AGENT_SPRITES[t.state].label} /></span>
                  <span class="relative z-10 flex justify-end">
                    {#if t.turnRunning}
                      <Button variant="quiet-destructive" size="icon-2xs" title="Interrupt the turn" aria-label="Interrupt the turn in {t.title}" onclick={() => monitor.interrupt(t.id)}>{@render stopIcon()}</Button>
                    {/if}
                  </span>
                </li>

                {#each t.subagents as a (a.toolUseId)}
                  {@const subSel: MonitorSelection = { kind: 'subagent', threadId: t.id, toolUseId: a.toolUseId }}
                  <li class="{COLS} {rowClass(subSel)}" data-testid="monitor-subagent">
                    {@render selectButton(subSel, a.description)}
                    <span class="pointer-events-none flex min-w-0 items-center gap-2 pl-4">
                      <Pulse size="xs" />
                      <BotIcon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span class="shrink-0 text-purple-400">{a.type}</span>
                      <span class="truncate text-muted-foreground">{a.description}</span>
                    </span>
                    <span class="pointer-events-none min-w-0"><AgentMonitorDoing doing={a.doing} /></span>
                    <span class="relative z-10 flex justify-end">
                      {#if a.taskId}
                        {@const taskId = a.taskId}
                        <Button variant="quiet-destructive" size="icon-2xs" disabled={a.stopping} class="disabled:cursor-wait" title={a.stopping ? 'Stopping…' : 'Stop this subagent'} aria-label="Stop {a.description}" onclick={() => monitor.stopTask(t.id, taskId)}>{@render stopIcon()}</Button>
                      {:else}
                        <Button variant="quiet-destructive" size="icon-2xs" disabled class="disabled:cursor-not-allowed" title="Runs inside the turn: interrupt the turn to stop it" aria-label="Can't stop {a.description} on its own">{@render stopIcon()}</Button>
                      {/if}
                    </span>
                  </li>
                {/each}

                {#each t.shells as sh (sh.taskId)}
                  {@const shellSel: MonitorSelection = { kind: 'shell', threadId: t.id, taskId: sh.taskId }}
                  <li class="{COLS} {rowClass(shellSel)}" data-testid="monitor-shell">
                    {@render selectButton(shellSel, sh.description)}
                    <span class="pointer-events-none flex min-w-0 items-center gap-2 pl-4">
                      <Pulse size="xs" />
                      {#if sh.kind === 'monitor'}
                        <EyeIcon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span class="shrink-0 text-status-working">Monitor</span>
                      {:else}
                        <TerminalIcon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span class="shrink-0 text-status-working">Shell</span>
                      {/if}
                      <span class="truncate text-muted-foreground">{sh.description}</span>
                    </span>
                    <span class="pointer-events-none truncate text-muted-foreground">{sh.stopping ? 'Stopping…' : 'In the background'}</span>
                    <span class="relative z-10 flex justify-end">
                      <Button variant="quiet-destructive" size="icon-2xs" disabled={sh.stopping} class="disabled:cursor-wait" title={sh.stopping ? 'Stopping…' : `Stop this ${sh.kind}`} aria-label="Stop {sh.description}" onclick={() => monitor.stopTask(t.id, sh.taskId)}>{@render stopIcon()}</Button>
                    </span>
                  </li>
                {/each}
              {/each}
            </ul>
          </section>
        {/each}
      </div>

      <aside class="flex w-[22rem] shrink-0 flex-col border-l border-border bg-card/30" aria-label="Details">
        <AgentMonitorDetail {selection} />
      </aside>
    </div>
  </Dialog.Content>
</Dialog.Root>
