import { previewStore } from './preview.svelte.js';
import { gitStatusStore } from './gitStatus.svelte.js';
import { errorMessage } from '../../shared/error-message.js';
import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';
import type { PtySpawnResult } from '../../shared/types.js';

/** After Enter in a thread's terminal, how long its output must stay quiet
 *  before the git status is read again: the command has likely finished. */
export const COMMAND_SETTLED_MS = 1000;
/** How long after Enter output still counts as the command's: a command that
 *  ends within it is read as it ends. One that runs longer (or a server left
 *  running) is read when the Changes tab opens or the window comes back. */
export const COMMAND_WINDOW_MS = 120_000;

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
  /** Starts (or checks before one) in flight per session: the panel says
   *  Starting rather than Stopped meanwhile. A count, since a `!command`
   *  and the panel mounting can each be waiting. */
  startingBySession = $state<Record<string, number>>({});
  /** Why the last start failed, until the next one. */
  startErrorBySession = $state<Record<string, string>>({});

  private dataCleanups = new Map<string, () => void>();
  private exitCleanups = new Map<string, () => void>();

  /** Callbacks registered by the TerminalPanel to receive raw PTY data. */
  private dataHandlers = new Map<string, (data: string) => void>();

  /** Callbacks registered for PTY exit. */
  private exitHandlers = new Map<string, (exitCode: number, signal?: number) => void>();

  /** A command typed in the terminal may change what git sees (git itself,
   *  or anything that edits files): when its output settles, the Changes tab
   *  and the status bar are read again. Per session: until when output still
   *  counts as the last command's. */
  private commandUntil = new Map<string, number>();

  isAlive(sessionId: string): boolean {
    return this.aliveBySession[sessionId] ?? false;
  }

  /** A shell is being started (or looked for) for this session. A new
   *  thread's waits for its worktree (main's PTY_SPAWN). */
  isStarting(sessionId: string): boolean {
    return (this.startingBySession[sessionId] ?? 0) > 0;
  }

  /** Why the shell didn't start, or null. */
  startError(sessionId: string): string | null {
    return this.startErrorBySession[sessionId] ?? null;
  }

  private async whileStarting<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    this.startingBySession[sessionId] = (this.startingBySession[sessionId] ?? 0) + 1;
    try {
      return await run();
    } finally {
      this.startingBySession[sessionId] = Math.max(0, (this.startingBySession[sessionId] ?? 1) - 1);
    }
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
      if (Date.now() < (this.commandUntil.get(sessionId) ?? 0)) this.awaitSettled(sessionId);
      // A dev server started here prints its URL; offer it in the Preview tab.
      previewStore.noteStream(sessionId, data);
    });
    this.dataCleanups.set(sessionId, dataCleanup);

    const exitCleanup = window.groveBench.onPtyExit(sessionId, (exitCode, signal) => {
      this.aliveBySession[sessionId] = false;
      const handler = this.exitHandlers.get(sessionId);
      if (handler) handler(exitCode, signal);
    });
    this.exitCleanups.set(sessionId, exitCleanup);
  }

  /** (Re)start the wait for a command's output to settle: the store's
   *  scheduled read starts over each time it's asked. */
  private awaitSettled(sessionId: string) {
    if (gitStatusStore.hasGit(sessionId)) gitStatusStore.scheduleRefresh(sessionId, COMMAND_SETTLED_MS);
  }

  /** Unsubscribe from IPC events. */
  unsubscribe(sessionId: string) {
    this.dataCleanups.get(sessionId)?.();
    this.dataCleanups.delete(sessionId);
    this.exitCleanups.get(sessionId)?.();
    this.exitCleanups.delete(sessionId);
    this.dataHandlers.delete(sessionId);
    this.exitHandlers.delete(sessionId);
    this.commandUntil.delete(sessionId);
  }

  /** The main process killed this session's PTY on close without an exit
   *  event; mark it dead so reopening sizes the fresh shell it spawns. */
  markClosed(sessionId: string) {
    this.aliveBySession[sessionId] = false;
  }

  /** Tear down all state for a permanently destroyed session. */
  destroySession(sessionId: string) {
    this.unsubscribe(sessionId);
    const { [sessionId]: _drop, ...rest } = this.aliveBySession;
    this.aliveBySession = rest;
    const { [sessionId]: _starting, ...restStarting } = this.startingBySession;
    this.startingBySession = restStarting;
    const { [sessionId]: _error, ...restErrors } = this.startErrorBySession;
    this.startErrorBySession = restErrors;
  }

  /** Spawn a PTY for the session. */
  async spawn(sessionId: string): Promise<boolean> {
    delete this.startErrorBySession[sessionId];
    let result: PtySpawnResult;
    try {
      result = await window.groveBench.ptySpawn(sessionId);
    } catch (e) {
      result = { ok: false, error: stripIpcErrorPrefix(errorMessage(e)) };
    }
    this.aliveBySession[sessionId] = result.ok;
    if (!result.ok) this.startErrorBySession[sessionId] = result.error;
    return result.ok;
  }

  private ensuring = new Map<string, Promise<boolean>>();

  /** Make sure a PTY is alive, spawning one if needed. Concurrent callers
   *  (e.g. the panel mounting while a `!command` is being dispatched) share
   *  one in-flight check so they can't each spawn and kill the other's shell. */
  ensureAlive(sessionId: string): Promise<boolean> {
    const pending = this.ensuring.get(sessionId);
    if (pending) return pending;
    const run = this.whileStarting(sessionId, async () => {
      const alive = await this.checkAlive(sessionId);
      return alive ? true : this.spawn(sessionId);
    }).finally(() => this.ensuring.delete(sessionId));
    this.ensuring.set(sessionId, run);
    return run;
  }

  /** Write data to the PTY (keystrokes, pasted text). */
  write(sessionId: string, data: string) {
    window.groveBench.ptyWrite(sessionId, data);
    // Enter: a command runs.
    if (data.includes('\r')) {
      this.commandUntil.set(sessionId, Date.now() + COMMAND_WINDOW_MS);
      this.awaitSettled(sessionId);
    }
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

  /** Kill and respawn the PTY (same as what happens on tab open). */
  async restart(sessionId: string): Promise<boolean> {
    return this.whileStarting(sessionId, async () => {
      await this.kill(sessionId);
      return this.spawn(sessionId);
    });
  }

  /** Check if the PTY is alive (queries main process). */
  async checkAlive(sessionId: string): Promise<boolean> {
    const alive = await window.groveBench.ptyIsAlive(sessionId);
    this.aliveBySession[sessionId] = alive;
    return alive;
  }
}

export const terminalStore = new TerminalStore();
