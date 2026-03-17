import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import * as path from 'node:path';
import { logger } from '../logger.js';
import { toDockerPath, killContainer } from './docker-utils.js';

type SDKMessage = import('@anthropic-ai/claude-agent-sdk').SDKMessage;

export interface DockerSessionOpts {
  sessionId: string;
  worktreePath: string;
  /** Path to the main repo (needed to mount .git for worktree support) */
  repoPath: string;
  sdkVersion: string;
  /** System prompt to pass to the SDK */
  systemPrompt?: unknown;
  /** Permission mode for the SDK */
  permissionMode?: string;
  /** SDK sandbox config */
  sandbox?: Record<string, unknown> | null;
  /** Extra environment variables */
  extraEnv?: Record<string, string> | null;
  /** Append system prompt */
  appendSystemPrompt?: string | null;
  /** Auth env var to pass to the container (e.g. { key: 'ANTHROPIC_API_KEY', value: '...' }) */
  authEnv?: { key: string; value: string } | null;
}

export class DockerSession {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;
  private containerName: string;
  private ready = false;
  private aborted = false;
  private pendingInit: string | null = null;
  /** Error reported by the worker's exit message (before process exit). */
  private workerError: string | null = null;
  /** Captured stderr output for error reporting. */
  private stderrBuf = '';

  /** Called for each SDK message received from the container */
  onMessage: ((message: SDKMessage) => void) | null = null;
  /** Called when the container exits */
  onComplete: ((result: { isError: boolean; error?: string }) => void) | null = null;

  constructor(private opts: DockerSessionOpts) {
    this.containerName = `grove-subtask-${opts.sessionId}`;
  }

  /** Start the Docker container */
  start(): void {
    const { worktreePath, repoPath, sdkVersion, extraEnv, sessionId } = this.opts;
    const tag = `grove-sandbox:${sdkVersion}`;

    // Auth env var is resolved by the orchestrator and passed in via opts.authEnv
    const { authEnv } = this.opts;

    // Mount the main repo's .git directory so worktree git refs resolve inside the container.
    // The worker will rewrite the .git file to point to /repo-git/worktrees/<id>.
    const repoGitPath = path.join(repoPath, '.git');

    const args: string[] = [
      'run', '--rm', '-i',
      '--name', this.containerName,
      '--memory=2g', '--cpus=2', '--pids-limit=256',
      '--tmpfs', '/tmp:rw,size=512m',
      '--tmpfs', '/root:rw,size=256m',
      '-v', `${toDockerPath(worktreePath)}:/workspace`,
      '-v', `${toDockerPath(repoGitPath)}:/repo-git`,
      '-e', `HOME=/root`,
      '-e', `CI=true`,
      '-e', `npm_config_yes=true`,
      '-e', `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1`,
      '-e', `GROVE_WORKTREE_ID=${sessionId}`,
    ];

    // Pass auth credential
    if (authEnv) {
      args.push('-e', `${authEnv.key}=${authEnv.value}`);
    }

    // Pass extra env vars
    if (extraEnv) {
      for (const [key, value] of Object.entries(extraEnv)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    args.push(tag);

    logger.info(`[docker-session] Starting container: ${this.containerName}`);
    logger.debug(`[docker-session] docker ${args.join(' ')}`);

    this.proc = spawn('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse stdout as JSONL
    this.rl = createInterface({ input: this.proc.stdout! });
    this.rl.on('line', (line) => {
      this.handleLine(line);
    });

    // Log stderr and capture for error reporting
    this.proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      logger.debug(`[docker-session] ${this.containerName} stderr: ${text}`);
      // Keep last 2KB of stderr for error messages
      this.stderrBuf += text + '\n';
      if (this.stderrBuf.length > 2048) {
        this.stderrBuf = this.stderrBuf.slice(-2048);
      }
    });

    // Handle process exit
    this.proc.on('exit', (code) => {
      logger.info(`[docker-session] Container ${this.containerName} exited with code ${code}`);
      this.rl?.close();
      this.rl = null;
      this.proc = null;

      if (this.onComplete && !this.aborted) {
        const isError = code !== 0 || !!this.workerError;
        const stderrTail = this.stderrBuf.trim();
        this.onComplete({
          isError,
          error: this.workerError
            ?? (code !== 0 ? `Container exited with code ${code}${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}` : undefined),
        });
      }
    });

    this.proc.on('error', (err) => {
      logger.error(`[docker-session] Container ${this.containerName} error:`, err);
      if (this.onComplete && !this.aborted) {
        this.onComplete({ isError: true, error: err.message });
      }
    });
  }

  private handleLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      logger.debug(`[docker-session] Non-JSON line from ${this.containerName}: ${line}`);
      return;
    }

    switch (msg.type) {
      case 'ready':
        this.ready = true;
        logger.info(`[docker-session] Container ${this.containerName} is ready`);
        // Flush any pending init that was queued before ready
        if (this.pendingInit !== null) {
          const prompt = this.pendingInit;
          this.pendingInit = null;
          this.sendInit(prompt);
        }
        break;

      case 'sdk_message':
        if (this.onMessage && msg.message) {
          this.onMessage(msg.message);
        }
        break;

      case 'exit':
        logger.info(`[docker-session] Container ${this.containerName} worker exited: code=${msg.code}, error=${msg.error}`);
        if (msg.error) {
          this.workerError = msg.error;
        }
        break;

      default:
        logger.debug(`[docker-session] Unknown message type from ${this.containerName}: ${msg.type}`);
    }
  }

  /** Send the init message to start the SDK query inside the container */
  sendInit(prompt: string): void {
    if (!this.proc?.stdin) {
      logger.warn(`[docker-session] Cannot send init — no process: ${this.containerName}`);
      return;
    }
    if (!this.ready) {
      // Container not ready yet — queue and send when "ready" arrives
      logger.debug(`[docker-session] Queuing init — container not ready yet: ${this.containerName}`);
      this.pendingInit = prompt;
      return;
    }

    const { systemPrompt, permissionMode, sandbox, appendSystemPrompt } = this.opts;

    const resolvedSystemPrompt = appendSystemPrompt
      ? { type: 'preset', preset: 'claude_code', append: appendSystemPrompt }
      : systemPrompt || { type: 'preset', preset: 'claude_code' };

    const initMsg = {
      type: 'init',
      prompt,
      systemPrompt: resolvedSystemPrompt,
      permissionMode: permissionMode || 'acceptEdits',
      sandbox: sandbox || null,
    };

    const payload = JSON.stringify(initMsg) + '\n';
    logger.info(`[docker-session] Sending init to ${this.containerName} (prompt length: ${prompt.length})`);
    const writeOk = this.proc.stdin.write(payload);
    if (!writeOk) {
      logger.warn(`[docker-session] stdin write returned false (backpressure) for ${this.containerName}`);
    }
  }

  /** Abort the running container */
  async abort(): Promise<void> {
    this.aborted = true;

    // Try sending abort message first
    if (this.proc?.stdin) {
      try {
        this.proc.stdin.write(JSON.stringify({ type: 'abort' }) + '\n');
      } catch { /* stdin may be closed */ }
    }

    // Kill the container
    await killContainer(this.containerName);

    // Clean up local state
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }

  get isReady(): boolean {
    return this.ready;
  }

  get isRunning(): boolean {
    return this.proc !== null && !this.aborted;
  }
}
