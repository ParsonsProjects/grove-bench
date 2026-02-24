import { createRequire } from 'node:module';
import { BrowserWindow } from 'electron';
import { detectShell } from './shell-detect.js';
import { IPC } from '../shared/types.js';
import type { SessionInfo, SessionStatus } from '../shared/types.js';

// node-pty is a native module — must be required, not imported
const require_ = createRequire(import.meta.url);
const pty = require_('node-pty') as typeof import('node-pty');

interface ManagedSession {
  id: string;
  branch: string;
  worktreePath: string;
  repoPath: string;
  status: SessionStatus;
  agentType: 'claude-code';
  createdAt: number;
  ptyProcess: import('node-pty').IPty;
  dispose: () => void;
}

class AgentSessionManager {
  private sessions = new Map<string, ManagedSession>();
  private shell: string | null = null;

  private async getShell(): Promise<string> {
    if (!this.shell) {
      this.shell = await detectShell();
    }
    return this.shell;
  }

  async createSession(opts: {
    id: string;
    branch: string;
    cwd: string;
    repoPath: string;
    window: BrowserWindow;
  }): Promise<SessionInfo> {
    const shell = await this.getShell();
    const { id, branch, cwd, repoPath, window: win } = opts;

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd,
      env: {
        ...process.env,
        CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
      } as Record<string, string>,
    });

    // Batch PTY output at ~16ms intervals to avoid flooding IPC
    let outputBuffer = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (outputBuffer && !win.isDestroyed()) {
        win.webContents.send(`${IPC.TERM_DATA}:${id}`, outputBuffer);
        outputBuffer = '';
      }
      flushTimer = null;
    };

    const dataDisposable = ptyProcess.onData((data: string) => {
      outputBuffer += data;
      if (!flushTimer) {
        flushTimer = setTimeout(flush, 16);
      }
    });

    const exitDisposable = ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      const session = this.sessions.get(id);
      if (session) {
        session.status = 'stopped';
      }
      if (!win.isDestroyed()) {
        win.webContents.send(
          `${IPC.TERM_DATA}:${id}`,
          `\r\n\x1b[31m[Process exited with code ${exitCode}]\x1b[0m\r\n`
        );
        win.webContents.send(IPC.SESSION_STATUS, id, 'stopped');
      }
    });

    const dispose = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flush();
      }
      dataDisposable.dispose();
      exitDisposable.dispose();
    };

    const session: ManagedSession = {
      id,
      branch,
      worktreePath: cwd,
      repoPath,
      status: 'running',
      agentType: 'claude-code',
      createdAt: Date.now(),
      ptyProcess,
      dispose,
    };

    this.sessions.set(id, session);

    return {
      id: session.id,
      branch: session.branch,
      worktreePath: session.worktreePath,
      repoPath: session.repoPath,
      status: session.status,
      agentType: session.agentType,
      createdAt: session.createdAt,
    };
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session?.status === 'running') {
      session.ptyProcess.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session?.status === 'running') {
      session.ptyProcess.resize(cols, rows);
    }
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;

    session.dispose();

    if (session.status === 'running') {
      session.ptyProcess.kill();
      // Wait for Windows file handles to release
      await new Promise((r) => setTimeout(r, 500));
    }

    this.sessions.delete(id);
  }

  async destroyAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.destroySession(id)));
  }

  listSessions(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      branch: s.branch,
      worktreePath: s.worktreePath,
      repoPath: s.repoPath,
      status: s.status,
      agentType: s.agentType,
      createdAt: s.createdAt,
    }));
  }

  getSessionsByRepo(repoPath: string): ManagedSession[] {
    return [...this.sessions.values()].filter((s) => s.repoPath === repoPath);
  }

  getSession(id: string): ManagedSession | undefined {
    return this.sessions.get(id);
  }

  get count(): number {
    return this.sessions.size;
  }
}

export const sessionManager = new AgentSessionManager();
