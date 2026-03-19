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

// The Agent SDK is ESM-only; Electron's main process is CJS.
// Use Function constructor to create a dynamic import that Rollup/Vite
// won't transform into require().
const dynamicImport = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@anthropic-ai/claude-agent-sdk')>;

let _query: typeof import('@anthropic-ai/claude-agent-sdk').query;
let _createSdkMcpServer: typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer;
let _tool: typeof import('@anthropic-ai/claude-agent-sdk').tool;
let _z: typeof import('zod').z;

async function getSdk() {
  if (!_query) {
    const sdk = await dynamicImport('@anthropic-ai/claude-agent-sdk');
    _query = sdk.query;
    _createSdkMcpServer = sdk.createSdkMcpServer;
    _tool = sdk.tool;
    const zodModule = await (dynamicImport as any)('zod');
    _z = zodModule.z;
  }
  return { query: _query, createSdkMcpServer: _createSdkMcpServer, tool: _tool, z: _z };
}

async function getQuery() {
  const { query } = await getSdk();
  return query;
}

/**
 * Strip noisy env vars that leak absolute paths into the LLM context,
 * causing the model to use full paths for simple CLI commands.
 */
const ENV_NOISE_PREFIXES = ['npm_', 'NVM_', 'FNM_', 'VSCODE_', 'ELECTRON_'];
function cleanEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !ENV_NOISE_PREFIXES.some(p => key.startsWith(p))
    )
  );
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
  /** Permission mode for the SDK query. */
  permissionMode: 'default' | 'plan' | 'acceptEdits';
  /** Extra system prompt appended to the default claude_code preset. */
  appendSystemPrompt: string | null;
  /** Fully custom system prompt — overrides the claude_code preset entirely. */
  customSystemPrompt: string | null;
  /** If set, only these tools are allowed — everything else is auto-denied. */
  allowedTools: Set<string> | null;
  /** Force structured JSON output via json_schema. */
  outputFormat: { type: 'json_schema'; schema: Record<string, unknown> } | null;
  /** SDK sandbox settings for restricted Bash execution. */
  sandbox: Record<string, unknown> | null;
  /** Extra environment variables merged into the SDK query env. */
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
  /** Emit function for sending events to the renderer — set by runQuery. */
  emit: ((event: AgentEvent) => void) | null;
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

/**
 * Match a tool rule pattern against a tool call.
 * Patterns: "Bash" matches all Bash, "Bash(npm run *)" matches commands starting with "npm run ".
 * Glob-style * wildcards are supported.
 */
function matchToolRule(pattern: string, toolName: string, toolCall: string): boolean {
  // Simple tool name match (no parentheses)
  if (!pattern.includes('(')) {
    return toolName === pattern || toolName.startsWith(pattern);
  }
  // Pattern with specifier: ToolName(specifier)
  const match = pattern.match(/^([^(]+)\((.+)\)$/);
  if (!match) return false;
  const [, ruleTool, specifier] = match;
  if (ruleTool !== toolName) return false;
  if (specifier === '*') return true;
  // Convert glob pattern to regex
  const escaped = specifier.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`).test(toolCall.slice(toolName.length + 1, -1) || '');
  } catch {
    return false;
  }
}

// Suppress "Operation aborted" unhandled rejections from the Claude Agent SDK.
// When we abort a running query, the SDK's internal async operations (write,
// handleControlRequest) may reject after the abort signal fires.  These are
// expected and safe to ignore.
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

  async createSession(opts: {
    id: string;
    branch: string;
    cwd: string;
    repoPath: string;
    window: BrowserWindow;
    resumeClaudeSessionId?: string;
    permissionMode?: 'default' | 'plan' | 'acceptEdits';
    appendSystemPrompt?: string | null;
    /** Fully custom system prompt — overrides the claude_code preset entirely. */
    customSystemPrompt?: string | null;
    /** If set, only these tools are allowed — everything else is auto-denied. */
    allowedTools?: string[] | null;
    /** Force structured JSON output via json_schema. */
    outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> } | null;
    /** SDK sandbox settings for restricted Bash execution. */
    sandbox?: Record<string, unknown> | null;
    /** Extra environment variables for the SDK query. */
    extraEnv?: Record<string, string> | null;
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

    // Apply settings defaults for values not explicitly provided
    const appSettings = settings.getSettings();
    const effectivePermissionMode = opts.permissionMode
      || (appSettings.defaultPermissionMode === 'bypassPermissions' ? 'default' : appSettings.defaultPermissionMode)
      || 'default';
    // Inject project memory into the system prompt
    const memoryPrompt = memory.getMemoryForSystemPrompt(repoPath);
    const userAppend = opts.appendSystemPrompt ?? (appSettings.defaultSystemPromptAppend || null);
    const builtInPrompt = 'When running Bash commands, prefer short command names (npm, npx, node, git, etc.) over absolute paths. Only fall back to a full path if the short command name fails to resolve. IMPORTANT: Do not use `cd` to navigate to your current working directory before running commands — you are already there. Just run commands directly.';
    const effectiveAppendPrompt = [builtInPrompt, memoryPrompt, userAppend].filter(Boolean).join('\n\n') || null;

    // Ensure memory directory exists for this repo
    memory.ensureRepoMemory(repoPath);

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
      eventLogPath: path.join(EVENTS_DIR, `${id}.jsonl`),
      displayName: null,
      devServer: null,
      stoppedByUser: false,
      autoSaveInProgress: false,
      emit: null,
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
    const { query: queryFn, createSdkMcpServer, tool, z } = await getSdk();
    logger.debug(`[runQuery] session=${id} SDK loaded`);

    // Create per-session MCP server for memory tools
    const memoryServer = createSdkMcpServer({
      name: 'grove-memory',
      version: '1.0.0',
      tools: [
        tool('memory_list', 'List all memory files for this project', {}, async () => {
          const entries = memory.listMemoryFiles(session.repoPath);
          return { content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }] };
        }),
        tool('memory_read', 'Read a specific memory file by relative path', {
          path: z.string().describe('Relative path e.g. "repo/overview.md"'),
        }, async (args: { path: string }) => {
          const content = memory.readMemoryFile(session.repoPath, args.path);
          return { content: [{ type: 'text' as const, text: content ?? 'File not found' }] };
        }),
        tool('memory_write', 'Write or update a memory file. Always read the file first to avoid duplicating or contradicting existing content.', {
          path: z.string().describe('Relative path e.g. "repo/overview.md" or "conventions/naming.md"'),
          content: z.string().describe('Full markdown content including YAML frontmatter (title, updatedAt)'),
        }, async (args: { path: string; content: string }) => {
          memory.writeMemoryFile(session.repoPath, args.path, args.content);
          return { content: [{ type: 'text' as const, text: `Saved memory file: ${args.path}` }] };
        }),
        tool('memory_delete', 'Delete a memory file', {
          path: z.string().describe('Relative path e.g. "repo/overview.md"'),
        }, async (args: { path: string }) => {
          const deleted = memory.deleteMemoryFile(session.repoPath, args.path);
          return { content: [{ type: 'text' as const, text: deleted ? `Deleted: ${args.path}` : 'File not found' }] };
        }),
      ],
    });

    // Memory tool names for allowedTools whitelist compatibility
    const memoryToolNames = [
      'mcp__grove-memory__memory_list',
      'mcp__grove-memory__memory_read',
      'mcp__grove-memory__memory_write',
      'mcp__grove-memory__memory_delete',
    ];

    const q = queryFn({
      prompt: readableStreamToAsyncIterable(session.inputStream!),
      options: {
        cwd: worktreePath,
        abortController,
        includePartialMessages: true,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: session.customSystemPrompt
          ? session.customSystemPrompt
          : session.appendSystemPrompt
            ? { type: 'preset', preset: 'claude_code', append: session.appendSystemPrompt }
            : { type: 'preset', preset: 'claude_code' },
        permissionMode: session.permissionMode,
        // Memory MCP server
        mcpServers: {
          'grove-memory': memoryServer,
        },
        // Force structured JSON output if configured
        ...(session.outputFormat ? { outputFormat: session.outputFormat } : {}),
        // Sandbox settings for restricted Bash execution
        ...(session.sandbox ? { sandbox: session.sandbox } : {}),
        // Resume previous conversation if we have a saved session ID
        ...(session.claudeSessionId ? { resume: session.claudeSessionId } : {}),
        canUseTool: async (toolName, input, options) => {
          // Always allow memory tools
          if (memoryToolNames.includes(toolName)) {
            return { behavior: 'allow' as const, updatedInput: input as Record<string, unknown> };
          }
          // If an allowedTools whitelist is set, deny anything not in it
          if (session.allowedTools && !session.allowedTools.has(toolName)) {
            return { behavior: 'deny', message: `Tool "${toolName}" is not allowed in this session` };
          }
          // Check settings-level deny/allow rules
          const currentSettings = settings.getSettings();
          const toolCall = typeof (input as any)?.command === 'string'
            ? `${toolName}(${(input as any).command})`
            : toolName;
          for (const rule of currentSettings.toolDenyRules) {
            if (matchToolRule(rule.pattern, toolName, toolCall)) {
              return { behavior: 'deny', message: `Denied by settings rule: ${rule.pattern}` };
            }
          }
          for (const rule of currentSettings.toolAllowRules) {
            if (matchToolRule(rule.pattern, toolName, toolCall)) {
              return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
            }
          }
          // Auto-approve Bash for sandboxed sessions (SDK sandbox may not
          // be active on all platforms, so we enforce it here as fallback)
          if (session.sandbox && toolName === 'Bash') {
            return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
          }
          // For sandboxed sessions, validate Edit/Write paths against allowWrite
          if (session.sandbox && (toolName === 'Edit' || toolName === 'Write')) {
            const filePath = (input as any).file_path;
            if (filePath && typeof filePath === 'string') {
              const allowWrite = (session.sandbox as any)?.filesystem?.allowWrite as string[] | undefined;
              if (allowWrite && allowWrite.length > 0) {
                const resolved = path.resolve(filePath);
                const allowed = allowWrite.some(dir => resolved.startsWith(path.resolve(dir)));
                if (!allowed) {
                  return { behavior: 'deny', message: `Path "${filePath}" is outside the allowed write directories` };
                }
              }
            }
          }
          // In acceptEdits mode, auto-approve Edit and Write tools
          if (session.permissionMode === 'acceptEdits' && (toolName === 'Edit' || toolName === 'Write')) {
            return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
          }
          // Auto-approve if user previously chose "Always Allow" for this tool
          if (session.alwaysAllowedTools.has(toolName)) {
            return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
          }
          // Forward permission request to renderer and wait for user response.
          // Times out after 30 minutes to give users plenty of time to respond.
          const PERMISSION_TIMEOUT_MS = 30 * 60 * 1000;
          const requestId = `perm_${id}_${++permRequestCounter}`;
          return new Promise((resolve) => {
            const timer = setTimeout(() => {
              pendingPermissions.delete(requestId);
              emit({
                type: 'permission_resolved',
                requestId,
                toolUseId: options.toolUseID,
                decision: 'deny',
              });
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
          ...cleanEnv(),
          CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
          ...(session.extraEnv ?? {}),
        },
        stderr: (data: string) => {
          logger.debug(`[claude-stderr] session=${id}: ${data.trim()}`);
        },
      },
    });

    session.queryInstance = q;
    logger.debug(`[runQuery] session=${id} query created, entering message loop`);

    // Show a connecting message in the thread while waiting for system_init
    emit({ type: 'status', message: `Connecting to Claude Code — ${session.branch} · ${session.permissionMode}` });

    // Process message stream
    try {
      for await (const message of q) {
        logger.debug(`[runQuery] session=${id} msg type=${message.type}`);
        if (abortController.signal.aborted) break;
        this.handleMessage(session, message, emit);
      }
      logger.debug(`[runQuery] session=${id} message loop ended normally`);
    } catch (err: any) {
      // Abort errors are expected when the user stops a query — don't surface them
      if (err?.message === 'Operation aborted' || abortController.signal.aborted) {
        logger.debug(`[runQuery] session=${id} message loop aborted (expected)`);
      } else {
        // Extract as much detail as possible from the SDK error
        const errMsg = err?.message || String(err);
        const stderr = err?.stderr || err?.cause?.stderr || '';
        const exitCode = err?.exitCode ?? err?.code ?? '';
        const detail = stderr ? `${errMsg}\n${stderr}` : errMsg;
        logger.error(`[runQuery] session=${id} message loop error (exit=${exitCode}):`, detail);

        const isAuthError = /auth|unauthorized|401|403|invalid.*key|not.*logged|credential/i.test(detail);
        if (isAuthError) {
          emit({ type: 'error', message: 'Authentication failed. Please run "claude auth login" in your terminal and try again.' });
        } else {
          emit({ type: 'error', message: detail.slice(0, 500) });
        }
      }
    }

    // Kill any dev servers that were detected during this session
    await this.killDetectedPorts(session);

    // If the user clicked Stop, don't mark the session as stopped or fire
    // process_exit — stopQuery will restart the query loop.
    if (session.stoppedByUser) {
      session.stoppedByUser = false;
      return;
    }

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
      onStatus: (status, filesWritten) => {
        emit({ type: 'memory_autosave', status, filesWritten });
      },
    }).catch(err => {
      logger.warn(`[memory-autosave] Auto-save failed for session ${id}: ${err}`);
    });
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
          // Auto-save memories before compaction wipes context
          memoryAutosave.triggerAutoSave({
            sessionId: session.id,
            repoPath: session.repoPath,
            cwd: session.worktreePath,
            events: session.eventHistory,
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
          structured_output: 'structured_output' in message ? (message as any).structured_output : undefined,
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
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            emit({ type: 'partial_thinking', text: delta.thinking });
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

  sendMessage(id: string, content: string, images?: import('../shared/types.js').ImageAttachment[]): boolean {
    const session = this.sessions.get(id);

    if (!session?.inputController) {
      logger.debug(`[sendMessage] session=${id} no session or inputController`);
      return false;
    }

    // Record in event history so user messages survive renderer refresh
    const userEvent: AgentEvent = { type: 'user_message', text: content };
    session.eventHistory.push(userEvent);
    try { fs.appendFileSync(session.eventLogPath, JSON.stringify(userEvent) + '\n'); } catch { /* non-fatal */ }

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
      return true;
    } catch (e) {
      console.error(`[sendMessage] session=${id} enqueue FAILED:`, e);
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
    if (!session?.queryInstance) return;
    try {
      session.permissionMode = mode as ManagedSession['permissionMode'];
      // Only pass SDK-recognized modes to the SDK instance.
      // 'acceptEdits' is an app-level concept handled by our canUseTool callback.
      if (mode === 'default' || mode === 'plan') {
        session.queryInstance.setPermissionMode(mode as any);
      }
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

    // Close the query and input stream *before* aborting so the SDK can
    // clean up gracefully and avoid dangling async operations that reject
    // with "Operation aborted" after the signal fires.
    try { session.queryInstance?.close(); } catch { /* may already be closed */ }
    try { session.inputController?.close(); } catch { /* may already be closed */ }

    // Now abort — any remaining in-flight SDK operations will be cancelled
    session.abortController.abort();

    // Stop host-managed dev server
    if (session.devServer) {
      await session.devServer.stop();
      session.devServer = null;
    }

    // Kill any detected dev servers
    await this.killDetectedPorts(session);

    // Set up fresh abort controller and input stream for the next query
    session.abortController = new AbortController();
    let inputController: ReadableStreamDefaultController<SDKUserMessage> | null = null;
    session.inputStream = new ReadableStream<SDKUserMessage>({
      start(controller) {
        inputController = controller;
      },
    });
    session.inputController = inputController;
    session.queryInstance = null;

    // Build the emit helper (same as in createSession)
    const emit = (event: AgentEvent) => {
      logger.debug(`[emit] session=${id} event.type=${event.type}`);
      session.eventHistory.push(event);
      try {
        fs.appendFileSync(session.eventLogPath, JSON.stringify(event) + '\n');
      } catch { /* non-fatal */ }
      const listeners = this.eventListeners.get(id);
      if (listeners) {
        for (const cb of listeners) {
          try { cb(event); } catch { /* non-fatal */ }
        }
      }
      const w = session.window;
      if (!w.isDestroyed()) {
        const channel = `${IPC.AGENT_EVENT}:${id}`;
        w.webContents.send(channel, event);
      }
    };
    session.emit = emit;

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

    // Start a new query loop — the session stays in the map so sendMessage works
    this.runQuery(session, emit).catch((err) => {
      console.error(`[runQuery] session=${id} FAILED after stop:`, err);
      const errMsg = String(err.message || err);
      const isAuthError = /auth|unauthorized|401|403|invalid.*key|not.*logged|credential/i.test(errMsg);
      emit({ type: 'error', message: isAuthError
        ? 'Authentication failed. Please run "claude auth login" in your terminal and try again.'
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
      session.queryInstance?.close();
    } catch { /* may already be closed */ }

    try {
      session.inputController?.close();
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
   * This causes the SDK's `for await` loop to exit naturally, firing
   * the completion callback. Use for single-shot sessions (subtasks,
   * merge agents) where only one instruction is sent.
   */
  closeInputStream(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (!session.inputController) return;
    try {
      session.inputController.close();
      session.inputController = null;
    } catch { /* may already be closed */ }
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
    const logPath = path.join(EVENTS_DIR, `${id}.jsonl`);
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

  get count(): number {
    return this.sessions.size;
  }
}

export const sessionManager = new AgentSessionManager();
