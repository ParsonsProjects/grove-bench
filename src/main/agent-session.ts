import crypto from 'node:crypto';
import { BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import type { SessionInfo, SessionStatus, ClaudeEvent, PermissionRequest } from '../shared/types.js';
import { worktreeManager } from './worktree-manager.js';
import { MessageQueue } from './message-queue.js';
import { logger } from './logger.js';

interface ManagedSession {
  id: string;
  branch: string;
  worktreePath: string;
  repoPath: string;
  status: SessionStatus;
  agentType: 'claude-code';
  createdAt: number;
  messageQueue: MessageQueue | null;
  queryRunning: boolean;
  abortController: AbortController | null;
  claudeSessionId: string | null;
  window: BrowserWindow | null;
}

interface PendingPermission {
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  resolve: (result: { behavior: string; updatedInput?: unknown; message?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

class AgentSessionManager {
  private sessions = new Map<string, ManagedSession>();
  private pendingPermissions = new Map<string, PendingPermission>();

  createSession(opts: {
    id: string;
    branch: string;
    cwd: string;
    repoPath: string;
    window: BrowserWindow;
    claudeSessionId?: string;
  }): SessionInfo {
    const { id, branch, cwd, repoPath, window: win, claudeSessionId } = opts;

    const session: ManagedSession = {
      id,
      branch,
      worktreePath: cwd,
      repoPath,
      status: 'idle',
      agentType: 'claude-code',
      createdAt: Date.now(),
      messageQueue: null,
      queryRunning: false,
      abortController: null,
      claudeSessionId: claudeSessionId ?? null,
      window: win,
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

  async sendMessage(id: string, message: string, window: BrowserWindow): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    if (session.status === 'busy') throw new Error(`Session ${id} is busy`);

    session.status = 'busy';
    session.window = window;
    this.emitStatus(session, window);

    if (!session.queryRunning) {
      this.startQueryLoop(session, window, message);
    } else {
      // Push into existing query loop
      session.messageQueue!.push(message);
    }
  }

  private async startQueryLoop(session: ManagedSession, window: BrowserWindow, firstMessage: string): Promise<void> {
    session.queryRunning = true;
    session.messageQueue = new MessageQueue();
    session.abortController = new AbortController();

    // Push the first message
    session.messageQueue.push(firstMessage);

    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      const q = query({
        prompt: session.messageQueue,
        options: {
          cwd: session.worktreePath,
          resume: session.claudeSessionId || undefined,
          includePartialMessages: true,
          abortController: session.abortController,
          canUseTool: async (toolName: string, input: Record<string, unknown>) => {
            return this.requestPermission(session.id, window, toolName, input);
          },
        },
      });

      for await (const message of q) {
        if (window.isDestroyed()) break;

        const events = this.translateToClaudeEvents(message, session);
        for (const event of events) {
          window.webContents.send(`${IPC.CLAUDE_EVENT}:${session.id}`, event);
        }

        // Extract session_id from init message
        if (message.type === 'system' && (message as { subtype?: string }).subtype === 'init') {
          const sid = (message as { session_id?: string }).session_id;
          if (sid && !session.claudeSessionId) {
            session.claudeSessionId = sid;
            logger.info(`Session ${session.id} got claude session_id: ${sid}`);
            worktreeManager.setClaudeSessionId(session.id, sid).catch((err) => {
              logger.warn(`Failed to persist claudeSessionId for ${session.id}:`, err);
            });
          }
        }

        // On result message, set status back to idle
        if (message.type === 'result') {
          session.status = 'idle';
          this.emitStatus(session, window);
        }
      }
    } catch (err: unknown) {
      // Don't treat abort as an error
      if (err instanceof Error && err.name === 'AbortError') {
        logger.info(`Query loop aborted for session ${session.id}`);
      } else {
        session.status = 'error';
        logger.error(`Query loop error for session ${session.id}:`, err);
        if (!window.isDestroyed()) {
          const errorEvent: ClaudeEvent = {
            type: 'error',
            error: `Agent error: ${err instanceof Error ? err.message : String(err)}`,
          };
          window.webContents.send(`${IPC.CLAUDE_EVENT}:${session.id}`, errorEvent);
        }
        this.emitStatus(session, window);
      }
    } finally {
      session.queryRunning = false;
      session.messageQueue = null;
      session.abortController = null;
    }
  }

  /**
   * Translate SDK message types to ClaudeEvent shapes the renderer already handles.
   */
  private translateToClaudeEvents(message: Record<string, unknown>, session: ManagedSession): ClaudeEvent[] {
    switch (message.type) {
      case 'system': {
        // SDKSystemMessage — init subtype has session_id
        return [{
          type: 'system',
          subtype: message.subtype,
          session_id: message.session_id,
        }];
      }

      case 'assistant': {
        // SDKAssistantMessage — message field is an APIAssistantMessage
        // with .content[] containing text and tool_use blocks
        return [{
          type: 'assistant',
          message: message.message,
        }];
      }

      case 'stream_event': {
        // SDKPartialAssistantMessage — event field is a RawMessageStreamEvent
        // (content_block_start, content_block_delta, content_block_stop, etc.)
        const event = message.event as Record<string, unknown>;
        if (event && event.type) {
          return [event as ClaudeEvent];
        }
        return [];
      }

      case 'result': {
        // SDKResultMessage — has result string and session_id
        return [{
          type: 'result',
          subtype: message.subtype,
          result: message.result,
          session_id: message.session_id,
          is_error: message.is_error,
          duration_ms: message.duration_ms,
          num_turns: message.num_turns,
          total_cost_usd: message.total_cost_usd,
          usage: message.usage,
        }];
      }

      default:
        return [];
    }
  }

  /**
   * Request permission from the renderer. Returns a promise that resolves
   * when respondPermission() is called from the IPC handler.
   */
  private requestPermission(
    sessionId: string,
    window: BrowserWindow,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<{ behavior: string; updatedInput?: unknown; message?: string }> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();

      const timer = setTimeout(() => {
        this.pendingPermissions.delete(requestId);
        resolve({ behavior: 'deny', message: 'Permission request timed out' });
      }, 5 * 60 * 1000);

      this.pendingPermissions.set(requestId, { sessionId, toolName, input, resolve, timer });

      // Send to renderer
      if (!window.isDestroyed()) {
        const request: PermissionRequest = { sessionId, requestId, toolName, input };
        window.webContents.send(IPC.PERMISSION_REQUEST, request);
      } else {
        clearTimeout(timer);
        this.pendingPermissions.delete(requestId);
        resolve({ behavior: 'deny', message: 'Window destroyed' });
      }
    });
  }

  /**
   * Called from IPC handler when renderer responds to a permission request.
   */
  respondPermission(requestId: string, allowed: boolean): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingPermissions.delete(requestId);

    if (allowed) {
      pending.resolve({ behavior: 'allow', updatedInput: pending.input });
    } else {
      pending.resolve({ behavior: 'deny', message: 'User denied permission' });
    }
  }

  private emitStatus(session: ManagedSession, window: BrowserWindow): void {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.SESSION_STATUS, session.id, session.status);
    }
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;

    // Close the message queue
    if (session.messageQueue) {
      session.messageQueue.close();
    }

    // Abort the query loop
    if (session.abortController) {
      session.abortController.abort();
    }

    // Clear any pending permissions for this session
    for (const [reqId, pending] of this.pendingPermissions) {
      if (pending.sessionId === id) {
        clearTimeout(pending.timer);
        pending.resolve({ behavior: 'deny', message: 'Session destroyed' });
        this.pendingPermissions.delete(reqId);
      }
    }

    // Wait for query loop to wind down
    if (session.queryRunning) {
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
