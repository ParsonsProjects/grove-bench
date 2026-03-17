import type { AgentEvent, PermissionDecision, PermissionMode } from '../../shared/types.js';

// ─── Chat message types ───

export interface ChatTextMessage {
  kind: 'text';
  id: string;
  text: string;
  uuid: string;
}

export interface ChatToolCallMessage {
  kind: 'tool_call';
  id: string;
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
  uuid: string;
  result?: string;
  isError?: boolean;
  pending: boolean;
}

export interface ChatUserMessage {
  kind: 'user';
  id: string;
  text: string;
}

export interface ChatSystemMessage {
  kind: 'system';
  id: string;
  text: string;
}

export interface ChatErrorMessage {
  kind: 'error';
  id: string;
  text: string;
}

export interface ChatResultMessage {
  kind: 'result';
  id: string;
  subtype: string;
  result?: string;
  totalCostUsd?: number;
  durationMs?: number;
  isError: boolean;
  errors?: string[];
}

export interface ChatPermissionMessage {
  kind: 'permission';
  id: string;
  requestId: string;
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
  resolved: boolean;
  decision?: 'allow' | 'deny';
  decisionReason?: string;
  suggestions?: unknown[];
}

export interface ChatThinkingMessage {
  kind: 'thinking';
  id: string;
  thinking: string;
}

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionItem {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface ChatQuestionMessage {
  kind: 'question';
  id: string;
  requestId: string;
  toolUseId: string;
  questions: QuestionItem[];
  resolved: boolean;
  response?: string;
  /** Exact labels that were selected, for accurate resolved-state rendering */
  selectedLabels?: string[];
}

export type ChatMessage =
  | ChatTextMessage
  | ChatToolCallMessage
  | ChatUserMessage
  | ChatSystemMessage
  | ChatErrorMessage
  | ChatResultMessage
  | ChatPermissionMessage
  | ChatThinkingMessage
  | ChatQuestionMessage;

// ─── Store ───

let msgCounter = 0;
function nextId(): string {
  return `msg_${++msgCounter}_${Date.now()}`;
}

class MessageStore {
  /** All finalized messages per session */
  messagesBySession = $state<Record<string, ChatMessage[]>>({});

  /** Streaming text that hasn't been finalized yet */
  streamingText = $state<Record<string, string>>({});

  /** Streaming thinking text that hasn't been finalized yet */
  streamingThinking = $state<Record<string, string>>({});

  /** Whether Claude is currently processing for a session */
  isRunning = $state<Record<string, boolean>>({});

  /** Whether a /clear was issued and we're waiting for re-init */
  pendingClear = $state<Record<string, boolean>>({});

  /** Current activity per session (what the LLM is doing right now) */
  activityBySession = $state<Record<string, { activity: 'thinking' | 'tool_starting' | 'generating' | 'idle'; toolName?: string; elapsedSeconds?: number; toolSummary?: string }>>({});

  /** Per-tool progress tracking — maps toolUseId to progress info */
  toolProgressBySession = $state<Record<string, Record<string, { toolName: string; elapsedSeconds: number }>>>({});

  /** Whether the session has initialized (received system_init) and can accept messages */
  isReady = $state<Record<string, boolean>>({});

  /** Model name per session */
  modelBySession = $state<Record<string, string>>({});

  /** Current permission mode per session */
  modeBySession = $state<Record<string, PermissionMode>>({});

  /** Whether thinking/extended reasoning is enabled per session */
  thinkingBySession = $state<Record<string, boolean>>({});

  /** Token usage per session — inputTokens is latest (= current context size), outputTokens is cumulative */
  usageBySession = $state<Record<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }>>({});

  /** System info per session (from system_init) */
  systemInfoBySession = $state<Record<string, {
    tools: string[];
    agents: string[];
    skills: string[];
    slashCommands: string[];
    mcpServers: { name: string; status: string }[];
  }>>({});

  /** Context window size per session (from result's modelUsage, or default 200k) */
  contextWindowBySession = $state<Record<string, number>>({});

  /** Number of turns per session */
  turnsBySession = $state<Record<string, number>>({});

  /** Detected dev server ports per session */
  devServersBySession = $state<Record<string, { port: number; url: string }[]>>({});

  /** Rate limit state per session */
  rateLimitBySession = $state<Record<string, { status: 'allowed' | 'allowed_warning' | 'rejected'; resetsAt?: number; utilization?: number; rateLimitType?: string }>>({});

  /** Prompt suggestions per session (from SDK) */
  promptSuggestionsBySession = $state<Record<string, string[]>>({});

  /** Background task tracking per session */
  backgroundTasksBySession = $state<Record<string, Record<string, { taskId: string; description: string; taskType?: string; summary?: string; lastToolName?: string; status: 'running' | 'completed' | 'failed' | 'stopped'; totalTokens: number; toolUses: number; durationMs: number }>>>({});

  /** Files that have been reverted in the changes review panel */
  revertedFilesBySession = $state<Record<string, Set<string>>>({});

  /** Active tab per session (survives component remount) */
  activeTabBySession = $state<Record<string, 'activity' | 'changes' | 'plan'>>({});

  /** Whether to show detailed tool calls & thinking per session (default: false = summary mode) */
  showDetailsBySession = $state<Record<string, boolean>>({});

  private cleanups = new Map<string, () => void>();

  getMessages(sessionId: string): ChatMessage[] {
    return this.messagesBySession[sessionId] ?? [];
  }

  getStreamingText(sessionId: string): string {
    return this.streamingText[sessionId] ?? '';
  }

  getStreamingThinking(sessionId: string): string {
    return this.streamingThinking[sessionId] ?? '';
  }

  getIsRunning(sessionId: string): boolean {
    return this.isRunning[sessionId] ?? false;
  }

  getIsReady(sessionId: string): boolean {
    return this.isReady[sessionId] ?? false;
  }

  getModel(sessionId: string): string {
    return this.modelBySession[sessionId] ?? '';
  }

  setModelOverride(sessionId: string, model: string): void {
    this.modelBySession[sessionId] = model;
  }

  getMode(sessionId: string): PermissionMode {
    return this.modeBySession[sessionId] ?? 'default';
  }

  getThinking(sessionId: string): boolean {
    return this.thinkingBySession[sessionId] ?? true;
  }

  async setThinking(sessionId: string, enabled: boolean) {
    this.thinkingBySession[sessionId] = enabled;
    await window.groveBench.setThinking(sessionId, enabled);
  }

  getUsage(sessionId: string) {
    return this.usageBySession[sessionId] ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  }

  getSystemInfo(sessionId: string) {
    return this.systemInfoBySession[sessionId] ?? { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [] };
  }

  getContextWindow(sessionId: string): number {
    return this.contextWindowBySession[sessionId] ?? 200_000;
  }

  getTurns(sessionId: string): number {
    return this.turnsBySession[sessionId] ?? 0;
  }

  getActivity(sessionId: string) {
    return this.activityBySession[sessionId] ?? { activity: 'idle' as const };
  }

  getActiveTab(sessionId: string): 'activity' | 'changes' | 'plan' {
    return this.activeTabBySession[sessionId] ?? 'activity';
  }

  setActiveTab(sessionId: string, tab: 'activity' | 'changes' | 'plan') {
    this.activeTabBySession[sessionId] = tab;
  }

  getShowDetails(sessionId: string): boolean {
    return this.showDetailsBySession[sessionId] ?? false;
  }

  setShowDetails(sessionId: string, show: boolean) {
    this.showDetailsBySession[sessionId] = show;
  }

  getDevServers(sessionId: string): { port: number; url: string }[] {
    return this.devServersBySession[sessionId] ?? [];
  }

  getRateLimit(sessionId: string) {
    return this.rateLimitBySession[sessionId] ?? null;
  }

  getPromptSuggestions(sessionId: string): string[] {
    return this.promptSuggestionsBySession[sessionId] ?? [];
  }

  clearPromptSuggestions(sessionId: string) {
    this.promptSuggestionsBySession[sessionId] = [];
  }

  getBackgroundTasks(sessionId: string) {
    return Object.values(this.backgroundTasksBySession[sessionId] ?? {});
  }

  /** Remove a completed/failed/stopped background task from the list */
  removeBackgroundTask(sessionId: string, taskId: string) {
    const tasks = this.backgroundTasksBySession[sessionId];
    if (!tasks?.[taskId]) return;
    const { [taskId]: _, ...rest } = tasks;
    this.backgroundTasksBySession[sessionId] = rest;
  }

  /** Get all currently pending tool calls with their progress info. */
  getPendingTools(sessionId: string): { toolName: string; toolUseId: string; summary: string; elapsedSeconds?: number }[] {
    const msgs = this.messagesBySession[sessionId] ?? [];
    const progress = this.toolProgressBySession[sessionId] ?? {};
    const pending: { toolName: string; toolUseId: string; summary: string; elapsedSeconds?: number }[] = [];
    for (const m of msgs) {
      if (m.kind === 'tool_call' && m.pending) {
        const p = progress[m.toolUseId];
        pending.push({
          toolName: m.toolName,
          toolUseId: m.toolUseId,
          summary: this.summarizeToolInput(m.toolName, m.toolInput),
          elapsedSeconds: p?.elapsedSeconds,
        });
      }
    }
    return pending;
  }

  private summarizeToolInput(toolName: string, input: unknown): string {
    if (typeof input !== 'object' || input === null) return '';
    const obj = input as Record<string, unknown>;
    if (toolName === 'Bash' && obj.command) return String(obj.command).slice(0, 60);
    if (toolName === 'Agent' && obj.prompt) return String(obj.prompt).slice(0, 60);
    if (obj.file_path) return String(obj.file_path);
    if (obj.pattern) return String(obj.pattern);
    if (obj.description) return String(obj.description).slice(0, 60);
    return '';
  }

  /**
   * Get all file changes across the entire thread, grouped by file path.
   * Each file keeps only the edits from its most recent turn (the last turn
   * that touched it), so changes persist across conversation continuations
   * until the file is updated by newer edits.
   */
  getLastTurnFileChanges(sessionId: string): { filePath: string; toolName: string; toolInput: unknown; edits: ChatToolCallMessage[] }[] {
    const msgs = this.messagesBySession[sessionId] ?? [];
    if (msgs.length === 0) return [];

    // Must have at least one completed turn (result message)
    const hasResult = msgs.some(m => m.kind === 'result');
    if (!hasResult) return [];

    // Split messages into turns (user → result boundaries)
    // Each turn's edits for a file supersede earlier turns' edits for the same file
    const byFile = new Map<string, { edits: ChatToolCallMessage[]; turnIndex: number }>();
    let turnIndex = 0;
    let inTurn = false;

    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];

      if (m.kind === 'user') {
        turnIndex++;
        inTurn = true;
        continue;
      }

      if (m.kind === 'result') {
        inTurn = false;
        continue;
      }

      if (
        inTurn &&
        m.kind === 'tool_call' &&
        (m.toolName === 'Edit' || m.toolName === 'Write') &&
        !m.isError
      ) {
        const input = m.toolInput as Record<string, unknown>;
        const fp = String(input?.file_path ?? input?.filePath ?? '');
        if (!fp) continue;

        const existing = byFile.get(fp);
        if (existing && existing.turnIndex === turnIndex) {
          // Same turn — accumulate edits
          existing.edits.push(m);
        } else {
          // New turn for this file — replace previous edits
          byFile.set(fp, { edits: [m], turnIndex });
        }
      }
    }

    return [...byFile.entries()].map(([filePath, { edits }]) => ({
      filePath,
      toolName: edits[edits.length - 1].toolName,
      toolInput: edits[edits.length - 1].toolInput,
      edits,
    }));
  }

  /** Check if a file has been reverted */
  isFileReverted(sessionId: string, filePath: string): boolean {
    return this.revertedFilesBySession[sessionId]?.has(filePath) ?? false;
  }

  /** Revert a file via git checkout and track it */
  async revertFile(sessionId: string, filePath: string) {
    await window.groveBench.revertFile(sessionId, filePath);
    const reverted = this.revertedFilesBySession[sessionId] ?? new Set();
    reverted.add(filePath);
    this.revertedFilesBySession[sessionId] = new Set(reverted);
  }

  removeDevServer(sessionId: string, port: number) {
    const servers = this.devServersBySession[sessionId] ?? [];
    this.devServersBySession[sessionId] = servers.filter((s) => s.port !== port);
  }

  async setMode(sessionId: string, mode: PermissionMode) {
    this.modeBySession[sessionId] = mode;
    await window.groveBench.setMode(sessionId, mode);
  }

  /** Set mode locally without IPC — used for UI-only modes like 'orchestrator'. */
  setModeLocal(sessionId: string, mode: PermissionMode) {
    this.modeBySession[sessionId] = mode;
  }

  cycleMode(sessionId: string) {
    const current = this.getMode(sessionId);
    // Orchestrator mode is fixed — don't cycle
    if (current === 'orchestrator') return;
    const modes = ['default', 'plan', 'acceptEdits'] as const;
    const idx = modes.indexOf(current as typeof modes[number]);
    const next = modes[(idx + 1) % modes.length];
    this.setMode(sessionId, next);
  }

  private pushMessage(sessionId: string, msg: ChatMessage) {
    const current = this.messagesBySession[sessionId] ?? [];
    this.messagesBySession[sessionId] = [...current, msg];
  }

  private flushStreamingText(sessionId: string) {
    const text = this.streamingText[sessionId];
    if (text) {
      this.pushMessage(sessionId, {
        kind: 'text',
        id: nextId(),
        text,
        uuid: '',
      });
      this.streamingText[sessionId] = '';
    }
  }

  /** Reset running state for a session (e.g. after stop is clicked) */
  markSessionStopped(sessionId: string) {
    this.flushStreamingText(sessionId);
    this.streamingThinking[sessionId] = '';
    this.isRunning[sessionId] = false;
    this.activityBySession[sessionId] = { activity: 'idle' };

    // Resolve any pending tool calls so spinners don't linger
    const msgs = this.messagesBySession[sessionId] ?? [];
    let changed = false;
    const updated = msgs.map((m) => {
      if (m.kind === 'tool_call' && m.pending) {
        changed = true;
        return { ...m, pending: false };
      }
      return m;
    });
    if (changed) {
      this.messagesBySession[sessionId] = updated;
    }
  }

  /** Add a user message to the display */
  addUserMessage(sessionId: string, text: string) {
    this.pushMessage(sessionId, {
      kind: 'user',
      id: nextId(),
      text,
    });
    this.isRunning[sessionId] = true;
    this.activityBySession[sessionId] = { activity: 'generating' };
    // Clear stale suggestions when user sends a new message
    this.promptSuggestionsBySession[sessionId] = [];
  }

  /** Ingest a raw AgentEvent from the main process */
  ingestEvent(sessionId: string, event: AgentEvent) {
    switch (event.type) {
      case 'system_init': {
        // If /clear was issued, wipe all messages for a fresh start
        const wasCleared = !!this.pendingClear[sessionId];
        if (wasCleared) {
          this.messagesBySession[sessionId] = [];
          this.streamingText[sessionId] = '';
          delete this.usageBySession[sessionId];
          delete this.turnsBySession[sessionId];
          delete this.pendingClear[sessionId];
        }
        this.isReady[sessionId] = true;
        this.isRunning[sessionId] = false;
        this.modelBySession[sessionId] = event.model;
        this.systemInfoBySession[sessionId] = {
          tools: event.tools ?? [],
          agents: event.agents ?? [],
          skills: event.skills ?? [],
          slashCommands: event.slashCommands ?? [],
          mcpServers: event.mcpServers ?? [],
        };
        this.pushMessage(sessionId, {
          kind: 'system',
          id: nextId(),
          text: wasCleared
            ? `Conversation cleared — connected to ${event.model}`
            : `Connected to ${event.model}`,
        });
        break;
      }

      case 'assistant_text':
        // assistant_text is the finalized version of what partial_text was streaming.
        // Clear streaming text (it was a preview) and push the finalized message.
        this.isRunning[sessionId] = true;
        this.streamingText[sessionId] = '';
        this.pushMessage(sessionId, {
          kind: 'text',
          id: nextId(),
          text: event.text,
          uuid: event.uuid,
        });
        break;

      case 'partial_text':
        this.isRunning[sessionId] = true;
        this.streamingThinking[sessionId] = '';
        this.streamingText[sessionId] = (this.streamingText[sessionId] ?? '') + event.text;
        break;

      case 'partial_thinking':
        this.isRunning[sessionId] = true;
        this.activityBySession[sessionId] = { activity: 'thinking' };
        this.streamingThinking[sessionId] = (this.streamingThinking[sessionId] ?? '') + event.text;
        break;

      case 'assistant_tool_use':
        this.isRunning[sessionId] = true;
        this.streamingThinking[sessionId] = '';
        // If partial text was streaming but no assistant_text arrived to finalize it
        // (e.g., the assistant switched from text to tool_use mid-message), flush it.
        // Guard: only flush if there IS accumulated streaming text.
        if (this.streamingText[sessionId]) {
          this.flushStreamingText(sessionId);
        }
        // Sync mode when LLM calls mode-changing tools
        if (event.toolName === 'EnterPlanMode') {
          this.modeBySession[sessionId] = 'plan';
        } else if (event.toolName === 'ExitPlanMode') {
          this.modeBySession[sessionId] = 'default';
        }
        this.activityBySession[sessionId] = {
          activity: 'tool_starting',
          toolName: event.toolName,
          toolSummary: this.summarizeToolInput(event.toolName, event.toolInput),
        };
        this.pushMessage(sessionId, {
          kind: 'tool_call',
          id: nextId(),
          toolName: event.toolName,
          toolInput: event.toolInput,
          toolUseId: event.toolUseId,
          uuid: event.uuid,
          pending: true,
        });
        break;

      case 'tool_result': {
        // Find the matching tool_call and update it
        const msgs = this.messagesBySession[sessionId] ?? [];
        const idx = msgs.findIndex(
          (m) => m.kind === 'tool_call' && m.toolUseId === event.toolUseId,
        );
        if (idx >= 0) {
          const updated = { ...(msgs[idx] as ChatToolCallMessage) };
          updated.result = event.content;
          updated.isError = event.isError;
          updated.pending = false;
          this.messagesBySession[sessionId] = [
            ...msgs.slice(0, idx),
            updated,
            ...msgs.slice(idx + 1),
          ];
        }
        // Clear tool progress for this tool
        const prog = this.toolProgressBySession[sessionId];
        if (prog?.[event.toolUseId]) {
          delete prog[event.toolUseId];
          this.toolProgressBySession[sessionId] = { ...prog };
        }
        // Also mark any matching permission or question request as resolved (handles replay after refresh)
        const msgs2 = this.messagesBySession[sessionId] ?? [];
        const interactiveIdx = msgs2.findIndex(
          (m) => (m.kind === 'permission' || m.kind === 'question') && m.toolUseId === event.toolUseId && !m.resolved,
        );
        if (interactiveIdx >= 0) {
          const msg = msgs2[interactiveIdx];
          if (msg.kind === 'permission') {
            const updated = { ...(msg as ChatPermissionMessage) };
            updated.resolved = true;
            updated.decision = event.isError ? 'deny' : 'allow';
            this.messagesBySession[sessionId] = [
              ...msgs2.slice(0, interactiveIdx),
              updated,
              ...msgs2.slice(interactiveIdx + 1),
            ];
          } else if (msg.kind === 'question') {
            const updated = { ...(msg as ChatQuestionMessage) };
            updated.resolved = true;
            this.messagesBySession[sessionId] = [
              ...msgs2.slice(0, interactiveIdx),
              updated,
              ...msgs2.slice(interactiveIdx + 1),
            ];
          }
        }
        break;
      }

      case 'permission_request':
        this.flushStreamingText(sessionId);
        // Detect AskUserQuestion tool — render as an interactive question, not a permission gate
        if (event.toolName === 'AskUserQuestion') {
          const input = event.toolInput as Record<string, unknown>;
          const questions = (Array.isArray(input?.questions) ? input.questions : []) as QuestionItem[];
          this.pushMessage(sessionId, {
            kind: 'question',
            id: nextId(),
            requestId: event.requestId,
            toolUseId: event.toolUseId,
            questions,
            resolved: false,
          });
        } else {
          this.pushMessage(sessionId, {
            kind: 'permission',
            id: nextId(),
            requestId: event.requestId,
            toolName: event.toolName,
            toolInput: event.toolInput,
            toolUseId: event.toolUseId,
            resolved: false,
            decisionReason: event.decisionReason,
            suggestions: event.suggestions,
          });
        }
        break;

      case 'thinking':
        this.isRunning[sessionId] = true;
        this.streamingThinking[sessionId] = '';
        this.pushMessage(sessionId, {
          kind: 'thinking',
          id: nextId(),
          thinking: event.thinking,
        });
        break;

      case 'result':
        this.flushStreamingText(sessionId);
        this.isRunning[sessionId] = false;
        this.activityBySession[sessionId] = { activity: 'idle' };
        this.toolProgressBySession[sessionId] = {};
        if (event.contextWindow) {
          this.contextWindowBySession[sessionId] = event.contextWindow;
        }
        if (event.numTurns) {
          this.turnsBySession[sessionId] = event.numTurns;
        }
        this.pushMessage(sessionId, {
          kind: 'result',
          id: nextId(),
          subtype: event.subtype,
          result: event.result,
          totalCostUsd: event.totalCostUsd,
          durationMs: event.durationMs,
          isError: event.isError,
          errors: event.errors,
        });
        break;

      case 'error':
        this.flushStreamingText(sessionId);
        this.pushMessage(sessionId, {
          kind: 'error',
          id: nextId(),
          text: event.message,
        });
        break;

      case 'status':
        this.pushMessage(sessionId, {
          kind: 'system',
          id: nextId(),
          text: event.message,
        });
        break;

      case 'usage': {
        const prev = this.usageBySession[sessionId] ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
        this.usageBySession[sessionId] = {
          // input_tokens = current context window usage (latest value, not cumulative)
          inputTokens: event.inputTokens,
          // output_tokens accumulate across turns
          outputTokens: prev.outputTokens + event.outputTokens,
          cacheReadTokens: event.cacheReadTokens ?? 0,
          cacheCreationTokens: event.cacheCreationTokens ?? 0,
        };
        break;
      }

      case 'compact_boundary':
        this.pushMessage(sessionId, {
          kind: 'system',
          id: nextId(),
          text: `Context compacted (${event.trigger}) — was ${Math.round(event.preTokens / 1000)}k tokens`,
        });
        break;

      case 'tool_progress': {
        const prevSummary = this.activityBySession[sessionId]?.toolSummary;
        this.activityBySession[sessionId] = {
          activity: 'tool_starting',
          toolName: event.toolName,
          elapsedSeconds: event.elapsedSeconds,
          toolSummary: prevSummary,
        };
        // Track per-tool progress
        const prog = this.toolProgressBySession[sessionId] ?? {};
        prog[event.toolUseId] = { toolName: event.toolName, elapsedSeconds: event.elapsedSeconds };
        this.toolProgressBySession[sessionId] = { ...prog };
        break;
      }

      case 'activity':
        if (event.activity !== 'idle') {
          this.isRunning[sessionId] = true;
        }
        this.activityBySession[sessionId] = {
          activity: event.activity,
          toolName: event.toolName,
        };
        break;

      case 'user_message':
        this.pushMessage(sessionId, {
          kind: 'user',
          id: nextId(),
          text: event.text,
        });
        break;

      case 'devserver_detected': {
        const servers = this.devServersBySession[sessionId] ?? [];
        if (!servers.some((s) => s.port === event.port)) {
          this.devServersBySession[sessionId] = [...servers, { port: event.port, url: event.url }];
        }
        break;
      }

      case 'process_exit':
        this.flushStreamingText(sessionId);
        this.streamingThinking[sessionId] = '';
        this.isRunning[sessionId] = false;
        this.activityBySession[sessionId] = { activity: 'idle' };
        break;

      case 'rate_limit':
        this.rateLimitBySession[sessionId] = {
          status: event.status,
          resetsAt: event.resetsAt,
          utilization: event.utilization,
          rateLimitType: event.rateLimitType,
        };
        if (event.status === 'rejected') {
          this.pushMessage(sessionId, {
            kind: 'system',
            id: nextId(),
            text: `Rate limited${event.rateLimitType ? ` (${event.rateLimitType})` : ''}${event.resetsAt ? ` — resets ${new Date(event.resetsAt * 1000).toLocaleTimeString()}` : ''}`,
          });
        }
        break;

      case 'prompt_suggestion':
        if (event.suggestion) {
          const existing = this.promptSuggestionsBySession[sessionId] ?? [];
          this.promptSuggestionsBySession[sessionId] = [...existing, event.suggestion];
        }
        break;

      case 'task_started': {
        const tasks = this.backgroundTasksBySession[sessionId] ?? {};
        tasks[event.taskId] = {
          taskId: event.taskId,
          description: event.description,
          taskType: event.taskType,
          status: 'running',
          totalTokens: 0,
          toolUses: 0,
          durationMs: 0,
        };
        this.backgroundTasksBySession[sessionId] = { ...tasks };
        this.pushMessage(sessionId, {
          kind: 'system',
          id: nextId(),
          text: `Background task started: ${event.description}${event.taskType ? ` (${event.taskType})` : ''}`,
        });
        break;
      }

      case 'task_progress': {
        const tasks2 = this.backgroundTasksBySession[sessionId] ?? {};
        const existing = tasks2[event.taskId];
        tasks2[event.taskId] = {
          ...(existing ?? { taskId: event.taskId, status: 'running' }),
          description: event.description,
          summary: event.summary,
          lastToolName: event.lastToolName,
          totalTokens: event.totalTokens,
          toolUses: event.toolUses,
          durationMs: event.durationMs,
        };
        this.backgroundTasksBySession[sessionId] = { ...tasks2 };
        break;
      }

      case 'task_notification': {
        const tasks3 = this.backgroundTasksBySession[sessionId] ?? {};
        const prev = tasks3[event.taskId];
        tasks3[event.taskId] = {
          ...(prev ?? { taskId: event.taskId, description: '' }),
          status: event.taskStatus,
          summary: event.summary,
          totalTokens: event.totalTokens ?? prev?.totalTokens ?? 0,
          toolUses: event.toolUses ?? prev?.toolUses ?? 0,
          durationMs: event.durationMs ?? prev?.durationMs ?? 0,
        };
        this.backgroundTasksBySession[sessionId] = { ...tasks3 };
        const label = event.taskStatus === 'completed' ? 'completed' : event.taskStatus === 'failed' ? 'failed' : 'stopped';
        this.pushMessage(sessionId, {
          kind: 'system',
          id: nextId(),
          text: `Background task ${label}: ${event.summary || prev?.description || event.taskId}`,
        });
        break;
      }

      case 'auth_status':
        if (event.authError) {
          this.pushMessage(sessionId, {
            kind: 'error',
            id: nextId(),
            text: `Authentication error: ${event.authError}`,
          });
        } else if (event.isAuthenticating) {
          this.pushMessage(sessionId, {
            kind: 'system',
            id: nextId(),
            text: event.output.length > 0 ? event.output.join('\n') : 'Authenticating...',
          });
        }
        break;

      case 'tool_use_summary':
        if (event.summary) {
          this.pushMessage(sessionId, {
            kind: 'text',
            id: nextId(),
            text: event.summary,
            uuid: '',
          });
        }
        break;

      case 'hook_event':
        // Only show hook responses with errors or meaningful output
        if (event.subtype === 'response' && event.outcome === 'error') {
          this.pushMessage(sessionId, {
            kind: 'system',
            id: nextId(),
            text: `Hook "${event.hookName}" (${event.hookEvent}) failed${event.exitCode !== undefined ? ` (exit ${event.exitCode})` : ''}${event.output ? `: ${event.output}` : ''}`,
          });
        }
        break;

      case 'elicitation_complete':
        // Informational — log to system messages
        this.pushMessage(sessionId, {
          kind: 'system',
          id: nextId(),
          text: `MCP server "${event.serverName}" elicitation complete`,
        });
        break;

      case 'files_persisted':
        // Only show if there were failures
        if (event.failed.length > 0) {
          this.pushMessage(sessionId, {
            kind: 'system',
            id: nextId(),
            text: `Failed to persist: ${event.failed.map((f) => `${f.filename} (${f.error})`).join(', ')}`,
          });
        }
        break;

      case 'mode_sync':
        this.modeBySession[sessionId] = event.mode;
        break;
    }
  }

  /** Send a slash command (e.g. /compact, /clear) */
  sendCommand(sessionId: string, command: string) {
    const trimmed = command.trim();
    if (trimmed === '/clear') {
      this.pendingClear[sessionId] = true;
    }
    // Sync mode when user issues mode-changing slash commands
    if (trimmed === '/plan') {
      this.modeBySession[sessionId] = 'plan';
    } else if (trimmed === '/code') {
      this.modeBySession[sessionId] = 'default';
    }
    this.pushMessage(sessionId, {
      kind: 'user',
      id: nextId(),
      text: command,
    });
    this.isRunning[sessionId] = true;
    window.groveBench.sendMessage(sessionId, command);
  }

  /** Resolve a question from Claude (AskUserQuestion) by sending the answer as a deny message.
   *  We use 'deny' because the permission system feeds the message text back to Claude as
   *  tool error output, which is how the SDK receives the user's answer. */
  resolveQuestion(sessionId: string, requestId: string, response: string, selectedLabels?: string[]) {
    const msgs = this.messagesBySession[sessionId] ?? [];
    const idx = msgs.findIndex(
      (m) => m.kind === 'question' && m.requestId === requestId,
    );
    if (idx >= 0) {
      const updated = { ...(msgs[idx] as ChatQuestionMessage) };
      updated.resolved = true;
      updated.response = response;
      updated.selectedLabels = selectedLabels;
      this.messagesBySession[sessionId] = [
        ...msgs.slice(0, idx),
        updated,
        ...msgs.slice(idx + 1),
      ];
    }

    // Send the answer back through the permission system — "deny" with the answer as message
    // so Claude receives the user's response as tool feedback
    const permDecision: PermissionDecision = {
      requestId,
      behavior: 'deny',
      message: response,
    };
    window.groveBench.respondToPermission(sessionId, permDecision);
  }

  /** Resolve a permission request in the UI */
  resolvePermission(
    sessionId: string,
    requestId: string,
    decision: 'allow' | 'deny' | 'allowAlways',
    opts?: { message?: string; updatedPermissions?: unknown[] },
  ) {
    const msgs = this.messagesBySession[sessionId] ?? [];
    const idx = msgs.findIndex(
      (m) => m.kind === 'permission' && m.requestId === requestId,
    );

    // Capture the tool name before resolving, so we can sync mode
    let toolName: string | undefined;
    if (idx >= 0) {
      const updated = { ...(msgs[idx] as ChatPermissionMessage) };
      toolName = updated.toolName;
      updated.resolved = true;
      updated.decision = decision === 'deny' ? 'deny' : 'allow';
      this.messagesBySession[sessionId] = [
        ...msgs.slice(0, idx),
        updated,
        ...msgs.slice(idx + 1),
      ];
    }

    // When "Always Allow" is used on Edit/Write, sync mode to acceptEdits
    if (decision === 'allowAlways' && toolName && (toolName === 'Edit' || toolName === 'Write')) {
      this.modeBySession[sessionId] = 'acceptEdits';
    }

    const permDecision: PermissionDecision = {
      requestId,
      behavior: decision,
      message: decision === 'deny' ? (opts?.message || 'User denied permission') : undefined,
      updatedPermissions: opts?.updatedPermissions,
    };
    window.groveBench.respondToPermission(sessionId, permDecision);
  }

  /** Clear all in-memory state for a session so history can be replayed cleanly.
   *  Also unsubscribes any existing listener to avoid duplicate subscriptions. */
  clearSession(sessionId: string) {
    this.unsubscribe(sessionId);
    this.messagesBySession[sessionId] = [];
    this.streamingText[sessionId] = '';
    this.streamingThinking[sessionId] = '';
    this.isReady[sessionId] = false;
    this.activityBySession[sessionId] = { activity: 'idle' };
    this.toolProgressBySession[sessionId] = {};
    // Preserve isRunning — caller controls this based on history
  }

  /** Subscribe to events from the main process for a session */
  subscribe(sessionId: string) {
    if (this.cleanups.has(sessionId)) {
      return;
    }
    const cleanup = window.groveBench.onAgentEvent(sessionId, (event) => {
      this.ingestEvent(sessionId, event);
    });
    this.cleanups.set(sessionId, cleanup);
  }

  /** Unsubscribe from session events */
  unsubscribe(sessionId: string) {
    const cleanup = this.cleanups.get(sessionId);
    if (cleanup) {
      cleanup();
      this.cleanups.delete(sessionId);
    }
    window.groveBench.offAgentEvent(sessionId);
  }

  /** After replaying event history, mark any tool_calls still pending as resolved.
   *  During replay the tool_result handler should match, but if events arrive
   *  out of order or the session is idle, we clean up so spinners don't linger. */
  resolveStaleToolCalls(sessionId: string) {
    if (this.isRunning[sessionId]) return; // genuinely in-flight
    const msgs = this.messagesBySession[sessionId] ?? [];
    let changed = false;
    const updated = msgs.map((m) => {
      if (m.kind === 'tool_call' && m.pending) {
        changed = true;
        return { ...m, pending: false };
      }
      return m;
    });
    if (changed) {
      this.messagesBySession[sessionId] = updated;
    }
  }

}

export const messageStore = new MessageStore();
