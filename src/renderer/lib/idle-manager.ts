import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';

/** Minimal per-session snapshot the idle policy needs. Kept plain (no store
 *  coupling) so the policy is unit-testable. */
export interface IdleSnapshotSession {
  id: string;
  status: string;
  /** Currently focused session: never put to sleep. */
  isActive: boolean;
  /** Executing a turn right now. */
  isRunning: boolean;
  /** Awaiting a permission decision. */
  hasPending: boolean;
}

/**
 * Pure idle policy. A live (`running`) session becomes a sleep candidate when
 * it is not focused, not executing a turn, and not awaiting a permission. The
 * first tick it's eligible we record `idleSince`; once it's been eligible for
 * at least `thresholdMs` it's returned in `toSleep`. `nextIdleSince` carries
 * forward the timestamps for sessions still counting down (sessions that
 * became ineligible are dropped, so their clock resets next time).
 *
 * Background tasks (a dev server the agent started, a background subagent)
 * are main's call: sleepSession refuses while the agent reports one. The
 * thread's own task list can't decide it: it pairs each task's start with its
 * end, so one end that never arrives keeps a finished task listed as running,
 * and the thread awake, for good.
 *
 * `thresholdMs <= 0` disables idle sleep entirely.
 */
export function computeIdleSleeps(
  sessions: IdleSnapshotSession[],
  idleSince: Map<string, number>,
  now: number,
  thresholdMs: number,
): { toSleep: string[]; nextIdleSince: Map<string, number> } {
  const nextIdleSince = new Map<string, number>();
  const toSleep: string[] = [];
  if (thresholdMs <= 0) return { toSleep, nextIdleSince };

  for (const s of sessions) {
    const eligible = s.status === 'running' && !s.isActive && !s.isRunning && !s.hasPending;
    if (!eligible) continue;
    const since = idleSince.get(s.id) ?? now;
    if (now - since >= thresholdMs) {
      toSleep.push(s.id);
    } else {
      nextIdleSince.set(s.id, since);
    }
  }
  return { toSleep, nextIdleSince };
}

/**
 * Start the idle sleep loop. Polls every `intervalMs` and puts sessions that
 * have been idle past the configured threshold to sleep: main shuts down
 * their agent process and reports them 'sleeping', or leaves it running and
 * logs why (a background task, say). They stay open, and wake when focused
 * (App.svelte) or sent a message. Returns a cleanup function.
 */
export function startIdleManager(intervalMs = 60_000): () => void {
  let idleSince = new Map<string, number>();

  const tick = () => {
    const thresholdMs = (settingsStore.current.idleSleepMinutes ?? 0) * 60_000;
    const now = Date.now();
    const snapshot: IdleSnapshotSession[] = store.sessions.map((s) => ({
      id: s.id,
      status: s.status,
      isActive: store.activeSessionId === s.id,
      isRunning: messageStore.getIsRunning(s.id),
      hasPending: messageStore.hasPendingPermission(s.id),
    }));
    const { toSleep, nextIdleSince } = computeIdleSleeps(snapshot, idleSince, now, thresholdMs);
    idleSince = nextIdleSince;
    for (const id of toSleep) {
      window.groveBench.sleepSession(id).catch(() => { /* stays awake; retried once idle again */ });
    }
  };

  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
