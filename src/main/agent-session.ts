import type { BrowserWindow } from 'electron';
import { IPC } from '../shared/types.js';
import type { SessionInfo, SessionStatus, AgentEvent, PermissionDecision, PermissionMode, McpServerInfo, McpAuthStartResult, McpElicitationResponse, McpServerContextCost, ProviderUsage, SessionControls } from '../shared/types.js';
import { CONTROL_IDS, PERMISSION_MODES } from '../shared/types.js';
import { displayTextFromSent } from '../shared/prompt-text.js';
import { pruneImages, removeImages, saveImages, storeToolImages } from './attachments.js';
import { logger } from './logger.js';
import { worktreeManager } from './worktree-manager.js';
import * as settings from './settings.js';
import * as memory from './memory.js';
import * as memoryAutosave from './memory-autosave.js';
import { adapterRegistry } from './adapters/index.js';
import type { AgentAdapter, AgentQueryHandle, UserMessage } from './adapters/types.js';
import { ResumeNotFoundError } from './adapters/types.js';
import { getGitIdentity } from './git.js';
import { findRewindForkPoint, isAuthFailure, lastTurnUuid } from './agent-utils.js';
import { CheckpointManager } from './checkpoints.js';
import type { EventSearchHit } from './event-search.js';
import { noGitCheckpoints } from './no-git-checkpoints.js';
import { killTree } from './process-tree.js';
import { previewManager } from './preview.js';
import type { Emit, ManagedSession, SessionCompletionResult } from './session-types.js';
import { SessionEventStore, TRANSIENT_EVENT_TYPES, eventLogPath } from './session-event-store.js';
import {
  requestPermission, respondToPermission as answerPermission, denyPendingPermissions,
  awaitElicitation, respondToElicitation as answerElicitation, cancelElicitations,
} from './session-permissions.js';
import { SessionSkills } from './session-skills.js';
import {
  READ_SAFE_SANDBOX_WARNING, readSafeSandbox, hasSandboxWarning, startingPermissionMode,
  initialControls, normalizeModelId, appendedSystemPrompt,
} from './session-config.js';

export type { SessionCompletionResult } from './session-types.js';

// SDK teardown rejections (a query closed with control responses in flight)
// are filtered in crash-handling.ts, which owns the process-wide handler.

// The agent SDK registers a global process 'exit' handler per query() to
// SIGTERM its child process on shutdown, but never removes it when the query
// closes — so each session/restart leaks one listener.  They are harmless
// (the child is already dead by then), but accumulate past Node's default
// limit of 10 and trigger a MaxListenersExceededWarning.  Raise the cap so the
// warning doesn't fire under normal multi-session use.
process.setMaxListeners(50);

class AgentSessionManager {
  private sessions = new Map<string, ManagedSession>();
  private completionCallbacks = new Map<string, (result: SessionCompletionResult) => void>();
  /** Session setups (worktree, dependency install, adapter start) still in
   *  flight, keyed by the id the renderer already holds. The renderer opens
   *  the pane and its input the moment it has an id, so sendMessage() waits
   *  on these instead of bouncing a prompt typed before the session exists. */
  private pendingSetups = new Map<string, Promise<void>>();
  /** Cancels a pending setup, for setups that can stop part-way. */
  private pendingSetupAborts = new Map<string, AbortController>();
  /** Sessions closeSession() is still shutting down, keyed by id. They are
   *  already out of `sessions`; reopening or destroying one waits on this. */
  private closing = new Map<string, Promise<void>>();
  private eventListeners = new Map<string, ((event: AgentEvent) => void)[]>();

  private events = new SessionEventStore();
  private skills = new SessionSkills();

  /** Worktree path for a managed session, if it exists. */
  getWorktreePath(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.worktreePath ?? null;
  }

  /** Adapter for a managed session, if it exists (used by IPC to route
   *  provider-specific operations like skill discovery). */
  getSessionAdapter(sessionId: string): AgentAdapter | null {
    return this.sessions.get(sessionId)?.adapter ?? null;
  }

  /** Mine the project's conversations for skill suggestions (see SessionSkills). */
  analyzeSkillSuggestionsForRepo(repoPath: string) {
    return this.skills.analyzeRepo(repoPath);
  }

  /** Create an emit function bound to a session — buffers events and persists them to JSONL on disk. */
  private createEmitter(session: ManagedSession): Emit {
    const id = session.id;
    const emit = (event: AgentEvent) => {
      // Streaming deltas and activity ticks are only useful live: the renderer
      // drops them on replay, search ignores them, and memory extraction never
      // reads them. Keeping them would grow eventHistory and the JSONL log by
      // one entry per token.
      if (!TRANSIENT_EVENT_TYPES.has(event.type)) {
        this.events.append(session, event);
      }

      // Notify registered listeners (used for progress events)
      const listeners = this.eventListeners.get(id);
      if (listeners) {
        for (const cb of listeners) {
          try { cb(event); } catch { /* non-fatal */ }
        }
      }

      const w = session.window;
      if (!w.isDestroyed()) {
        w.webContents.send(`${IPC.AGENT_EVENT}:${id}`, event);
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
    permissionMode?: PermissionMode;
    appendSystemPrompt?: string | null;
    customSystemPrompt?: string | null;
    allowedTools?: string[] | null;
    outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> } | null;
    sandbox?: Record<string, unknown> | null;
    extraEnv?: Record<string, string> | null;
    adapterType?: string;
    /** Model to run this session with. Falls back to the default when omitted. */
    model?: string | null;
    /** Starting control values (effort, thinking, …) chosen for this
     *  conversation. Laid over the saved defaults; a value the model doesn't
     *  offer is ignored. */
    controls?: Record<string, string> | null;
    /** Runs in a folder without git (the worktree entry's `noGit`): no
     *  checkpoints and no commit identity. */
    noGit?: boolean;
  }): Promise<SessionInfo> {
    const { id, branch, cwd, repoPath, window: win } = opts;

    // Reopened while still closing: let the old agent process finish shutting
    // down before a new one resumes the same transcript.
    await this.closing.get(id);

    // Look up the adapter (fall back to the registry default)
    const adapterType = opts.adapterType ?? adapterRegistry.getDefault().id;
    const adapter = adapterRegistry.get(adapterType);
    if (!adapter) throw new Error(`Unknown agent adapter: ${adapterType}`);
    // Record the agent so a restart resumes this conversation on it and its
    // background tasks (memory notes, commit messages) use it.
    worktreeManager.saveAdapterType(id, adapterType).catch((e) => {
      logger.warn(`Failed to record agent for ${id}:`, e);
    });

    const abortController = new AbortController();

    // Apply settings defaults for values not explicitly provided
    const appSettings = settings.getSettings();
    const initialModel = opts.model ?? (appSettings.defaultModels?.[adapter.id] || adapter.getModels()[0]?.id || null);
    // The saved default mode is kept per agent with its other control defaults.
    const effectivePermissionMode = startingPermissionMode(
      adapter, initialModel, opts.permissionMode, appSettings.adapterDefaults?.[adapter.id]?.[CONTROL_IDS.permissionMode],
    );
    // Path rules, project memory, caveman mode and the user's own addition.
    const effectiveAppendPrompt = appendedSystemPrompt({
      cwd,
      repoPath,
      userAppend: opts.appendSystemPrompt ?? (appSettings.defaultSystemPromptAppend || null),
      cavemanMode: appSettings.cavemanMode,
    });

    // Ensure memory directory exists for this repo
    memory.ensureRepoMemory(repoPath);

    // A folder project isn't a git repository: no checkpoints, no commits.
    const gitBacked = !opts.noGit;

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
      pendingElicitations: new Map(),
      alwaysAllowedTools: new Set(),
      providerSessionId: opts.resumeSessionId || null,
      pendingResumeAt: null,
      model: initialModel,
      window: win,
      // Copy: the cached array must not be mutated by the live session.
      eventHistory: [...this.events.load(id)],
      logBuffer: [],
      logBufferBytes: 0,
      logFlushTimer: null,
      destroying: false,
      lastResult: null,
      permissionMode: effectivePermissionMode,
      appendSystemPrompt: effectiveAppendPrompt,
      customSystemPrompt: opts.customSystemPrompt ?? null,
      allowedTools: opts.allowedTools ? new Set(opts.allowedTools) : null,
      outputFormat: opts.outputFormat ?? null,
      sandbox: opts.sandbox ?? null,
      extraEnv: opts.extraEnv ?? null,
      eventLogPath: eventLogPath(id),
      displayName: null,
      controls: initialControls(adapter, initialModel, appSettings.adapterDefaults?.[adapter.id], opts.controls),
      stoppedByUser: false,
      interrupting: false,
      autoSaveInProgress: false,
      emit: null,
      permRequestCounter: 0,
      isStartingQuery: false,
      restartRequested: false,
      queryReady: null,
      resolveQueryReady: null,
      checkpoints: gitBacked ? new CheckpointManager() : noGitCheckpoints,
      gitBacked,
      statusBeforeSleep: null,
      sleepSettled: null,
      turnHandle: null,
      promptsBeforeInit: null,
    };

    this.sessions.set(id, session);

    this.events.ensureDir();

    const emit = this.createEmitter(session);

    // Tell the renderer which mode the conversation starts in. It shows
    // 'default' until a mode_sync arrives, and adapters don't report the
    // mode a query starts in.
    emit({ type: 'mode_sync', mode: session.permissionMode, source: 'session' });

    // Let sendMessage() wait for the first queryHandle instead of dropping a
    // prompt that arrives while adapter.start() is still in flight (the
    // renderer's input is live from the moment the pane mounts). runQuery
    // resolves this once the handle is set, or on start failure.
    session.queryReady = new Promise<void>((resolve) => {
      session.resolveQueryReady = resolve;
    });

    this.runQuery(session, emit).catch((err) => {
        console.error(`[runQuery] session=${id} FAILED:`, err);
        const errMsg = String(err.message || err);
        const isAuthError = isAuthFailure(errMsg);
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

  /** Relaunch a query loop after a stop/restart that arrived during startup.
   *  Clears the startup guard first so the new run isn't itself deferred.
   *  `resend` goes to the new query first (see runQuery). */
  private relaunchQuery(session: ManagedSession, resend: UserMessage[] = []): void {
    session.isStartingQuery = false;
    session.restartRequested = false;
    // The stop that triggered this relaunch is now being consumed by starting a
    // fresh run, so clear the flag — otherwise it would suppress process_exit on
    // the next natural completion of the new run.
    session.stoppedByUser = false;
    const emit = session.emit ?? this.createEmitter(session);
    this.runQuery(session, emit, resend).catch((err) => {
      console.error(`[runQuery] session=${session.id} FAILED on restart:`, err);
      const errMsg = String(err?.message || err);
      const isAuthError = isAuthFailure(errMsg);
      emit({ type: 'error', message: isAuthError ? session.adapter.authErrorMessage : errMsg });
      session.status = 'error';
      if (!session.window.isDestroyed()) {
        session.window.webContents.send(IPC.SESSION_STATUS, session.id, 'error');
      }
    });
  }

  /** `resend`: prompts to send the new query before any other, carried over
   *  from a run whose conversation turned out to be gone. */
  private async runQuery(
    session: ManagedSession,
    emit: (event: AgentEvent) => void,
    resend: UserMessage[] = [],
  ) {
    const { id, abortController } = session;

    // Guard against concurrent runQuery calls (e.g. rapid double-stop).
    // A stop that arrives mid-startup must not be dropped: flag a restart so the
    // in-flight run relaunches once it finishes starting up (see below).
    if (session.isStartingQuery) {
      logger.warn(`[runQuery] session=${id} already starting — deferring restart`);
      session.restartRequested = true;
      return;
    }
    session.isStartingQuery = true;
    session.restartRequested = false;

    logger.debug(`[runQuery] session=${id} starting`);
    // Build adapter config from session state + app settings
    const currentSettings = settings.getSettings();

    // Read the user's git identity so we can force it via env vars.
    // Environment variables take highest precedence in git's identity
    // resolution, ensuring commits are attributed to the user even if
    // the agent SDK sets its own git config. With no identity configured
    // the vars stay unset and git's own rules apply (usually it refuses to
    // commit and asks for one) rather than us inventing an author.
    let gitIdentityEnv: Record<string, string> = {};
    if (session.gitBacked) try {
      const identity = await getGitIdentity(session.worktreePath);
      if (identity) {
        gitIdentityEnv = {
          GIT_AUTHOR_NAME: identity.name,
          GIT_AUTHOR_EMAIL: identity.email,
          GIT_COMMITTER_NAME: identity.name,
          GIT_COMMITTER_EMAIL: identity.email,
        };
      } else {
        logger.warn(`[runQuery] session=${id} git user.name/user.email not set; agent commits use git's own identity rules`);
        // Tell the user once per conversation. eventHistory is reloaded from
        // disk, so this also holds across restarts and app relaunches.
        if (!session.eventHistory.some((e) => e.type === 'git_identity_missing')) {
          emit({ type: 'git_identity_missing' });
        }
      }
    } catch { /* best effort */ }

    // Snapshot the rewind fork target for this start attempt. It stays set on
    // the session until a query successfully starts with it, so a stop that
    // lands mid-startup (restartRequested) retries the same truncated resume.
    const resumeAtUuid = session.pendingResumeAt;

    const skillsFilter = await this.skills.filterFor(session, currentSettings.disabledSkills ?? []);

    // Read-safe mode leans on a sandbox that may not start: say so once per
    // conversation (eventHistory is reloaded from disk, so across restarts too).
    if (session.permissionMode === 'readSafe' && !session.sandbox && !hasSandboxWarning(session.eventHistory)) {
      emit({ type: 'status', level: 'warning', message: READ_SAFE_SANDBOX_WARNING });
    }

    // Fresh conversation: snapshot the working tree as the session's baseline
    // before the query can accept a prompt, so the baseline is always the
    // oldest checkpoint and the first turn's diff is measured from it. The
    // manager skips it if the session already has turns (rewind restart).
    // Resumed sessions rebuild their checkpoint state on system_init instead.
    const resumingProviderSession = !!session.providerSessionId;
    if (!resumingProviderSession && session.gitBacked) {
      session.checkpoints.captureBaseline(id, session.worktreePath).then((written) => {
        if (!written) logger.warn(`Checkpoint baseline not captured for ${id}`);
      });
    }

    // Only hand the agent what it says it supports (AgentCapabilities).
    const caps = session.adapter.capabilities;
    if (session.outputFormat && !caps.structuredOutput) {
      logger.warn(`[runQuery] ${id}: ${session.adapter.id} has no structured output; the output format is ignored`);
    }

    let handle: AgentQueryHandle;
    try {
    handle = await session.adapter.start({
      cwd: session.worktreePath,
      // session.model is the source of truth — it survives stop/restart and
      // resume cycles, so the user's selected model isn't lost when the query
      // is torn down and recreated.
      model: session.model,
      permissionMode: session.permissionMode,
      appendSystemPrompt: session.appendSystemPrompt,
      customSystemPrompt: session.customSystemPrompt,
      allowedTools: session.allowedTools,
      skills: skillsFilter ?? null,
      outputFormat: caps.structuredOutput ? session.outputFormat : null,
      // Read-safe mode gets OS-level sandbox enforcement as a backstop beneath
      // the read-only classifier (explicit per-session sandbox settings win).
      // Mode is read at query start: switching into read-safe mid-query keeps
      // classifier-only protection until the next query (re)start.
      sandbox: !caps.sandbox ? null
        : session.sandbox ?? (session.permissionMode === 'readSafe' ? readSafeSandbox(session.worktreePath) : null),
      memoryOperations: {
        list: () => memory.listMemoryFiles(session.repoPath),
        read: (p) => memory.readMemoryFile(session.repoPath, p),
        write: (p, c) => memory.writeMemoryFile(session.repoPath, p, c),
        delete: (p) => memory.deleteMemoryFile(session.repoPath, p),
      },
      previewOperations: currentSettings.previewAgentTools
        ? previewManager.operationsFor(id, session.worktreePath)
        : null,
      extraEnv: { ...gitIdentityEnv, ...(session.extraEnv ?? {}) },
      controls: session.controls,
      thinkingSummaries: currentSettings.showThinkingSummaries,
      // An agent that can't resume starts a new conversation each time; the
      // thread still shows the earlier turns from Grove's own event log.
      resumeSessionId: caps.resume ? session.providerSessionId : null,
      resumeAtUuid: caps.resume && caps.rewind ? resumeAtUuid : null,
      toolAllowRules: currentSettings.toolAllowRules,
      toolDenyRules: currentSettings.toolDenyRules,
      alwaysAllowedTools: session.alwaysAllowedTools,
      onElicitation: (request, signal) => awaitElicitation(session, request, signal),
      onPermissionRequest: (request) => requestPermission(session, request, emit),
    });

    } catch (startErr) {
      session.isStartingQuery = false;
      // A stop arrived mid-startup (which can be what made start() fail). Honour
      // the restart instead of surfacing the error or resolving queryReady with
      // no handle — stopQuery has already prepared a fresh abortController/queryReady.
      if (session.restartRequested) {
        this.relaunchQuery(session);
        return;
      }
      // A truncated (rewind) resume failed to start — fall back to a fresh
      // conversation rather than wedging the session. The retry cannot loop:
      // both resume fields are cleared before relaunching.
      if (resumeAtUuid) {
        logger.warn(`[runQuery] session=${id} truncated resume failed, falling back to fresh conversation:`, startErr);
        session.pendingResumeAt = null;
        session.providerSessionId = null;
        worktreeManager.saveProviderSessionId(id, '').catch(() => { /* non-fatal */ });
        this.relaunchQuery(session);
        return;
      }
      // Reject any pending sendMessage() waiters
      if (session.resolveQueryReady) {
        session.resolveQueryReady();
        session.resolveQueryReady = null;
        session.queryReady = null;
      }
      throw startErr;
    }

    // If a stop arrived while start() was in flight, discard this now-stale
    // handle and relaunch cleanly rather than installing a handle on an already
    // aborted run (which would leave the session wedged and queryReady resolved
    // against a dead query).
    if (session.restartRequested) {
      try { handle.close(); } catch { /* may already be closed */ }
      this.relaunchQuery(session);
      return;
    }

    // Closed or destroyed while start() was in flight: nothing will read this
    // handle, so shut its process down now rather than leave it running.
    if (session.destroying) {
      try { handle.close(); } catch { /* may already be closed */ }
      session.isStartingQuery = false;
      session.resolveQueryReady?.();
      session.resolveQueryReady = null;
      session.queryReady = null;
      return;
    }

    session.queryHandle = handle;
    session.isStartingQuery = false;
    // Only a resumed conversation can turn out to be missing.
    session.promptsBeforeInit = resumingProviderSession ? { handle, prompts: [] } : null;
    // Before resolving queryReady below, so they go ahead of sends waiting on it.
    for (const prompt of resend) {
      session.turnHandle = handle;
      try {
        handle.sendMessage(prompt);
      } catch (e) {
        logger.warn(`[runQuery] session=${id} failed to resend a prompt:`, e);
      }
    }
    // The truncated resume (if any) has been consumed by this start — later
    // restarts must resume the forked conversation normally.
    if (resumeAtUuid && session.pendingResumeAt === resumeAtUuid) {
      session.pendingResumeAt = null;
    }
    // Signal any pending sendMessage() that the queryHandle is ready
    if (session.resolveQueryReady) {
      session.resolveQueryReady();
      session.resolveQueryReady = null;
      session.queryReady = null;
    }
    logger.debug(`[runQuery] session=${id} query created, entering event loop`);

    // Show a connecting message in the thread while waiting for system_init
    emit({ type: 'status', message: `Connecting to ${session.adapter.displayName} — ${session.branch || 'project folder'} · ${session.permissionMode}` });

    // Process event stream from the adapter
    try {
      for await (const adapterEvent of handle.events) {
        if (!TRANSIENT_EVENT_TYPES.has(adapterEvent.type)) {
          logger.debug(`[runQuery] session=${id} event type=${adapterEvent.type}`);
        }
        if (abortController.signal.aborted) break;

        // Save the images a tool returned; the event passes on references.
        const event: AgentEvent = adapterEvent.type === 'tool_result' && adapterEvent.imageData
          ? await storeToolImages(id, adapterEvent)
          : adapterEvent;

        // Skip adapter user_message events — we emit our own with UUIDs in sendMessage
        if (event.type === 'user_message') continue;

        // A reply means a turn is running, including ones the agent starts
        // itself (e.g. when a background task finishes).
        if (event.type === 'assistant_text' || event.type === 'assistant_tool_use'
          || event.type === 'thinking' || event.type === 'partial_text') {
          session.turnHandle = handle;
        }

        // Intercept system_init to capture provider session ID and update status
        if (event.type === 'system_init') {
          session.status = 'running';
          session.providerSessionId = handle.getSessionId();
          if (session.promptsBeforeInit?.handle === handle) session.promptsBeforeInit = null;
          // Remember reported skills so the disabled-skills allowlist can
          // include plugin skills the on-disk scan can't see.
          if (event.skills && event.skills.length > 0) {
            this.skills.record(session.repoPath, event.skills);
          }
          // Record the model the provider resolved, normalised back to a known
          // picker id. The SDK reports a dated alias (e.g. "claude-opus-4-8-
          // 20260101") which must not leak into session.model, or it would
          // break picker highlighting and round-trip the wrong string on
          // restart. Only overwrite when we recognise it.
          const normalized = normalizeModelId(event.model, session.adapter);
          if (normalized && normalized !== session.model) {
            session.model = normalized;
            worktreeManager.saveModel(session.id, normalized).catch((e) => {
              logger.warn(`Failed to persist model for ${session.id}:`, e);
            });
          }
          // The resolved model decides which controls are valid — tell the
          // renderer what to render now that the query is up.
          emit({ type: 'controls_sync', ...this.reconcileControls(session) });

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

          // A resumed provider session (app restart, stop/restart, rewind
          // fork) keeps its refs in git: rebuild the uuid map and turn counter
          // from them. Fresh conversations already captured their baseline
          // before the query started. providerSessionId is set above from the
          // handle on every init, so the decision has to use what it was
          // before this query started.
          if (resumingProviderSession) {
            session.checkpoints.resume(id, session.worktreePath).catch(err => {
              logger.warn(`Checkpoint resume failed for ${id}:`, err);
            });
          }
        }

        // Auto-save memories before compaction wipes context
        if (event.type === 'compact_boundary') {
          memoryAutosave.triggerAutoSave({
            sessionId: session.id,
            repoPath: session.repoPath,
            cwd: session.worktreePath,
            events: session.eventHistory,
            branchName: session.branch,
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
          if (session.turnHandle === handle) session.turnHandle = null;
          session.lastResult = {
            isError: event.isError,
            totalCostUsd: event.totalCostUsd,
            durationMs: event.durationMs,
          };

          // A finished turn is new history — refresh skill suggestions soon.
          if (!event.isError) this.skills.scheduleSuggestions(session);

          // A turn ended by a user interrupt reports abort/teardown errors
          // (e.g. "Request was aborted", in-flight tool failures). The user
          // asked to stop, so present a clean result instead of dumping them.
          if (session.interrupting) {
            session.interrupting = false;
            emit({ ...event, isError: false, errors: undefined });
            continue;
          }
        }

        emit(event);
      }
      logger.debug(`[runQuery] session=${id} event loop ended normally`);
    } catch (err: any) {
      // Abort errors are expected when the user stops a query — don't surface them.
      // interrupting covers an in-place interrupt that tears down the event loop
      // (the SDK throws "Request was aborted" rather than yielding a result).
      // destroying covers a close or delete, which kills the agent process
      // before closing its query. A handle that is no longer the session's
      // belongs to a run that was put to sleep, which also kills the process.
      if (err?.message === 'Operation aborted' || abortController.signal.aborted || session.interrupting || session.destroying || session.queryHandle !== handle) {
        session.interrupting = false;
        logger.debug(`[runQuery] session=${id} event loop aborted (expected)`);
      } else if (err instanceof ResumeNotFoundError && resumingProviderSession) {
        this.replaceMissingConversation(session, handle, emit, err.message);
        return;
      } else {
        const errMsg = err?.message || String(err);
        const stderr = err?.stderr || err?.cause?.stderr || '';
        const exitCode = err?.exitCode ?? err?.code ?? '';
        const detail = stderr ? `${errMsg}\n${stderr}` : errMsg;
        logger.error(`[runQuery] session=${id} event loop error (exit=${exitCode}):`, detail);

        const isAuthError = isAuthFailure(detail);
        if (isAuthError) {
          emit({ type: 'error', message: session.adapter.authErrorMessage });
        } else {
          emit({ type: 'error', message: detail.slice(0, 500) });
        }
      }
    }

    if (session.turnHandle === handle) session.turnHandle = null;

    // If the user clicked Stop, don't mark the session as stopped or fire
    // process_exit — stopQuery will restart the query loop.
    if (session.stoppedByUser) {
      session.stoppedByUser = false;
      return;
    }

    // destroySession closed the query: the session is being torn down and its
    // worktree removed. Don't flip status, fire callbacks, or start a memory
    // extraction (which would spawn a subprocess with cwd inside the worktree
    // and hold it locked while removal runs).
    if (session.destroying) {
      logger.debug(`[runQuery] session=${id} event loop ended during destroy`);
      return;
    }

    // Put to sleep (or already replaced by a newer run): the conversation
    // stays open, so this is not the end of it. Nothing to report.
    if (session.queryHandle !== handle) {
      logger.debug(`[runQuery] session=${id} event loop ended for a retired query`);
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
      branchName: session.branch,
      adapterType: session.adapter.id,
      onStatus: (status, filesWritten) => {
        emit({ type: 'memory_autosave', status, filesWritten });
      },
    }).catch(err => {
      logger.warn(`[memory-autosave] Auto-save failed for session ${id}: ${err}`);
    });
  }

  /**
   * The conversation `handle` resumed is gone from the agent (its transcript
   * was deleted or moved). Forget it, or every restart would resume it and
   * fail the same way, and start a new conversation in its place. Reporting
   * the agent stopped instead would make the renderer resume the same missing
   * conversation again, in a loop. The new run can't end up here: it has no
   * provider session to resume.
   */
  private replaceMissingConversation(session: ManagedSession, handle: AgentQueryHandle, emit: Emit, reason: string): void {
    const { id } = session;
    logger.warn(`[runQuery] session=${id} provider session ${session.providerSessionId} not found, starting a new conversation: ${reason}`);
    session.providerSessionId = null;
    session.pendingResumeAt = null;
    worktreeManager.saveProviderSessionId(id, '').catch(() => { /* non-fatal */ });

    // Prompts sent while it was starting went nowhere; the new one gets them.
    const unanswered = session.promptsBeforeInit?.handle === handle ? session.promptsBeforeInit.prompts : [];
    session.promptsBeforeInit = null;
    if (session.turnHandle === handle) session.turnHandle = null;
    session.queryHandle = null;
    try { handle.close(); } catch { /* may already be closed */ }

    emit({
      type: 'status',
      level: 'warning',
      newConversation: true,
      message: `${session.adapter.displayName} couldn't find this conversation any more, so it starts a new one. The thread above stays, but the agent won't remember it.`,
    });
    // Prompts sent meanwhile wait for the new run (see awaitQueryHandle).
    if (!session.resolveQueryReady) {
      session.queryReady = new Promise<void>((resolve) => {
        session.resolveQueryReady = resolve;
      });
    }
    this.relaunchQuery(session, unanswered);
  }

  /**
   * Register an in-flight session setup so prompts sent for `id` before
   * createSession() has run are held until it settles. The entry clears
   * itself once the setup resolves or rejects. `abort`, when given, is how
   * deleting the conversation stops the setup.
   */
  trackPendingSetup(id: string, setup: Promise<unknown>, abort?: AbortController): void {
    const settled = setup.then(() => undefined, () => undefined);
    this.pendingSetups.set(id, settled);
    if (abort) this.pendingSetupAborts.set(id, abort);
    else this.pendingSetupAborts.delete(id);
    settled.then(() => {
      if (this.pendingSetups.get(id) !== settled) return;
      this.pendingSetups.delete(id);
      if (this.pendingSetupAborts.get(id) === abort) this.pendingSetupAborts.delete(id);
    });
  }

  /**
   * Resolve once the session has a live query handle. If none is installed
   * but a new query is being initialized (e.g. right after stop), waits for it
   * to become ready. Returns false when there is nothing to send to.
   */
  private async awaitQueryHandle(session: ManagedSession): Promise<boolean> {
    const id = session.id;
    // A message for a sleeping conversation wakes it; the send then waits for
    // the restarted agent like a send right after a stop does.
    if (session.status === 'sleeping') this.wake(session);
    if (!session.queryHandle && session.queryReady) {
      logger.debug(`[sendMessage] session=${id} waiting for queryHandle after stop`);
      const QUERY_READY_TIMEOUT_MS = 30_000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), QUERY_READY_TIMEOUT_MS);
      });
      let result: unknown;
      try {
        result = await Promise.race([session.queryReady, timeout]);
      } finally {
        clearTimeout(timer);
      }
      if (result === 'timeout' || !session.queryHandle) {
        logger.warn(`[sendMessage] session=${id} timed out waiting for queryHandle`);
        return false;
      }
    }

    if (!session.queryHandle) {
      logger.debug(`[sendMessage] session=${id} no queryHandle`);
      return false;
    }
    return true;
  }

  async sendMessage(id: string, content: string, images?: import('../shared/types.js').ImageAttachment[]): Promise<boolean> {
    let session = this.sessions.get(id);

    // The session object is created at the end of setup; a prompt that
    // arrives during worktree creation or dependency install has nowhere to
    // go yet. Wait for setup to settle and look the session up again.
    if (!session) {
      const setup = this.pendingSetups.get(id);
      if (setup) {
        logger.debug(`[sendMessage] session=${id} waiting for session setup`);
        await setup;
        session = this.sessions.get(id);
      }
    }

    if (!session) {
      logger.debug(`[sendMessage] session=${id} no session`);
      return false;
    }

    if (!(await this.awaitQueryHandle(session))) return false;

    // A new turn supersedes any pending interrupt: don't let a stale flag
    // sanitize this turn's genuine result.
    session.interrupting = false;

    // Record in event history with UUID for checkpoint tracking.
    // Use emit() which handles eventHistory, disk persistence, and renderer notification.
    // Attached images are saved to disk and the event refers to them, so the
    // thread can show them again when the conversation is reopened.
    const uuid = crypto.randomUUID();
    // The composer only offers attachments to agents that take images; this
    // catches any that arrive anyway (a paste racing an agent switch).
    if (images?.length && !session.adapter.capabilities.imageAttachments) {
      session.emit?.({ type: 'status', level: 'warning', message: `${session.adapter.displayName} can't take images, so the attached image${images.length > 1 ? 's were' : ' was'} left out.` });
      images = undefined;
    }
    const storedImages = images?.length ? await saveImages(id, images) : [];
    const userEvent: AgentEvent = {
      type: 'user_message', text: content, uuid,
      ...(storedImages.length > 0 && { images: storedImages }),
    };
    session.emit?.(userEvent);

    // Snapshot the working tree before the agent gets the prompt. The capture
    // is awaited on purpose: fired concurrently, the agent could start editing
    // files while `git add -A` is still scanning, and the "before this turn"
    // checkpoint would silently include part of the turn. capture() never
    // throws; a false result means there is no checkpoint for this message,
    // which the thread shows so a later rewind attempt is not a surprise.
    // Label the checkpoint with what the chat shows, not attached file content.
    const captured = await session.checkpoints.capture(id, session.worktreePath, uuid, displayTextFromSent(content, images));
    // Without git there are no checkpoints to capture, so nothing failed.
    if (captured) {
      session.checkpointFailing = false;
    } else if (session.gitBacked) {
      logger.warn(`Checkpoint capture failed for ${id} uuid=${uuid}`);
      if (!session.checkpointFailing) {
        session.checkpointFailing = true;
        session.emit?.({
          type: 'error',
          message: 'Checkpoint could not be captured for this message, so rewinding to it will not be available. Later messages won\'t get one either until git works again. See the log for the git error.',
        });
      }
    }
    // The query may have been torn down while the snapshot ran (stop, model
    // switch); if a replacement is starting, hand the prompt to that one.
    if (!(await this.awaitQueryHandle(session))) return false;
    const queryHandle = session.queryHandle!;

    const sessionId = session.providerSessionId ?? '';
    logger.debug(`[sendMessage] session=${id} sending to adapter, providerSessionId=${sessionId || '(not yet initialized)'}${images?.length ? ` with ${images.length} image(s)` : ''}`);
    try {
      session.turnHandle = queryHandle;
      const message: UserMessage = { text: content, images };
      queryHandle.sendMessage(message);
      if (session.promptsBeforeInit?.handle === queryHandle) session.promptsBeforeInit.prompts.push(message);
      logger.debug(`[sendMessage] session=${id} sent successfully`);
      // Update last-active timestamp (fire-and-forget)
      worktreeManager.updateLastActive(id).catch(() => {});
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
    return !!session && answerPermission(session, decision);
  }

  /** Answer a pending MCP elicitation. Returns false when it already
   *  resolved (answered, cancelled or timed out). */
  respondToElicitation(id: string, requestId: string, response: McpElicitationResponse): boolean {
    const session = this.sessions.get(id);
    return !!session && answerElicitation(session, requestId, response);
  }

  setMode(id: string, mode: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    // Only modes the app offers. The value comes over IPC, and anything else
    // (e.g. the SDK's bypassPermissions) would be passed to the SDK as-is.
    if (!(PERMISSION_MODES as readonly string[]).includes(mode)) {
      logger.warn(`[setMode] session=${id} ignored unknown permission mode: ${mode}`);
      return;
    }

    const prevMode = session.permissionMode;

    // Always update permissionMode on the session so it persists across
    // stop/restart cycles — even when queryHandle is temporarily null.
    session.permissionMode = mode as ManagedSession['permissionMode'];

    // When leaving an edit-accepting mode (acceptEdits, readSafe or auto),
    // clear always-allowed edit tools so switching back to default/plan
    // re-enables permission prompts for edits.
    // Claude Code's edit tools, plus whatever tools this agent has asked to
    // run as edits (the 'edit' category, recorded by requestPermission).
    const acceptsEdits = (m: string) => m === 'acceptEdits' || m === 'readSafe' || m === 'auto';
    if (acceptsEdits(prevMode) && !acceptsEdits(mode)) {
      for (const tool of ['Edit', 'Write', 'MultiEdit', ...(session.editToolNames ?? [])]) {
        session.alwaysAllowedTools.delete(tool);
      }
    }

    // Entering read-safe mode with a live query: the sandbox is only applied
    // at query start, so until the next (re)start the read-only classifier is
    // the sole protection layer. Surface that honestly.
    if (mode === 'readSafe' && prevMode !== 'readSafe' && session.queryHandle && !session.sandbox) {
      session.emit?.({
        type: 'status',
        level: 'warning',
        message: 'Read-safe mode on: read-only tool calls run without asking. The sandbox only applies once the agent restarts, and may not start at all on this machine.',
      });
      if (!hasSandboxWarning(session.eventHistory)) {
        session.emit?.({ type: 'status', level: 'warning', message: READ_SAFE_SANDBOX_WARNING });
      }
    }

    // Pass the mode to the adapter so the SDK is kept in sync.
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
    if (!session || !model) return;
    // No live query to update yet (idle/not started) — just record the choice
    // so the next runQuery picks it up.
    if (!session.queryHandle?.setModel) {
      session.model = model;
      worktreeManager.saveModel(id, model).catch((e) => {
        logger.warn(`Failed to persist model for ${id}:`, e);
      });
      return;
    }
    try {
      await session.queryHandle.setModel(model);
      // Persist only after the live switch succeeds so it survives
      // stop/restart and resume cycles without diverging from the SDK.
      session.model = model;
      worktreeManager.saveModel(id, model).catch((e) => {
        logger.warn(`Failed to persist model for ${id}:`, e);
      });
      const before = session.controls;
      const controls = this.reconcileControls(session);
      // Values reset for the new model (e.g. an effort level it doesn't
      // offer) must reach the live query too, or the badge and the
      // provider disagree until the next query start.
      for (const [controlId, value] of Object.entries(controls.values)) {
        if (before[controlId] === value || !session.queryHandle.setControl) continue;
        try {
          await session.queryHandle.setControl(controlId, value);
        } catch (e) {
          logger.warn(`Failed to apply ${controlId}=${value} after model switch for ${id}:`, e);
        }
      }
      session.emit?.({ type: 'controls_sync', ...controls });
    } catch (e) {
      logger.warn(`Failed to set model for session ${id}:`, e);
      throw e;
    }
  }

  /**
   * Descriptors for the session's current model plus recorded values. Values
   * that are no longer offered (e.g. after switching to a model without fast
   * mode) are reset to the descriptor default so the renderer and the next
   * query start never see an option the provider can't honour.
   */
  private reconcileControls(session: ManagedSession): SessionControls {
    const descriptors = session.adapter.getControls(session.model);
    const values: Record<string, string> = {};
    for (const d of descriptors) {
      if (d.id === CONTROL_IDS.permissionMode) {
        // The permission mode lives in its own field, but it is still a
        // per-model option (native auto mode is not offered on every model),
        // so it falls back the same way — and the SDK and renderer are told.
        if (!d.options.some((o) => o.value === session.permissionMode)) {
          this.setMode(session.id, d.default);
          session.emit?.({ type: 'mode_sync', mode: session.permissionMode, source: 'session' });
        }
        continue;
      }
      const current = session.controls[d.id];
      values[d.id] = current !== undefined && d.options.some((o) => o.value === current) ? current : d.default;
    }
    session.controls = values;
    return { descriptors, values };
  }

  /** Controls for a session; an unknown id (e.g. a stopped session that was
   *  never restored) falls back to the default adapter's descriptors so the
   *  status bar still has something to render. */
  getControls(id: string): SessionControls {
    const session = this.sessions.get(id);
    if (!session) {
      return { descriptors: adapterRegistry.getDefault().getControls(null), values: {} };
    }
    return this.reconcileControls(session);
  }

  async setControl(id: string, controlId: string, value: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    if (controlId === CONTROL_IDS.permissionMode) {
      throw new Error('permissionMode is set through setMode');
    }
    const descriptor = session.adapter.getControls(session.model).find((d) => d.id === controlId);
    if (!descriptor) throw new Error(`Unknown control "${controlId}" for ${session.adapter.displayName}`);
    if (!descriptor.options.some((o) => o.value === value)) {
      throw new Error(`"${value}" is not a valid ${descriptor.label} option for ${session.model ?? 'the default model'}`);
    }
    // Record even without a live handle so the next query start picks it up
    session.controls = { ...session.controls, [controlId]: value };
    if (session.queryHandle?.setControl) {
      try {
        await session.queryHandle.setControl(controlId, value);
      } catch (e) {
        logger.warn(`Failed to set ${controlId} for session ${id}:`, e);
        throw e;
      }
    }
    session.emit?.({ type: 'controls_sync', ...this.reconcileControls(session) });
  }

  /** Plan usage for the session's provider; null without a live query or when
   *  the adapter cannot report it. Failures are logged, never surfaced — the
   *  popover treats null as "nothing to show". */
  async getUsage(id: string): Promise<ProviderUsage | null> {
    const session = this.sessions.get(id);
    if (!session?.queryHandle?.getUsage || session.adapter.capabilities.usage !== true) return null;
    try {
      return await session.queryHandle.getUsage();
    } catch (e) {
      logger.warn(`Failed to fetch usage for session ${id}:`, e);
      return null;
    }
  }

  async listMcpServers(id: string): Promise<McpServerInfo[]> {
    const session = this.sessions.get(id);
    if (!session?.queryHandle?.listMcpServers) return [];
    try {
      return await session.queryHandle.listMcpServers();
    } catch (e) {
      logger.warn(`Failed to list MCP servers for session ${id}:`, e);
      return [];
    }
  }

  async getMcpContextCost(id: string): Promise<McpServerContextCost[]> {
    const session = this.sessions.get(id);
    if (!session?.queryHandle?.getMcpContextCost) return [];
    try {
      return await session.queryHandle.getMcpContextCost();
    } catch (e) {
      logger.warn(`Failed to read MCP context cost for session ${id}:`, e);
      return [];
    }
  }

  async reconnectMcpServer(id: string, serverName: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session?.queryHandle?.reconnectMcpServer) {
      throw new Error('MCP server control is not available for this conversation');
    }
    try {
      await session.queryHandle.reconnectMcpServer(serverName);
    } catch (e) {
      logger.warn(`Failed to reconnect MCP server "${serverName}" for session ${id}:`, e);
      throw e;
    }
  }

  async authenticateMcpServer(id: string, serverName: string): Promise<McpAuthStartResult> {
    const session = this.sessions.get(id);
    if (!session?.queryHandle?.authenticateMcpServer) {
      throw new Error('MCP sign-in is not available for this conversation');
    }
    try {
      return await session.queryHandle.authenticateMcpServer(serverName);
    } catch (e) {
      logger.warn(`Failed to start sign-in for MCP server "${serverName}" in session ${id}:`, e);
      throw e;
    }
  }

  async setMcpServerEnabled(id: string, serverName: string, enabled: boolean): Promise<void> {
    const session = this.sessions.get(id);
    if (!session?.queryHandle?.setMcpServerEnabled) {
      throw new Error('MCP server control is not available for this conversation');
    }
    try {
      await session.queryHandle.setMcpServerEnabled(serverName, enabled);
    } catch (e) {
      logger.warn(`Failed to ${enabled ? 'enable' : 'disable'} MCP server "${serverName}" for session ${id}:`, e);
      throw e;
    }
  }

  /** Whether the agent is in the middle of a turn (a message sent or a reply
   *  under way). Same test idle sleep uses. */
  isMidTurn(id: string): boolean {
    const session = this.sessions.get(id);
    return !!session && (session.isStartingQuery || (!!session.turnHandle && session.turnHandle === session.queryHandle));
  }

  setBranch(id: string, newBranch: string): void {
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

  /**
   * Stop the current turn the user-facing way: interrupt it in place while
   * keeping the agent process alive, so the next message is instant (no cold
   * respawn + resume).  Falls back to the heavier stopQuery() teardown when the
   * adapter can't interrupt or there's no live query to interrupt (e.g. a stop
   * that lands mid-startup).
   */
  async interruptQuery(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;

    const handle = session.queryHandle;

    // No live handle (still starting up, already torn down) or an adapter that
    // doesn't support in-place interrupt → fall back to the teardown+respawn
    // path, which already handles the startup race via restartRequested.
    if (!handle || typeof handle.interrupt !== 'function') {
      return this.stopQuery(id);
    }

    const emit = session.emit ?? this.createEmitter(session);

    // Resolve any pending permissions as denied first so the SDK isn't left
    // awaiting a tool decision.  The process is still alive, so these control
    // responses write cleanly (unlike stopQuery, which closes the transport
    // before resolving and trips "ProcessTransport is not ready for writing").
    denyPendingPermissions(session, 'Query stopped by user', emit);
    cancelElicitations(session);

    // Interrupt the current turn.  The event loop in runQuery stays parked on
    // handle.events and simply waits for the next user message — no respawn.
    // Flag the interrupt so the resulting turn's abort/teardown noise (reported
    // via the result's errors or a thrown abort) is treated as a clean stop.
    session.interrupting = true;
    try {
      await handle.interrupt();
    } catch (err) {
      session.interrupting = false;
      logger.warn(`[interruptQuery] session=${id} interrupt failed, falling back to teardown:`, err);
      return this.stopQuery(id);
    }
    // The turn is over even if the agent never reports a result for it.
    if (session.turnHandle === handle) session.turnHandle = null;

    // Re-sync the renderer with the current permission mode (parity with
    // stopQuery) — this also clears the renderer's stoppingSession guard so
    // permission requests from the continuing query aren't suppressed.
    emit({ type: 'mode_sync', mode: session.permissionMode, source: 'session' });
  }

  /**
   * Stop a single background task without touching the current turn. Throws
   * when the session has no live handle or the adapter can't stop tasks, so
   * the renderer can surface the failure instead of silently doing nothing.
   */
  async stopTask(id: string, taskId: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    const handle = session.queryHandle;
    if (!handle || typeof handle.stopTask !== 'function') {
      throw new Error('This session cannot stop background tasks');
    }
    await handle.stopTask(taskId);
  }

  /**
   * Stop the current query but keep the session alive so the user can send
   * follow-up messages without losing state or remounting the UI.
   */
  async stopQuery(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    // Asleep: there is no query to stop. A rewind's fork point (set before
    // this is called) is picked up when the session wakes.
    if (session.status === 'sleeping') return;
    // Waking while the sleep is still killing the old agent: starting a run
    // now would put a second agent on the transcript beside it, and the
    // wake would then start a third. Wait for the wake's run to begin; this
    // stop then restarts it through restartRequested like any stop during
    // startup.
    if (session.sleepSettled) {
      await session.sleepSettled;
      // Re-read after the wait (TypeScript keeps the check above's narrowing)
      if (session.destroying || (session.status as SessionStatus) === 'sleeping' || !this.sessions.has(id)) return;
    }

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
    denyPendingPermissions(session, 'Query stopped by user', emit);
    cancelElicitations(session);

    // Re-sync the renderer with the current permission mode so the status bar
    // reflects the correct state after a stop/restart cycle.
    emit({ type: 'mode_sync', mode: session.permissionMode, source: 'session' });

    // Create a deferred promise so sendMessage() can wait for the new
    // queryHandle. Keep one that's still pending (e.g. a wake's): messages
    // already waiting on it would otherwise never be delivered.
    if (!session.resolveQueryReady) {
      session.queryReady = new Promise<void>((resolve) => {
        session.resolveQueryReady = resolve;
      });
    }

    // Start a new query loop — the session stays in the map so sendMessage works
    this.runQuery(session, emit).catch((err) => {
      console.error(`[runQuery] session=${id} FAILED after stop:`, err);
      const errMsg = String(err.message || err);
      const isAuthError = isAuthFailure(errMsg);
      emit({ type: 'error', message: isAuthError
        ? session.adapter.authErrorMessage
        : errMsg });
    });
  }

  /**
   * Put an idle conversation to sleep to free its agent process. The agent
   * and everything under it (MCP servers) are killed, but the session stays,
   * so the conversation keeps its place, mode, controls and always-allowed
   * tools. The terminal is left alone. It wakes (see wake()) when opened or
   * sent a message. Returns false, leaving it awake, unless the agent is up
   * and not mid-turn or waiting on a permission or an MCP elicitation.
   */
  async sleepSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session || session.destroying) return false;
    if (session.status !== 'running' && session.status !== 'starting') return false;
    const handle = session.queryHandle;
    if (!handle || session.isStartingQuery || session.pendingPermissions.size > 0 || session.pendingElicitations.size > 0) return false;
    if (session.turnHandle === handle) return false;

    session.statusBeforeSleep = session.status;
    session.status = 'sleeping';
    // Detach the query first: runQuery treats a run whose handle is no longer
    // the session's as retired, so the agent exiting below is neither an error
    // nor the end of the conversation.
    session.queryHandle = null;
    const abortController = session.abortController;
    session.abortController = new AbortController();
    if (!session.window.isDestroyed()) {
      session.window.webContents.send(IPC.SESSION_STATUS, id, 'sleeping');
    }

    const settled = (async () => {
      // Kill the tree while the agent is still running, as shutDown() does.
      const pid = handle.processId?.();
      if (pid) {
        await killTree(pid);
        logger.info(`Put session ${id} to sleep: killed agent pid=${pid}`);
      }
      try { handle.close(); } catch { /* may already be closed */ }
      abortController.abort();
    })();
    session.sleepSettled = settled;
    await settled;
    if (session.sleepSettled === settled) session.sleepSettled = null;
    return true;
  }

  /** Wake a sleeping conversation. No-op for any other state. */
  wakeSession(id: string): void {
    const session = this.sessions.get(id);
    if (session?.status === 'sleeping') this.wake(session);
  }

  /** Restart a sleeping session's agent on the same provider transcript.
   *  Messages sent meanwhile wait on queryReady (see awaitQueryHandle). */
  private wake(session: ManagedSession): void {
    const { id } = session;
    session.status = session.statusBeforeSleep ?? 'running';
    session.statusBeforeSleep = null;
    session.queryReady = new Promise<void>((resolve) => {
      session.resolveQueryReady = resolve;
    });
    if (!session.window.isDestroyed()) {
      session.window.webContents.send(IPC.SESSION_STATUS, id, 'running');
    }
    const emit = session.emit ?? this.createEmitter(session);
    const asleep = session.sleepSettled;
    (async () => {
      await asleep;
      // Closed or deleted while the sleep was still finishing.
      if (session.destroying) return;
      await this.runQuery(session, emit);
    })().catch((err) => {
      console.error(`[runQuery] session=${id} FAILED on wake:`, err);
      const errMsg = String(err?.message || err);
      const isAuthError = isAuthFailure(errMsg);
      emit({ type: 'error', message: isAuthError ? session.adapter.authErrorMessage : errMsg });
      session.status = 'error';
      if (!session.window.isDestroyed()) {
        session.window.webContents.send(IPC.SESSION_STATUS, id, 'error');
      }
    });
  }

  /**
   * Close a conversation without deleting it: stop the agent process and
   * everything it started (background tasks, dev servers and the ports they
   * hold), and drop the live session. Opening the conversation again resumes
   * it from the provider's transcript, as after an app restart. Checkpoint
   * refs and the worktree are kept.
   */
  closeSession(id: string): Promise<void> {
    const inFlight = this.closing.get(id);
    if (inFlight) return inFlight;
    const session = this.sessions.get(id);
    if (!session) {
      // Still being set up (new worktree, dependency install, resume): close
      // it once it exists, or setup would start an agent after the close.
      const setup = this.pendingSetups.get(id);
      return setup ? setup.then(() => this.closeSession(id)) : Promise.resolve();
    }

    // Out of the map at once so a reopen can't reattach to the dying agent;
    // createSession() waits on `closing` instead.
    this.sessions.delete(id);
    const closed = (async () => {
      try {
        await this.shutDown(session, 'Conversation closed');
      } catch (err) {
        logger.warn(`Closing session ${id} failed:`, err);
      } finally {
        this.events.flush(session);
        this.events.forget(id);
        session.status = 'stopped';
        if (!session.window.isDestroyed()) {
          session.window.webContents.send(IPC.SESSION_STATUS, id, 'stopped');
        }
        this.closing.delete(id);
      }
    })();
    this.closing.set(id, closed);
    return closed;
  }

  async destroySession(id: string): Promise<void> {
    // Setup still running (new worktree, dependency install, resume): stop
    // it where it can stop (a deleted conversation needs no install or agent)
    // and wait for it, so it can't start an agent afterwards.
    this.pendingSetupAborts.get(id)?.abort();
    await this.pendingSetups.get(id);
    // A close still shutting the agent down finishes first.
    await this.closing.get(id);
    const session = this.sessions.get(id);
    if (!session) {
      // A closed conversation has no live session, but a memory auto-save may
      // still be pending, its metadata hasn't been saved, and its checkpoint
      // refs are still in the repository.
      memoryAutosave.cancelAutoSave(id);
      const worktree = await worktreeManager.getWorktreeOrManifest(id).catch(() => undefined);
      if (worktree) {
        memoryAutosave.saveSessionMetadata(worktree.repoPath, id, this.getEventHistory(id), worktree.branch);
        if (!worktree.noGit) await new CheckpointManager().cleanup(id, worktree.path).catch(err => {
          logger.warn(`Checkpoint cleanup failed for ${id}:`, err);
        });
      }
      this.events.forget(id);
      return;
    }

    // Cancel any pending auto-save debounce and save heuristic metadata
    memoryAutosave.cancelAutoSave(id);
    memoryAutosave.saveSessionMetadata(session.repoPath, id, session.eventHistory, session.branch);

    await this.shutDown(session, 'Session destroyed');

    // Clean up checkpoint refs
    await session.checkpoints.cleanup(id, session.worktreePath).catch(err => {
      logger.warn(`Checkpoint cleanup failed for ${id}:`, err);
    });

    // Wait for Windows file handles to release
    await new Promise((r) => setTimeout(r, 500));

    this.events.flush(session);
    this.events.forget(id);
    this.sessions.delete(id);
  }

  /**
   * Stop a session's agent for good: kill the agent process and everything
   * under it (background tasks, dev servers, MCP servers), close its query
   * and deny pending permissions.
   */
  private async shutDown(session: ManagedSession, reason: string): Promise<void> {
    const { id } = session;

    // Must be set before the agent is killed or its query closed: either ends
    // runQuery's event loop, whose tail would otherwise treat this as a normal
    // query end (see runQuery).
    session.destroying = true;

    // A sleep still killing the agent: let it finish, so a reopen right after
    // the close can't start a second agent on the same transcript.
    await session.sleepSettled;

    // Kill the agent's process tree while the agent is still running. Once it
    // exits, whatever it left running can no longer be traced back to it.
    const pid = session.queryHandle?.processId?.();
    if (pid) {
      await killTree(pid);
      logger.info(`Killed agent process tree for ${id}: pid=${pid}`);
    }

    // Close the query and input stream before aborting so the SDK tidies up its side
    try {
      session.queryHandle?.close();
    } catch { /* may already be closed */ }

    // Abort any remaining in-flight operations
    session.abortController.abort();

    // Resolve any pending permissions as denied
    denyPendingPermissions(session, reason, session.emit);
    cancelElicitations(session);

    // Clean up completion callback and event listeners
    this.completionCallbacks.delete(id);
    this.eventListeners.delete(id);
  }

  /** App quit: stop every live agent the way closing its conversation does.
   *  Worktrees, branches and checkpoints stay, so the conversations reopen
   *  on the next launch. */
  async closeAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) void this.closeSession(id);
    await this.waitForCloses();
  }

  /** Resolves once every conversation being closed has finished shutting down. */
  async waitForCloses(): Promise<void> {
    await Promise.all(this.closing.values());
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
    this.events.append(session, event);
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

  /** Start a search request (see SessionEventStore.beginSearch). Returns a
   *  function that ends it. */
  beginSearch(opts: { sweep?: boolean } = {}): () => void {
    return this.events.beginSearch(opts);
  }

  /** Search a session's history, newest match first (see searchEvents). */
  searchEventHistory(id: string, query: string, limit: number): EventSearchHit[] {
    return this.events.search(id, this.sessions.get(id)?.eventHistory, query, limit);
  }

  /** Rewind files on disk to their state at a specific user message checkpoint.
   *  When options.conversationOnly is true, only truncate the conversation
   *  without restoring files on disk. When options.filesOnly is true, only
   *  restore the files: the conversation, event history and later checkpoint
   *  refs are untouched (used for checkpoints from before a /clear, whose
   *  messages are gone). */
  async rewindFiles(id: string, userMessageId: string, options?: import('../shared/types.js').RewindOptions): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Conversation ${id} not found`);

    // A running turn would keep editing files while, and after, they are
    // restored. Stop it first; the query itself is restarted at the end.
    if (this.isMidTurn(id)) await this.interruptQuery(id);

    // A checkpoint whose message is no longer in the conversation (rewound
    // away earlier, or from before a /clear) can only have its files restored.
    // Without this guard the fork point below would come back null and the
    // "rewind" would silently start a brand-new conversation.
    const inConversation = session.eventHistory.some(
      (e) => e.type === 'user_message' && e.uuid === userMessageId,
    );
    if (options?.filesOnly || !inConversation) {
      if (options?.conversationOnly) {
        throw new Error('That message is no longer part of the conversation, so there is nothing to rewind. Its files can still be restored.');
      }
      await session.checkpoints.restore(id, session.worktreePath, userMessageId);
      session.emit?.({ type: 'rewind', toMessageId: userMessageId, filesOnly: true });
      return;
    }

    if (!options?.conversationOnly) {
      await session.checkpoints.restore(id, session.worktreePath, userMessageId);
    }

    // Remove orphaned checkpoint refs for turns after the rewind point
    await session.checkpoints.pruneAfter(id, session.worktreePath, userMessageId);

    // Cancel any pending memory auto-save so notes about the turns being
    // rewound away aren't extracted and persisted after the truncation.
    memoryAutosave.cancelAutoSave(id);

    // Fork point for a truncating resume: the provider uuid of the last
    // assistant event before the rewind target. Must be computed before the
    // event history is truncated below.
    const forkPoint = session.providerSessionId
      ? findRewindForkPoint(session.eventHistory, userMessageId)
      : null;
    // Without a truncating resume the agent would keep the rewound turns in
    // its memory, so it starts over instead (the else branch below).
    const canFork = session.adapter.capabilities.resume && session.adapter.capabilities.rewind === true;

    // Truncate event history to the rewind point so replays after refresh
    // don't resurrect events that occurred after the rewound turn.
    const rewindIdx = session.eventHistory.findLastIndex(
      (e) => e.type === 'user_message' && e.uuid === userMessageId,
    );
    if (rewindIdx >= 0) {
      // Exclude the rewind target message — it gets placed back into the
      // input. The disk log is rewritten to match.
      this.events.replace(session, session.eventHistory.slice(0, rewindIdx));
    }

    session.emit?.({ type: 'rewind', toMessageId: userMessageId, conversationOnly: options?.conversationOnly });
    // Starting over below turns the agent could fork from: mark where the new
    // conversation begins, so a later rewind can't fork into the old one.
    if (!(forkPoint && canFork) && lastTurnUuid(session.eventHistory)) {
      session.emit?.({
        type: 'status',
        level: 'warning',
        newConversation: true,
        message: canFork
          ? `${session.adapter.displayName} starts a new conversation from here. The thread above stays, but the agent won't remember it.`
          : `${session.adapter.displayName} can't forget part of a conversation, so it starts a new one from here. The thread above stays, but the agent won't remember it.`,
      });
    }

    if (forkPoint && canFork) {
      // True rewind: resume the same conversation truncated at the last kept
      // chain entry, forked to a new provider session — the agent keeps the
      // turns before the rewind point and genuinely forgets everything after.
      session.pendingResumeAt = forkPoint;
    } else {
      // No provider content to keep (rewind to the first message, or the
      // provider session never initialised) — start a fresh conversation.
      session.providerSessionId = null;
      session.pendingResumeAt = null;
    }

    // Persist an empty provider session id in both cases. If the app dies
    // before the restarted query's system_init persists the forked session's
    // new id, an app-restart resume of the OLD id would bring the rewound
    // messages back; degrading to a fresh conversation is the safe fallback.
    worktreeManager.saveProviderSessionId(id, '').catch(() => { /* non-fatal */ });

    // Restart the query. stopQuery() tears down the current handle and calls
    // runQuery(), which picks up pendingResumeAt (truncated fork resume) or —
    // with providerSessionId null — starts a fresh conversation.
    await this.stopQuery(id);

    // After the stop, so a tool result from the old query can't save an image
    // after the check. The rewound turns' images are no longer shown.
    void pruneImages(id, session.eventHistory);
  }

  /** Dry-run rewind to get the diff of what would change. */
  async getCheckpointDiff(id: string, userMessageId: string): Promise<string> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Conversation ${id} not found`);

    return session.checkpoints.diff(id, session.worktreePath, userMessageId);
  }

  /** List all checkpoints for a session. */
  async listCheckpoints(id: string): Promise<import('../shared/types.js').CheckpointListItem[]> {
    const session = this.sessions.get(id);
    if (!session) return [];
    return session.checkpoints.list(id, session.worktreePath);
  }

  /** Per-turn diff history (what each turn changed) plus cumulative stats. */
  async getDiffHistory(id: string): Promise<import('../shared/types.js').DiffHistoryResult> {
    const session = this.sessions.get(id);
    if (!session) return { entries: [], total: { filesChanged: 0, additions: 0, deletions: 0 } };
    return session.checkpoints.history(id, session.worktreePath);
  }

  /** Unified diff of what a single turn changed. */
  async getTurnDiff(id: string, userMessageId: string): Promise<string> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Conversation ${id} not found`);
    return session.checkpoints.turnDiff(id, session.worktreePath, userMessageId);
  }

  /** Cumulative diff from the session baseline to the current working tree. */
  async getFullThreadDiff(id: string): Promise<string> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Conversation ${id} not found`);
    return session.checkpoints.fullThreadDiff(id, session.worktreePath);
  }

  /** Files changed across a checkpoint comparison (for the review panel). */
  async getCheckpointFiles(id: string, uuid: string, scope: import('../shared/types.js').CheckpointDiffScope): Promise<import('../shared/types.js').GitStatusResult> {
    const session = this.sessions.get(id);
    if (!session) return { entries: [], scopeError: 'Conversation not found' };
    return session.checkpoints.files(id, session.worktreePath, uuid, scope);
  }

  async getCheckpointFileDiff(id: string, uuid: string, scope: import('../shared/types.js').CheckpointDiffScope, relPath: string): Promise<import('../shared/types.js').FileDiffResult> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Conversation ${id} not found`);
    return session.checkpoints.fileDiff(id, session.worktreePath, uuid, scope, relPath);
  }

  async getCheckpointFileLines(id: string, uuid: string, scope: import('../shared/types.js').CheckpointDiffScope, relPath: string): Promise<import('../shared/types.js').FileLinesResult> {
    const session = this.sessions.get(id);
    if (!session) return null;
    return session.checkpoints.fileLines(id, session.worktreePath, uuid, scope, relPath);
  }

  /** Return all buffered events for replay after renderer reload. Falls back to disk log. */
  getEventHistory(id: string): AgentEvent[] {
    const session = this.sessions.get(id);
    if (session) return session.eventHistory;
    return this.events.load(id);
  }

  /** Return the total number of events for a session. */
  getEventHistoryCount(id: string): number {
    const session = this.sessions.get(id);
    if (session) return session.eventHistory.length;
    return this.events.load(id).length;
  }

  /** Return a page of events from the end of the history.
   *  Returns `limit` events ending before `beforeIndex` (exclusive).
   *  If beforeIndex is undefined, returns the last `limit` events. */
  getEventHistoryPage(id: string, limit: number, beforeIndex?: number): { events: AgentEvent[]; totalCount: number; startIndex: number } {
    const all = this.getEventHistory(id);
    const totalCount = all.length;
    const end = beforeIndex !== undefined ? Math.min(beforeIndex, totalCount) : totalCount;
    const start = Math.max(0, end - limit);
    return {
      events: all.slice(start, end),
      totalCount,
      startIndex: start,
    };
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
          branchName: session.branch,
          adapterType: session.adapter.id,
          onStatus: (status, filesWritten) => {
            session.emit?.({ type: 'memory_autosave', status, filesWritten });
          },
        });
      }
      this.events.replace(session, []);
      // Keep the checkpoint refs — the user can still restore files to any
      // earlier turn — but capture a clear sentinel so the Checkpoints tab can
      // separate the cleared conversation's turns from the new one's (the
      // post-/clear system_init's resume() re-reads all refs).
      session.checkpoints.markCleared(id, session.worktreePath).catch((err) => {
        logger.warn(`[clearEventHistory] checkpoint clear marker failed for ${id}:`, err);
      });
    } else {
      // Session not running — clear disk log directly
      this.events.clearStored(id);
    }
    // No event refers to the thread's images any more.
    void removeImages(id);
  }

  /** Session ids that were running when the system suspended. Captured on
   *  'suspend' so that on 'resume' we can bring back exactly the tabs that were
   *  live before sleep (their SDK queries usually die during suspend). */
  private runningAtSuspend = new Set<string>();

  /** Snapshot the running sessions at suspend so wake-from-sleep can resume them. */
  captureSuspendState(): void {
    const ids = new Set<string>();
    for (const [id, session] of this.sessions) {
      if (session.status === 'running') ids.add(id);
    }
    this.runningAtSuspend = ids;
  }

  /**
   * Health-check all sessions after system resume. Detects sessions whose SDK
   * query died silently (e.g. during sleep) and emits process_exit +
   * SESSION_STATUS so the renderer updates. Returns the ids of sessions that
   * were running before sleep but are no longer running — the tabs the renderer
   * should resume so they don't silently close.
   */
  healthCheckAll(): string[] {
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

    // Tabs to bring back: those that were running before sleep but whose query
    // didn't survive it. Sessions that stayed running are left alone.
    const toResume: string[] = [];
    for (const id of this.runningAtSuspend) {
      const session = this.sessions.get(id);
      if (session && session.status !== 'running') toResume.push(id);
    }
    this.runningAtSuspend.clear();
    return toResume;
  }

  get count(): number {
    return this.sessions.size;
  }

  /** Conversations still shutting down after closeSession(). */
  get closingCount(): number {
    return this.closing.size;
  }
}

export const sessionManager = new AgentSessionManager();
