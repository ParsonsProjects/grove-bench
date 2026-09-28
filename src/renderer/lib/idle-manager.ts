import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';
import { backgroundTaskStore } from '../stores/backgroundTask.svelte.js';

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
  /** Has a background task running (e.g. a dev server the agent started),
   *  which would die with the agent process. */
  hasRunningTasks: boolean;
}

/**
 * Pure idle policy. A live (`running`) session becomes a sleep candidate when
 * it is not focused, not executing a turn or background task, and not awaiting
 * a permission. The first tick it's eligible we record `idleSince`; once it's
 * been eligible for at least `thresholdMs` it's returned in `toSleep`.
 * `nextIdleSince` carries forward the timestamps for sessions still counting
 * down (sessions that became ineligible are dropped, so their clock resets
 * next time).
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
    const eligible = s.status === 'running' && !s.isActive && !s.isRunning && !s.hasPending && !s.hasRunningTasks;
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
 * their agent process and reports them 'sleeping'. They stay open, and wake
 * when focused (App.svelte) or sent a message. Returns a cleanup function.
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
      hasRunningTasks: backgroundTaskStore.get(s.id).some((t) => t.status === 'running'),
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
