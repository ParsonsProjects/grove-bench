import type { AgentEvent, PermissionDecision } from '../../shared/types.js';

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
}

export interface ChatThinkingMessage {
  kind: 'thinking';
  id: string;
  thinking: string;
}

export type ChatMessage =
  | ChatTextMessage
  | ChatToolCallMessage
  | ChatUserMessage
  | ChatSystemMessage
  | ChatErrorMessage
  | ChatResultMessage
  | ChatPermissionMessage
  | ChatThinkingMessage;

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

  /** Whether Claude is currently processing for a session */
  isRunning = $state<Record<string, boolean>>({});

  /** Whether a /clear was issued and we're waiting for re-init */
  pendingClear = $state<Record<string, boolean>>({});

  /** Current activity per session (what the LLM is doing right now) */
  activityBySession = $state<Record<string, { activity: 'thinking' | 'tool_starting' | 'generating' | 'idle'; toolName?: string; elapsedSeconds?: number }>>({});

  /** Per-tool progress tracking — maps toolUseId to progress info */
  toolProgressBySession = $state<Record<string, Record<string, { toolName: string; elapsedSeconds: number }>>>({});

  /** Whether the session has initialized (received system_init) and can accept messages */
  isReady = $state<Record<string, boolean>>({});

  /** Model name per session */
  modelBySession = $state<Record<string, string>>({});

  /** Current permission mode per session */
  modeBySession = $state<Record<string, string>>({});

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

  private cleanups = new Map<string, () => void>();

  getMessages(sessionId: string): ChatMessage[] {
    return this.messagesBySession[sessionId] ?? [];
  }

  getStreamingText(sessionId: string): string {
    return this.streamingText[sessionId] ?? '';
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

  getMode(sessionId: string): string {
    return this.modeBySession[sessionId] ?? 'default';
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

  getDevServers(sessionId: string): { port: number; url: string }[] {
    return this.devServersBySession[sessionId] ?? [];
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

  removeDevServer(sessionId: string, port: number) {
    const servers = this.devServersBySession[sessionId] ?? [];
    this.devServersBySession[sessionId] = servers.filter((s) => s.port !== port);
  }

  async setMode(sessionId: string, mode: string) {
    await window.groveBench.setMode(sessionId, mode);
    this.modeBySession[sessionId] = mode;
  }

  cycleMode(sessionId: string) {
    const modes = ['default', 'plan', 'acceptEdits'] as const;
    const current = this.getMode(sessionId);
    const idx = modes.indexOf(current as any);
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

  /** Add a user message to the display */
  addUserMessage(sessionId: string, text: string) {
    this.pushMessage(sessionId, {
      kind: 'user',
      id: nextId(),
      text,
    });
    this.isRunning[sessionId] = true;
    this.activityBySession[sessionId] = { activity: 'generating' };
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
        this.streamingText[sessionId] = '';
        this.pushMessage(sessionId, {
          kind: 'text',
          id: nextId(),
          text: event.text,
          uuid: event.uuid,
        });
        break;

      case 'partial_text':
        this.streamingText[sessionId] = (this.streamingText[sessionId] ?? '') + event.text;
        break;

      case 'assistant_tool_use':
        // If partial text was streaming but no assistant_text arrived to finalize it
        // (e.g., the assistant switched from text to tool_use mid-message), flush it.
        // Guard: only flush if there IS accumulated streaming text.
        if (this.streamingText[sessionId]) {
          this.flushStreamingText(sessionId);
        }
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
        // Also mark any matching permission request as resolved (handles replay after refresh)
        const msgs2 = this.messagesBySession[sessionId] ?? [];
        const permIdx = msgs2.findIndex(
          (m) => m.kind === 'permission' && m.toolUseId === event.toolUseId && !m.resolved,
        );
        if (permIdx >= 0) {
          const updated = { ...(msgs2[permIdx] as ChatPermissionMessage) };
          updated.resolved = true;
          updated.decision = event.isError ? 'deny' : 'allow';
          this.messagesBySession[sessionId] = [
            ...msgs2.slice(0, permIdx),
            updated,
            ...msgs2.slice(permIdx + 1),
          ];
        }
        break;
      }

      case 'permission_request':
        this.flushStreamingText(sessionId);
        this.pushMessage(sessionId, {
          kind: 'permission',
          id: nextId(),
          requestId: event.requestId,
          toolName: event.toolName,
          toolInput: event.toolInput,
          toolUseId: event.toolUseId,
          resolved: false,
        });
        break;

      case 'thinking':
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
        this.activityBySession[sessionId] = {
          activity: 'tool_starting',
          toolName: event.toolName,
          elapsedSeconds: event.elapsedSeconds,
        };
        // Track per-tool progress
        const prog = this.toolProgressBySession[sessionId] ?? {};
        prog[event.toolUseId] = { toolName: event.toolName, elapsedSeconds: event.elapsedSeconds };
        this.toolProgressBySession[sessionId] = { ...prog };
        break;
      }

      case 'activity':
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
        this.isRunning[sessionId] = false;
        this.activityBySession[sessionId] = { activity: 'idle' };
        break;
    }
  }

  /** Send a slash command (e.g. /compact, /clear) */
  sendCommand(sessionId: string, command: string) {
    if (command.trim() === '/clear') {
      this.pendingClear[sessionId] = true;
    }
    this.pushMessage(sessionId, {
      kind: 'user',
      id: nextId(),
      text: command,
    });
    this.isRunning[sessionId] = true;
    window.groveBench.sendMessage(sessionId, command);
  }

  /** Resolve a permission request in the UI */
  resolvePermission(sessionId: string, requestId: string, decision: 'allow' | 'deny' | 'allowAlways') {
    const msgs = this.messagesBySession[sessionId] ?? [];
    const idx = msgs.findIndex(
      (m) => m.kind === 'permission' && m.requestId === requestId,
    );
    if (idx >= 0) {
      const updated = { ...(msgs[idx] as ChatPermissionMessage) };
      updated.resolved = true;
      updated.decision = decision === 'deny' ? 'deny' : 'allow';
      this.messagesBySession[sessionId] = [
        ...msgs.slice(0, idx),
        updated,
        ...msgs.slice(idx + 1),
      ];
    }

    const permDecision: PermissionDecision = {
      requestId,
      behavior: decision,
      message: decision === 'deny' ? 'User denied permission' : undefined,
    };
    window.groveBench.respondToPermission(sessionId, permDecision);
  }

  /** Subscribe to events from the main process for a session */
  subscribe(sessionId: string) {
    if (this.cleanups.has(sessionId)) {
      this.pushMessage(sessionId, {
        kind: 'system',
        id: nextId(),
        text: `[debug] subscribe: already subscribed to ${sessionId}`,
      });
      return;
    }
    this.pushMessage(sessionId, {
      kind: 'system',
      id: nextId(),
      text: `[debug] subscribe: subscribing to ${sessionId}`,
    });
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

  /** Clear all messages for a session */
  clearSession(sessionId: string) {
    this.messagesBySession[sessionId] = [];
    this.streamingText[sessionId] = '';
    this.isRunning[sessionId] = false;
    this.isReady[sessionId] = false;
    delete this.usageBySession[sessionId];
    delete this.systemInfoBySession[sessionId];
    delete this.contextWindowBySession[sessionId];
    delete this.turnsBySession[sessionId];
    delete this.pendingClear[sessionId];
    delete this.activityBySession[sessionId];
    delete this.devServersBySession[sessionId];
  }
}

export const messageStore = new MessageStore();
