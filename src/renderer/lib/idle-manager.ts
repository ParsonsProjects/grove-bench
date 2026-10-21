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
}

/** What the idle loop made of one thread on one tick. Goes to the app log
 *  (IdleLog), so it holds states and times only, never a thread's text. */
export type IdleReason =
  | { kind: 'status'; status: string }
  | { kind: 'focused' }
  /** Unfocused and live, but not asked yet: under the threshold, or first
   *  seen unfocused this tick. `since` says where its idle time counts from. */
  | { kind: 'counting'; idleMs: number; since: 'activity' | 'left' }
  | { kind: 'asking'; idleMs: number }
  /** Past the threshold, but main hasn't answered the last ask yet. */
  | { kind: 'waiting'; idleMs: number };

/**
 * Pure idle policy: which threads to ask main to put to sleep this tick.
 *
 * A thread is idle from the last thing it did (`lastActiveAt`), not from
 * when it was last focused: opening a thread to read it, or to clear its
 * unread flag, doesn't restart the clock. A thread without a `lastActiveAt`
 * counts from the first tick it was seen live and unfocused. The focused
 * thread is never asked, and a thread is asked only once it has been seen
 * unfocused on an earlier tick too, so leaving a thread that's long past the
 * threshold sleeps it on the next tick, not the moment it's left.
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
    const seen = unfocusedSince.get(s.id);
    nextUnfocusedSince.set(s.id, seen ?? now);
    const hasActivity = typeof s.lastActiveAt === 'number' && Number.isFinite(s.lastActiveAt);
    const idleMs = Math.max(0, now - (hasActivity ? s.lastActiveAt! : seen ?? now));
    if (seen === undefined || idleMs < thresholdMs) {
      reasons.set(s.id, { kind: 'counting', idleMs, since: hasActivity ? 'activity' : 'left' });
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
        + (reason.since === 'left' ? ' since it was left (no activity recorded)' : ' since its last activity')
        + (reason.idleMs >= thresholdMs ? ', asks next tick' : '');
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
