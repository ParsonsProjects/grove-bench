import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { WebContents } from 'electron';
import { IPC } from '../shared/types.js';
import { logger } from './logger.js';
import { killDescendants } from './process-tree.js';

interface PtySession {
  pty: IPty;
  sessionId: string;
  sender: WebContents;
  cwd: string;
}

export class TerminalManager {
  private sessions = new Map<string, PtySession>();

  /** Spawn a persistent PTY shell for a session. Returns true if spawned. */
  spawnPty(sessionId: string, cwd: string, sender: WebContents): boolean {
    // Kill existing PTY if any (it leaves the map synchronously)
    if (this.sessions.has(sessionId)) {
      void this.killPty(sessionId);
    }

    const isWin = process.platform === 'win32';
    const shell = isWin
      ? (process.env.COMSPEC || 'cmd.exe')
      : (process.env.SHELL || '/bin/bash');

    try {
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: Object.fromEntries(
          Object.entries(process.env).filter((e): e is [string, string] => e[1] != null)
        ),
      });

      const dataChannel = `${IPC.PTY_DATA}:${sessionId}`;
      const exitChannel = `${IPC.PTY_EXIT}:${sessionId}`;

      // Buffer output with 8ms batching to avoid IPC flooding
      let buffer = '';
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flush = () => {
        flushTimer = null;
        // Don't send data if this PTY has been replaced by a new one (restart)
        const current = this.sessions.get(sessionId);
        if (current?.pty !== ptyProcess) {
          buffer = '';
          return;
        }
        // Drop it when the window is gone too, or a chatty shell (a dev
        // server) would grow it for as long as it runs.
        if (buffer && !sender.isDestroyed()) sender.send(dataChannel, buffer);
        buffer = '';
      };

      ptyProcess.onData((data: string) => {
        buffer += data;
        if (!flushTimer) {
          flushTimer = setTimeout(flush, 8);
        }
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }

        // Only handle exit if this PTY is still the active one for the session.
        // During restart, a new PTY is already registered under the same sessionId —
        // we must not send stale data or exit events from the old PTY.
        const current = this.sessions.get(sessionId);
        if (current?.pty !== ptyProcess) {
          buffer = '';
          logger.info(`PTY exited (stale, ignored): session=${sessionId}, code=${exitCode}, signal=${signal}`);
          return;
        }

        // Flush remaining data
        if (buffer && !sender.isDestroyed()) {
          sender.send(dataChannel, buffer);
          buffer = '';
        }
        if (!sender.isDestroyed()) {
          sender.send(exitChannel, exitCode, signal);
        }
        this.sessions.delete(sessionId);
        logger.info(`PTY exited: session=${sessionId}, code=${exitCode}, signal=${signal}`);
      });

      this.sessions.set(sessionId, { pty: ptyProcess, sessionId, sender, cwd });
      logger.info(`PTY spawned: session=${sessionId}, shell=${shell}, cwd=${cwd}`);
      return true;
    } catch (err: any) {
      logger.error(`PTY spawn failed for session ${sessionId}:`, err.message);
      return false;
    }
  }

  /** Write data to a session's PTY (keystrokes, pasted text, commands). */
  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.pty.write(data);
  }

  /** Resize a session's PTY. */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.pty.resize(cols, rows);
    } catch {
      // Ignore resize errors on dead PTY
    }
  }

  /** Kill a session's PTY and everything started from it (dev servers,
   *  watchers), so their ports and file handles are released. */
  async killPty(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    // Remove from map BEFORE killing so that if onExit fires synchronously
    // during kill(), it won't find this session and won't send a stale exit event.
    this.sessions.delete(sessionId);
    // Children first: once the shell is gone they can't be traced back to it,
    // and on Windows they would keep running.
    const children = await killDescendants(session.pty.pid);
    try {
      session.pty.kill();
    } catch {
      // Already dead
    }
    logger.info(`PTY killed: session=${sessionId}, child processes killed=${children.length}`);
  }

  /** Check if a session has a live PTY. */
  isAlive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Number of live PTYs. */
  get count(): number {
    return this.sessions.size;
  }

  /** Kill all PTYs for cleanup (app quit). */
  async killAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.killPty(sessionId)));
  }

  /** Kill PTY for a specific session (conversation close or destroy). */
  async killAllForSession(sessionId: string): Promise<void> {
    await this.killPty(sessionId);
  }
}

export const terminalManager = new TerminalManager();
