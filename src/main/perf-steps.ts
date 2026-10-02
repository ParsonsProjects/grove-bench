/**
 * Step timings: how long a new conversation, a resume or a wake took, step
 * by step, written to the performance log (perf-log.ts). A run starts when
 * the user asks, each step records the time since the one before, and the
 * line is written once the agent's process is up:
 *
 *   new conversation 1a2b3c4d: started
 *   new conversation 1a2b3c4d ready after 4210 ms: checks 95 ms, worktree 1830 ms, ...
 *
 * The agent's first message isn't waited for: it only comes with the first
 * prompt, so it would time the user. A run that is closed, deleted, put to
 * sleep or replaced by another before then is written up as stopped.
 *
 * Steps for a conversation with no run going (a restart after Stop, say)
 * are ignored, so the agent code can mark its steps unconditionally.
 */
import type { TimingReport } from '../shared/types.js';
import { perfLine } from './perf-log.js';

/** A run whose agent never comes up is written up and dropped after this. */
const GIVE_UP_MS = 10 * 60_000;

interface Run {
  label: string;
  start: number;
  last: number;
  steps: string[];
  timer: ReturnType<typeof setTimeout>;
}

export interface StepTimerOptions {
  /** Monotonic clock in ms. */
  now?: () => number;
  write?: (line: string) => void;
  giveUpMs?: number;
}

export function createStepTimer({
  now = () => performance.now(),
  write = (line) => perfLine('steps', line),
  giveUpMs = GIVE_UP_MS,
}: StepTimerOptions = {}) {
  const runs = new Map<string, Run>();

  function close(id: string, outcome: string): void {
    const run = runs.get(id);
    if (!run) return;
    runs.delete(id);
    clearTimeout(run.timer);
    const steps = run.steps.length > 0 ? `: ${run.steps.join(', ')}` : '';
    write(`${run.label} ${id} ${outcome} after ${Math.round(now() - run.start)} ms${steps}`);
  }

  function step(id: string, name: string): void {
    const run = runs.get(id);
    if (!run) return;
    const t = now();
    run.steps.push(`${name} ${Math.round(t - run.last)} ms`);
    run.last = t;
  }

  return {
    /** Start timing `label` for conversation `id`, from `startedAt` (a time
     *  from the same clock) when the work began before the id was known. */
    begin(id: string, label: string, startedAt = now()): void {
      // One run per conversation: a wake while a resume is still starting
      // writes the resume up rather than dropping it.
      close(id, `stopped (${label} started)`);
      const timer = setTimeout(() => close(id, 'gave up waiting for the agent'), giveUpMs);
      (timer as { unref?: () => void }).unref?.();
      runs.set(id, { label, start: startedAt, last: startedAt, steps: [], timer });
      write(`${label} ${id}: started`);
    },
    /** The step `name` just ended. */
    step,
    /** The last step, `name`, ended and the conversation is ready. */
    finish(id: string, name: string): void {
      step(id, name);
      close(id, 'ready');
    },
    /** It went wrong or was stopped; write up how far it got. */
    fail(id: string, reason: string): void {
      close(id, `stopped (${reason})`);
    },
  };
}

export const perfSteps = createStepTimer();

/** A TimingReport from the window, with every field checked, or null. Names
 *  are kept short and plain so the line can't carry other text. */
export function sanitizeTiming(value: unknown): TimingReport | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max && /^[\w .,:()-]+$/.test(v) ? v : undefined);
  const label = text(r.label, 40);
  if (!label || !Array.isArray(r.steps)) return null;
  const steps = r.steps.slice(0, 12).flatMap((step) => {
    const st = (step ?? {}) as Record<string, unknown>;
    const name = text(st.name, 40);
    const ms = st.ms;
    return name && typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? [{ name, ms: Math.min(ms, 3_600_000) }] : [];
  });
  const sessionId = text(r.sessionId, 40);
  const detail = text(r.detail, 80);
  return { label, steps, ...(sessionId ? { sessionId } : {}), ...(detail ? { detail } : {}) };
}

/** Write step timings the window reported, in the same form as ours. */
export function logWindowTiming(report: unknown, write: (line: string) => void = (line) => perfLine('steps', line)): void {
  const r = sanitizeTiming(report);
  if (!r) return;
  const total = r.steps.reduce((sum, st) => sum + st.ms, 0);
  const steps = r.steps.map((st) => `${st.name} ${Math.round(st.ms)} ms`).join(', ');
  write(`${r.label}${r.sessionId ? ` ${r.sessionId}` : ''} took ${Math.round(total)} ms${steps ? `: ${steps}` : ''}${r.detail ? ` (${r.detail})` : ''}`);
}
