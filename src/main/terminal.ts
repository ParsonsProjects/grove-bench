import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import type { WebContents } from 'electron';
import { IPC } from '../shared/types.js';
import type { ShellOutputEvent } from '../shared/types.js';
import { logger } from './logger.js';

/** Strip ANSI escape sequences (colors, cursor movement, hyperlinks, etc.) */
function stripAnsi(text: string): string {
  // Covers: SGR (colors/bold), cursor movement, erase, OSC (hyperlinks/title), CSI sequences
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)|\x1B[()][0-9A-Z]|\x1B\[?[0-9;]*[hHlL]/g, '');
}

interface Execution {
  process: ChildProcess;
  sessionId: string;
  sender: WebContents;
}

class TerminalManager {
  private executions = new Map<string, Execution>();

  /** Spawn a shell command and stream output via IPC. Returns the execId. */
  spawnCommand(sessionId: string, command: string, cwd: string, sender: WebContents): string {
    const execId = crypto.randomUUID().slice(0, 8);
    const channel = `${IPC.SHELL_OUTPUT}:${sessionId}`;

    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd.exe' : '/bin/bash';
    const args = isWin ? ['/c', command] : ['-c', command];

    const child = spawn(shell, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      windowsHide: true,
    });

    this.executions.set(execId, { process: child, sessionId, sender });

    // Buffer and batch output to avoid flooding IPC (16ms batching)
    const createBatcher = (stream: 'stdout' | 'stderr') => {
      let buffer = '';
      let timer: ReturnType<typeof setTimeout> | null = null;

      const flush = () => {
        timer = null;
        if (buffer && !sender.isDestroyed()) {
          const cleaned = stripAnsi(buffer);
          if (cleaned) {
            sender.send(channel, { execId, stream, data: cleaned } satisfies ShellOutputEvent);
          }
          buffer = '';
        }
      };

      return (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        if (!timer) {
          timer = setTimeout(flush, 16);
        }
      };
    };

    if (child.stdout) {
      child.stdout.on('data', createBatcher('stdout'));
    }
    if (child.stderr) {
      child.stderr.on('data', createBatcher('stderr'));
    }

    child.on('close', (exitCode) => {
      // Flush any remaining buffered output before sending exit
      setTimeout(() => {
        if (!sender.isDestroyed()) {
          sender.send(channel, { execId, stream: 'exit', exitCode: exitCode ?? 0 } satisfies ShellOutputEvent);
        }
        this.executions.delete(execId);
      }, 32);
    });

    child.on('error', (err) => {
      logger.error(`Shell execution error (${execId}):`, err.message);
      if (!sender.isDestroyed()) {
        sender.send(channel, { execId, stream: 'stderr', data: `Error: ${err.message}\n` } satisfies ShellOutputEvent);
        sender.send(channel, { execId, stream: 'exit', exitCode: 1 } satisfies ShellOutputEvent);
      }
      this.executions.delete(execId);
    });

    logger.info(`Shell spawn: execId=${execId}, session=${sessionId}, cmd="${command.slice(0, 80)}"`);
    return execId;
  }

  /** Kill a running execution */
  killExecution(execId: string): void {
    const exec = this.executions.get(execId);
    if (!exec) return;

    const { process: child } = exec;
    if (child.killed) return;

    if (process.platform === 'win32') {
      // On Windows, use taskkill to kill the process tree
      try {
        spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true });
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGTERM');
      // Force kill after 2s if still alive
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 2000);
    }
  }

  /** Write to a running process's stdin */
  sendInput(execId: string, data: string): void {
    const exec = this.executions.get(execId);
    if (!exec || !exec.process.stdin) return;
    exec.process.stdin.write(data);
  }

  /** Kill all executions for a session */
  async killAllForSession(sessionId: string): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [execId, exec] of this.executions) {
      if (exec.sessionId === sessionId) {
        promises.push(new Promise<void>((resolve) => {
          exec.process.on('close', () => resolve());
          this.killExecution(execId);
          // Don't wait forever
          setTimeout(resolve, 3000);
        }));
      }
    }

    await Promise.all(promises);
  }
}

export const terminalManager = new TerminalManager();
