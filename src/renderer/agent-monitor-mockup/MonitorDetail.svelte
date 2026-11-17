<script lang="ts">
  /**
   * The agent monitor mockup's side pane: the selected thread, subagent,
   * background shell or process, what it is doing, and what you can do
   * about it. Each also says what the real data can't tell (the gaps in
   * docs/agent-monitor-plan.md), so the mockup doesn't promise them.
   */
  import { monitor, processTree, flattenProcesses, treeBytes } from './monitor.svelte.js';
  import type { DoneCall, MockProcess, MockShell, MockSubagent, MockThread } from './mock-data.js';
  import { bytes, duration } from './format.js';
  import { formatTokens } from '../lib/context-usage.js';
  import DoingNow from './DoingNow.svelte';
  import StatusDot from '../components/StatusDot.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Confirm } from '$lib/components/ui/confirm/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { PanelHeader } from '$lib/components/ui/panel-header/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { SectionLabel } from '$lib/components/ui/section-label/index.js';
  import AppWindowIcon from '@lucide/svelte/icons/app-window';
  import BotIcon from '@lucide/svelte/icons/bot';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import GitBranchIcon from '@lucide/svelte/icons/git-branch';
  import TerminalIcon from '@lucide/svelte/icons/terminal';

  let { onprocesses }: { onprocesses: () => void } = $props();

  type Shown =
    | { kind: 'thread'; t: MockThread }
    | { kind: 'subagent'; t: MockThread; a: MockSubagent }
    | { kind: 'shell'; t: MockThread; sh: MockShell }
    | { kind: 'process'; t: MockThread; p: MockProcess }
    | { kind: 'none' };

  let shown = $derived.by((): Shown => {
    const sel = monitor.selection;
    const t = monitor.thread(sel.threadId);
    if (!t) return { kind: 'none' };
    if (sel.kind === 'subagent') {
      const a = t.subagents.find((x) => x.id === sel.id);
      return a ? { kind: 'subagent', t, a } : { kind: 'thread', t };
    }
    if (sel.kind === 'shell') {
      const sh = t.shells.find((x) => x.taskId === sel.taskId);
      return sh ? { kind: 'shell', t, sh } : { kind: 'thread', t };
    }
    if (sel.kind === 'process') {
      const p = t.processes.find((x) => x.pid === sel.pid);
      return p ? { kind: 'process', t, p } : { kind: 'thread', t };
    }
    return { kind: 'thread', t };
  });

  /** Indents by depth in the process list. */
  const INDENT = ['pl-0', 'pl-3', 'pl-6', 'pl-9', 'pl-12'];

  const HEADINGS: Record<Shown['kind'], string> = {
    thread: 'Thread',
    subagent: 'Subagent',
    shell: 'Background',
    process: 'Process',
    none: 'Details',
  };

  /** The executables from the agent down to `p`. */
  function chain(t: MockThread, p: MockProcess): string[] {
    const names: string[] = [];
    let cur: MockProcess | undefined = p;
    while (cur) {
      names.unshift(cur.name);
      const parent: number = cur.ppid;
      cur = t.processes.find((x) => x.pid === parent);
    }
    return names;
  }
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

{#snippet recentCalls(calls: DoneCall[])}
  {#if calls.length > 0}
    <div>
      <SectionLabel as="h3" class="mb-1">Recent tool calls</SectionLabel>
      <ul class="space-y-1">
        {#each calls as c, i (i)}
          <li class="flex min-w-0 items-center gap-1.5">
            <span class="shrink-0 font-medium {c.isError ? 'text-red-400' : 'text-yellow-400'}">{c.name}</span>
            <span class="truncate text-muted-foreground" title={c.summary}>{c.summary}</span>
            <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">{c.isError ? 'failed' : `${c.seconds}s`}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/snippet}

{#snippet inThread(t: MockThread)}
  <p class="text-caption text-muted-foreground">
    In <Button variant="link" size="inline" onclick={() => monitor.select({ kind: 'thread', threadId: t.id })}>{t.title}</Button>, {t.project}
  </p>
{/snippet}

{#snippet now(doing: MockThread['doing'], idle: string)}
  <div>
    <SectionLabel as="h3" class="mb-1">Now</SectionLabel>
    <div class="border border-border bg-background px-2 py-1.5"><DoingNow {doing} now={monitor.now} {idle} /></div>
  </div>
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
        <Badge tone="muted" class="ml-auto">{t.agent}</Badge>
      </div>
      <p class="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
        <FolderIcon class="size-3 shrink-0" aria-hidden="true" />{t.project}
        <GitBranchIcon class="ml-1 size-3 shrink-0" aria-hidden="true" /><span class="truncate">{t.branch}</span>
      </p>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button variant="subtle" size="xs" onclick={() => monitor.openInMain(`“${t.title}”`)}><AppWindowIcon />Open thread</Button>
      {#if t.state === 'working'}
        <Button variant="outline-destructive" size="xs" onclick={() => monitor.interrupt(t.id)}>{@render stopIcon()}Interrupt turn</Button>
      {/if}
    </div>

    {#if t.doing.kind === 'waiting'}
      <Notice tone="warning" title="Waiting for you" layout="stacked">
        {#snippet actions()}<Button variant="link" size="2xs" onclick={() => monitor.openInMain('the prompt')}>Answer in the thread</Button>{/snippet}
        <p>{t.doing.prompt}</p>
      </Notice>
    {:else if t.error}
      <Notice tone="danger" title="Failed">
        <p>{t.error}</p>
      </Notice>
    {:else}
      {@render now(t.doing, t.state === 'unread' ? 'Finished, not seen yet' : t.state === 'sleeping' ? 'Sleeping: no agent running' : 'Ready')}
    {/if}

    <div class="grid grid-cols-4 gap-2">
      {@render stat('Turn', t.turnStartedAt ? duration(monitor.now - t.turnStartedAt) : 'idle')}
      {@render stat('Tokens', t.turnTokens ? formatTokens(t.turnTokens) : '0')}
      {@render stat('Processes', String(t.processes.length))}
      {@render stat('Memory', t.processes.length ? bytes(treeBytes(t.processes)) : 'none')}
    </div>

    <div>
      <SectionLabel as="h3" class="mb-1">Subagents</SectionLabel>
      {#if !t.reportsSubagents}
        <p class="text-caption text-muted-foreground">{t.agent} runs over ACP, which doesn't tell Grove about subagents yet. Any it starts show up as its own tool calls.</p>
      {:else if t.subagents.length === 0}
        <p class="text-caption text-muted-foreground">None this turn.</p>
      {:else}
        <ul class="-mx-1.5">
          {#each t.subagents as a (a.id)}
            <li>
              <button class="flex w-full min-w-0 items-center gap-2 px-1.5 py-1 text-left hover:bg-accent" onclick={() => monitor.select({ kind: 'subagent', threadId: t.id, id: a.id })}>
                {#if a.status === 'running' || a.status === 'stopping'}<Pulse size="xs" />{:else}<Pulse size="xs" tone="muted" motion="none" />{/if}
                <span class="shrink-0 text-purple-400">{a.type}</span>
                <span class="truncate text-muted-foreground">{a.description}</span>
                <span class="ml-auto shrink-0 text-muted-foreground">&rsaquo;</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if t.shells.length > 0}
      <div>
        <SectionLabel as="h3" class="mb-1">Background</SectionLabel>
        <ul class="-mx-1.5">
          {#each t.shells as sh (sh.taskId)}
            <li>
              <button class="flex w-full min-w-0 items-center gap-2 px-1.5 py-1 text-left hover:bg-accent" onclick={() => monitor.select({ kind: 'shell', threadId: t.id, taskId: sh.taskId })}>
                {#if sh.status === 'running' || sh.status === 'stopping'}<Pulse size="xs" />{:else}<Pulse size="xs" tone="muted" motion="none" />{/if}
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

    {#if t.processes.length > 0}
      <div>
        <div class="mb-1 flex items-center">
          <SectionLabel as="h3">Processes</SectionLabel>
          <Button variant="link" size="inline" class="ml-auto text-caption" onclick={onprocesses}>Show all</Button>
        </div>
        <ul class="-mx-1.5">
          {#each flattenProcesses(t).slice(0, 6) as { p, depth } (p.pid)}
            <li>
              <button class="flex w-full min-w-0 items-center gap-1.5 px-1.5 py-0.5 text-left hover:bg-accent" onclick={() => monitor.select({ kind: 'process', threadId: t.id, pid: p.pid })}>
                <span class="truncate {INDENT[Math.min(depth, INDENT.length - 1)]} {depth === 0 ? 'font-medium' : 'text-muted-foreground'}">{depth > 0 ? '└ ' : ''}{p.name}</span>
                <span class="shrink-0 tabular-nums text-muted-foreground">{p.pid}</span>
                <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">{bytes(p.bytes)}</span>
              </button>
            </li>
          {/each}
        </ul>
        {#if t.processes.length > 6}<p class="mt-1 text-caption text-muted-foreground">and {t.processes.length - 6} more</p>{/if}
      </div>
    {/if}

  {:else if shown.kind === 'subagent'}
    {@const t = shown.t}
    {@const a = shown.a}
    {@const running = a.status === 'running' || a.status === 'stopping'}
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
      <Button variant="subtle" size="xs" onclick={() => monitor.openInMain("this subagent's thread")}><AppWindowIcon />Open its thread</Button>
      {#if running && a.background}
        <Button variant="outline-destructive" size="xs" disabled={a.status === 'stopping'} class="disabled:cursor-wait" onclick={() => monitor.stopSubagent(t.id, a.id)}>{@render stopIcon()}{a.status === 'stopping' ? 'Stopping…' : 'Stop subagent'}</Button>
      {:else if running}
        <Button variant="outline-destructive" size="xs" onclick={() => monitor.interrupt(t.id)}>{@render stopIcon()}Interrupt turn</Button>
      {/if}
    </div>
    {#if running && !a.background}
      <p class="text-caption text-muted-foreground">The turn waits on this subagent, so it can only stop with the turn. Interrupting ends the turn and any other subagent it waits on; background ones keep going.</p>
    {/if}

    {@render now(a.doing, a.status === 'completed' ? 'Done: its report is in the thread' : a.status === 'stopped' ? 'Stopped' : a.status === 'failed' ? 'Failed' : 'Running')}

    <div class="grid grid-cols-3 gap-2">
      {@render stat('Running for', running ? duration(monitor.now - a.startedAt) : 'not running')}
      {@render stat('Tokens', formatTokens(a.tokens))}
      {@render stat('Tool calls', String(a.toolUses))}
    </div>

    <div>
      <SectionLabel as="h3" class="mb-1">Asked</SectionLabel>
      <p class="bg-muted px-2 py-1.5 text-caption whitespace-pre-wrap text-foreground">{a.prompt}</p>
    </div>

    {@render recentCalls(a.recent)}

    <p class="text-caption text-muted-foreground">
      It runs inside its thread's agent ({t.processes[0] ? `${t.processes[0].name}, PID ${t.processes[0].pid}` : 'not running'}), so it has no process of its own. Commands it runs show under that process, but nothing says which are its.
    </p>

  {:else if shown.kind === 'shell'}
    {@const t = shown.t}
    {@const sh = shown.sh}
    {@const running = sh.status === 'running' || sh.status === 'stopping'}
    <div class="space-y-1">
      <div class="flex min-w-0 items-center gap-2">
        <TerminalIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 class="truncate text-sm font-medium" title={sh.description}>{sh.description}</h2>
      </div>
      <div class="flex items-center gap-1.5">
        <Badge tone={running ? 'working' : 'muted'}>{sh.kind === 'monitor' ? 'monitor' : 'background shell'}</Badge>
      </div>
      {@render inThread(t)}
    </div>

    {#if running}
      <div class="flex gap-2">
        <Button variant="outline-destructive" size="xs" disabled={sh.status === 'stopping'} class="disabled:cursor-wait" onclick={() => monitor.stopShell(t.id, sh.taskId)}>{@render stopIcon()}{sh.status === 'stopping' ? 'Stopping…' : `Stop ${sh.kind}`}</Button>
      </div>
    {/if}

    <div class="grid grid-cols-2 gap-2">
      {@render stat('Running for', running ? duration(monitor.now - sh.startedAt) : 'not running')}
      {@render stat('Status', sh.status)}
    </div>

    <p class="text-caption text-muted-foreground">
      Its command runs somewhere under the agent's processes, but the agent doesn't say which process is its, so this can't point to it.
      <Button variant="link" size="inline" class="text-caption" onclick={onprocesses}>See the processes</Button>
    </p>

  {:else if shown.kind === 'process'}
    {@const t = shown.t}
    {@const p = shown.p}
    {@const tree = processTree(t.processes, p.pid)}
    {@const isAgent = t.processes[0]?.pid === p.pid}
    <div class="space-y-1">
      <div class="flex min-w-0 items-baseline gap-2">
        <h2 class="truncate text-sm font-medium">{p.name}</h2>
        <span class="tabular-nums text-muted-foreground">PID {p.pid}</span>
      </div>
      {@render inThread(t)}
      <p class="text-caption break-words text-muted-foreground">{chain(t, p).join(' › ')}</p>
    </div>

    <div class="grid grid-cols-2 gap-2">
      {@render stat('Memory', bytes(p.bytes))}
      {@render stat('Running for', duration(monitor.now - p.startedAt))}
      {@render stat('Started under it', String(tree.length - 1))}
      {@render stat('With those', bytes(treeBytes(tree)))}
    </div>

    {#if isAgent}
      <Notice tone="neutral">
        <p>This is the thread's agent. To stop it, interrupt the turn or close the thread in the main window.</p>
      </Notice>
    {:else if monitor.confirmEnd === p.pid}
      <Confirm
        message={`End ${p.name} (PID ${p.pid})${tree.length > 1 ? ` and the ${tree.length - 1} process${tree.length === 2 ? '' : 'es'} it started` : ''}? Whatever the agent was running there fails.`}
        confirm="End process"
        onconfirm={() => monitor.endProcess(t.id, p.pid)}
        oncancel={() => (monitor.confirmEnd = null)}
      />
    {:else}
      <div class="flex gap-2">
        <Button variant="outline-destructive" size="xs" onclick={() => (monitor.confirmEnd = p.pid)}>{@render stopIcon()}End process…</Button>
      </div>
    {/if}

    <p class="text-caption text-muted-foreground">Windows' process counters give each process's executable, not its command line, so two node.exe processes look the same here.</p>
  {/if}
</div>
