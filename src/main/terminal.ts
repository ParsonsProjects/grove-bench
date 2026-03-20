import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { WebContents } from 'electron';
import { IPC } from '../shared/types.js';
import { logger } from './logger.js';

interface PtySession {
  pty: IPty;
  sessionId: string;
  sender: WebContents;
  cwd: string;
}

class TerminalManager {
  private sessions = new Map<string, PtySession>();

  /** Spawn a persistent PTY shell for a session. Returns true if spawned. */
  spawnPty(sessionId: string, cwd: string, sender: WebContents): boolean {
    // Kill existing PTY if any
    if (this.sessions.has(sessionId)) {
      this.killPty(sessionId);
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
        if (buffer && !sender.isDestroyed()) {
          sender.send(dataChannel, buffer);
          buffer = '';
        }
      };

      ptyProcess.onData((data: string) => {
        buffer += data;
        if (!flushTimer) {
          flushTimer = setTimeout(flush, 8);
        }
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        // Flush remaining data
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
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

  /** Kill a session's PTY. */
  killPty(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.pty.kill();
    } catch {
      // Already dead
    }
    this.sessions.delete(sessionId);
    logger.info(`PTY killed: session=${sessionId}`);
  }

  /** Kill and respawn the PTY for a session. If sender is provided, bind to the new WebContents. */
  restartPty(sessionId: string, sender?: WebContents): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const cwd = session.cwd;
    const activeSender = sender ?? session.sender;
    this.killPty(sessionId);
    return this.spawnPty(sessionId, cwd, activeSender);
  }

  /** Check if a session has a live PTY. */
  isAlive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Kill all PTYs for cleanup (app quit). */
  async killAll(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) {
      this.killPty(sessionId);
    }
  }

  /** Kill PTY for a specific session (session destroy). */
  async killAllForSession(sessionId: string): Promise<void> {
    this.killPty(sessionId);
  }
}

export const terminalManager = new TerminalManager();
