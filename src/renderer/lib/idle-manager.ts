import { store } from '../stores/sessions.svelte.js';
import { messageStore } from '../stores/messages.svelte.js';
import { settingsStore } from '../stores/settings.svelte.js';

/** Minimal per-session snapshot the idle policy needs. Kept plain (no store
 *  coupling) so the policy is unit-testable. */
export interface IdleSnapshotSession {
  id: string;
  status: string;
  /** Currently focused session — never auto-stopped. */
  isActive: boolean;
  /** Executing a turn right now. */
  isRunning: boolean;
  /** Awaiting a permission decision. */
  hasPending: boolean;
}

/**
 * Pure idle policy. A live (`running`) session becomes a stop candidate when it
 * is not focused, not executing a turn, and not awaiting a permission. The first
 * tick it's eligible we record `idleSince`; once it's been eligible for at least
 * `thresholdMs` it's returned in `toStop`. `nextIdleSince` carries forward the
 * timestamps for sessions still counting down (sessions that became ineligible
 * are dropped, so their clock resets next time).
 *
 * `thresholdMs <= 0` disables auto-stop entirely.
 */
export function computeIdleStops(
  sessions: IdleSnapshotSession[],
  idleSince: Map<string, number>,
  now: number,
  thresholdMs: number,
): { toStop: string[]; nextIdleSince: Map<string, number> } {
  const nextIdleSince = new Map<string, number>();
  const toStop: string[] = [];
  if (thresholdMs <= 0) return { toStop, nextIdleSince };

  for (const s of sessions) {
    const eligible = s.status === 'running' && !s.isActive && !s.isRunning && !s.hasPending;
    if (!eligible) continue;
    const since = idleSince.get(s.id) ?? now;
    if (now - since >= thresholdMs) {
      toStop.push(s.id);
    } else {
      nextIdleSince.set(s.id, since);
    }
  }
  return { toStop, nextIdleSince };
}

/** Non-destructively stop a session (same path as the sidebar's Stop). An idle
 *  candidate is never the active session, so no active-session reassignment is
 *  needed here. */
function stopSession(id: string) {
  store.pushRecentlyClosed(id);
  store.updateStatus(id, 'stopped');
  window.groveBench.stopSession(id).catch(() => { /* may already be dead */ });
}

/**
 * Start the idle auto-stop loop. Polls every `intervalMs` and stops sessions
 * that have been idle past the configured threshold. Returns a cleanup function.
 */
export function startIdleManager(intervalMs = 60_000): () => void {
  let idleSince = new Map<string, number>();

  const tick = () => {
    const thresholdMs = (settingsStore.current.idleAutoStopMinutes ?? 0) * 60_000;
    const now = Date.now();
    const snapshot: IdleSnapshotSession[] = store.sessions.map((s) => ({
      id: s.id,
      status: s.status,
      isActive: store.activeSessionId === s.id,
      isRunning: messageStore.getIsRunning(s.id),
      hasPending: messageStore.hasPendingPermission(s.id),
    }));
    const { toStop, nextIdleSince } = computeIdleStops(snapshot, idleSince, now, thresholdMs);
    idleSince = nextIdleSince;
    for (const id of toStop) stopSession(id);
  };

  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
