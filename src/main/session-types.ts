/**
 * State of a live conversation in the main process, shared by the session
 * manager (agent-session.ts) and the modules it delegates to.
 */
import type { BrowserWindow } from 'electron';
import type { AgentEvent, McpElicitationResponse, PermissionMode, SessionStatus } from '../shared/types.js';
import type { AgentAdapter, AgentQueryHandle, PermissionResponse, UserMessage } from './adapters/types.js';
import type { Checkpoints } from './no-git-checkpoints.js';

export type Emit = (event: AgentEvent) => void;

export interface PendingPermission {
  requestId: string;
  toolName: string;
  toolUseId: string;
  toolInput: Record<string, unknown>;
  resolve: (result: PermissionResponse) => void;
}

/** An MCP elicitation waiting on the user. `resolve` answers the server,
 *  emits elicitation_resolved and drops the entry. */
export interface PendingElicitation {
  requestId: string;
  resolve: (response: McpElicitationResponse) => void;
}

export interface ManagedSession {
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
  pendingElicitations: Map<string, PendingElicitation>;
  /** Tools the user has chosen to always allow for this session */
  alwaysAllowedTools: Set<string>;
  /** Names of the tools this session's agent asked to run as file edits
   *  (category 'edit'), so leaving an edit-accepting mode can take them back
   *  out of alwaysAllowedTools whatever the agent calls them. */
  editToolNames?: Set<string>;
  providerSessionId: string | null;
  /** Set by rewindFiles(): provider chain-entry uuid to fork the conversation
   *  at on the next query start (resume truncated at this point, forkSession).
   *  Cleared once a query starts successfully with it. */
  pendingResumeAt: string | null;
  /** Current model for this session — the source of truth across stop/restart,
   *  in-app resume, and app-restart resume (persisted to the worktree manifest).
   *  Initialised from the restored/default model, updated on model switches and
   *  from the provider's system_init (normalised to a known picker id). */
  model: string | null;
  window: BrowserWindow;
  /** Buffered events for replay after renderer reload. Transient streaming
   *  events (see TRANSIENT_EVENT_TYPES in session-event-store.ts) are not kept here — the renderer
   *  skips them on replay anyway. */
  eventHistory: AgentEvent[];
  /** JSONL lines waiting to be appended to eventLogPath (see SessionEventStore). */
  logBuffer: string[];
  logBufferBytes: number;
  logFlushTimer: ReturnType<typeof setTimeout> | null;
  /** Set by closeSession/destroySession before the query is closed so the
   *  event loop's tail (status update, completion callback, memory auto-save)
   *  is skipped. The session is going away, and on destroy its worktree is
   *  about to be removed, so nothing may spawn inside it. */
  destroying: boolean;
  /** Last result data for completion callback */
  lastResult: { isError: boolean; totalCostUsd?: number; durationMs?: number } | null;
  /** Permission mode for the SDK query. */
  permissionMode: PermissionMode;
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
  /** Values for the adapter's declared controls (thinking, speed, ...) keyed
   *  by control id — survive stop/restart so query restarts keep them.
   *  permissionMode lives in its own field because the session manager
   *  layers app-level behaviour (read-safe mode) on top of it. */
  controls: Record<string, string>;
  /** Set when the user clicks Stop — prevents runQuery (agent-session.ts) from sending SESSION_STATUS 'stopped'. */
  stoppedByUser: boolean;
  /** Set while a user-initiated in-place interrupt is settling. The resulting
   *  turn reports abort/teardown noise (e.g. "Request was aborted", in-flight
   *  tool failures); this flag lets runQuery treat that as a clean stop instead
   *  of surfacing it as an error. Cleared once the interrupt's result/throw is
   *  consumed. */
  interrupting: boolean;
  /** Whether a memory auto-save is currently in progress. */
  autoSaveInProgress: boolean;
  /** Emit function for sending events to the renderer — set by createEmitter. */
  emit: Emit | null;
  /** Counter for permission request IDs; persists across stopQuery restarts
   *  but not a new ManagedSession, so the ids also carry a random part. */
  permRequestCounter: number;
  /** Guard against concurrent runQuery calls (e.g. rapid double-stop). */
  isStartingQuery: boolean;
  /** Set when a stop/restart arrives while a query is still starting up. The
   *  in-flight runQuery honours this once startup settles, so the restart isn't
   *  silently dropped by the isStartingQuery guard. */
  restartRequested: boolean;
  /** Resolves when the current runQuery() finishes initializing queryHandle.
   *  sendMessage() awaits this so messages sent right after stop aren't lost. */
  queryReady: Promise<void> | null;
  /** Resolver for queryReady — called in runQuery after queryHandle is set. */
  resolveQueryReady: (() => void) | null;
  /** Git-based checkpoint manager for rewind functionality. */
  checkpoints: Checkpoints;
  /** The conversation's folder is a git repository. Without git there are no
   *  checkpoints and no commits, so neither is attempted. */
  gitBacked: boolean;
  /** The last checkpoint capture failed. The thread is told once per run of
   *  failures (git missing, a broken repository), not on every message. */
  checkpointFailing?: boolean;
  /** Status to go back to when a sleeping session wakes: 'running', or
   *  'starting' when its query had not reported system_init yet. */
  statusBeforeSleep: SessionStatus | null;
  /** Resolves once sleepSession() has shut the agent process down. A wake,
   *  close or destroy waits on it so two agents never share a transcript. */
  sleepSettled: Promise<void> | null;
  /** The query whose turn is in progress: set when a message is sent or the
   *  agent starts replying, cleared on its result. Tied to the handle, so a
   *  replaced query never counts as mid-turn. Idle sleep refuses while set,
   *  rather than trusting the renderer's view alone. */
  turnHandle: AgentQueryHandle | null;
  /** Prompts sent to a resumed query's `handle` before it reported
   *  system_init. If the agent turns out not to have the conversation it
   *  resumed, they went nowhere, and the new conversation started in its
   *  place gets them. Null for a fresh query, or once the query reports in. */
  promptsBeforeInit: { handle: AgentQueryHandle; prompts: UserMessage[] } | null;
}

export interface SessionCompletionResult {
  sessionId: string;
  isError: boolean;
  totalCostUsd?: number;
  durationMs?: number;
}
