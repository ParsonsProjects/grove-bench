import { BrowserWindow, app } from 'electron';
import { IPC } from '../shared/types.js';
import type { SessionInfo, SessionStatus, AgentEvent, PermissionDecision } from '../shared/types.js';
import { logger } from './logger.js';
import { worktreeManager } from './worktree-manager.js';
import { killProcessOnPort } from './port-killer.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
type SDKMessage = import('@anthropic-ai/claude-agent-sdk').SDKMessage;
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
  /** Ports where dev servers were detected — cleaned up on session destroy */
  detectedPorts: Set<number>;
  /** Maps toolUseId → toolName for matching tool_results back to Bash calls */
  toolUseMap: Map<string, string>;
  /** Last result data for completion callback */
  lastResult: { isError: boolean; totalCostUsd?: number; durationMs?: number } | null;
  /** Parent session ID for nesting (orch subtasks). */
  parentSessionId: string | null;
  /** Associated orchestration job ID. */
  orchJobId: string | null;
  /** Permission mode for the SDK query. */
  permissionMode: 'default' | 'plan' | 'acceptEdits';
  /** Extra system prompt appended to the default claude_code preset. */
  appendSystemPrompt: string | null;
  /** Path to append-only event log on disk. */
  eventLogPath: string;
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

export interface SessionCompletionResult {
  sessionId: string;
  isError: boolean;
  totalCostUsd?: number;
  durationMs?: number;
}

const EVENTS_DIR = path.join(app.getPath('userData'), 'worktrees', 'events');

class AgentSessionManager {
  private sessions = new Map<string, ManagedSession>();
  private completionCallbacks = new Map<string, (result: SessionCompletionResult) => void>();
  private eventListeners = new Map<string, ((event: AgentEvent) => void)[]>();

  async createSession(opts: {
    id: string;
    branch: string;
    cwd: string;
    repoPath: string;
    window: BrowserWindow;
    resumeClaudeSessionId?: string;
    permissionMode?: 'default' | 'plan' | 'acceptEdits';
    parentSessionId?: string | null;
    orchJobId?: string | null;
    appendSystemPrompt?: string | null;
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
      detectedPorts: new Set(),
      toolUseMap: new Map(),
      lastResult: null,
      parentSessionId: opts.parentSessionId ?? null,
      orchJobId: opts.orchJobId ?? null,
      permissionMode: opts.permissionMode || 'default',
      appendSystemPrompt: opts.appendSystemPrompt ?? null,
      eventLogPath: path.join(EVENTS_DIR, `${id}.jsonl`),
    };

    this.sessions.set(id, session);

    // Ensure events directory exists
    try { fs.mkdirSync(EVENTS_DIR, { recursive: true }); } catch { /* already exists */ }

    // Emit helper — buffers events and persists them to JSONL on disk.
    const emit = (event: AgentEvent) => {
      logger.debug(`[emit] session=${id} event.type=${event.type}`);
      session.eventHistory.push(event);

      // Persist to disk (fire-and-forget, non-blocking)
      try {
        fs.appendFileSync(session.eventLogPath, JSON.stringify(event) + '\n');
      } catch { /* non-fatal */ }

      // Notify registered listeners (used by orchestrator for progress events)
      const listeners = this.eventListeners.get(id);
      if (listeners) {
        for (const cb of listeners) {
          try { cb(event); } catch { /* non-fatal */ }
        }
      }

      const w = session.window;
      if (!w.isDestroyed()) {
        const channel = `${IPC.AGENT_EVENT}:${id}`;
        logger.debug(`[emit] sending on channel=${channel}`);
        w.webContents.send(channel, event);
      } else {
        logger.debug(`[emit] window is destroyed, dropping event`);
      }
    };

    // Start the agent query in the background
    this.runQuery(session, emit).catch((err) => {
      console.error(`[runQuery] session=${id} FAILED:`, err);
      const errMsg = String(err.message || err);
      const isAuthError = /auth|unauthorized|401|403|invalid.*key|not.*logged|credential/i.test(errMsg);
      emit({ type: 'error', message: isAuthError
        ? 'Authentication failed. Please run "claude auth login" in your terminal and try again.'
        : errMsg });
      session.status = 'error';
      const w = session.window;
      if (!w.isDestroyed()) {
        w.webContents.send(IPC.SESSION_STATUS, id, 'error');
      }
      // Fire completion callback on error
      const errCb = this.completionCallbacks.get(id);
      if (errCb) {
        this.completionCallbacks.delete(id);
        errCb({ sessionId: id, isError: true });
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
      parentSessionId: session.parentSessionId,
      orchJobId: session.orchJobId,
    };
  }

  private async runQuery(
    session: ManagedSession,
    emit: (event: AgentEvent) => void,
  ) {
    const { id, worktreePath, abortController } = session;

    const pendingPermissions = session.pendingPermissions;

    let permRequestCounter = 0;

    logger.debug(`[runQuery] session=${id} starting`);
    const queryFn = await getQuery();
    logger.debug(`[runQuery] session=${id} SDK loaded`);
    const q = queryFn({
      prompt: readableStreamToAsyncIterable(session.inputStream!),
      options: {
        cwd: worktreePath,
        abortController,
        includePartialMessages: true,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: session.appendSystemPrompt
          ? { type: 'preset', preset: 'claude_code', append: session.appendSystemPrompt }
          : { type: 'preset', preset: 'claude_code' },
        permissionMode: session.permissionMode,
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
              decisionReason: options.decisionReason,
              suggestions: options.suggestions,
            });
          });
        },
        env: {
          ...process.env,
          CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
        },
        stderr: (data: string) => {
          logger.debug(`[claude-stderr] session=${id}: ${data.trim()}`);
        },
      },
    });

    session.queryInstance = q;
    logger.debug(`[runQuery] session=${id} query created, entering message loop`);

    // Process message stream
    try {
      for await (const message of q) {
        logger.debug(`[runQuery] session=${id} msg type=${message.type}`);
        if (abortController.signal.aborted) break;
        this.handleMessage(session, message, emit);
      }
      logger.debug(`[runQuery] session=${id} message loop ended normally`);
    } catch (err) {
      console.error(`[runQuery] session=${id} message loop error:`, err);
      const errMsg = (err as Error).message || String(err);
      const isAuthError = /auth|unauthorized|401|403|invalid.*key|not.*logged|credential/i.test(errMsg);
      if (isAuthError) {
        emit({ type: 'error', message: 'Authentication failed. Please run "claude auth login" in your terminal and try again.' });
      } else {
        emit({ type: 'error', message: `Query error: ${errMsg}` });
      }
    }

    // Query finished
    session.status = 'stopped';
    emit({ type: 'process_exit' });
    const w = session.window;
    if (!w.isDestroyed()) {
      w.webContents.send(IPC.SESSION_STATUS, id, 'stopped');
    }

    // Fire completion callback if registered (used by orchestrator)
    const cb = this.completionCallbacks.get(id);
    if (cb) {
      this.completionCallbacks.delete(id);
      cb({
        sessionId: id,
        isError: session.lastResult?.isError ?? false,
        totalCostUsd: session.lastResult?.totalCostUsd,
        durationMs: session.lastResult?.durationMs,
      });
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
            agents: (message as any).agents,
            skills: (message as any).skills,
            slashCommands: (message as any).slash_commands,
            mcpServers: (message as any).mcp_servers,
          });
          const w = session.window;
          if (!w.isDestroyed()) {
            w.webContents.send(IPC.SESSION_STATUS, session.id, 'running');
          }

        } else if (message.subtype === 'compact_boundary') {
          const meta = (message as any).compact_metadata ?? {};
          emit({
            type: 'compact_boundary',
            trigger: meta.trigger ?? 'manual',
            preTokens: meta.pre_tokens ?? 0,
          });
        } else if (message.subtype === 'status') {
          const m = message as any;
          if (m.status === 'compacting') {
            emit({ type: 'status', message: 'Compacting conversation...' });
          }
          // Sync permission mode from SDK (check both camelCase and snake_case)
          const modeValue = m.permissionMode ?? m.permission_mode;
          if (modeValue) {
            emit({ type: 'mode_sync', mode: modeValue });
          }
        } else if (message.subtype === 'local_command_output') {
          const content = (message as any).content;
          if (content) {
            emit({ type: 'status', message: content });
            // Detect mode changes from slash command output
            if (/mode.*plan/i.test(content) || /plan mode/i.test(content)) {
              emit({ type: 'mode_sync', mode: 'plan' });
            } else if (/mode.*code/i.test(content) || /code mode/i.test(content) || /default mode/i.test(content)) {
              emit({ type: 'mode_sync', mode: 'default' });
            } else if (/mode.*accept/i.test(content) || /acceptEdits/i.test(content) || /edit mode/i.test(content)) {
              emit({ type: 'mode_sync', mode: 'acceptEdits' });
            }
          }
        } else if (message.subtype === 'task_started') {
          const m = message as any;
          emit({
            type: 'task_started',
            taskId: m.task_id ?? '',
            toolUseId: m.tool_use_id,
            description: m.description ?? '',
            taskType: m.task_type,
          });
        } else if (message.subtype === 'task_progress') {
          const m = message as any;
          const usage = m.usage ?? {};
          emit({
            type: 'task_progress',
            taskId: m.task_id ?? '',
            toolUseId: m.tool_use_id,
            description: m.description ?? '',
            summary: m.summary,
            lastToolName: m.last_tool_name,
            totalTokens: usage.total_tokens ?? 0,
            toolUses: usage.tool_uses ?? 0,
            durationMs: usage.duration_ms ?? 0,
          });
        } else if (message.subtype === 'task_notification') {
          const m = message as any;
          const usage = m.usage ?? {};
          emit({
            type: 'task_notification',
            taskId: m.task_id ?? '',
            toolUseId: m.tool_use_id,
            taskStatus: m.status ?? 'completed',
            summary: m.summary ?? '',
            outputFile: m.output_file ?? '',
            totalTokens: usage.total_tokens,
            toolUses: usage.tool_uses,
            durationMs: usage.duration_ms,
          });
        } else if (message.subtype === 'hook_started') {
          const m = message as any;
          emit({
            type: 'hook_event',
            subtype: 'started',
            hookId: m.hook_id ?? '',
            hookName: m.hook_name ?? '',
            hookEvent: m.hook_event ?? '',
          });
        } else if (message.subtype === 'hook_progress') {
          const m = message as any;
          emit({
            type: 'hook_event',
            subtype: 'progress',
            hookId: m.hook_id ?? '',
            hookName: m.hook_name ?? '',
            hookEvent: m.hook_event ?? '',
            output: m.output || m.stdout || m.stderr || '',
          });
        } else if (message.subtype === 'hook_response') {
          const m = message as any;
          emit({
            type: 'hook_event',
            subtype: 'response',
            hookId: m.hook_id ?? '',
            hookName: m.hook_name ?? '',
            hookEvent: m.hook_event ?? '',
            output: m.output || m.stdout || m.stderr || '',
            outcome: m.outcome ?? 'success',
            exitCode: m.exit_code,
          });
        } else if (message.subtype === 'elicitation_complete') {
          const m = message as any;
          emit({
            type: 'elicitation_complete',
            serverName: m.mcp_server_name ?? '',
            elicitationId: m.elicitation_id ?? '',
          });
        } else if (message.subtype === 'files_persisted') {
          const m = message as any;
          emit({
            type: 'files_persisted',
            files: (m.files ?? []).map((f: any) => ({ filename: f.filename, fileId: f.file_id })),
            failed: m.failed ?? [],
          });
        } else {
          // Log unhandled system subtypes to help debug missing events
          const m = message as any;
          logger.debug(`[handleMessage] session=${session.id} unhandled system subtype=${message.subtype} keys=${Object.keys(m).join(',')}`);
          // Try to extract permission mode from any system message
          const modeVal = m.permissionMode ?? m.permission_mode ?? m.mode;
          if (modeVal && typeof modeVal === 'string') {
            emit({ type: 'mode_sync', mode: modeVal as any });
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
              // Track tool name for matching results later
              session.toolUseMap.set(block.id, block.name);
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
        // Emit usage info if available
        const usage = (message.message as any)?.usage;
        if (usage) {
          emit({
            type: 'usage',
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            cacheReadTokens: usage.cache_read_input_tokens,
            cacheCreationTokens: usage.cache_creation_input_tokens,
          });
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
              // Detect localhost URLs in Bash tool output
              const toolName = session.toolUseMap.get(block.tool_use_id);
              if (toolName === 'Bash' && resultContent) {
                const portMatches = resultContent.matchAll(
                  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d+)/g
                );
                for (const m of portMatches) {
                  const port = parseInt(m[1], 10);
                  if (!session.detectedPorts.has(port)) {
                    session.detectedPorts.add(port);
                    const url = m[0].replace(/0\.0\.0\.0|\[::\]/, 'localhost');
                    logger.info(`Dev server detected on port ${port} in session ${session.id}`);
                    emit({ type: 'devserver_detected', port, url: `http://localhost:${port}` });
                  }
                }
              }
            }
          }
        }
        break;
      }

      case 'result': {
        // Extract contextWindow from modelUsage (first model entry)
        const modelUsage = (message as any).modelUsage as Record<string, { contextWindow?: number }> | undefined;
        const contextWindow = modelUsage
          ? Object.values(modelUsage)[0]?.contextWindow
          : undefined;
        // Store for completion callback
        session.lastResult = {
          isError: message.is_error,
          totalCostUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
        };
        emit({
          type: 'result',
          subtype: message.subtype,
          result: 'result' in message ? (message as any).result : undefined,
          totalCostUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
          isError: message.is_error,
          errors: 'errors' in message ? (message as any).errors : undefined,
          numTurns: message.num_turns,
          contextWindow,
        });
        break;
      }

      case 'tool_progress': {
        const m = message as any;
        emit({
          type: 'tool_progress',
          toolName: m.tool_name ?? '',
          toolUseId: m.tool_use_id ?? '',
          elapsedSeconds: m.elapsed_time_seconds ?? 0,
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
          } else if (delta?.type === 'thinking_delta') {
            emit({ type: 'activity', activity: 'thinking' });
          }
        } else if (event.type === 'content_block_start') {
          const block = (event as any).content_block;
          if (block?.type === 'thinking') {
            emit({ type: 'activity', activity: 'thinking' });
          } else if (block?.type === 'text') {
            emit({ type: 'activity', activity: 'generating' });
          } else if (block?.type === 'tool_use') {
            emit({ type: 'activity', activity: 'tool_starting', toolName: block.name });
          }
        } else if (event.type === 'message_start') {
          emit({ type: 'activity', activity: 'generating' });
        }
        break;
      }

      case 'auth_status': {
        const m = message as any;
        emit({
          type: 'auth_status',
          isAuthenticating: m.isAuthenticating ?? false,
          output: m.output ?? [],
          authError: m.error,
        });
        break;
      }

      case 'tool_use_summary': {
        const m = message as any;
        emit({
          type: 'tool_use_summary',
          summary: m.summary ?? '',
          toolUseIds: m.preceding_tool_use_ids ?? [],
        });
        break;
      }

      case 'rate_limit_event': {
        const m = message as any;
        const info = m.rate_limit_info ?? {};
        emit({
          type: 'rate_limit',
          status: info.status ?? 'allowed',
          resetsAt: info.resets_at ?? info.resetsAt,
          utilization: info.utilization,
          rateLimitType: info.rate_limit_type ?? info.rateLimitType,
        });
        break;
      }

      case 'prompt_suggestion': {
        const m = message as any;
        emit({
          type: 'prompt_suggestion',
          suggestion: m.suggestion ?? '',
        });
        break;
      }

      default:
        // Ignore other message types
        break;
    }
  }

  sendMessage(id: string, content: string, images?: import('../shared/types.js').ImageAttachment[]): void {
    const session = this.sessions.get(id);
    if (!session?.inputController) {
      logger.debug(`[sendMessage] session=${id} no session or inputController`);
      return;
    }

    // Record in event history so user messages survive renderer refresh
    session.eventHistory.push({ type: 'user_message', text: content });

    // Build content: plain string when no images, content block array when images attached
    let messageContent: string | Array<Record<string, unknown>> = content;
    if (images && images.length > 0) {
      const blocks: Array<Record<string, unknown>> = [];
      for (const img of images) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        });
      }
      blocks.push({ type: 'text', text: content });
      messageContent = blocks;
    }

    const sessionId = session.claudeSessionId ?? '';
    logger.debug(`[sendMessage] session=${id} enqueuing to SDK, claudeSessionId=${sessionId || '(not yet initialized)'}${images?.length ? ` with ${images.length} image(s)` : ''}`);
    try {
      session.inputController.enqueue({
        type: 'user',
        session_id: sessionId,
        message: {
          role: 'user',
          content: messageContent,
        },
        parent_tool_use_id: null,
      } as SDKUserMessage);
      logger.debug(`[sendMessage] session=${id} enqueued successfully`);
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
      const result: any = { behavior: 'allow', updatedInput: pending.toolInput };
      if (decision.updatedPermissions) {
        result.updatedPermissions = decision.updatedPermissions;
      }
      pending.resolve(result);
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

  async setModel(id: string, model?: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session?.queryInstance) return;
    try {
      await session.queryInstance.setModel(model);
    } catch (e) {
      logger.warn(`Failed to set model for session ${id}:`, e);
      throw e;
    }
  }

  async setThinking(id: string, enabled: boolean): Promise<void> {
    const session = this.sessions.get(id);
    if (!session?.queryInstance) return;
    try {
      await session.queryInstance.setMaxThinkingTokens(enabled ? null : 0);
    } catch (e) {
      logger.warn(`Failed to set thinking for session ${id}:`, e);
      throw e;
    }
  }

  renameBranch(id: string, newBranch: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.branch = newBranch;
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

    // Kill any dev servers that were detected during this session
    if (session.detectedPorts.size > 0) {
      logger.info(`Killing ${session.detectedPorts.size} dev server(s) for session ${id}: ports ${[...session.detectedPorts].join(', ')}`);
      await Promise.all(
        [...session.detectedPorts].map((port) => killProcessOnPort(port).catch(() => {}))
      );
    }

    // Clean up completion callback and event listeners
    this.completionCallbacks.delete(id);
    this.eventListeners.delete(id);

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
      parentSessionId: s.parentSessionId,
      orchJobId: s.orchJobId,
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

  /** Register a one-time callback for when a session's query completes. */
  onComplete(id: string, callback: (result: SessionCompletionResult) => void): void {
    this.completionCallbacks.set(id, callback);
  }

  /** Register a listener for all events on a session (used by orchestrator for progress). */
  onEvent(id: string, callback: (event: AgentEvent) => void): void {
    const list = this.eventListeners.get(id) ?? [];
    list.push(callback);
    this.eventListeners.set(id, list);
  }

  /** Return all buffered events for replay after renderer reload. Falls back to disk log. */
  getEventHistory(id: string): AgentEvent[] {
    const session = this.sessions.get(id);
    if (session) return session.eventHistory;

    // Fall back to reading from disk
    const logPath = path.join(EVENTS_DIR, `${id}.jsonl`);
    try {
      const data = fs.readFileSync(logPath, 'utf-8');
      return data.split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  get count(): number {
    return this.sessions.size;
  }
}

export const sessionManager = new AgentSessionManager();
