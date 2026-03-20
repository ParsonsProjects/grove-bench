/**
 * Terminal store for per-session PTY terminals.
 *
 * Each session gets a persistent PTY shell. The store manages:
 * - PTY lifecycle (spawn, kill, restart)
 * - IPC subscriptions for data/exit events
 * - Alive state tracking
 */

class TerminalStore {
  /** Whether the PTY is alive for each session. */
  aliveBySession = $state<Record<string, boolean>>({});

  private dataCleanups = new Map<string, () => void>();
  private exitCleanups = new Map<string, () => void>();

  /** Callbacks registered by the TerminalPanel to receive raw PTY data. */
  private dataHandlers = new Map<string, (data: string) => void>();

  /** Callbacks registered for PTY exit. */
  private exitHandlers = new Map<string, (exitCode: number, signal?: number) => void>();

  isAlive(sessionId: string): boolean {
    return this.aliveBySession[sessionId] ?? false;
  }

  /** Register a handler to receive raw PTY data (called by TerminalPanel). */
  onData(sessionId: string, handler: (data: string) => void) {
    this.dataHandlers.set(sessionId, handler);
  }

  /** Register a handler for PTY exit (called by TerminalPanel). */
  onExit(sessionId: string, handler: (exitCode: number, signal?: number) => void) {
    this.exitHandlers.set(sessionId, handler);
  }

  /** Subscribe to IPC events for a session's PTY. */
  subscribe(sessionId: string) {
    if (this.dataCleanups.has(sessionId)) return;

    const dataCleanup = window.groveBench.onPtyData(sessionId, (data) => {
      const handler = this.dataHandlers.get(sessionId);
      if (handler) handler(data);
    });
    this.dataCleanups.set(sessionId, dataCleanup);

    const exitCleanup = window.groveBench.onPtyExit(sessionId, (exitCode, signal) => {
      this.aliveBySession[sessionId] = false;
      const handler = this.exitHandlers.get(sessionId);
      if (handler) handler(exitCode, signal);
    });
    this.exitCleanups.set(sessionId, exitCleanup);
  }

  /** Unsubscribe from IPC events. */
  unsubscribe(sessionId: string) {
    this.dataCleanups.get(sessionId)?.();
    this.dataCleanups.delete(sessionId);
    this.exitCleanups.get(sessionId)?.();
    this.exitCleanups.delete(sessionId);
    this.dataHandlers.delete(sessionId);
    this.exitHandlers.delete(sessionId);
  }

  /** Spawn a PTY for the session. */
  async spawn(sessionId: string): Promise<boolean> {
    const ok = await window.groveBench.ptySpawn(sessionId);
    this.aliveBySession[sessionId] = ok;
    return ok;
  }

  /** Write data to the PTY (keystrokes, pasted text). */
  write(sessionId: string, data: string) {
    window.groveBench.ptyWrite(sessionId, data);
  }

  /** Resize the PTY. */
  resize(sessionId: string, cols: number, rows: number) {
    window.groveBench.ptyResize(sessionId, cols, rows);
  }

  /** Kill the PTY. */
  async kill(sessionId: string) {
    await window.groveBench.ptyKill(sessionId);
    this.aliveBySession[sessionId] = false;
  }

  /** Kill and respawn the PTY. */
  async restart(sessionId: string): Promise<boolean> {
    const ok = await window.groveBench.ptyRestart(sessionId);
    this.aliveBySession[sessionId] = ok;
    return ok;
  }

  /** Check if the PTY is alive (queries main process). */
  async checkAlive(sessionId: string): Promise<boolean> {
    const alive = await window.groveBench.ptyIsAlive(sessionId);
    this.aliveBySession[sessionId] = alive;
    return alive;
  }
}

export const terminalStore = new TerminalStore();
