import { BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import type { SessionInfo, SessionStatus, AgentEvent, PermissionDecision } from '../shared/types.js';
import { logger } from './logger.js';
import { worktreeManager } from './worktree-manager.js';

// The Agent SDK is ESM-only; Electron's main process is CJS.
// Use Function constructor to create a dynamic import that Rollup/Vite
// won't transform into require().
const dynamicImport = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@anthropic-ai/claude-agent-sdk')>;

let _query: typeof import('@anthropic-ai/claude-agent-sdk').query;
async function getQuery() {
  if (!_query) {
    const sdk = await dynamicImport('@anthropic-ai/claude-agent-sdk');
    _query = sdk.query;
  }
  return _query;
}

// Re-declare the types we need (type-only imports are erased at runtime)
type Query = import('@anthropic-ai/claude-agent-sdk').Query;
type SDKMessage = Awaited<ReturnType<Query[typeof Symbol.asyncIterator]>['next']>['value'];
type SDKUserMessage = Extract<SDKMessage, { type: 'user' }>;

interface PendingPermission {
  requestId: string;
  toolName: string;
  toolUseId: string;
  toolInput: Record<string, unknown>;
  resolve: (result: { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }) => void;
}

interface ManagedSession {
  id: string;
  branch: string;
  worktreePath: string;
  repoPath: string;
  status: SessionStatus;
  agentType: 'claude-code';
  createdAt: number;
  queryInstance: Query | null;
  abortController: AbortController;
  inputController: ReadableStreamDefaultController<SDKUserMessage> | null;
  inputStream: ReadableStream<SDKUserMessage> | null;
  pendingPermissions: Map<string, PendingPermission>;
  /** Tools the user has chosen to always allow for this session */
  alwaysAllowedTools: Set<string>;
  claudeSessionId: string | null;
  window: BrowserWindow;
  /** Buffered events for replay after renderer reload */
  eventHistory: AgentEvent[];
}

/**
 * Creates an AsyncIterable from a ReadableStream so we can pass
 * it to query()'s prompt parameter for multi-turn conversations.
 */
function readableStreamToAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const reader = stream.getReader();
      return {
        async next() {
          const { done, value } = await reader.read();
          if (done) return { done: true, value: undefined as any };
          return { done: false, value };
        },
        async return() {
          reader.releaseLock();
          return { done: true, value: undefined as any };
        },
        async throw(e: unknown) {
          reader.cancel(e instanceof Error ? e.message : String(e));
          return { done: true, value: undefined as any };
        },
      };
    },
  };
}

class AgentSessionManager {
  private sessions = new Map<string, ManagedSession>();

  async createSession(opts: {
    id: string;
    branch: string;
    cwd: string;
    repoPath: string;
    window: BrowserWindow;
    resumeClaudeSessionId?: string;
  }): Promise<SessionInfo> {
    const { id, branch, cwd, repoPath, window: win } = opts;

    const abortController = new AbortController();

    // Create a stream for multi-turn input
    let inputController: ReadableStreamDefaultController<SDKUserMessage> | null = null;
    const inputStream = new ReadableStream<SDKUserMessage>({
      start(controller) {
        inputController = controller;
      },
    });

    const session: ManagedSession = {
      id,
      branch,
      worktreePath: cwd,
      repoPath,
      status: 'starting',
      agentType: 'claude-code',
      createdAt: Date.now(),
      queryInstance: null,
      abortController,
      inputController,
      inputStream,
      pendingPermissions: new Map(),
      alwaysAllowedTools: new Set(),
      claudeSessionId: opts.resumeClaudeSessionId || null,
      window: win,
      eventHistory: [],
    };

    this.sessions.set(id, session);

    // Emit helper — always reads session.window so it picks up re-attached windows.
    // Also buffers every event so they can be replayed after renderer reload.
    const emit = (event: AgentEvent) => {
      console.log(`[emit] session=${id} event.type=${event.type}`);
      session.eventHistory.push(event);
      const w = session.window;
      if (!w.isDestroyed()) {
        const channel = `${IPC.AGENT_EVENT}:${id}`;
        console.log(`[emit] sending on channel=${channel}`);
        w.webContents.send(channel, event);
      } else {
        console.log(`[emit] window is destroyed, dropping event`);
      }
    };

    // Start the agent query in the background
    this.runQuery(session, emit).catch((err) => {
      console.error(`[runQuery] session=${id} FAILED:`, err);
      emit({ type: 'error', message: String(err.message || err) });
      session.status = 'error';
      const w = session.window;
      if (!w.isDestroyed()) {
        w.webContents.send(IPC.SESSION_STATUS, id, 'error');
      }
    });

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

  private async runQuery(
    session: ManagedSession,
    emit: (event: AgentEvent) => void,
  ) {
    const { id, worktreePath, abortController } = session;

    const pendingPermissions = session.pendingPermissions;

    let permRequestCounter = 0;

    console.log(`[runQuery] session=${id} starting`);
    const queryFn = await getQuery();
    console.log(`[runQuery] session=${id} SDK loaded`);
    const q = queryFn({
      prompt: readableStreamToAsyncIterable(session.inputStream!),
      options: {
        cwd: worktreePath,
        abortController,
        includePartialMessages: true,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        permissionMode: 'default',
        // Resume previous conversation if we have a saved session ID
        ...(session.claudeSessionId ? { resume: session.claudeSessionId } : {}),
        canUseTool: async (toolName, input, options) => {
          // Auto-approve if user previously chose "Always Allow" for this tool
          if (session.alwaysAllowedTools.has(toolName)) {
            return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
          }
          // Forward permission request to renderer and wait for user response.
          // Times out after 5 minutes to prevent leaked promises if window closes.
          const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;
          const requestId = `perm_${id}_${++permRequestCounter}`;
          return new Promise((resolve) => {
            const timer = setTimeout(() => {
              pendingPermissions.delete(requestId);
              resolve({ behavior: 'deny', message: 'Permission request timed out' });
            }, PERMISSION_TIMEOUT_MS);

            pendingPermissions.set(requestId, {
              requestId,
              toolName,
              toolUseId: options.toolUseID,
              toolInput: input as Record<string, unknown>,
              resolve: (result) => {
                clearTimeout(timer);
                resolve(result);
              },
            });
            emit({
              type: 'permission_request',
              toolName,
              toolInput: input,
              toolUseId: options.toolUseID,
              requestId,
            });
          });
        },
        env: {
          ...process.env,
          CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
        },
        stderr: (data: string) => {
          console.log(`[claude-stderr] session=${id}: ${data.trim()}`);
        },
      },
    });

    session.queryInstance = q;
    console.log(`[runQuery] session=${id} query created, entering message loop`);

    // Process message stream
    try {
      for await (const message of q) {
        console.log(`[runQuery] session=${id} msg type=${message.type}`);
        if (abortController.signal.aborted) break;
        this.handleMessage(session, message, emit);
      }
      console.log(`[runQuery] session=${id} message loop ended normally`);
    } catch (err) {
      console.error(`[runQuery] session=${id} message loop error:`, err);
      emit({ type: 'error', message: `Query error: ${(err as Error).message || err}` });
    }

    // Query finished
    session.status = 'stopped';
    emit({ type: 'process_exit' });
    const w = session.window;
    if (!w.isDestroyed()) {
      w.webContents.send(IPC.SESSION_STATUS, id, 'stopped');
    }
  }

  private handleMessage(
    session: ManagedSession,
    message: SDKMessage,
    emit: (event: AgentEvent) => void,
  ) {
    switch (message.type) {
      case 'system': {
        if (message.subtype === 'init') {
          session.status = 'running';
          session.claudeSessionId = message.session_id;

          // Persist Claude session ID so we can resume after app restart
          worktreeManager.saveClaudeSessionId(session.id, message.session_id).catch((e) => {
            logger.warn(`Failed to persist Claude session ID for ${session.id}:`, e);
          });

          emit({
            type: 'system_init',
            sessionId: message.session_id,
            model: message.model,
            tools: message.tools,
          });
          const w = session.window;
          if (!w.isDestroyed()) {
            w.webContents.send(IPC.SESSION_STATUS, session.id, 'running');
          }

        }
        break;
      }

      case 'assistant': {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              emit({ type: 'assistant_text', text: block.text, uuid: message.uuid });
            } else if (block.type === 'tool_use') {
              emit({
                type: 'assistant_tool_use',
                toolName: block.name,
                toolInput: block.input,
                toolUseId: block.id,
                uuid: message.uuid,
              });
            } else if (block.type === 'thinking') {
              emit({
                type: 'thinking',
                thinking: (block as any).thinking || '',
                uuid: message.uuid,
              });
            }
          }
        }
        break;
      }

      case 'user': {
        // Tool results come back as user messages
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              const resultContent = Array.isArray(block.content)
                ? block.content.map((c: any) => c.text || '').join('')
                : typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
              emit({
                type: 'tool_result',
                toolUseId: block.tool_use_id,
                content: resultContent,
                isError: block.is_error,
              });
            }
          }
        }
        break;
      }

      case 'result': {
        emit({
          type: 'result',
          subtype: message.subtype,
          result: 'result' in message ? (message as any).result : undefined,
          totalCostUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
          isError: message.is_error,
          errors: 'errors' in message ? (message as any).errors : undefined,
        });
        break;
      }

      case 'stream_event': {
        // Partial streaming events for real-time text display
        const event = message.event;
        if (event.type === 'content_block_delta') {
          const delta = (event as any).delta;
          if (delta?.type === 'text_delta' && delta.text) {
            emit({ type: 'partial_text', text: delta.text });
          }
        }
        break;
      }

      default:
        // Ignore other message types (compact_boundary, etc.)
        break;
    }
  }

  sendMessage(id: string, content: string): void {
    const session = this.sessions.get(id);
    if (!session?.inputController) {
      console.log(`[sendMessage] session=${id} no session or inputController`);
      return;
    }

    const sessionId = session.claudeSessionId ?? '';
    console.log(`[sendMessage] session=${id} enqueuing to SDK, claudeSessionId=${sessionId || '(not yet initialized)'}`);
    try {
      session.inputController.enqueue({
        type: 'user',
        session_id: sessionId,
        message: {
          role: 'user',
          content,
        },
        parent_tool_use_id: null,
      } as SDKUserMessage);
      console.log(`[sendMessage] session=${id} enqueued successfully`);
    } catch (e) {
      console.error(`[sendMessage] session=${id} enqueue FAILED:`, e);
      logger.warn(`Failed to send message to session ${id}:`, e);
    }
  }

  respondToPermission(id: string, decision: PermissionDecision): void {
    const session = this.sessions.get(id);
    if (!session) return;

    const pending = session.pendingPermissions.get(decision.requestId);
    if (!pending) return;

    session.pendingPermissions.delete(decision.requestId);

    if (decision.behavior === 'allow' || decision.behavior === 'allowAlways') {
      if (decision.behavior === 'allowAlways') {
        session.alwaysAllowedTools.add(pending.toolName);
      }
      pending.resolve({ behavior: 'allow', updatedInput: pending.toolInput });
    } else {
      pending.resolve({
        behavior: 'deny',
        message: decision.message || 'User denied permission',
      });
    }
  }

  setMode(id: string, mode: string): void {
    const session = this.sessions.get(id);
    if (!session?.queryInstance) return;
    try {
      session.queryInstance.setPermissionMode(mode as any);
    } catch (e) {
      logger.warn(`Failed to set mode for session ${id}:`, e);
    }
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;

    // Abort the query
    session.abortController.abort();

    // Close the input stream
    try {
      session.inputController?.close();
    } catch { /* may already be closed */ }

    // Close the query
    try {
      session.queryInstance?.close();
    } catch { /* may already be closed */ }

    // Resolve any pending permissions as denied
    for (const [, pending] of session.pendingPermissions) {
      pending.resolve({ behavior: 'deny', message: 'Session destroyed' });
    }

    // Wait for Windows file handles to release
    await new Promise((r) => setTimeout(r, 500));

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

  /**
   * Re-attach a new BrowserWindow to an existing running session.
   * Called after renderer reload so that IPC events flow to the new webContents.
   */
  reattachWindow(id: string, win: BrowserWindow): void {
    const session = this.sessions.get(id);
    if (session) {
      session.window = win;
    }
  }

  /** Return all buffered events for replay after renderer reload. */
  getEventHistory(id: string): AgentEvent[] {
    return this.sessions.get(id)?.eventHistory ?? [];
  }

  get count(): number {
    return this.sessions.size;
  }
}

export const sessionManager = new AgentSessionManager();
