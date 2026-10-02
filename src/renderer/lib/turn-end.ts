/** How long a conversation must stay idle before its turn counts as finished. */
export const TURN_SETTLE_MS = 1000;

/**
 * Whether a finished turn marks its conversation unread: not while you're
 * looking at it, and not when the turn ended because the conversation was
 * stopped (closed, or its agent shut down), as there is nothing
 * new to read.
 */
export function flagsUnread(session: { id: string; status: string }, activeSessionId: string | null): boolean {
  return session.id !== activeSessionId && session.status !== 'stopped';
}

/**
 * Spots conversations finishing a turn: running, then idle for `settleMs`.
 * A turn can look finished for a moment and then carry on (the agent picks
 * up again straight after a result), so a brief idle gap doesn't count. That
 * way the sidebar character doesn't wave "finished" mid-turn.
 */
export class TurnEndWatcher {
  private wasRunning = new Map<string, boolean>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private onEnd: (sessionId: string) => void,
    private settleMs = TURN_SETTLE_MS,
  ) {}

  /** Report a conversation's current running state. */
  update(sessionId: string, running: boolean): void {
    const wasRunning = this.wasRunning.get(sessionId) ?? false;
    this.wasRunning.set(sessionId, running);
    if (running) {
      this.cancel(sessionId);
    } else if (wasRunning) {
      this.cancel(sessionId);
      this.timers.set(sessionId, setTimeout(() => {
        this.timers.delete(sessionId);
        this.onEnd(sessionId);
      }, this.settleMs));
    }
  }

  private cancel(sessionId: string): void {
    clearTimeout(this.timers.get(sessionId));
    this.timers.delete(sessionId);
  }
}
