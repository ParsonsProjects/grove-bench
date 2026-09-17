import type { AgentEvent, ControlDescriptor, ImageAttachment, McpServerInfo, PermissionDecision, PermissionMode, SessionControls } from '../../shared/types.js';
import { CONTROL_IDS } from '../../shared/types.js';
import { gitStatusStore } from './gitStatus.svelte.js';
import { notifyOs } from '../lib/os-notify.js';
import { checkpointStore } from './checkpoints.svelte.js';
import { backgroundTaskStore } from './backgroundTask.svelte.js';
import { rateLimitStore } from './rateLimit.svelte.js';
import { usageStore } from './usage.svelte.js';
import { store as sessionStore } from './sessions.svelte.js';
import { settingsStore } from './settings.svelte.js';

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
  /** True while a permission_request is pending for this tool — suppresses rendering until approved */
  awaitingPermission?: boolean;
  /** Adapter-agnostic tool category for display logic. */
  toolCategory?: import('../../shared/types.js').ToolCategory;
}

export interface ChatUserMessage {
  kind: 'user';
  id: string;
  text: string;
  /** SDK user message UUID — used as checkpoint ID for /rewind */
  uuid?: string;
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
  /** Set by the adapter when this permission is for executing a plan. */
  isPlanExecution?: boolean;
  /** Adapter-agnostic tool category for display logic. */
  toolCategory?: import('../../shared/types.js').ToolCategory;
  /** Plan text extracted by the adapter for plan execution permissions. */
  planText?: string;
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
/** A prompt the user submitted while the agent was busy (connecting or mid-turn).
 *  Held in the renderer until the session is idle so it can still be removed. */
export interface QueuedMessage {
  id: string;
  /** Text shown in the thread once sent (includes attachment names). */
  displayText: string;
  /** Prepared outgoing text sent to main (file tags + prompt), or the slash command. */
  outgoing: string;
  images?: ImageAttachment[];
  /** Slash command — dispatched through sendCommand rather than as a prompt. */
  isCommand?: boolean;
}

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

  /** Whether the agent is currently processing for a session */
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

  /** Adapter-declared controls (descriptors for the current model + recorded
   *  values) per session, fed by controls_sync events and loadControls(). */
  controlsBySession = $state<Record<string, SessionControls>>({});

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



  /** Prompt suggestions per session (from SDK) */
  promptSuggestionsBySession = $state<Record<string, string[]>>({});



  /** Active tab per session (survives component remount) */
  activeTabBySession = $state<Record<string, 'activity' | 'changes' | 'checkpoints' | 'plan' | 'terminal'>>({});

  /** Activity view mode per session. Unset = the global default
   *  (settings.defaultActivityView). Not persisted across restarts. */
  viewModeBySession = $state<Record<string, import('../lib/message-view.js').MessageViewMode>>({});

  /** Draft input text per session (survives tab switches and component remounts) */
  draftBySession = $state<Record<string, string>>({});

  /** Prompts waiting to be sent, oldest first. Dispatched one per turn once the
   *  session is connected and idle. See submitMessage / flushQueue. */
  queuedBySession = $state<Record<string, QueuedMessage[]>>({});

  /** Set when the user intervened (Stop, rewind). Queued prompts stay put until
   *  the user clicks Resume, so a stale follow-up doesn't fire right after a stop. */
  queuePausedBySession = $state<Record<string, boolean>>({});

  /** Preserved edit history after conversation-only rewind (keyed by session) */
  preservedEditHistory = $state<Record<string, { filePath: string; toolName: string; toolInput: unknown; edits: ChatToolCallMessage[] }[]>>({});

  /** Message to send automatically after a /clear completes (system_init) */
  private pendingMessageAfterClear: Record<string, string> = {};

  /** Set after markSessionStopped — suppresses late permission_request events
   *  from the dying query until the next system_init re-initializes the session. */
  private stoppingSession: Record<string, boolean> = {};

  /** Set when a user message has been submitted but the agent hasn't responded
   *  yet. Lets onSystemInit know not to clear isRunning — otherwise a query that
   *  (re)initializes *after* the user sent a message (e.g. the respawn following
   *  a Stop) would flip the optimistic "working" indicator back off until the
   *  first token streams. Cleared on result / process_exit / error / stop. */
  private awaitingResponse: Record<string, boolean> = {};

  /** Set when the user explicitly changes mode via UI (cycleMode / setMode).
   *  Prevents stale SDK mode_sync events from overwriting the user's choice.
   *  Cleared on system_init (new query) or authoritative session mode_sync. */
  private userExplicitMode: Record<string, boolean> = {};

  private cleanups = new Map<string, () => void>();

  /** When true, pushMessage appends to a temporary array instead of triggering reactive updates. */
  private _replayBuffer: ChatMessage[] | null = null;
  private _replaySessionId: string | null = null;

  /** Absolute (prelaunch-prefixed) index of the event currently being replayed,
   *  or null for live events. Used to stamp messages so full-history search hits
   *  can be mapped back to the message they produced. */
  private _currentEventIndex: number | null = null;

  /** Per-session map of messageId → source event index, populated during replay.
   *  Lets click-to-jump locate the message for a search hit's eventIndex. Stale
   *  entries (after rewind/clear) are harmless since ids are unique and we only
   *  ever look up ids of currently-present messages. */
  private sourceIndexBySession = new Map<string, Map<string, number>>();

  /** Pagination state per session — tracks how far back we've loaded from the event log. */
  paginationBySession = $state<Record<string, { totalCount: number; loadedFromIndex: number; loading: boolean }>>({});

  /** Whether there are older events that haven't been loaded yet. */
  hasOlderEvents(sessionId: string): boolean {
    const p = this.paginationBySession[sessionId];
    return p ? p.loadedFromIndex > 0 : false;
  }

  /** How many older events remain unloaded. */
  olderEventCount(sessionId: string): number {
    const p = this.paginationBySession[sessionId];
    return p ? p.loadedFromIndex : 0;
  }

  /** Whether older events are currently being loaded. */
  isLoadingOlder(sessionId: string): boolean {
    return this.paginationBySession[sessionId]?.loading ?? false;
  }

  /** Set pagination state after initial page load. */
  setPagination(sessionId: string, totalCount: number, loadedFromIndex: number) {
    this.paginationBySession[sessionId] = { totalCount, loadedFromIndex, loading: false };
  }

  /** Load an older page of events and prepend them to the message list. */
  async loadOlderEvents(sessionId: string, pageSize = 200) {
    const p = this.paginationBySession[sessionId];
    if (!p || p.loadedFromIndex <= 0 || p.loading) return;

    this.paginationBySession[sessionId] = { ...p, loading: true };
    try {
      const skipDuringReplay = new Set([
        'partial_text', 'activity', 'tool_progress', 'usage',
      ]);
      const page = await window.groveBench.getEventHistoryPage(sessionId, pageSize, p.loadedFromIndex);

      // Process the older events in batch mode to build messages
      this._replayBuffer = [];
      this._replaySessionId = sessionId;
      try {
        for (let i = 0; i < page.events.length; i++) {
          const event = page.events[i];
          if (skipDuringReplay.has(event.type)) continue;
          this._currentEventIndex = page.startIndex + i;
          this.ingestEvent(sessionId, event);
        }
      } finally {
        this._currentEventIndex = null;
        const buffer = this._replayBuffer;
        this._replayBuffer = null;
        this._replaySessionId = null;
        if (buffer && buffer.length > 0) {
          // Prepend older messages before existing ones
          const existing = this.messagesBySession[sessionId] ?? [];
          this.messagesBySession[sessionId] = [...buffer, ...existing];
        }
      }

      // Resolve stale tool calls/permissions in the prepended messages
      this.resolveStaleToolCalls(sessionId);
      this.resolveReplayedPermissions(sessionId);

      this.paginationBySession[sessionId] = { totalCount: p.totalCount, loadedFromIndex: page.startIndex, loading: false };
    } finally {
      // Ensure loading is cleared even on error
      const cur = this.paginationBySession[sessionId];
      if (cur?.loading) {
        this.paginationBySession[sessionId] = { ...cur, loading: false };
      }
    }
  }

  /** Page older events until the given absolute event index is loaded into the
   *  store. Used by click-to-jump from a search result — loads only as deep as
   *  the chosen match, not the whole history. */
  async loadOlderUntil(sessionId: string, eventIndex: number) {
    let guard = 0;
    // olderEventCount() === loadedFromIndex; load until it's at/below the target.
    while (this.olderEventCount(sessionId) > eventIndex && guard < 1000) {
      const before = this.olderEventCount(sessionId);
      await this.loadOlderEvents(sessionId);
      if (this.olderEventCount(sessionId) >= before) break; // no progress — stop
      guard++;
    }
  }

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

  /** Set isRunning for a session using full object reassignment so Svelte 5
   *  reliably notifies all $derived subscribers (key-level mutations on
   *  $state<Record> proxies can silently fail to propagate). */
  setIsRunning(sessionId: string, value: boolean) {
    // Called on every streamed delta; an unchanged value must not reassign the
    // record, or every derived reading isRunning (in every mounted pane, the
    // sidebar, the session finder) re-runs per token.
    if (this.isRunning[sessionId] === value) return;
    this.isRunning = { ...this.isRunning, [sessionId]: value };
  }

  // ─── Streaming delta coalescing ───
  //
  // The adapter emits one partial_text / partial_thinking event per model
  // token. Appending each one to streamingText re-renders the whole markdown
  // block per token. Deltas are buffered here and applied at most once per
  // STREAM_FLUSH_MS; any non-streaming event settles the buffer first so
  // ordering relative to finalized messages is preserved.
  private static readonly STREAM_FLUSH_MS = 80;
  private streamBuf = new Map<string, { text: string; thinking: string }>();
  private streamFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private bufferStreamDelta(sessionId: string, kind: 'text' | 'thinking', delta: string) {
    let buf = this.streamBuf.get(sessionId);
    if (!buf) {
      buf = { text: '', thinking: '' };
      this.streamBuf.set(sessionId, buf);
    }
    if (kind === 'text') {
      // Text starting means any pending thinking preview is obsolete.
      buf.thinking = '';
      buf.text += delta;
    } else {
      buf.thinking += delta;
    }
    if (!this.streamFlushTimer) {
      this.streamFlushTimer = setTimeout(() => this.flushStreamBuffers(), MessageStore.STREAM_FLUSH_MS);
    }
  }

  /** Apply all buffered deltas to the reactive streaming fields. */
  flushStreamBuffers() {
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
      this.streamFlushTimer = null;
    }
    if (this.streamBuf.size === 0) return;
    for (const [sessionId, buf] of this.streamBuf) {
      if (buf.text) {
        this.streamingText[sessionId] = (this.streamingText[sessionId] ?? '') + buf.text;
      }
      if (buf.thinking) {
        this.streamingThinking[sessionId] = (this.streamingThinking[sessionId] ?? '') + buf.thinking;
      }
    }
    this.streamBuf.clear();
  }

  /** Called before a non-streaming event is processed. Deltas that the event
   *  itself supersedes (a finalized text/thinking block) are dropped instead
   *  of rendered once more; everything else is applied first. */
  private settleStreamBuffer(sessionId: string, eventType: AgentEvent['type']) {
    const buf = this.streamBuf.get(sessionId);
    if (!buf) return;
    if (eventType === 'assistant_text') buf.text = '';
    else if (eventType === 'thinking') buf.thinking = '';
    if (!buf.text && !buf.thinking) {
      this.streamBuf.delete(sessionId);
      return;
    }
    if (buf.text) {
      this.streamingText[sessionId] = (this.streamingText[sessionId] ?? '') + buf.text;
    }
    if (buf.thinking) {
      this.streamingThinking[sessionId] = (this.streamingThinking[sessionId] ?? '') + buf.thinking;
    }
    this.streamBuf.delete(sessionId);
  }

  getIsReady(sessionId: string): boolean {
    return this.isReady[sessionId] ?? false;
  }

  /** Set isReady for a session using full object reassignment so Svelte 5
   *  reliably notifies all $derived subscribers (key-level mutations on
   *  $state<Record> proxies can silently fail to propagate). */
  setIsReady(sessionId: string, value: boolean) {
    if (this.isReady[sessionId] === value) return;
    this.isReady = { ...this.isReady, [sessionId]: value };
  }

  /** Whether a session has any unresolved permission requests */
  hasPendingPermission(sessionId: string): boolean {
    return (this.messagesBySession[sessionId] ?? []).some(
      (m) => m.kind === 'permission' && !(m as ChatPermissionMessage).resolved,
    );
  }

  /** Whether the agent is blocked on an unanswered question */
  hasPendingQuestion(sessionId: string): boolean {
    return (this.messagesBySession[sessionId] ?? []).some(
      (m) => m.kind === 'question' && !(m as { resolved?: boolean }).resolved,
    );
  }

  /** Whether the session is waiting on the user for anything (permission or question) */
  needsInput(sessionId: string): boolean {
    return this.hasPendingPermission(sessionId) || this.hasPendingQuestion(sessionId);
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

  getControlDescriptors(sessionId: string): ControlDescriptor[] {
    return this.controlsBySession[sessionId]?.descriptors ?? [];
  }

  /** Current value of a control. permissionMode reads the mode store (kept
   *  in sync by mode_sync); anything else reads the last controls_sync value
   *  or the descriptor default. */
  getControlValue(sessionId: string, controlId: string): string {
    if (controlId === CONTROL_IDS.permissionMode) return this.getMode(sessionId);
    const controls = this.controlsBySession[sessionId];
    return controls?.values[controlId]
      ?? controls?.descriptors.find((d) => d.id === controlId)?.default
      ?? '';
  }

  async setControl(sessionId: string, controlId: string, value: string) {
    if (controlId === CONTROL_IDS.permissionMode) {
      await this.setMode(sessionId, value as PermissionMode);
      return;
    }
    const controls = this.controlsBySession[sessionId];
    if (!controls) return;
    const previous = controls.values[controlId];
    // Reflect the choice immediately; main's controls_sync confirms it, and
    // the catch below rolls back if the adapter rejected it.
    this.controlsBySession[sessionId] = { ...controls, values: { ...controls.values, [controlId]: value } };
    try {
      await window.groveBench.setControl(sessionId, controlId, value);
    } catch (e) {
      console.warn(`[setControl] ${controlId} failed, rolling back:`, e);
      const current = this.controlsBySession[sessionId];
      if (!current) return;
      const values = { ...current.values };
      if (previous === undefined) delete values[controlId];
      else values[controlId] = previous;
      this.controlsBySession[sessionId] = { ...current, values };
    }
  }

  /** Advance a control to its next declared option (status-bar badge /
   *  Alt+M, Alt+T). Falls back to the built-in mode cycle when no descriptors
   *  have arrived yet so the shortcut never goes dead. */
  cycleControl(sessionId: string, controlId: string) {
    const descriptor = this.getControlDescriptors(sessionId).find((d) => d.id === controlId);
    if (!descriptor || descriptor.options.length === 0) {
      if (controlId === CONTROL_IDS.permissionMode) this.cycleMode(sessionId);
      return;
    }
    const current = this.getControlValue(sessionId, controlId);
    const idx = descriptor.options.findIndex((o) => o.value === current);
    const next = descriptor.options[(idx + 1) % descriptor.options.length].value;
    this.setControl(sessionId, controlId, next).catch((e) => console.error(`Failed to set ${controlId}:`, e));
  }

  /** Fetch descriptors for a session that hasn't reported controls_sync yet
   *  (e.g. restored but idle). A sync that lands mid-fetch wins. */
  async loadControls(sessionId: string) {
    if (this.controlsBySession[sessionId]) return;
    try {
      const controls = await window.groveBench.getControls(sessionId);
      if (!this.controlsBySession[sessionId]) this.controlsBySession[sessionId] = controls;
    } catch (e) {
      console.warn('[loadControls] failed:', e);
    }
  }

  getUsage(sessionId: string) {
    return this.usageBySession[sessionId] ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  }

  getSystemInfo(sessionId: string) {
    return this.systemInfoBySession[sessionId] ?? { tools: [], agents: [], skills: [], slashCommands: [], mcpServers: [] };
  }

  /** Replace the MCP server list with a live status snapshot (from listMcpServers). */
  updateMcpServers(sessionId: string, servers: McpServerInfo[]) {
    const info = this.systemInfoBySession[sessionId];
    if (!info) return;
    this.systemInfoBySession[sessionId] = {
      ...info,
      mcpServers: servers.map((s) => ({ name: s.name, status: s.status })),
    };
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

  getActiveTab(sessionId: string): 'activity' | 'changes' | 'checkpoints' | 'plan' | 'terminal' {
    return this.activeTabBySession[sessionId] ?? 'activity';
  }

  setActiveTab(sessionId: string, tab: 'activity' | 'changes' | 'checkpoints' | 'plan' | 'terminal') {
    this.activeTabBySession[sessionId] = tab;
  }

  getViewMode(sessionId: string): import('../lib/message-view.js').MessageViewMode {
    return this.viewModeBySession[sessionId] ?? settingsStore.current.defaultActivityView ?? 'summary';
  }

  setViewMode(sessionId: string, mode: import('../lib/message-view.js').MessageViewMode) {
    this.viewModeBySession[sessionId] = mode;
  }

  getDraft(sessionId: string): string {
    return this.draftBySession[sessionId] ?? '';
  }

  setDraft(sessionId: string, text: string) {
    this.draftBySession[sessionId] = text;
  }

  getPromptSuggestions(sessionId: string): string[] {
    return this.promptSuggestionsBySession[sessionId] ?? [];
  }

  clearPromptSuggestions(sessionId: string) {
    this.promptSuggestionsBySession[sessionId] = [];
  }

  // ── Outgoing message queue ───────────────────────────────────────────────
  // The input never locks. A prompt submitted while the agent is busy —
  // still connecting after the first send, mid-turn, or waiting on a
  // permission — is parked here and sent when the turn finishes. The first
  // prompt of a fresh session is never queued: the SDK only reports
  // system_init once it has something to process, so holding it would
  // deadlock the "connecting" state.

  getQueue(sessionId: string): QueuedMessage[] {
    return this.queuedBySession[sessionId] ?? [];
  }

  isQueuePaused(sessionId: string): boolean {
    return this.queuePausedBySession[sessionId] ?? false;
  }

  /** Whether a submission right now would be sent immediately (vs queued).
   *  Idle with nothing queued: send. Idle with a paused queue: the user is
   *  intervening, so their new prompt goes ahead of the held items. Idle with
   *  an unpaused, non-empty queue (transient, e.g. after a process exit before
   *  the restart connects): queue behind to keep order. */
  canSendNow(sessionId: string): boolean {
    if (this.getIsRunning(sessionId)) return false;
    return this.getQueue(sessionId).length === 0 || this.isQueuePaused(sessionId);
  }

  /** Submit a prompt: send it now if the agent is idle, otherwise queue it. */
  submitMessage(sessionId: string, msg: { displayText: string; outgoing: string; images?: ImageAttachment[] }): 'sent' | 'queued' {
    return this.submitOrQueue(sessionId, { ...msg, isCommand: false });
  }

  /** Submit a slash command. /rewind is client-side and always immediate;
   *  everything else follows the same send-or-queue rule as prompts. */
  submitCommand(sessionId: string, command: string): 'sent' | 'queued' {
    const trimmed = command.trim();
    if (trimmed === '/rewind') {
      this.openRewindDialog(sessionId);
      return 'sent';
    }
    return this.submitOrQueue(sessionId, { displayText: trimmed, outgoing: trimmed, isCommand: true });
  }

  private submitOrQueue(sessionId: string, item: Omit<QueuedMessage, 'id'>): 'sent' | 'queued' {
    if (this.canSendNow(sessionId)) {
      // A paused queue stays paused: the held items only go out on Resume.
      this.dispatch(sessionId, item);
      return 'sent';
    }
    this.queuedBySession = {
      ...this.queuedBySession,
      [sessionId]: [...this.getQueue(sessionId), { ...item, id: nextId() }],
    };
    return 'queued';
  }

  removeQueuedMessage(sessionId: string, id: string) {
    const remaining = this.getQueue(sessionId).filter((m) => m.id !== id);
    this.queuedBySession = { ...this.queuedBySession, [sessionId]: remaining };
    if (remaining.length === 0) delete this.queuePausedBySession[sessionId];
  }

  clearQueue(sessionId: string) {
    this.queuedBySession = { ...this.queuedBySession, [sessionId]: [] };
    delete this.queuePausedBySession[sessionId];
  }

  /** Put a queued item's text back into the input (and drop it from the queue)
   *  so it can be edited before sending. Returns false for nothing to edit. */
  editQueuedMessage(sessionId: string, id: string): boolean {
    const item = this.getQueue(sessionId).find((m) => m.id === id);
    if (!item) return false;
    this.removeQueuedMessage(sessionId, id);
    this.appendToPrompt(sessionId, item.displayText);
    return true;
  }

  /** Lift a pause set by Stop/rewind and send the next queued item if idle. */
  resumeQueue(sessionId: string) {
    delete this.queuePausedBySession[sessionId];
    this.flushQueue(sessionId);
  }

  /** Send the oldest queued item if the session is idle and not paused.
   *  Only one is sent per call — the next goes out when its turn's result
   *  arrives, so each queued prompt gets its own turn. */
  flushQueue(sessionId: string) {
    // Never fire from replayed history: those results are old news.
    if (this._replayBuffer !== null) return;
    if (this.getIsRunning(sessionId) || this.isQueuePaused(sessionId)) return;
    const queue = this.getQueue(sessionId);
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    this.queuedBySession = { ...this.queuedBySession, [sessionId]: rest };
    this.dispatch(sessionId, next);
  }

  private pauseQueue(sessionId: string) {
    if (this.getQueue(sessionId).length === 0) return;
    this.queuePausedBySession = { ...this.queuePausedBySession, [sessionId]: true };
  }

  private dispatch(sessionId: string, item: Omit<QueuedMessage, 'id'>) {
    if (item.isCommand) {
      this.sendCommand(sessionId, item.outgoing);
      return;
    }
    this.addUserMessage(sessionId, item.displayText);
    window.groveBench.sendMessage(sessionId, item.outgoing, item.images?.length ? item.images : undefined);
    sessionStore.updateLastActive(sessionId);
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

  private summarizeToolInput(toolName: string, input: unknown, toolCategory?: import('../../shared/types.js').ToolCategory): string {
    if (typeof input !== 'object' || input === null) return '';
    const obj = input as Record<string, unknown>;
    // Use toolCategory when available (adapter-agnostic), fall back to tool name heuristics
    if ((toolCategory === 'bash' || obj.command) && obj.command) return String(obj.command).slice(0, 60);
    if ((toolCategory === 'agent' || obj.prompt) && obj.prompt) return String(obj.prompt).slice(0, 60);
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

    const fromMessages = [...byFile.entries()].map(([filePath, { edits }]) => ({
      filePath,
      toolName: edits[edits.length - 1].toolName,
      toolInput: edits[edits.length - 1].toolInput,
      edits,
    }));

    // Merge in preserved edit history from conversation-only rewinds
    const preserved = this.preservedEditHistory[sessionId];
    if (!preserved || preserved.length === 0) return fromMessages;

    // Current message-derived changes take precedence over preserved ones
    const seenPaths = new Set(fromMessages.map(fc => fc.filePath));
    const merged = [...fromMessages];
    for (const p of preserved) {
      if (!seenPaths.has(p.filePath)) {
        merged.push(p);
      }
    }
    return merged;
  }

  async setMode(sessionId: string, mode: PermissionMode) {
    const previousMode = this.modeBySession[sessionId] ?? 'default';
    this.modeBySession[sessionId] = mode;
    // Mark as user-explicit so stale SDK mode_sync events don't overwrite it
    this.userExplicitMode[sessionId] = true;
    try {
      await window.groveBench.setMode(sessionId, mode);
    } catch (e) {
      // Roll back to previous mode if the IPC failed
      console.warn('[setMode] IPC failed, rolling back:', e);
      this.modeBySession[sessionId] = previousMode;
      delete this.userExplicitMode[sessionId];
    }
  }

  cycleMode(sessionId: string) {
    const current = this.getMode(sessionId);
    // Cycle through the modes the adapter declared for this session; the
    // built-in list only serves sessions whose descriptors haven't arrived.
    const declared = this.getControlDescriptors(sessionId)
      .find((d) => d.id === CONTROL_IDS.permissionMode)
      ?.options.map((o) => o.value as PermissionMode);
    const modes: readonly PermissionMode[] = declared && declared.length > 0
      ? declared
      : ['default', 'plan', 'acceptEdits', 'auto', 'readSafe'];
    const idx = modes.indexOf(current);
    const next = modes[(idx + 1) % modes.length];
    this.setMode(sessionId, next);
  }

  private pushMessage(sessionId: string, msg: ChatMessage) {
    // Stamp the source event index (replay only) so search hits map to messages.
    if (this._currentEventIndex != null) {
      let idx = this.sourceIndexBySession.get(sessionId);
      if (!idx) { idx = new Map(); this.sourceIndexBySession.set(sessionId, idx); }
      idx.set(msg.id, this._currentEventIndex);
    }
    // During batch replay, append to the buffer without triggering reactivity
    if (this._replayBuffer && this._replaySessionId === sessionId) {
      this._replayBuffer.push(msg);
      return;
    }
    const current = this.messagesBySession[sessionId] ?? [];
    this.messagesBySession[sessionId] = [...current, msg];
  }

  /** Find the message a search hit's event index maps to: the message with the
   *  largest stamped source index ≤ eventIndex (handles events that update an
   *  existing message rather than creating one, e.g. tool_result → tool_call). */
  findMessageIdForEventIndex(sessionId: string, eventIndex: number): string | null {
    const idx = this.sourceIndexBySession.get(sessionId);
    if (!idx) return null;
    const msgs = this.messagesBySession[sessionId] ?? [];
    let bestId: string | null = null;
    let bestIdx = -1;
    for (const m of msgs) {
      const ei = idx.get(m.id);
      if (ei != null && ei <= eventIndex && ei > bestIdx) {
        bestIdx = ei;
        bestId = m.id;
      }
    }
    return bestId;
  }

  /** Inverse of findMessageIdForEventIndex: the stable source event index a
   *  message was stamped with during replay/pagination, or null for live or
   *  otherwise unstamped messages. Lets bookmark capture anchor a selection to
   *  a durable eventIndex. */
  getEventIndexForMessageId(sessionId: string, messageId: string): number | null {
    const idx = this.sourceIndexBySession.get(sessionId);
    const ei = idx?.get(messageId);
    return ei ?? null;
  }

  /** Cross-session bookmark jump requests, consumed by the active OutputPanel's
   *  $effect. Keyed by sessionId; the panel resolves the anchor (cached
   *  eventIndex → uuid re-resolution → text fallback) and then clears the entry. */
  pendingJumpBySession = $state<Record<string, { eventIndex: number | null; uuid: string | null; bookmarkId: string }>>({});

  requestJump(sessionId: string, req: { eventIndex: number | null; uuid: string | null; bookmarkId: string }) {
    this.pendingJumpBySession = { ...this.pendingJumpBySession, [sessionId]: req };
  }

  clearJump(sessionId: string) {
    if (!(sessionId in this.pendingJumpBySession)) return;
    const next = { ...this.pendingJumpBySession };
    delete next[sessionId];
    this.pendingJumpBySession = next;
  }

  /** One-shot "insert this text into the prompt" requests (e.g. the activity
   *  thread's "copy selection to prompt" action). The mounted PromptEditor
   *  appends `text` to its input whenever `nonce` increments. */
  promptInsertBySession = $state<Record<string, { text: string; nonce: number }>>({});

  requestPromptInsert(sessionId: string, text: string) {
    const prev = this.promptInsertBySession[sessionId]?.nonce ?? 0;
    this.promptInsertBySession = {
      ...this.promptInsertBySession,
      [sessionId]: { text, nonce: prev + 1 },
    };
  }

  /** Append `text` to the session's prompt whether or not a PromptEditor is
   *  mounted right now (it is not on the Terminal / Checkpoints tabs). The
   *  draft is updated for an editor that mounts later, and an insert request
   *  is raised for one that is already showing; the mounted editor's own
   *  draft sync then writes the same combined text back, so the two paths
   *  never double up. */
  appendToPrompt(sessionId: string, text: string) {
    const draft = this.getDraft(sessionId);
    this.setDraft(sessionId, draft ? `${draft}\n${text}` : text);
    this.requestPromptInsert(sessionId, text);
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

  /**
   * Return the current messages for a session, including the replay buffer
   * if a batch replay is active.  During replay the reactive store hasn't
   * been flushed yet, so callers inside ingestEvent need to see both.
   */
  private getMessagesForMutation(sessionId: string): ChatMessage[] {
    if (this._replayBuffer && this._replaySessionId === sessionId) {
      return this._replayBuffer;
    }
    return this.messagesBySession[sessionId] ?? [];
  }

  /**
   * Replace the full message array for a session.  During replay this
   * replaces the buffer; outside replay it triggers reactivity.
   */
  private setMessagesForMutation(sessionId: string, msgs: ChatMessage[]) {
    if (this._replayBuffer && this._replaySessionId === sessionId) {
      this._replayBuffer = msgs;
      return;
    }
    this.messagesBySession[sessionId] = msgs;
  }

  /**
   * Batch-ingest a list of events without triggering per-event reactive
   * updates.  All messages are accumulated in a plain array and flushed to
   * the reactive store in a single assignment at the end.
   *
   * This turns the O(n²) replay (pushMessage spreads on every event) into
   * O(n) and avoids hundreds of intermediate Svelte re-renders.
   */
  replayEvents(sessionId: string, events: AgentEvent[], skipSet?: Set<string>, baseIndex = 0) {
    // Start batch mode
    this._replayBuffer = [];
    this._replaySessionId = sessionId;

    try {
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (skipSet && skipSet.has(event.type)) continue;
        // Absolute event index = page base + position (every event counts,
        // including skipped ones, so indices stay aligned with the backend).
        this._currentEventIndex = baseIndex + i;
        this.ingestEvent(sessionId, event);
      }
    } finally {
      this._currentEventIndex = null;
      // Flush the accumulated messages in one reactive assignment
      const buffer = this._replayBuffer;
      this._replayBuffer = null;
      this._replaySessionId = null;
      if (buffer && buffer.length > 0) {
        const existing = this.messagesBySession[sessionId] ?? [];
        this.messagesBySession[sessionId] = existing.length > 0
          ? [...existing, ...buffer]
          : buffer;
      }
    }
  }

  /** Reset running state for a session (e.g. after stop is clicked) */
  markSessionStopped(sessionId: string) {
    this.flushStreamingText(sessionId);
    this.streamingThinking[sessionId] = '';
    this.setIsRunning(sessionId, false);
    delete this.awaitingResponse[sessionId];
    this.activityBySession[sessionId] = { activity: 'idle' };

    // Suppress late permission_request events from the dying query.
    // Cleared on the next system_init when the new query connects.
    this.stoppingSession[sessionId] = true;

    // Stop is an intervention: hold queued follow-ups until the user resumes,
    // rather than firing the next one into the restarted query.
    this.pauseQueue(sessionId);

    // Resolve any pending tool calls and permissions so spinners/buttons don't linger
    const msgs = this.messagesBySession[sessionId] ?? [];
    let changed = false;
    const updated = msgs.map((m) => {
      if (m.kind === 'tool_call' && (m.pending || m.awaitingPermission)) {
        changed = true;
        return { ...m, pending: false, awaitingPermission: false };
      }
      if (m.kind === 'permission' && !m.resolved) {
        changed = true;
        return { ...m, resolved: true, decision: 'deny' as const };
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
    this.setIsRunning(sessionId, true);
    this.awaitingResponse[sessionId] = true;
    this.activityBySession[sessionId] = { activity: 'generating' };
    // Clear stale suggestions when user sends a new message
    this.promptSuggestionsBySession[sessionId] = [];
  }

  /** Ingest a raw AgentEvent from the main process */
  ingestEvent(sessionId: string, event: AgentEvent) {
    if (event.type !== 'partial_text' && event.type !== 'partial_thinking') {
      this.settleStreamBuffer(sessionId, event.type);
    }
    switch (event.type) {
      case 'system_init':
        this.onSystemInit(sessionId, event);
        break;

      case 'assistant_text':
        // assistant_text is the finalized version of what partial_text was streaming.
        // Clear streaming text (it was a preview) and push the finalized message.
        this.setIsRunning(sessionId, true);
        this.streamingText[sessionId] = '';
        this.pushMessage(sessionId, {
          kind: 'text',
          id: nextId(),
          text: event.text,
          uuid: event.uuid,
        });
        break;

      case 'partial_text':
        this.setIsRunning(sessionId, true);
        if (this.streamingThinking[sessionId]) this.streamingThinking[sessionId] = '';
        this.bufferStreamDelta(sessionId, 'text', event.text);
        break;

      case 'partial_thinking':
        this.setIsRunning(sessionId, true);
        if (this.activityBySession[sessionId]?.activity !== 'thinking') {
          this.activityBySession[sessionId] = { activity: 'thinking' };
        }
        this.bufferStreamDelta(sessionId, 'thinking', event.text);
        break;

      case 'assistant_tool_use':
        this.setIsRunning(sessionId, true);
        this.streamingThinking[sessionId] = '';
        // If partial text was streaming but no assistant_text arrived to finalize it
        // (e.g., the assistant switched from text to tool_use mid-message), flush it.
        // Guard: only flush if there IS accumulated streaming text.
        if (this.streamingText[sessionId]) {
          this.flushStreamingText(sessionId);
        }
        // Mode syncing is handled by mode_sync events from the adapter,
        // not by detecting specific tool names (which would be adapter-specific).
        this.activityBySession[sessionId] = {
          activity: 'tool_starting',
          toolName: event.toolName,
          toolSummary: this.summarizeToolInput(event.toolName, event.toolInput, event.toolCategory),
        };
        this.pushMessage(sessionId, {
          kind: 'tool_call',
          id: nextId(),
          toolName: event.toolName,
          toolInput: event.toolInput,
          toolUseId: event.toolUseId,
          uuid: event.uuid,
          pending: true,
          toolCategory: event.toolCategory,
        });
        break;

      case 'tool_result':
        this.onToolResult(sessionId, event);
        break;

      case 'permission_request':
        this.onPermissionRequest(sessionId, event);
        break;

      case 'permission_resolved':
        this.onPermissionResolved(sessionId, event);
        break;

      case 'thinking':
        this.setIsRunning(sessionId, true);
        this.streamingThinking[sessionId] = '';
        this.pushMessage(sessionId, {
          kind: 'thinking',
          id: nextId(),
          thinking: event.thinking,
        });
        break;

      case 'result':
        this.onResult(sessionId, event);
        // A finished turn is the cheapest moment to learn what it cost the
        // plan; the store throttles so back-to-back turns don't spam the SDK.
        usageStore.refresh(sessionId).catch(() => {});
        break;

      case 'error':
        this.flushStreamingText(sessionId);
        this.pushMessage(sessionId, {
          kind: 'error',
          id: nextId(),
          text: event.message,
        });
        // If the session never initialized (system_init never arrived),
        // unlock the input so the user can see the error and retry.
        if (!this.getIsReady(sessionId)) {
          this.setIsReady(sessionId, true);
          this.setIsRunning(sessionId, false);
          delete this.awaitingResponse[sessionId];
        }
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
          this.setIsRunning(sessionId, true);
        }
        this.activityBySession[sessionId] = {
          activity: event.activity,
          toolName: event.toolName,
        };
        break;

      case 'user_message':
        this.onUserMessage(sessionId, event);
        break;

      case 'process_exit':
        this.flushStreamingText(sessionId);
        this.streamingThinking[sessionId] = '';
        this.setIsRunning(sessionId, false);
        delete this.awaitingResponse[sessionId];
        // If the agent exited before system_init, unlock the input
        if (!this.getIsReady(sessionId)) {
          this.setIsReady(sessionId, true);
        }
        this.activityBySession[sessionId] = { activity: 'idle' };
        backgroundTaskStore.resolveStale(sessionId, this.getIsRunning(sessionId));
        gitStatusStore.scheduleRefresh(sessionId, 100);
        break;

      case 'rate_limit':
        rateLimitStore.set(sessionId, {
          status: event.status,
          resetsAt: event.resetsAt,
          utilization: event.utilization,
          rateLimitType: event.rateLimitType,
        });
        usageStore.applyRateLimitEvent(sessionId, event);
        if (event.status === 'rejected') {
          this.pushMessage(sessionId, {
            kind: 'system',
            id: nextId(),
            text: `Rate limited${event.rateLimitType ? ` (${event.rateLimitType})` : ''}${event.resetsAt ? ` — resets ${new Date(event.resetsAt * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}`,
          });
        }
        break;

      case 'prompt_suggestion':
        if (event.suggestion) {
          const existing = this.promptSuggestionsBySession[sessionId] ?? [];
          this.promptSuggestionsBySession[sessionId] = [...existing, event.suggestion];
        }
        break;

      case 'task_started':
        backgroundTaskStore.start(sessionId, event);
        this.pushMessage(sessionId, {
          kind: 'system',
          id: nextId(),
          text: `Background task started: ${event.description}${event.taskType ? ` (${event.taskType})` : ''}`,
        });
        break;

      case 'task_progress':
        backgroundTaskStore.progress(sessionId, event);
        break;

      case 'task_notification':
        this.onTaskNotification(sessionId, event);
        break;

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

      case 'controls_sync':
        this.controlsBySession[sessionId] = { descriptors: event.descriptors, values: event.values };
        break;
      case 'mode_sync':
        this.onModeSync(sessionId, event);
        break;

      case 'rewind':
        this.onRewind(sessionId, event);
        break;
    }
  }

  // ── Per-event handlers (dispatched from ingestEvent) ─────────────────────
  // The trivial event cases stay inline in ingestEvent; the multi-branch ones
  // live here as named methods so each is readable and testable in isolation.

  private onSystemInit(sessionId: string, event: Extract<AgentEvent, { type: 'system_init' }>) {
    // If /clear was issued, wipe all messages for a fresh start
    const wasCleared = !!this.pendingClear[sessionId];
    if (wasCleared) {
      this.setMessagesForMutation(sessionId, []);
      this.streamingText[sessionId] = '';
      delete this.usageBySession[sessionId];
      delete this.turnsBySession[sessionId];
      delete this.paginationBySession[sessionId];
      delete this.pendingClear[sessionId];
      // Drop the checkpoint selection (its message is gone) but keep the
      // list: main keeps the git refs and flags earlier turns as
      // beforeClear so their files stay restorable. The refresh runs after
      // clearEventHistory has captured the clear marker.
      checkpointStore.clearSelection(sessionId);
      // Truncate event history on disk so old messages don't reappear on restart
      window.groveBench.clearEventHistory(sessionId)
        .catch(() => {})
        .finally(() => checkpointStore.scheduleRefresh(sessionId));
    }
    this.setIsReady(sessionId, true);
    // Don't clear isRunning if the user already submitted a message that this
    // (re)initialized query is about to process — otherwise the "working"
    // indicator flickers off between system_init and the first streamed token.
    if (!this.awaitingResponse[sessionId]) {
      this.setIsRunning(sessionId, false);
    }
    delete this.stoppingSession[sessionId];
    delete this.userExplicitMode[sessionId];
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

    // If a message was queued to send after clear, fire it now
    const pendingMsg = this.pendingMessageAfterClear[sessionId];
    if (wasCleared && pendingMsg) {
      delete this.pendingMessageAfterClear[sessionId];
      this.addUserMessage(sessionId, pendingMsg);
      window.groveBench.sendMessage(sessionId, pendingMsg);
    }

    // Connected and idle (e.g. after a stop/restart or /clear) — send the
    // next queued prompt. No-op while a turn is already pending or paused.
    this.flushQueue(sessionId);
  }

  private onToolResult(sessionId: string, event: Extract<AgentEvent, { type: 'tool_result' }>) {
    // Build a single updated array that handles both the tool_call result
    // and any matching permission/question resolution in one pass.
    const msgs = this.getMessagesForMutation(sessionId);
    let changed = false;
    let matchedToolName: string | undefined;
    const updated = msgs.map((m) => {
      // Update the matching tool_call (also clear awaitingPermission)
      if (m.kind === 'tool_call' && m.toolUseId === event.toolUseId) {
        changed = true;
        matchedToolName = m.toolName;
        return { ...m, result: event.content, isError: event.isError, pending: false, awaitingPermission: false };
      }
      // Fallback: if a tool_result exists, the tool ran, so the permission
      // was allowed. permission_resolved is the primary path but this catches
      // cases where that event is lost or from pre-refactor history.
      if (m.kind === 'permission' && m.toolUseId === event.toolUseId && !m.resolved) {
        changed = true;
        return { ...m, resolved: true as const, decision: 'allow' as const };
      }
      if (m.kind === 'question' && m.toolUseId === event.toolUseId && !m.resolved) {
        changed = true;
        return { ...m, resolved: true as const };
      }
      return m;
    });
    if (changed) {
      this.setMessagesForMutation(sessionId, updated);
    }
    // Clear tool progress for this tool
    const prog = this.toolProgressBySession[sessionId];
    if (prog?.[event.toolUseId]) {
      delete prog[event.toolUseId];
      this.toolProgressBySession[sessionId] = { ...prog };
    }
    // Refresh git status after file-modifying tool calls
    if (matchedToolName && ['Edit', 'Write', 'Bash', 'MultiEdit'].includes(matchedToolName)) {
      gitStatusStore.scheduleRefresh(sessionId, 300);
    }
  }

  private onPermissionRequest(sessionId: string, event: Extract<AgentEvent, { type: 'permission_request' }>) {
    // Drop stale permission requests from a dying query after the user
    // clicked Stop. The new query will re-request if needed.
    if (this.stoppingSession[sessionId]) return;

    // Desktop notification for live requests only — replayed history must not
    // re-notify. Main gates on window focus and settings.
    if (this._replayBuffer === null) {
      notifyOs('permission_request', sessionId, permissionNotificationBody(event));
    }

    this.flushStreamingText(sessionId);
    // Mark the matching tool_call as awaiting permission so it doesn't
    // render before the user has approved/denied.
    const permMsgs = this.getMessagesForMutation(sessionId);
    const toolIdx = permMsgs.findIndex(
      (m) => m.kind === 'tool_call' && m.toolUseId === event.toolUseId,
    );
    if (toolIdx >= 0) {
      const updated = { ...(permMsgs[toolIdx] as ChatToolCallMessage), awaitingPermission: true };
      this.setMessagesForMutation(sessionId, [
        ...permMsgs.slice(0, toolIdx),
        updated,
        ...permMsgs.slice(toolIdx + 1),
      ]);
    }
    // Detect question tools — render as an interactive question, not a permission gate
    if (event.toolCategory === 'question') {
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
        isPlanExecution: event.isPlanExecution,
        toolCategory: event.toolCategory,
        planText: event.planText,
      });
    }
  }

  private onPermissionResolved(sessionId: string, event: Extract<AgentEvent, { type: 'permission_resolved' }>) {
    const msgs = this.getMessagesForMutation(sessionId);
    let changed = false;
    const updated = msgs.map((m) => {
      if (m.kind === 'permission' && (m as ChatPermissionMessage).requestId === event.requestId && !m.resolved) {
        changed = true;
        return { ...m, resolved: true as const, decision: event.decision };
      }
      if (m.kind === 'question' && m.requestId === event.requestId && !m.resolved) {
        changed = true;
        return { ...m, resolved: true as const };
      }
      if (m.kind === 'tool_call' && m.toolUseId === event.toolUseId && m.awaitingPermission) {
        changed = true;
        return { ...m, awaitingPermission: false };
      }
      return m;
    });
    if (changed) {
      this.setMessagesForMutation(sessionId, updated);
    }
  }

  private onResult(sessionId: string, event: Extract<AgentEvent, { type: 'result' }>) {
    // Desktop notification anchored to the SDK's authoritative end-of-turn
    // event (live only) — a crashed or stopped session never produces one, so
    // it can't claim a turn "finished" that actually died. Main gates on
    // window focus and settings.
    if (this._replayBuffer === null) {
      notifyOs(
        'turn_complete',
        sessionId,
        event.isError ? 'Agent turn ended with an error' : 'Agent finished a turn',
      );
    }

    this.flushStreamingText(sessionId);
    this.setIsRunning(sessionId, false);
    delete this.awaitingResponse[sessionId];
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
    backgroundTaskStore.resolveStale(sessionId, this.getIsRunning(sessionId));
    gitStatusStore.scheduleRefresh(sessionId, 100);

    // Turn finished — the agent is free for the next queued prompt.
    this.flushQueue(sessionId);
  }

  private onUserMessage(sessionId: string, event: Extract<AgentEvent, { type: 'user_message' }>) {
    // When replay-user-messages is enabled, the SDK replays user messages
    // with UUIDs. We stamp the UUID onto the most recent user message
    // that doesn't already have one. Text matching is unreliable because
    // the SDK sees the full message (with @-ref file tags prepended) while
    // the store has the display text. So we match by position: the most
    // recent UUID-less user message is the one the SDK is replaying.
    if (event.uuid) {
      const msgs = this.getMessagesForMutation(sessionId);
      const existingIdx = msgs.findLastIndex(
        (m) => m.kind === 'user' && !(m as ChatUserMessage).uuid,
      );
      if (existingIdx >= 0) {
        const updated = [...msgs];
        updated[existingIdx] = { ...updated[existingIdx], uuid: event.uuid } as ChatUserMessage;
        this.setMessagesForMutation(sessionId, updated);
        // Schedule checkpoint refresh so the Checkpoints tab picks up the new checkpoint
        checkpointStore.scheduleRefresh(sessionId);
        return;
      }
    }
    this.pushMessage(sessionId, {
      kind: 'user',
      id: nextId(),
      text: event.text,
      uuid: event.uuid,
    });
    // Schedule checkpoint list refresh so the Checkpoints tab updates
    if (event.uuid) {
      checkpointStore.scheduleRefresh(sessionId);
    }
  }

  private onTaskNotification(sessionId: string, event: Extract<AgentEvent, { type: 'task_notification' }>) {
    const { label, text } = backgroundTaskStore.notify(sessionId, event);
    this.pushMessage(sessionId, {
      kind: 'system',
      id: nextId(),
      text: `Background task ${label}: ${text}`,
    });
  }

  private onModeSync(sessionId: string, event: Extract<AgentEvent, { type: 'mode_sync' }>) {
    // Session-sourced mode_sync (from stopQuery) is authoritative — always apply.
    // SDK-sourced mode_sync may be stale (e.g. the SDK was in 'default' while
    // the app showed 'acceptEdits', and emitted a stale 'default' after the
    // user already cycled to 'plan').  Only apply SDK mode_sync when the user
    // hasn't explicitly set a different mode since the last query start.
    if (event.source === 'session') {
      this.modeBySession[sessionId] = event.mode;
      delete this.userExplicitMode[sessionId];
    } else if (!this.userExplicitMode[sessionId]) {
      this.modeBySession[sessionId] = event.mode;
    }
    // mode_sync is emitted by stopQuery after all old pending permissions
    // have been resolved and before the new query loop starts.  Clear the
    // stoppingSession flag here so permission_request events from the new
    // query are not suppressed.  (system_init also clears it, but it
    // arrives later — after the SDK initialises — leaving a window where
    // early permission requests from the new query would be silently
    // dropped, causing the agent to hang.)
    if (this.stoppingSession[sessionId]) {
      delete this.stoppingSession[sessionId];
    }
  }

  private onRewind(sessionId: string, event: Extract<AgentEvent, { type: 'rewind' }>) {
    // Files-only restore (a checkpoint from before /clear): the conversation
    // is untouched, only the working tree moved.
    if (event.filesOnly) {
      gitStatusStore.refresh(sessionId);
      checkpointStore.scheduleRefresh(sessionId);
      return;
    }
    // Snapshot edit history before truncation if conversation-only rewind
    if (event.conversationOnly) {
      this.preservedEditHistory[sessionId] = this.getLastTurnFileChanges(sessionId);
    } else {
      // Full rewind restores files — clear any preserved history
      delete this.preservedEditHistory[sessionId];
    }

    // Truncate messages after the rewind point.
    // Use getMessagesForMutation/setMessagesForMutation so this works
    // during replay (when messages are in _replayBuffer, not messagesBySession).
    const msgs = this.getMessagesForMutation(sessionId);
    const rewindIdx = msgs.findLastIndex(
      (m) => m.kind === 'user' && (m as ChatUserMessage).uuid === event.toMessageId,
    );
    if (rewindIdx >= 0) {
      // Remove the rewind target message and place its text into the input
      const rewindMsg = msgs[rewindIdx] as ChatUserMessage;
      this.setMessagesForMutation(sessionId, msgs.slice(0, rewindIdx));
      this.setDraft(sessionId, rewindMsg.text);
      this.setActiveTab(sessionId, 'activity');
    }
    this.isRunning[sessionId] = false;
    this.streamingText[sessionId] = '';
    this.streamingThinking[sessionId] = '';
    // A rewind rewrites history; queued follow-ups may no longer make sense.
    this.pauseQueue(sessionId);
    // Refresh git status since files may have changed on disk
    gitStatusStore.refresh(sessionId);
  }

  /** Send a slash command (e.g. /compact, /clear, /rewind) */
  sendCommand(sessionId: string, command: string) {
    const trimmed = command.trim();
    // /rewind is handled client-side — open the dialog instead of sending to SDK
    if (trimmed === '/rewind') {
      this.openRewindDialog(sessionId);
      return;
    }
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
    this.setIsRunning(sessionId, true);
    this.awaitingResponse[sessionId] = true;
    window.groveBench.sendMessage(sessionId, command);
  }

  /** Clear the conversation and send a message once the new session is ready. */
  clearAndSend(sessionId: string, message: string) {
    this.pendingMessageAfterClear[sessionId] = message;
    this.sendCommand(sessionId, '/clear');
  }

  /** Resolve a question (AskUserQuestion) by sending the answer as a deny message.
   *  We use 'deny' because the permission system feeds the message text back to the agent as
   *  tool error output, which is how it receives the user's answer. */
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
    // so the agent receives the user's response as tool feedback
    const permDecision: PermissionDecision = {
      requestId,
      behavior: 'deny',
      message: response,
    };
    window.groveBench.respondToPermission(sessionId, permDecision);
  }

  /** Resolve a permission request by forwarding the decision to main.
   *  The UI update is driven by the permission_resolved event from main,
   *  not by optimistic local mutation.
   *  Returns false if the main process rejected (already resolved/timed out). */
  async resolvePermission(
    sessionId: string,
    requestId: string,
    decision: 'allow' | 'deny' | 'allowAlways',
    opts?: { message?: string; updatedPermissions?: unknown[] },
  ): Promise<boolean> {
    const resolvedDecision = (decision === 'deny' ? 'deny' : 'allow') as 'allow' | 'deny';

    // Optimistically update the store so the UI responds instantly.
    // Scan the full message array to find and resolve the permission +
    // clear awaitingPermission on its matching tool_call in a single pass.
    const msgs = this.messagesBySession[sessionId] ?? [];
    let foundToolName: string | undefined;
    let foundToolCategory: import('../../shared/types.js').ToolCategory | undefined;
    let foundToolUseId: string | undefined;
    let foundIsPlanExecution = false;
    let changed = false;
    // Resolve the LAST unresolved permission with this requestId.
    // Skip already-resolved ones (stale duplicates from prior query loops).
    const updated = msgs.map((m) => {
      if (m.kind === 'permission') {
        const pm = m as ChatPermissionMessage;
        if (pm.requestId === requestId && !pm.resolved) {
          foundToolName = pm.toolName;
          foundToolCategory = pm.toolCategory;
          foundToolUseId = pm.toolUseId;
          foundIsPlanExecution = !!pm.isPlanExecution;
          changed = true;
          return { ...m, resolved: true as const, decision: resolvedDecision };
        }
      }
      return m;
    });

    if (!changed) return false;

    // Second pass: clear awaitingPermission on the matching tool_call
    if (changed && foundToolUseId) {
      for (let i = 0; i < updated.length; i++) {
        const m = updated[i];
        if (m.kind === 'tool_call' && m.toolUseId === foundToolUseId && m.awaitingPermission) {
          updated[i] = { ...m, awaitingPermission: false };
          break;
        }
      }
      this.messagesBySession[sessionId] = updated;
    }

    // When "Always Allow" is used on edit tools, switch to
    // acceptEdits mode immediately — don't wait for the IPC result.
    // The user's intent is clear regardless of whether main confirms.
    if (decision === 'allowAlways' && foundToolCategory === 'edit') {
      this.setMode(sessionId, 'acceptEdits').catch((e) => {
        console.warn('[resolvePermission] setMode to acceptEdits failed:', e);
      });
    }

    // When a plan execution (ExitPlanMode) is approved, switch to acceptEdits
    // so the plan's edits don't each require individual permission prompts.
    if (foundIsPlanExecution && resolvedDecision === 'allow') {
      this.setMode(sessionId, 'acceptEdits').catch((e) => {
        console.warn('[resolvePermission] setMode to acceptEdits for plan execution failed:', e);
      });
    }

    const permDecision: PermissionDecision = {
      requestId,
      behavior: decision,
      message: decision === 'deny' ? (opts?.message || 'User denied permission') : undefined,
      updatedPermissions: opts?.updatedPermissions,
    };

    // Ask main process — it will emit permission_resolved to confirm
    let accepted: boolean;
    try {
      accepted = await window.groveBench.respondToPermission(sessionId, permDecision);
    } catch (e) {
      console.error('[resolvePermission] IPC call failed:', e);
      accepted = false;
    }

    // If main rejected (stale/timed-out), override to denied
    if (!accepted) {
      const current = this.messagesBySession[sessionId] ?? [];
      let rollbackChanged = false;
      const rollback = current.map((m) => {
        if (m.kind === 'permission' && (m as ChatPermissionMessage).requestId === requestId && m.resolved && (m as ChatPermissionMessage).decision !== 'deny') {
          rollbackChanged = true;
          return { ...m, decision: 'deny' as const };
        }
        return m;
      });
      if (rollbackChanged) this.messagesBySession[sessionId] = rollback;
      return false;
    }

    return true;
  }

  /** Whether the rewind dialog is open for a session */
  rewindDialogOpen = $state<Record<string, boolean>>({});

  /** Get available rewind points (user messages with UUIDs) for a session */
  getRewindPoints(sessionId: string): { uuid: string; text: string; index: number }[] {
    const msgs = this.messagesBySession[sessionId] ?? [];
    const points: { uuid: string; text: string; index: number }[] = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.kind === 'user' && (m as ChatUserMessage).uuid) {
        points.push({
          uuid: (m as ChatUserMessage).uuid!,
          text: m.text,
          index: i,
        });
      }
    }
    // Most recent first
    return points.reverse();
  }

  /** Execute a rewind to a specific user message checkpoint.
   *  When conversationOnly is true, only truncate messages without restoring files. */
  async executeRewind(sessionId: string, userMessageId: string, options?: import('../../shared/types.js').RewindOptions): Promise<void> {
    await window.groveBench.rewindSession(sessionId, userMessageId, options);
    // The rewind event from main will handle message truncation
  }

  /** Open the rewind dialog for a session */
  openRewindDialog(sessionId: string) {
    this.rewindDialogOpen[sessionId] = true;
  }

  /** Close the rewind dialog for a session */
  closeRewindDialog(sessionId: string) {
    this.rewindDialogOpen[sessionId] = false;
  }

  /** Clear all in-memory state for a session so history can be replayed cleanly.
   *  Also unsubscribes any existing listener to avoid duplicate subscriptions.
   *  NOTE: isReady is NOT reset here — it is driven by system_init events and
   *  SESSION_STATUS updates. Resetting it here races with the SESSION_STATUS
   *  handler in App.svelte that sets isReady=true when the session transitions
   *  to 'running'. The caller's post-replay check handles the state correctly. */
  clearSession(sessionId: string) {
    this.unsubscribe(sessionId);
    this.messagesBySession[sessionId] = [];
    this.streamingText[sessionId] = '';
    this.streamingThinking[sessionId] = '';
    this.activityBySession[sessionId] = { activity: 'idle' };
    this.toolProgressBySession[sessionId] = {};
    backgroundTaskStore.clear(sessionId);
    this.sourceIndexBySession.delete(sessionId);
    delete this.stoppingSession[sessionId];
    delete this.awaitingResponse[sessionId];
    delete this.userExplicitMode[sessionId];
    this.streamBuf.delete(sessionId);
    // Preserve isRunning and isReady — caller controls these based on history/status
  }

  /** Tear down ALL state for a session that is being permanently destroyed.
   *  Unlike clearSession (which clears history for replay but keeps the session
   *  alive), this unsubscribes the IPC listener, cancels pending timers, and
   *  deletes every per-session entry so nothing leaks for the app's lifetime. */
  destroySession(sessionId: string) {
    this.unsubscribe(sessionId);

    // Delete every per-session entry. Reassign each $state record so Svelte
    // reliably drops derived subscriptions referencing this session.
    for (const record of [
      this.messagesBySession, this.streamingText, this.streamingThinking,
      this.isRunning, this.pendingClear, this.activityBySession,
      this.toolProgressBySession, this.isReady, this.modelBySession,
      this.modeBySession, this.controlsBySession, this.usageBySession,
      this.systemInfoBySession, this.contextWindowBySession, this.turnsBySession,
      this.promptSuggestionsBySession,
      this.activeTabBySession, this.viewModeBySession,
      this.draftBySession, this.preservedEditHistory, this.paginationBySession,
      this.rewindDialogOpen, this.pendingJumpBySession, this.promptInsertBySession,
      this.queuedBySession, this.queuePausedBySession,
    ] as Record<string, unknown>[]) {
      delete record[sessionId];
    }

    this.sourceIndexBySession.delete(sessionId);
    this.streamBuf.delete(sessionId);

    // Extracted stores own their own per-session teardown.
    backgroundTaskStore.destroy(sessionId);
    rateLimitStore.destroy(sessionId);

    // Plain (non-reactive) bookkeeping records
    delete this.pendingMessageAfterClear[sessionId];
    delete this.stoppingSession[sessionId];
    delete this.awaitingResponse[sessionId];
    delete this.userExplicitMode[sessionId];
  }

  /** Subscribe to events from the main process for a session */
  subscribe(sessionId: string) {
    if (this.cleanups.has(sessionId)) {
      return;
    }
    // Pre-initialize isReady via full-object reassignment so Svelte 5
    // reliably tracks it from the start.
    if (!this.getIsReady(sessionId)) {
      this.setIsReady(sessionId, false);
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
    if (this.getIsRunning(sessionId)) return; // genuinely in-flight
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


  /** After replaying event history, resolve any permission/question messages
   *  that were not resolved by a permission_resolved or tool_result event.
   *  If the session is still running, leave them unresolved (genuinely pending).
   *  Otherwise, mark as denied (timeout/stop/destroy happened before replay). */
  resolveReplayedPermissions(sessionId: string) {
    if (this.getIsRunning(sessionId)) return;
    const msgs = this.messagesBySession[sessionId] ?? [];
    let changed = false;
    const updated = msgs.map((m) => {
      if (m.kind === 'permission' && !m.resolved) {
        changed = true;
        return { ...m, resolved: true as const, decision: 'deny' as const };
      }
      if (m.kind === 'question' && !m.resolved) {
        changed = true;
        return { ...m, resolved: true as const };
      }
      if (m.kind === 'tool_call' && m.awaitingPermission) {
        changed = true;
        return { ...m, awaitingPermission: false };
      }
      return m;
    });
    if (changed) {
      this.messagesBySession[sessionId] = updated;
    }
  }

}

/** User-facing body for a blocked-agent notification — plan approvals and
 *  questions get plain language instead of internal tool names. */
function permissionNotificationBody(event: Extract<AgentEvent, { type: 'permission_request' }>): string {
  if (event.isPlanExecution) return 'A plan is ready for review';
  if (event.toolCategory === 'question') return 'Agent is waiting for an answer';
  return `${event.toolName} is waiting for permission`;
}

export const messageStore = new MessageStore();
