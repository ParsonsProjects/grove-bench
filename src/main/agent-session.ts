import { BrowserWindow, app } from 'electron';
import { IPC } from '../shared/types.js';
import type { SessionInfo, SessionStatus, AgentEvent, PermissionDecision } from '../shared/types.js';
import { logger } from './logger.js';
import { worktreeManager } from './worktree-manager.js';
import { killProcessOnPort } from './port-killer.js';
import { DevServer } from './dev-server.js';
import { detectDevCommand } from './dev-command-detector.js';
import * as settings from './settings.js';
import * as memory from './memory.js';
import * as memoryAutosave from './memory-autosave.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adapterRegistry } from './adapters/index.js';
import type { AgentAdapter, AgentQueryHandle, PermissionResponse } from './adapters/types.js';
import { getGitIdentity } from './git.js';

interface PendingPermission {
  requestId: string;
  toolName: string;
  toolUseId: string;
  toolInput: Record<string, unknown>;
  resolve: (result: PermissionResponse) => void;
}

interface ManagedSession {
  id: string;
  branch: string;
  worktreePath: string;
  repoPath: string;
  status: SessionStatus;
  agentType: string;
  createdAt: number;
  adapter: AgentAdapter;
  queryHandle: AgentQueryHandle | null;
  abortController: AbortController;
  pendingPermissions: Map<string, PendingPermission>;
  /** Tools the user has chosen to always allow for this session */
  alwaysAllowedTools: Set<string>;
  providerSessionId: string | null;
  window: BrowserWindow;
  /** Buffered events for replay after renderer reload */
  eventHistory: AgentEvent[];
  /** Ports where dev servers were detected — cleaned up on session destroy */
  detectedPorts: Set<number>;
  /** Maps toolUseId → toolName for matching tool_results back to Bash calls */
  toolUseMap: Map<string, string>;
  /** Last result data for completion callback */
  lastResult: { isError: boolean; totalCostUsd?: number; durationMs?: number } | null;
  /** Permission mode for the SDK query. */
  permissionMode: 'default' | 'plan' | 'acceptEdits';
  /** Extra system prompt appended to the adapter's default prompt. */
  appendSystemPrompt: string | null;
  /** Fully custom system prompt — overrides the adapter's default entirely. */
  customSystemPrompt: string | null;
  /** If set, only these tools are allowed — everything else is auto-denied. */
  allowedTools: Set<string> | null;
  /** Force structured JSON output via json_schema. */
  outputFormat: { type: 'json_schema'; schema: Record<string, unknown> } | null;
  /** Sandbox settings for restricted Bash execution. */
  sandbox: Record<string, unknown> | null;
  /** Extra environment variables merged into the adapter query env. */
  extraEnv: Record<string, string> | null;
  /** Path to append-only event log on disk. */
  eventLogPath: string;
  /** User-assigned display name — shown instead of branch when set. */
  displayName: string | null;
  /** Host-managed dev server instance. */
  devServer: DevServer | null;
  /** Set when the user clicks Stop — prevents runQuery from sending SESSION_STATUS 'stopped'. */
  stoppedByUser: boolean;
  /** Whether a memory auto-save is currently in progress. */
  autoSaveInProgress: boolean;
  /** Emit function for sending events to the renderer — set by createEmitter. */
  emit: ((event: AgentEvent) => void) | null;
  /** Monotonic counter for permission request IDs — persists across stopQuery restarts
   *  to avoid ID collisions with resolved permissions from previous query loops. */
  permRequestCounter: number;
  /** Guard against concurrent runQuery calls (e.g. rapid double-stop). */
  isStartingQuery: boolean;
}

export interface SessionCompletionResult {
  sessionId: string;
  isError: boolean;
  totalCostUsd?: number;
  durationMs?: number;
}

const getEventsDir = () => path.join(app.getPath('userData'), 'worktrees', 'events');

// Suppress "Operation aborted" unhandled rejections from agent SDKs.
// When we abort a running query, internal async operations may reject after
// the abort signal fires.  These are expected and safe to ignore.
process.on('unhandledRejection', (reason: unknown) => {
  if (reason instanceof Error && reason.message === 'Operation aborted') {
    logger.debug('[unhandledRejection] Suppressed expected SDK abort error');
    return;
  }
  // Re-throw anything else so it surfaces normally
  console.error('Unhandled promise rejection:', reason);
});

class AgentSessionManager {
  private sessions = new Map<string, ManagedSession>();
  private completionCallbacks = new Map<string, (result: SessionCompletionResult) => void>();
  private eventListeners = new Map<string, ((event: AgentEvent) => void)[]>();

  /** Create an emit function bound to a session — buffers events and persists them to JSONL on disk. */
  private createEmitter(session: ManagedSession): (event: AgentEvent) => void {
    const id = session.id;
    const emit = (event: AgentEvent) => {
      logger.debug(`[emit] session=${id} event.type=${event.type}`);
      session.eventHistory.push(event);

      // Persist to disk (fire-and-forget, non-blocking)
      try {
        fs.appendFileSync(session.eventLogPath, JSON.stringify(event) + '\n');
      } catch { /* non-fatal */ }

      // Notify registered listeners (used for progress events)
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
    session.emit = emit;
    return emit;
  }

  async createSession(opts: {
    id: string;
    branch: string;
    cwd: string;
    repoPath: string;
    window: BrowserWindow;
    resumeSessionId?: string;
    permissionMode?: 'default' | 'plan' | 'acceptEdits';
    appendSystemPrompt?: string | null;
    customSystemPrompt?: string | null;
    allowedTools?: string[] | null;
    outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> } | null;
    sandbox?: Record<string, unknown> | null;
    extraEnv?: Record<string, string> | null;
    adapterType?: string;
  }): Promise<SessionInfo> {
    const { id, branch, cwd, repoPath, window: win } = opts;

    // Look up the adapter (fall back to the registry default)
    const adapterType = opts.adapterType ?? adapterRegistry.getDefault().id;
    const adapter = adapterRegistry.get(adapterType);
    if (!adapter) throw new Error(`Unknown agent adapter: ${adapterType}`);

    const abortController = new AbortController();

    // Apply settings defaults for values not explicitly provided
    const appSettings = settings.getSettings();
    const effectivePermissionMode = opts.permissionMode
      || (appSettings.defaultPermissionMode === 'bypassPermissions' ? 'default' : appSettings.defaultPermissionMode)
      || 'default';
    // Inject project memory into the system prompt
    const memoryPrompt = memory.getMemoryForSystemPrompt(repoPath);
    const userAppend = opts.appendSystemPrompt ?? (appSettings.defaultSystemPromptAppend || null);
    const builtInPrompt = [
      'IMPORTANT PATH RULES — you are already in your project directory. Follow these strictly:',
      '- Use RELATIVE paths (e.g. "src/foo.ts") for ALL file operations: Read, Edit, Write, Grep, Glob. NEVER use absolute paths like "' + cwd.replace(/\\/g, '/').slice(0, 30) + '..." — just use paths relative to the project root.',
      '- When running Bash commands, use short command names (npm, npx, node, git) not absolute paths to binaries.',
      '- Do NOT use `cd` to navigate to your current working directory before running commands — you are already there.',
      '- If you see an absolute path in tool output or environment info, do NOT repeat it back in your tool calls. Convert it to a relative path from the project root.',
    ].join('\n');
    const effectiveAppendPrompt = [builtInPrompt, memoryPrompt, userAppend].filter(Boolean).join('\n\n') || null;

    // Ensure memory directory exists for this repo
    memory.ensureRepoMemory(repoPath);

    const session: ManagedSession = {
      id,
      branch,
      worktreePath: cwd,
      repoPath,
      status: 'starting',
      agentType: adapterType,
      createdAt: Date.now(),
      adapter,
      queryHandle: null,
      abortController,
      pendingPermissions: new Map(),
      alwaysAllowedTools: new Set(),
      providerSessionId: opts.resumeSessionId || null,
      window: win,
      eventHistory: this.loadEventHistory(id),
      detectedPorts: new Set(),
      toolUseMap: new Map(),
      lastResult: null,
      permissionMode: effectivePermissionMode,
      appendSystemPrompt: effectiveAppendPrompt,
      customSystemPrompt: opts.customSystemPrompt ?? null,
      allowedTools: opts.allowedTools ? new Set(opts.allowedTools) : null,
      outputFormat: opts.outputFormat ?? null,
      sandbox: opts.sandbox ?? null,
      extraEnv: opts.extraEnv ?? null,
      eventLogPath: path.join(getEventsDir(), `${id}.jsonl`),
      displayName: null,
      devServer: null,
      stoppedByUser: false,
      autoSaveInProgress: false,
      emit: null,
      permRequestCounter: 0,
      isStartingQuery: false,
    };

    this.sessions.set(id, session);

    // Ensure events directory exists
    try { fs.mkdirSync(getEventsDir(), { recursive: true }); } catch { /* already exists */ }

    const emit = this.createEmitter(session);

    this.runQuery(session, emit).catch((err) => {
        console.error(`[runQuery] session=${id} FAILED:`, err);
        const errMsg = String(err.message || err);
        const isAuthError = /auth|unauthorized|401|403|invalid.*key|not.*logged|credential/i.test(errMsg);
        emit({ type: 'error', message: isAuthError
          ? adapter.authErrorMessage
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
    };
  }

  private async runQuery(
    session: ManagedSession,
    emit: (event: AgentEvent) => void,
  ) {
    const { id, abortController } = session;

    // Guard against concurrent runQuery calls (e.g. rapid double-stop)
    if (session.isStartingQuery) {
      logger.warn(`[runQuery] session=${id} already starting — skipping duplicate`);
      return;
    }
    session.isStartingQuery = true;

    const pendingPermissions = session.pendingPermissions;

    logger.debug(`[runQuery] session=${id} starting`);
    // Build adapter config from session state + app settings
    const currentSettings = settings.getSettings();

    // Read the user's git identity so we can force it via env vars.
    // Environment variables take highest precedence in git's identity
    // resolution, ensuring commits are attributed to the user even if
    // the agent SDK sets its own git config.
    let gitIdentityEnv: Record<string, string> = {};
    try {
      const identity = await getGitIdentity(session.worktreePath);
      gitIdentityEnv = {
        GIT_AUTHOR_NAME: identity.name,
        GIT_AUTHOR_EMAIL: identity.email,
        GIT_COMMITTER_NAME: identity.name,
        GIT_COMMITTER_EMAIL: identity.email,
      };
    } catch { /* best effort */ }

    let handle: AgentQueryHandle;
    try {
    handle = await session.adapter.start({
      cwd: session.worktreePath,
      permissionMode: session.permissionMode,
      appendSystemPrompt: session.appendSystemPrompt,
      customSystemPrompt: session.customSystemPrompt,
      allowedTools: session.allowedTools,
      outputFormat: session.outputFormat,
      sandbox: session.sandbox,
      memoryOperations: {
        list: () => memory.listMemoryFiles(session.repoPath),
        read: (p) => memory.readMemoryFile(session.repoPath, p),
        write: (p, c) => memory.writeMemoryFile(session.repoPath, p, c),
        delete: (p) => memory.deleteMemoryFile(session.repoPath, p),
      },
      extraEnv: { ...gitIdentityEnv, ...(session.extraEnv ?? {}) },
      resumeSessionId: session.providerSessionId,
      toolAllowRules: currentSettings.toolAllowRules,
      toolDenyRules: currentSettings.toolDenyRules,
      alwaysAllowedTools: session.alwaysAllowedTools,
      onPermissionRequest: async (request) => {
        const PERMISSION_TIMEOUT_MS = 30 * 60 * 1000;
        const requestId = `perm_${id}_${++session.permRequestCounter}`;
        return new Promise<PermissionResponse>((resolve) => {
          const timer = setTimeout(() => {
            pendingPermissions.delete(requestId);
            emit({
              type: 'permission_resolved',
              requestId,
              toolUseId: request.toolUseId,
              decision: 'deny',
            });
            resolve({ behavior: 'deny', message: 'Permission request timed out' });
          }, PERMISSION_TIMEOUT_MS);

          pendingPermissions.set(requestId, {
            requestId,
            toolName: request.toolName,
            toolUseId: request.toolUseId,
            toolInput: request.toolInput,
            resolve: (result) => {
              clearTimeout(timer);
              resolve(result);
            },
          });
          emit({
            type: 'permission_request',
            toolName: request.toolName,
            toolInput: request.toolInput,
            toolUseId: request.toolUseId,
            requestId,
            decisionReason: request.decisionReason,
            suggestions: request.suggestions,
            isPlanExecution: request.isPlanExecution,
            toolCategory: request.toolCategory,
            planText: request.planText,
          });
        });
      },
    });

    } catch (startErr) {
      session.isStartingQuery = false;
      throw startErr;
    }

    session.queryHandle = handle;
    session.isStartingQuery = false;
    logger.debug(`[runQuery] session=${id} query created, entering event loop`);

    // Show a connecting message in the thread while waiting for system_init
    emit({ type: 'status', message: `Connecting to ${session.adapter.displayName} — ${session.branch} · ${session.permissionMode}` });

    // Process event stream from the adapter
    try {
      for await (const event of handle.events) {
        logger.debug(`[runQuery] session=${id} event type=${event.type}`);
        if (abortController.signal.aborted) break;

        // Intercept system_init to capture provider session ID and update status
        if (event.type === 'system_init') {
          session.status = 'running';
          session.providerSessionId = handle.getSessionId();

          // Persist provider session ID so we can resume after app restart
          if (session.providerSessionId) {
            worktreeManager.saveProviderSessionId(session.id, session.providerSessionId).catch((e) => {
              logger.warn(`Failed to persist provider session ID for ${session.id}:`, e);
            });
          }

          const w = session.window;
          if (!w.isDestroyed()) {
            w.webContents.send(IPC.SESSION_STATUS, session.id, 'running');
          }
        }

        // Intercept tool_result to track tool names and detect dev server URLs
        if (event.type === 'tool_result') {
          // Dev server URL detection (from Bash output)
          const toolName = session.toolUseMap.get(event.toolUseId);
          if (toolName === 'Bash' && event.content) {
            const portMatches = event.content.matchAll(
              /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d+)/g
            );
            for (const m of portMatches) {
              const port = parseInt(m[1], 10);
              if (!session.detectedPorts.has(port)) {
                session.detectedPorts.add(port);
                logger.info(`Dev server detected on port ${port} in session ${session.id}`);
                emit({ type: 'devserver_detected', port, url: `http://localhost:${port}` });
              }
            }
          }
        }

        // Track tool use IDs for matching tool_results
        if (event.type === 'assistant_tool_use') {
          session.toolUseMap.set(event.toolUseId, event.toolName);
        }

        // Auto-save memories before compaction wipes context
        if (event.type === 'compact_boundary') {
          memoryAutosave.triggerAutoSave({
            sessionId: session.id,
            repoPath: session.repoPath,
            cwd: session.worktreePath,
            events: session.eventHistory,
            adapterType: session.adapter.id,
            onStatus: (status, filesWritten) => {
              emit({ type: 'memory_autosave', status, filesWritten });
            },
          });
          // After compaction, remind the agent to re-read its plan/todo from memory
          const planFiles = memory.listMemoryFiles(session.repoPath)
            .filter(f => f.folder === 'sessions' && /plan|todo/i.test(f.relativePath));
          if (planFiles.length > 0) {
            const fileList = planFiles.map(f => f.relativePath).join(', ');
            this.sendMessage(session.id,
              `[System] Context was just compacted. You have active plan/todo files in memory: ${fileList}. Use memory_read to restore your progress before continuing.`
            );
          }
        }

        // Track result for completion callback
        if (event.type === 'result') {
          session.lastResult = {
            isError: event.isError,
            totalCostUsd: event.totalCostUsd,
            durationMs: event.durationMs,
          };
        }

        emit(event);
      }
      logger.debug(`[runQuery] session=${id} event loop ended normally`);
    } catch (err: any) {
      // Abort errors are expected when the user stops a query — don't surface them
      if (err?.message === 'Operation aborted' || abortController.signal.aborted) {
        logger.debug(`[runQuery] session=${id} event loop aborted (expected)`);
      } else {
        const errMsg = err?.message || String(err);
        const stderr = err?.stderr || err?.cause?.stderr || '';
        const exitCode = err?.exitCode ?? err?.code ?? '';
        const detail = stderr ? `${errMsg}\n${stderr}` : errMsg;
        logger.error(`[runQuery] session=${id} event loop error (exit=${exitCode}):`, detail);

        const isAuthError = /auth|unauthorized|401|403|invalid.*key|not.*logged|credential/i.test(detail);
        if (isAuthError) {
          emit({ type: 'error', message: session.adapter.authErrorMessage });
        } else {
          emit({ type: 'error', message: detail.slice(0, 500) });
        }
      }
    }

    // If the user clicked Stop, don't mark the session as stopped or fire
    // process_exit — stopQuery will restart the query loop.
    // Dev servers are preserved so they survive stop/continue cycles.
    if (session.stoppedByUser) {
      session.stoppedByUser = false;
      return;
    }

    // Kill any dev servers that were detected during this session
    // (only on natural query completion, not user-initiated stop)
    await this.killDetectedPorts(session);

    // Query finished
    session.status = 'stopped';
    emit({ type: 'process_exit' });
    const w = session.window;
    if (!w.isDestroyed()) {
      w.webContents.send(IPC.SESSION_STATUS, id, 'stopped');
    }

    // Fire completion callback if registered
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

    // Trigger memory auto-save (fire-and-forget, runs in background)
    memoryAutosave.triggerAutoSaveImmediate({
      sessionId: id,
      repoPath: session.repoPath,
      cwd: session.worktreePath,
      events: session.eventHistory,
      adapterType: session.adapter.id,
      onStatus: (status, filesWritten) => {
        emit({ type: 'memory_autosave', status, filesWritten });
      },
    }).catch(err => {
      logger.warn(`[memory-autosave] Auto-save failed for session ${id}: ${err}`);
    });
  }

  sendMessage(id: string, content: string, images?: import('../shared/types.js').ImageAttachment[]): boolean {
    const session = this.sessions.get(id);

    if (!session?.queryHandle) {
      logger.debug(`[sendMessage] session=${id} no session or queryHandle`);
      return false;
    }

    // Record in event history so user messages survive renderer refresh
    const userEvent: AgentEvent = { type: 'user_message', text: content };
    session.eventHistory.push(userEvent);
    try { fs.appendFileSync(session.eventLogPath, JSON.stringify(userEvent) + '\n'); } catch { /* non-fatal */ }

    const sessionId = session.providerSessionId ?? '';
    logger.debug(`[sendMessage] session=${id} sending to adapter, providerSessionId=${sessionId || '(not yet initialized)'}${images?.length ? ` with ${images.length} image(s)` : ''}`);
    try {
      session.queryHandle.sendMessage({
        text: content,
        images: images,
      });
      logger.debug(`[sendMessage] session=${id} sent successfully`);
      return true;
    } catch (e) {
      console.error(`[sendMessage] session=${id} send FAILED:`, e);
      logger.warn(`Failed to send message to session ${id}:`, e);
      return false;
    }
  }

  /**
   * Resolve a pending permission request.
   * Returns true if the permission was found and resolved, false if it was
   * already resolved or the session/request no longer exists (e.g. timed out).
   */
  respondToPermission(id: string, decision: PermissionDecision): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    const pending = session.pendingPermissions.get(decision.requestId);
    if (!pending) return false;

    session.pendingPermissions.delete(decision.requestId);

    const resolvedDecision = (decision.behavior === 'allow' || decision.behavior === 'allowAlways') ? 'allow' : 'deny';

    if (resolvedDecision === 'allow') {
      if (decision.behavior === 'allowAlways') {
        session.alwaysAllowedTools.add(pending.toolName);
      }
      const result: PermissionResponse = {
        behavior: 'allow',
        updatedInput: pending.toolInput,
        ...(decision.updatedPermissions ? { updatedPermissions: decision.updatedPermissions } : {}),
      };
      pending.resolve(result);
    } else {
      pending.resolve({
        behavior: 'deny',
        message: decision.message || 'User denied permission',
      });
    }

    // Notify renderer authoritatively
    session.emit?.({
      type: 'permission_resolved',
      requestId: decision.requestId,
      toolUseId: pending.toolUseId,
      decision: resolvedDecision,
    });

    return true;
  }

  setMode(id: string, mode: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    // Always update permissionMode on the session so it persists across
    // stop/restart cycles — even when queryHandle is temporarily null.
    session.permissionMode = mode as ManagedSession['permissionMode'];

    // Pass the mode to the adapter — it decides which modes it recognizes.
    // Some modes (like 'acceptEdits') may be handled at the app level only.
    if (session.queryHandle?.setPermissionMode) {
      try {
        session.queryHandle.setPermissionMode(mode as any);
      } catch (e) {
        logger.warn(`Failed to set mode for session ${id}:`, e);
      }
    }
  }

  async setModel(id: string, model?: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session?.queryHandle?.setModel) return;
    try {
      await session.queryHandle.setModel(model as string);
    } catch (e) {
      logger.warn(`Failed to set model for session ${id}:`, e);
      throw e;
    }
  }

  async setThinking(id: string, enabled: boolean): Promise<void> {
    const session = this.sessions.get(id);
    if (!session?.queryHandle?.setMaxThinkingTokens) return;
    try {
      await session.queryHandle.setMaxThinkingTokens(enabled ? null : 0);
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

  renameSession(id: string, displayName: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.displayName = displayName || null;
    }
  }

  /** Start a host-managed dev server for the given session. */
  async startDevServer(sessionId: string, overrideCommand?: string): Promise<import('../shared/types.js').DevServerResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // Stop existing dev server if any
    await this.stopDevServer(sessionId);

    // Resolve command via fallback chain: override → settings → auto-detect
    const command = overrideCommand
      || settings.getSettings().devCommand
      || await detectDevCommand(session.worktreePath);

    if (!command) throw new Error('No dev command configured and none detected from package.json');

    const devServer = new DevServer(sessionId, session.worktreePath, command, (info) => {
      // Emit devserver_detected event through the existing channel
      session.detectedPorts.add(info.port);
      const event: AgentEvent = { type: 'devserver_detected', port: info.port, url: info.url };
      session.eventHistory.push(event);
      try { fs.appendFileSync(session.eventLogPath, JSON.stringify(event) + '\n'); } catch { /* non-fatal */ }
      const w = session.window;
      if (!w.isDestroyed()) {
        w.webContents.send(`${IPC.AGENT_EVENT}:${sessionId}`, event);
      }
    });

    session.devServer = devServer;
    return devServer.start();
  }

  /** Stop the host-managed dev server for the given session. */
  async stopDevServer(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.devServer) return;
    await session.devServer.stop();
    session.devServer = null;
  }

  /** Kill dev servers detected during this session and clear the port set. */
  private async killDetectedPorts(session: ManagedSession): Promise<void> {
    if (session.detectedPorts.size === 0) return;
    const ports = [...session.detectedPorts];
    session.detectedPorts.clear();
    logger.info(`Killing ${ports.length} dev server(s) for session ${session.id}: ports ${ports.join(', ')}`);
    await Promise.all(
      ports.map((port) => killProcessOnPort(port).catch(() => {}))
    );
  }

  /**
   * Stop the current query but keep the session alive so the user can send
   * follow-up messages without losing state or remounting the UI.
   */
  async stopQuery(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;

    // Tell runQuery not to emit process_exit / SESSION_STATUS 'stopped'
    session.stoppedByUser = true;

    // Close the query *before* aborting so the SDK can
    // clean up gracefully and avoid dangling async operations that reject
    // with "Operation aborted" after the signal fires.
    try { session.queryHandle?.close(); } catch { /* may already be closed */ }

    // Now abort — any remaining in-flight SDK operations will be cancelled
    session.abortController.abort();

    // Dev servers are intentionally preserved across stop/continue cycles
    // so the user doesn't lose running servers when pausing the LLM.
    // They are cleaned up on natural query completion and session destroy.

    // Set up fresh abort controller for the next query
    session.abortController = new AbortController();
    session.queryHandle = null;

    const emit = this.createEmitter(session);

    // Resolve any pending permissions as denied — done after emit is rebuilt
    // so the permission_resolved events reach the renderer.
    for (const [, pending] of session.pendingPermissions) {
      pending.resolve({ behavior: 'deny', message: 'Query stopped by user' });
      emit({
        type: 'permission_resolved',
        requestId: pending.requestId,
        toolUseId: pending.toolUseId,
        decision: 'deny',
      });
    }
    session.pendingPermissions.clear();

    // Re-sync the renderer with the current permission mode so the status bar
    // reflects the correct state after a stop/restart cycle.
    emit({ type: 'mode_sync', mode: session.permissionMode });

    // Start a new query loop — the session stays in the map so sendMessage works
    this.runQuery(session, emit).catch((err) => {
      console.error(`[runQuery] session=${id} FAILED after stop:`, err);
      const errMsg = String(err.message || err);
      const isAuthError = /auth|unauthorized|401|403|invalid.*key|not.*logged|credential/i.test(errMsg);
      emit({ type: 'error', message: isAuthError
        ? session.adapter.authErrorMessage
        : errMsg });
    });
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;

    // Cancel any pending auto-save debounce and save heuristic metadata
    memoryAutosave.cancelAutoSave(id);
    memoryAutosave.saveSessionMetadata(session.repoPath, id, session.eventHistory);

    // Close the query and input stream before aborting to allow graceful cleanup
    try {
      session.queryHandle?.close();
    } catch { /* may already be closed */ }

    // Abort any remaining in-flight operations
    session.abortController.abort();

    // Resolve any pending permissions as denied
    for (const [, pending] of session.pendingPermissions) {
      pending.resolve({ behavior: 'deny', message: 'Session destroyed' });
      session.emit?.({
        type: 'permission_resolved',
        requestId: pending.requestId,
        toolUseId: pending.toolUseId,
        decision: 'deny',
      });
    }

    // Stop host-managed dev server
    if (session.devServer) {
      await session.devServer.stop();
      session.devServer = null;
    }

    // Kill any dev servers not already cleaned up on query completion
    await this.killDetectedPorts(session);

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
      displayName: s.displayName,
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

  /**
   * Close the input stream for a session, signalling no more messages.
   * This causes the agent's event loop to exit naturally, firing
   * the completion callback. Use for single-shot sessions (subtasks,
   * merge agents) where only one instruction is sent.
   */
  closeInputStream(id: string): void {
    const session = this.sessions.get(id);
    if (!session?.queryHandle?.closeInput) return;
    session.queryHandle.closeInput();
  }

  /** Register a one-time callback for when a session's query completes. */
  onComplete(id: string, callback: (result: SessionCompletionResult) => void): void {
    this.completionCallbacks.set(id, callback);
  }

  /** Register a listener for all events on a session. */
  onEvent(id: string, callback: (event: AgentEvent) => void): void {
    const list = this.eventListeners.get(id) ?? [];
    list.push(callback);
    this.eventListeners.set(id, list);
  }

  /** Inject an external event into a session's history and broadcast it to the renderer. */
  injectEvent(id: string, event: AgentEvent): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.eventHistory.push(event);
    try { fs.appendFileSync(session.eventLogPath, JSON.stringify(event) + '\n'); } catch { /* non-fatal */ }
    const w = session.window;
    if (!w.isDestroyed()) {
      w.webContents.send(`${IPC.AGENT_EVENT}:${id}`, event);
    }
    // Notify internal listeners
    const listeners = this.eventListeners.get(id);
    if (listeners) {
      for (const cb of listeners) {
        try { cb(event); } catch { /* non-fatal */ }
      }
    }
  }

  /** Load event history from the disk JSONL log for a session. */
  private loadEventHistory(id: string): AgentEvent[] {
    const logPath = path.join(getEventsDir(), `${id}.jsonl`);
    try {
      const data = fs.readFileSync(logPath, 'utf-8');
      return data.split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /** Return all buffered events for replay after renderer reload. Falls back to disk log. */
  getEventHistory(id: string): AgentEvent[] {
    const session = this.sessions.get(id);
    if (session) return session.eventHistory;
    return this.loadEventHistory(id);
  }

  /** Clear event history (in-memory and on disk) for a session.
   *  Called after /clear so replays don't resurrect old messages.
   *  Triggers memory auto-save before wiping so context isn't lost. */
  clearEventHistory(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      // Save memories before wiping history
      if (session.eventHistory.length > 0) {
        memoryAutosave.triggerAutoSave({
          sessionId: id,
          repoPath: session.repoPath,
          cwd: session.worktreePath,
          events: session.eventHistory,
          adapterType: session.adapter.id,
          onStatus: (status, filesWritten) => {
            session.emit?.({ type: 'memory_autosave', status, filesWritten });
          },
        });
      }
      session.eventHistory = [];
      try {
        fs.writeFileSync(session.eventLogPath, '');
      } catch { /* non-fatal */ }
    } else {
      // Session not running — clear disk log directly
      const logPath = path.join(getEventsDir(), `${id}.jsonl`);
      try { fs.writeFileSync(logPath, ''); } catch { /* non-fatal */ }
    }
  }

  /**
   * Health-check all sessions after system resume.
   * Detects sessions whose SDK query died silently (e.g. during sleep)
   * and emits process_exit + SESSION_STATUS so the renderer updates.
   */
  healthCheckAll(): void {
    for (const [id, session] of this.sessions) {
      if (session.status !== 'running') continue;

      // A running session should have a queryHandle. If it's null,
      // the query finished/crashed but the status was never updated.
      if (!session.queryHandle) {
        logger.warn(`[healthCheck] session ${id} has no queryHandle but status=running — marking stopped`);
        session.status = 'stopped';
        session.emit?.({ type: 'process_exit' });
        const w = session.window;
        if (!w.isDestroyed()) {
          w.webContents.send(IPC.SESSION_STATUS, id, 'stopped');
        }
      }
    }
  }

  get count(): number {
    return this.sessions.size;
  }
}

export const sessionManager = new AgentSessionManager();
