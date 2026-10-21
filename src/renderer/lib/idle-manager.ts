import { store } from '../stores/sessions.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';

/** Minimal per-session snapshot the idle policy needs. Kept plain (no store
 *  coupling) so the policy is unit-testable. */
export interface IdleSnapshotSession {
  id: string;
  status: string;
  /** Currently focused session: never put to sleep. */
  isActive: boolean;
  /** When the thread last did anything (ms): a message sent to it, or a
   *  live turn it finished. Missing for a thread that has done neither. */
  lastActiveAt?: number;
  /** When the user last moved off this thread (ms), noted as it happened
   *  (store.lastLeftAt). Missing for a thread not open this run. */
  leftAt?: number;
}

/** What the idle loop made of one thread on one tick. Goes to the app log
 *  (IdleLog), so it holds states and times only, never a thread's text. */
export type IdleReason =
  | { kind: 'status'; status: string }
  | { kind: 'focused' }
  /** Unfocused and live, under the threshold. `since` says where its idle
   *  time counts from. */
  | { kind: 'counting'; idleMs: number; since: 'activity' | 'left' }
  /** Past the threshold, but the user left it less than `graceMs` ago. */
  | { kind: 'grace'; idleMs: number; leftMs: number; graceMs: number }
  | { kind: 'asking'; idleMs: number }
  /** Past the threshold, but main hasn't answered the last ask yet. */
  | { kind: 'waiting'; idleMs: number };

/** How long after the user leaves a thread it can't be asked to sleep (see
 *  computeIdleSleeps). Five minutes covers a look at a thread and a trip to
 *  another and back, and is short against the 30-minute default. */
export const IDLE_GRACE_MS = 5 * 60_000;

/** The grace for a threshold: never longer than the threshold itself, so a
 *  short setting still means what it says. */
export function idleGraceMs(thresholdMs: number): number {
  return Math.min(IDLE_GRACE_MS, thresholdMs);
}

const isTime = (t: number | undefined): t is number => typeof t === 'number' && Number.isFinite(t);

/**
 * Pure idle policy: which threads to ask main to put to sleep this tick.
 *
 * A running, unfocused thread is asked once both hold:
 * - it has been idle for the threshold, counted from the last thing it did
 *   (`lastActiveAt`). Opening a thread doesn't restart that count: reading
 *   it, or clearing its unread flag, isn't activity. A thread without a
 *   `lastActiveAt` counts from when it was left, or from the first tick it
 *   was seen live and unfocused if it wasn't open this run.
 * - the user left it at least the grace (idleGraceMs: 5 minutes, or the
 *   threshold if shorter) ago. Opening a sleeping thread wakes it (a new
 *   agent process, seconds to start), so a glance at one long past the
 *   threshold would otherwise cost a full start, then a kill a minute
 *   later. `leftAt` is noted the moment focus moves, so a visit between two
 *   ticks counts too.
 * So it's asked at the later of `lastActiveAt` + threshold and `leftAt` +
 * grace: a short look costs at most the grace, never the full threshold.
 *
 * Whether it's safe is main's call: sleepSession refuses (and logs why) a
 * thread mid-turn, waiting on a permission, an MCP question or a limit
 * question, or running a background task. The renderer's own view can't
 * decide it: a thread resumed from a history that ends mid-turn, or on an
 * unanswered prompt, reads as running or waiting here for good. A refused
 * thread is asked again each tick, which main answers cheaply.
 *
 * `unfocusedSince` holds the first tick each live, unfocused thread was seen
 * on; `nextUnfocusedSince` carries it forward (threads focused or no longer
 * live are dropped). Threads in `inFlight` (an earlier ask main hasn't
 * answered) aren't asked again. `thresholdMs <= 0` disables idle sleep.
 */
export function computeIdleSleeps(
  sessions: readonly IdleSnapshotSession[],
  unfocusedSince: ReadonlyMap<string, number>,
  now: number,
  thresholdMs: number,
  inFlight: ReadonlySet<string> = new Set(),
): { toSleep: string[]; nextUnfocusedSince: Map<string, number>; reasons: Map<string, IdleReason> } {
  const nextUnfocusedSince = new Map<string, number>();
  const toSleep: string[] = [];
  const reasons = new Map<string, IdleReason>();
  if (thresholdMs <= 0) return { toSleep, nextUnfocusedSince, reasons };
  const graceMs = idleGraceMs(thresholdMs);

  for (const s of sessions) {
    if (reasons.has(s.id)) continue; // listed twice: decided once
    if (s.status !== 'running') {
      reasons.set(s.id, { kind: 'status', status: s.status });
      continue;
    }
    if (s.isActive) {
      reasons.set(s.id, { kind: 'focused' });
      continue;
    }
    const seen = unfocusedSince.get(s.id) ?? now;
    nextUnfocusedSince.set(s.id, seen);
    const leftAt = isTime(s.leftAt) ? s.leftAt : undefined;
    const hasActivity = isTime(s.lastActiveAt);
    // With no activity recorded: from when it was left, or first seen if later.
    const idleFrom = hasActivity ? s.lastActiveAt! : Math.max(seen, leftAt ?? seen);
    const idleMs = Math.max(0, now - idleFrom);
    const leftMs = leftAt === undefined ? Infinity : Math.max(0, now - leftAt);
    if (idleMs < thresholdMs) {
      reasons.set(s.id, { kind: 'counting', idleMs, since: hasActivity ? 'activity' : 'left' });
    } else if (leftMs < graceMs) {
      reasons.set(s.id, { kind: 'grace', idleMs, leftMs, graceMs });
    } else if (inFlight.has(s.id)) {
      reasons.set(s.id, { kind: 'waiting', idleMs });
    } else {
      reasons.set(s.id, { kind: 'asking', idleMs });
      toSleep.push(s.id);
    }
  }
  return { toSleep, nextUnfocusedSince, reasons };
}

/** Whole minutes, for idle times. */
const wholeMinutes = (ms: number) => `${Math.floor(ms / 60_000)}m`;
/** The setting's minutes, which may be fractional. */
const settingMinutes = (ms: number) => `${Math.round((ms / 60_000) * 10) / 10}m`;

/** What one reason says in the log. */
export function describeIdleReason(reason: IdleReason, thresholdMs: number): string {
  const of = (idleMs: number) => `idle ${wholeMinutes(idleMs)} of ${settingMinutes(thresholdMs)}`;
  switch (reason.kind) {
    case 'status': return `status ${reason.status}`;
    case 'focused': return 'focused';
    case 'counting':
      return of(reason.idleMs)
        + (reason.since === 'left' ? ' since it was left (no activity recorded)' : ' since its last activity');
    case 'grace':
      return `${of(reason.idleMs)} since its last activity, left ${wholeMinutes(reason.leftMs)} ago, grace ${settingMinutes(reason.graceMs)}`;
    case 'asking': return `${of(reason.idleMs)}, asking main to sleep it`;
    case 'waiting': return `${of(reason.idleMs)}, still waiting on main's answer to the last ask`;
  }
}

/** A reason's category: a log line is written only when this changes. */
function category(reason: IdleReason): string {
  return reason.kind === 'status' ? `status ${reason.status}` : reason.kind;
}

/** Summary lines go out every this many ticks. */
export const IDLE_SUMMARY_EVERY = 10;

/**
 * The idle loop's view, as app log lines: one per thread whenever its
 * reason's category changes (not each tick an idle thread's minutes go up),
 * one when the setting changes, and a short summary every
 * IDLE_SUMMARY_EVERY ticks. Nothing on a tick where nothing changed. Lines
 * name threads by id only.
 */
export class IdleLog {
  private categories = new Map<string, string>();
  private setting: string | null = null;
  private ticks = 0;

  /** The lines for one tick. `threadCount` is how many threads were listed. */
  lines(reasons: ReadonlyMap<string, IdleReason>, thresholdMs: number, threadCount: number): string[] {
    const out: string[] = [];
    const off = thresholdMs <= 0;
    const setting = off ? 'idle sleep is off' : `threshold ${settingMinutes(thresholdMs)}`;
    if (setting !== this.setting) out.push(setting);
    this.setting = setting;

    if (off) {
      // Each thread is logged afresh once it's turned back on.
      this.categories.clear();
    } else {
      for (const [id, reason] of reasons) {
        const cat = category(reason);
        if (this.categories.get(id) === cat) continue;
        this.categories.set(id, cat);
        out.push(`session=${id} ${describeIdleReason(reason, thresholdMs)}`);
      }
      // Closed or deleted threads: forget them quietly.
      for (const id of [...this.categories.keys()]) if (!reasons.has(id)) this.categories.delete(id);
    }

    this.ticks++;
    if (this.ticks % IDLE_SUMMARY_EVERY === 0 && threadCount > 0) out.push(this.summary(reasons, thresholdMs, threadCount));
    return out;
  }

  private summary(reasons: ReadonlyMap<string, IdleReason>, thresholdMs: number, threadCount: number): string {
    const head = `${threadCount} thread${threadCount === 1 ? '' : 's'}`;
    if (thresholdMs <= 0) return `${head}, idle sleep off`;
    const counts = new Map<string, number>([['counting', 0], ['focused', 0], ['asked', 0]]);
    for (const reason of reasons.values()) {
      const key = reason.kind === 'asking' || reason.kind === 'waiting' ? 'asked'
        : reason.kind === 'status' ? reason.status
          : reason.kind === 'grace' ? 'in grace'
            : reason.kind;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return `${head}, threshold ${settingMinutes(thresholdMs)}: ${[...counts].map(([k, n]) => `${n} ${k}`).join(', ')}`;
  }
}

/**
 * Start the idle sleep loop. Polls every `intervalMs` and asks main to put
 * threads idle past the configured threshold to sleep (see computeIdleSleeps):
 * main shuts down their agent process and reports them 'sleeping', or leaves
 * it running and logs why (mid-turn, a prompt open, a background task). They
 * stay open, and wake when focused (App.svelte) or sent a message. Each tick's
 * view goes to the app log as `[idle]` lines (IdleLog). Returns a cleanup
 * function.
 */
export function startIdleManager(intervalMs = 60_000): () => void {
  let unfocusedSince = new Map<string, number>();
  /** Threads asked to sleep whose answer hasn't come back. */
  const inFlight = new Set<string>();
  const log = new IdleLog();
  const send = (line: string) => {
    try {
      window.groveBench.logIdle(line);
    } catch { /* logging must never break the loop */ }
  };

  const tick = () => {
    const thresholdMs = (settingsStore.current.idleSleepMinutes ?? 0) * 60_000;
    const now = Date.now();
    const snapshot: IdleSnapshotSession[] = store.sessions.map((s) => ({
      id: s.id,
      status: s.status,
      isActive: store.activeSessionId === s.id,
      lastActiveAt: s.lastActiveAt,
      leftAt: store.lastLeftAt.get(s.id),
    }));
    const { toSleep, nextUnfocusedSince, reasons } = computeIdleSleeps(snapshot, unfocusedSince, now, thresholdMs, inFlight);
    unfocusedSince = nextUnfocusedSince;
    for (const line of log.lines(reasons, thresholdMs, snapshot.length)) send(line);
    for (const id of toSleep) {
      inFlight.add(id);
      // A refusal (false) needs nothing here: main logs why, and the next
      // tick asks again.
      void (async () => {
        try {
          await window.groveBench.sleepSession(id);
        } catch (e) {
          send(`session=${id} sleep request failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          inFlight.delete(id);
        }
      })();
    }
  };

  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
