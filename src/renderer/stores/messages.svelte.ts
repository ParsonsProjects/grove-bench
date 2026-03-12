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

  /** Whether the session has initialized (received system_init) and can accept messages */
  isReady = $state<Record<string, boolean>>({});

  /** Model name per session */
  modelBySession = $state<Record<string, string>>({});

  /** Current permission mode per session */
  modeBySession = $state<Record<string, string>>({});

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
    this.pushMessage(sessionId, {
      kind: 'system',
      id: nextId(),
      text: `[debug] addUserMessage: isRunning=true, isReady=${this.isReady[sessionId]}`,
    });
  }

  /** Ingest a raw AgentEvent from the main process */
  ingestEvent(sessionId: string, event: AgentEvent) {
    this.pushMessage(sessionId, {
      kind: 'system',
      id: nextId(),
      text: `[debug] ingestEvent: type=${event.type}`,
    });
    switch (event.type) {
      case 'system_init':
        this.isReady[sessionId] = true;
        this.modelBySession[sessionId] = event.model;
        this.pushMessage(sessionId, {
          kind: 'system',
          id: nextId(),
          text: `Connected to ${event.model}`,
        });
        break;

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

      case 'process_exit':
        this.flushStreamingText(sessionId);
        this.isRunning[sessionId] = false;
        break;
    }
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

  /** Clear all messages for a session */
  clearSession(sessionId: string) {
    this.messagesBySession[sessionId] = [];
    this.streamingText[sessionId] = '';
    this.isRunning[sessionId] = false;
    this.isReady[sessionId] = false;
  }
}

export const messageStore = new MessageStore();
