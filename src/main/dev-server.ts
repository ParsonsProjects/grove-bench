import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { logger } from './logger.js';
import type { DevServerSuccess, DevServerResult } from '../shared/types.js';

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d+)/g;
const DETECT_TIMEOUT_MS = 30_000;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
/** Allow common dev commands but reject shell metacharacters. */
const SAFE_COMMAND_RE = /^[\w./@:=+, -]+$/;

/** @deprecated Use DevServerSuccess from shared/types instead */
export type DevServerInfo = DevServerSuccess;

const MAX_OUTPUT_LINES = 30;

export class DevServer {
  private proc: ChildProcess | null = null;
  private detectedPorts = new Set<number>();
  private recentOutput: string[] = [];

  constructor(
    private sessionId: string,
    private cwd: string,
    private command: string,
    private onDetected: (info: DevServerInfo) => void,
  ) {}

  private captureOutput(text: string) {
    const lines = text.split('\n').filter((l) => l.trim());
    this.recentOutput.push(...lines);
    if (this.recentOutput.length > MAX_OUTPUT_LINES) {
      this.recentOutput = this.recentOutput.slice(-MAX_OUTPUT_LINES);
    }
  }

  private getRecentOutput(): string {
    return this.recentOutput.join('\n');
  }

  get isRunning(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  get ports(): Set<number> {
    return this.detectedPorts;
  }

  /** Start the dev server process. Resolves when the URL is detected or after timeout. */
  start(): Promise<DevServerResult> {
    // Validate command to prevent shell injection
    if (!SAFE_COMMAND_RE.test(this.command)) {
      throw new Error(`Dev command contains invalid characters: "${this.command}"`);
    }

    return new Promise((resolve) => {
      let resolved = false;
      this.recentOutput = [];

      const isWin = process.platform === 'win32';
      this.proc = spawn(this.command, [], {
        cwd: this.cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        // On Windows, spawn in a new process group so we can kill the tree
        ...(isWin ? { windowsHide: true } : {}),
      });

      const pid = this.proc.pid;
      logger.info(`[dev-server] session=${this.sessionId} started pid=${pid} cmd="${this.command}"`);

      const handleData = (data: Buffer) => {
        const text = data.toString().replace(ANSI_RE, '');
        this.captureOutput(text);
        logger.debug(`[dev-server] session=${this.sessionId} output: ${text.trim().slice(0, 200)}`);
        for (const match of text.matchAll(URL_RE)) {
          const port = parseInt(match[1], 10);
          if (this.detectedPorts.has(port)) continue;
          this.detectedPorts.add(port);
          const url = `http://localhost:${port}`;
          logger.info(`[dev-server] session=${this.sessionId} detected port ${port}`);
          this.onDetected({ port, url });
          if (!resolved) {
            resolved = true;
            resolve({ port, url });
          }
        }
      };

      this.proc.stdout?.on('data', handleData);
      this.proc.stderr?.on('data', handleData);

      this.proc.on('error', (err) => {
        logger.error(`[dev-server] session=${this.sessionId} error:`, err);
        if (!resolved) {
          resolved = true;
          resolve({ reason: 'error', exitCode: null, lastOutput: this.getRecentOutput(), errorMessage: err.message });
        }
      });

      this.proc.on('exit', (code) => {
        logger.info(`[dev-server] session=${this.sessionId} exited code=${code}`);
        this.proc = null;
        if (!resolved) {
          resolved = true;
          resolve({ reason: 'exited', exitCode: code ?? null, lastOutput: this.getRecentOutput() });
        }
      });

      // Timeout — resolve with failure info but keep process running
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          logger.info(`[dev-server] session=${this.sessionId} URL detection timed out after ${DETECT_TIMEOUT_MS}ms`);
          resolve({ reason: 'timeout', exitCode: null, lastOutput: this.getRecentOutput() });
        }
      }, DETECT_TIMEOUT_MS);
    });
  }

  /** Stop the dev server process. */
  stop(): Promise<void> {
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) {
      this.proc = null;
      return Promise.resolve();
    }

    const pid = proc.pid;
    logger.info(`[dev-server] session=${this.sessionId} stopping pid=${pid}`);

    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        proc.removeListener('exit', finish);
        this.proc = null;
        resolve();
      };

      proc.once('exit', finish);

      if (process.platform === 'win32' && pid) {
        // Kill entire process tree on Windows
        execFile('taskkill', ['/F', '/T', '/PID', String(pid)], () => {
          setTimeout(finish, 3000);
        });
      } else {
        try {
          proc.kill('SIGTERM');
        } catch { /* pid may be invalid */ }
        setTimeout(() => {
          try {
            if (this.proc && this.proc.exitCode === null) {
              proc.kill('SIGKILL');
            }
          } catch { /* already dead */ }
        }, 2000);
        setTimeout(finish, 3000);
      }
    });
  }
}
