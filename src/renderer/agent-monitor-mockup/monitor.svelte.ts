/**
 * The agent monitor mockup's state: made-up threads that move on every
 * second, so the page feels live, and what its buttons do to them. Nothing
 * here talks to main; docs/agent-monitor-plan.md says where each piece would
 * come from in the real window.
 */
import { mockThreads, type DoneCall, type Doing, type MockCall, type MockProcess, type MockThread } from './mock-data.js';

export type Selection =
  | { kind: 'thread'; threadId: string }
  | { kind: 'subagent'; threadId: string; id: string }
  | { kind: 'shell'; threadId: string; taskId: string }
  | { kind: 'process'; threadId: string; pid: number };

/** A thread or subagent: something that runs tool calls. */
interface Runner {
  doing: Doing;
  recent: DoneCall[];
  script: MockCall[];
  step: number;
}

/** How long it thinks between two tool calls in the mockup. */
const THINK_MS = 2500;
const RECENT_KEPT = 8;
const TOAST_MS = 3500;
/** How often the process list is sampled again (made-up memory jitter). */
const SAMPLE_MS = 5000;

/** A process and everything under it. */
export function processTree(processes: readonly MockProcess[], pid: number): MockProcess[] {
  const out: MockProcess[] = [];
  const walk = (p: MockProcess) => {
    out.push(p);
    for (const child of processes) if (child.ppid === p.pid) walk(child);
  };
  const root = processes.find((p) => p.pid === pid);
  if (root) walk(root);
  return out;
}

/** A thread's processes in tree order, each with its depth under the agent. */
export function flattenProcesses(t: MockThread): { p: MockProcess; depth: number }[] {
  const out: { p: MockProcess; depth: number }[] = [];
  const walk = (p: MockProcess, depth: number) => {
    out.push({ p, depth });
    for (const child of t.processes) if (child.ppid === p.pid) walk(child, depth + 1);
  };
  if (t.processes[0]) walk(t.processes[0], 0);
  return out;
}

export function treeBytes(processes: readonly MockProcess[]): number {
  return processes.reduce((n, p) => n + p.bytes, 0);
}

/** Something is running or waiting on the user: the "Running" filter. */
export function isActive(t: MockThread): boolean {
  return t.state === 'working' || t.state === 'permission'
    || t.subagents.some((a) => a.status === 'running' || a.status === 'stopping')
    || t.shells.some((sh) => sh.status === 'running' || sh.status === 'stopping');
}

class MockMonitor {
  now = $state(Date.now());
  threads = $state<MockThread[]>(mockThreads(Date.now()));
  sampledAt = $state(Date.now());
  selection = $state<Selection>({ kind: 'thread', threadId: 's-sidebar' });
  toast = $state('');
  /** The process whose End is waiting for the user to confirm. */
  confirmEnd = $state<number | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  thread(id: string): MockThread | undefined {
    return this.threads.find((t) => t.id === id);
  }

  select(selection: Selection) {
    this.selection = selection;
    this.confirmEnd = null;
  }

  /** Selects a process and asks before ending it. */
  askEnd(threadId: string, pid: number) {
    this.select({ kind: 'process', threadId, pid });
    this.confirmEnd = pid;
  }

  isSelected(s: Selection): boolean {
    const cur = this.selection;
    if (cur.kind !== s.kind || cur.threadId !== s.threadId) return false;
    if (cur.kind === 'subagent' && s.kind === 'subagent') return cur.id === s.id;
    if (cur.kind === 'shell' && s.kind === 'shell') return cur.taskId === s.taskId;
    if (cur.kind === 'process' && s.kind === 'process') return cur.pid === s.pid;
    return true;
  }

  say(message: string) {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = ''), TOAST_MS);
  }

  /** One second on: tool calls finish and the next start, tokens go up. */
  tick() {
    const t = Date.now();
    this.now = t;
    for (const thread of this.threads) {
      if (thread.state === 'working') {
        advance(thread, t);
        thread.turnTokens += 90;
      }
      for (const sub of thread.subagents) {
        if (sub.status !== 'running') continue;
        if (advance(sub, t)) sub.toolUses++;
        sub.tokens += 60;
      }
    }
    if (t - this.sampledAt >= SAMPLE_MS) this.sample(t);
  }

  /** A new process sample: the mockup only nudges memory a little. */
  sample(t = Date.now()) {
    for (const thread of this.threads) {
      for (const p of thread.processes) p.bytes = Math.max(1, Math.round(p.bytes * (0.98 + Math.random() * 0.04)));
    }
    this.sampledAt = t;
  }

  /** Interrupt: ends the turn and the subagents it waits on. Background
   *  subagents and shells keep running, as perTaskStopAffordance makes the
   *  real interrupt do (adapters/claude-code.ts). */
  interrupt(threadId: string) {
    const thread = this.thread(threadId);
    if (!thread) return;
    if (thread.doing.kind === 'tool') {
      thread.recent = [{ ...thread.doing.call, endedAt: Date.now(), isError: true }, ...thread.recent].slice(0, RECENT_KEPT);
    }
    thread.doing = { kind: 'idle' };
    thread.state = 'ready';
    thread.turnStartedAt = undefined;
    for (const sub of thread.subagents) {
      if (!sub.background && sub.status === 'running') {
        sub.status = 'stopped';
        sub.doing = { kind: 'idle' };
      }
    }
    thread.processes = thread.processes.filter((p) => !p.endsWithTurn);
    this.say(`Interrupted the turn in “${thread.title}”. Background subagents and shells are still running.`);
  }

  stopSubagent(threadId: string, id: string) {
    const sub = this.thread(threadId)?.subagents.find((a) => a.id === id);
    if (!sub || !sub.background || sub.status !== 'running') return;
    sub.status = 'stopping';
    setTimeout(() => {
      sub.status = 'stopped';
      sub.doing = { kind: 'idle' };
    }, 900);
  }

  stopShell(threadId: string, taskId: string) {
    const shell = this.thread(threadId)?.shells.find((sh) => sh.taskId === taskId);
    if (!shell || shell.status !== 'running') return;
    shell.status = 'stopping';
    setTimeout(() => (shell.status = 'stopped'), 900);
  }

  /** Ends a process and everything under it. Never the agent itself. */
  endProcess(threadId: string, pid: number) {
    const thread = this.thread(threadId);
    if (!thread || thread.processes[0]?.pid === pid) return;
    const tree = processTree(thread.processes, pid);
    const gone = new Set(tree.map((p) => p.pid));
    thread.processes = thread.processes.filter((p) => !gone.has(p.pid));
    this.selection = { kind: 'thread', threadId };
    const under = tree.length - 1;
    this.say(`Ended ${tree[0].name} (PID ${pid})${under ? ` and ${under} under it` : ''}. The agent sees its command fail.`);
  }

  /** Set by the dialog, which sits over the app: opens the thread there and
   *  returns true. The window page has no app behind it. */
  openThreadIn: ((threadId: string) => boolean) | null = null;

  /** Open thread: in the dialog it switches the app to the thread; in the
   *  window it says what would happen. */
  openThread(threadId: string, what: string) {
    if (this.openThreadIn?.(threadId)) return;
    this.say(`In the app this brings the main window forward with ${what} open.`);
  }
}

/** Moves a runner on: a finished call goes to its recent list, then it
 *  thinks a moment and starts the next. True when a call finished. */
function advance(r: Runner, t: number): boolean {
  if (r.script.length === 0) return false;
  const d = r.doing;
  if (d.kind === 'tool' && t - d.startedAt >= d.call.seconds * 1000) {
    r.recent = [{ ...d.call, endedAt: t }, ...r.recent].slice(0, RECENT_KEPT);
    r.doing = { kind: 'thinking', startedAt: t };
    return true;
  }
  if (d.kind === 'thinking' && t - d.startedAt >= THINK_MS) {
    const call = r.script[r.step % r.script.length];
    r.step++;
    r.doing = { kind: 'tool', call, startedAt: t };
  }
  return false;
}

export const monitor = new MockMonitor();
