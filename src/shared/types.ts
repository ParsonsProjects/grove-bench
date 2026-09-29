// ─── Worktree ───

export interface WorktreeConfig {
  repoPath: string;
  branchName: string;
  baseBranch?: string;
  useExisting?: boolean;
  /** Pre-generated ID — if omitted, a random one is created. */
  id?: string;
  /** Which adapter will run in this worktree (for generating agent-specific settings). */
  adapterType?: string;
}

export interface WorktreeInfo {
  id: string;
  path: string;
  branch: string;
  repoPath: string;
  createdAt: number;
  /** Timestamp (ms) of the last user interaction (message sent). */
  lastActiveAt?: number;
  /** True when session runs directly on the repo (no worktree created). */
  direct?: boolean;
  /** User-assigned or auto-generated display name, persisted across restart. */
  displayName?: string | null;
  /** Epoch ms when the user marked the session completed; null/absent when
   *  it is still open. Completed sessions are hidden from the sidebar by
   *  default and reopen on the next user message. */
  completedAt?: number | null;
  /** Adapter id of the agent the session runs, from the manifest. */
  agentType?: string;
}

export interface WorktreeRepoConfig {
  copyFiles: string[];
}

// ─── Session ───

export interface CreateSessionOpts {
  repoPath: string;
  branchName: string;
  baseBranch?: string;
  useExisting?: boolean;
  /** Run directly on the repo checkout — no worktree is created. */
  direct?: boolean;
  /** Attach a new (direct) session to an existing session's checkout + branch,
   *  sharing its worktree instead of running on the repo's default branch.
   *  Implies direct mode; the branch/path are resolved from the source session. */
  attachToSessionId?: string;
  /** Which adapter to use for this session (defaults to registry default). */
  adapterType?: string;
  /** Mode to start in instead of the agent's saved default (e.g. 'plan' for
   *  a review). Falls back to the default when the agent doesn't offer it. */
  permissionMode?: PermissionMode;
  /** Model to start on instead of the agent's default model. */
  model?: string;
  /** Starting values for the agent's other controls (effort, thinking, …),
   *  keyed by control id. Values the model doesn't offer are ignored. */
  controls?: Record<string, string>;
}

/** 'sleeping': an open conversation whose agent process was shut down after
 *  it sat idle. It keeps its place in the Conversations list and its live
 *  state (mode, controls, always-allowed tools) and wakes when opened or sent
 *  a message. The terminal is left running. */
export type SessionStatus = 'starting' | 'installing' | 'running' | 'sleeping' | 'stopped' | 'error';

export interface SessionInfo {
  id: string;
  branch: string;
  worktreePath: string;
  repoPath: string;
  status: SessionStatus;
  agentType: string;
  createdAt: number;
  /** User-assigned display name — shown instead of branch when set. */
  displayName?: string | null;
}

// ─── Prerequisites ───

/** A registered agent as the renderer sees it. */
export interface AgentSummary {
  id: string;
  displayName: string;
  capabilities: Record<string, boolean>;
  isDefault?: boolean;
  /** The adapter's own model for background tasks, if it declares one. */
  backgroundModel?: string;
  /** How the agent handles MCP servers. Absent: no MCP support Grove can drive. */
  mcp?: McpSupport;
}

/** One agent's install and sign-in state. */
export interface AgentPrerequisiteStatus {
  available: boolean;
  path?: string;
  authenticated?: boolean;
  authMethod?: string;
  email?: string;
  /** Adapter-provided error message when not available (e.g. install instructions). */
  errorMessage?: string;
  /** Adapter-provided message when not authenticated. */
  authErrorMessage?: string;
  /** Present when the provider accepts an API key entered in the app. The
   *  key itself never reaches the renderer. */
  apiKey?: {
    label: string;
    helpUrl: string;
    /** How using a key is paid for, shown under the field. */
    billingNote?: string;
    /** A key is saved. While saved it is used instead of any CLI sign-in. */
    saved: boolean;
    /** The OS can encrypt a key. Without it no key can be saved. */
    canStore: boolean;
  };
  /** Present when the user can sign in with the provider's CLI instead of a
   *  key. `available` above says whether that CLI is installed. */
  cliSignIn?: {
    accountLabel: string;
    accountDetail?: string;
    cliName: string;
    command: string;
    setupUrl: string;
  };
}

export interface PrerequisiteStatus {
  git: {
    available: boolean;
    version?: string;
    meetsMinimum?: boolean;
  };
  /** One entry per registered agent, keyed by adapter id. */
  agents: Record<string, AgentPrerequisiteStatus>;
  /** GitHub CLI — optional; only gates PR automation, never blocks the app. */
  gh?: {
    available: boolean;
    version?: string;
    authenticated?: boolean;
  };
}

// ─── Tool Categories (adapter-agnostic) ───

/**
 * Adapter-agnostic tool categories for renderer display logic.
 * Adapters map their provider-specific tool names to these categories
 * so the renderer doesn't need to know provider-specific tool names.
 */
export type ToolCategory = 'edit' | 'read' | 'bash' | 'question' | 'web_fetch' | 'agent' | 'other';

// ─── Agent Events (renderer-side, serializable) ───

/**
 * Serializable events sent from main → renderer via IPC.
 * These are adapter-agnostic events simplified for safe serialization
 * across the IPC boundary.
 */
export type AgentEvent =
  | { type: 'system_init'; sessionId: string; model: string; tools: string[]; agents?: string[]; skills?: string[]; slashCommands?: string[]; mcpServers?: { name: string; status: string }[] }
  | { type: 'assistant_text'; text: string; uuid: string }
  | { type: 'assistant_tool_use'; toolName: string; toolInput: unknown; toolUseId: string; uuid: string; toolCategory?: ToolCategory }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'result'; subtype: string; result?: string; structured_output?: unknown; totalCostUsd?: number; durationMs?: number; isError: boolean; errors?: string[]; numTurns?: number; contextWindow?: number }
  | { type: 'permission_request'; toolName: string; toolInput: unknown; toolUseId: string; requestId: string; decisionReason?: string; suggestions?: unknown[]; isPlanExecution?: boolean; toolCategory?: ToolCategory; planText?: string }
  | { type: 'thinking'; thinking: string; uuid: string }
  | { type: 'partial_text'; text: string }
  | { type: 'partial_thinking'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number }
  | { type: 'compact_boundary'; trigger: 'manual' | 'auto'; preTokens: number }
  | { type: 'tool_progress'; toolName: string; toolUseId: string; elapsedSeconds: number }
  | { type: 'activity'; activity: 'thinking' | 'tool_starting' | 'generating' | 'idle' ; toolName?: string }
  | { type: 'user_message'; text: string; uuid?: string }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | { type: 'process_exit'; exitCode?: number }
  // Rate limiting
  | { type: 'rate_limit'; status: 'allowed' | 'allowed_warning' | 'rejected'; resetsAt?: number; utilization?: number; rateLimitType?: string }
  // Background tasks (Agent tool sub-tasks)
  | { type: 'task_started'; taskId: string; toolUseId?: string; description: string; taskType?: string }
  | { type: 'task_progress'; taskId: string; toolUseId?: string; description: string; summary?: string; lastToolName?: string; totalTokens: number; toolUses: number; durationMs: number }
  | { type: 'task_notification'; taskId: string; toolUseId?: string; taskStatus: 'completed' | 'failed' | 'stopped'; summary: string; outputFile: string; totalTokens?: number; toolUses?: number; durationMs?: number }
  /** Authoritative list of every live background task (replace semantics). */
  | { type: 'background_tasks_changed'; tasks: Array<{ taskId: string; taskType?: string; description: string }> }
  // Auth status
  | { type: 'auth_status'; isAuthenticating: boolean; output: string[]; authError?: string }
  // Tool use summary (after compaction)
  | { type: 'tool_use_summary'; summary: string; toolUseIds: string[] }
  // Prompt suggestions
  | { type: 'prompt_suggestion'; suggestion: string }
  // Hook execution
  | { type: 'hook_event'; subtype: 'started' | 'progress' | 'response'; hookId: string; hookName: string; hookEvent: string; output?: string; outcome?: string; exitCode?: number }
  // MCP elicitation: a server asks the user for input mid-tool-call
  | { type: 'elicitation_request'; requestId: string; request: McpElicitationRequest }
  | { type: 'elicitation_resolved'; requestId: string; action: McpElicitationResponse['action'] }
  // MCP elicitation complete
  | { type: 'elicitation_complete'; serverName: string; elicitationId: string }
  // Files persisted to disk
  | { type: 'files_persisted'; files: { filename: string; fileId: string }[]; failed: { filename: string; error: string }[] }
  // Permission mode sync — source is required so the renderer knows whether to
  // respect user-explicit overrides ('sdk' may be stale, 'session' is authoritative)
  | { type: 'mode_sync'; mode: PermissionMode; source: 'sdk' | 'session' }
  // Adapter-declared session controls (descriptors depend on the model) and
  // their current values — emitted on query start, model switch, and control change
  | { type: 'controls_sync'; descriptors: ControlDescriptor[]; values: Record<string, string> }
  // Permission resolved (authoritative — emitted by main for all resolution paths)
  | {
      type: 'permission_resolved';
      requestId: string;
      toolUseId: string;
      decision: 'allow' | 'deny';
      /** The user's typed reply for a question (AskUserQuestion) or deny
       *  reason, so replayed history can still show what was answered. */
      message?: string;
    }
  // Memory auto-save status
  | { type: 'memory_autosave'; status: 'started' | 'completed' | 'skipped'; filesWritten?: string[] }
  // Rewind checkpoint
  | { type: 'rewind'; toMessageId: string; conversationOnly?: boolean; filesOnly?: boolean }
  // Git has no user.name/user.email for this conversation's checkout, so the
  // agent's commits will likely fail. Emitted at most once per conversation.
  | { type: 'git_identity_missing' };

/** A single full-history search match (main-process search over event history). */
export interface EventSearchHit {
  /** Index of the matching event in the session's (prelaunch-prefixed) history. */
  eventIndex: number;
  /** Display category for the dropdown (user / assistant / thinking / tool / …). */
  kind: string;
  /** Whitespace-collapsed text window around the match, ellipsised when truncated. */
  snippet: string;
}

/** A search match from the cross-session search (SessionFinder "in conversations"). */
export interface CrossSessionSearchHit extends EventSearchHit {
  /** Session whose history contained the match. */
  sessionId: string;
}

/** Lightweight conversation context for a session, derived from its event history.
 *  Used for sidebar subtitles / search entries when the renderer hasn't loaded
 *  the session's messages (e.g. stopped sessions). */
export interface SessionPreview {
  /** First real user prompt (slash commands skipped), whitespace-collapsed. */
  firstPrompt: string;
  /** Most recent user/assistant text, whitespace-collapsed. */
  lastText: string;
}

// ─── PTY / Terminal ───

/** @deprecated Legacy shell output event — replaced by PTY data stream. */
export interface ShellOutputEvent {
  execId: string;
  stream: 'stdout' | 'stderr' | 'exit';
  data?: string;
  exitCode?: number;
}

/** Permission decision from renderer → main */
export interface PermissionDecision {
  requestId: string;
  behavior: 'allow' | 'deny' | 'allowAlways';
  message?: string; // denial message
  updatedPermissions?: unknown[]; // PermissionUpdate[] from adapter suggestions
}

// ─── Git Status ───

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied';

export interface GitStatusEntry {
  filePath: string;
  status: GitFileStatus;
  staged: boolean;
  origPath?: string;
  /** Line counts from `git diff --numstat` (combined vs HEAD); absent for untracked files. */
  additions?: number;
  deletions?: number;
  /** Blob hash of the working-tree content (`git hash-object`), or 'deleted'.
   *  Lets the UI tell when a file changed since the user last viewed it. */
  contentHash?: string;
}

/** What the Changes tab compares against: the uncommitted working tree
 *  (staged / unstaged / untracked, like a git client) or everything on the
 *  branch since it diverged from the base (like a pull request). */
export type DiffScope = 'working' | 'branch';

export interface GitStatusOptions {
  scope?: DiffScope;
  /** Base branch for `scope: 'branch'` (merge-base with HEAD is the comparison point). */
  base?: string;
}

export interface GitStatusResult {
  entries: GitStatusEntry[];
  /** The ref the branch scope resolved (`main` or `origin/main`). */
  baseRef?: string;
  /** Set when the branch scope could not find a merge base with `base`. */
  scopeError?: string;
}

export interface FileDiffOptions {
  /** Diff against the merge-base with this branch instead of HEAD/index. */
  base?: string;
}

/** Lines of the "new side" of a file (working tree, or the index for a staged
 *  diff), used to expand context around hunks. Null when unreadable / binary. */
export type FileLinesResult = { lines: string[] } | null;

/** Which checkpoint comparison to show: what one turn changed, everything
 *  since a checkpoint (rewind preview), or the whole session. */
export type CheckpointDiffScope = 'turn' | 'since' | 'full';

/** Result of a single-file diff request. Text files carry a unified patch; binary
 *  and image files are flagged so the UI can show a card / thumbnails instead of garbled text. */
export type FileDiffResult =
  | { kind: 'text'; patch: string }
  | { kind: 'binary' }
  | { kind: 'image'; ext: string };

/** Base64 data URLs for an image file's working-tree and HEAD versions (either may be null). */
export interface ImageDiffContent {
  working: string | null;
  head: string | null;
}

/** How far a rewind reaches. Default (neither flag) restores files AND
 *  truncates the conversation. `conversationOnly` keeps the files on disk;
 *  `filesOnly` keeps the conversation (used for checkpoints from before a
 *  `/clear`, whose messages no longer exist to rewind to). */
export interface RewindOptions {
  conversationOnly?: boolean;
  filesOnly?: boolean;
}

export interface CheckpointListItem {
  uuid: string;
  turn: number;
  ref: string;
  text?: string;
  /** True when this checkpoint was captured before the most recent `/clear`.
   *  Its files can still be restored, but its message is no longer part of
   *  the conversation, so a conversation rewind to it is not offered. */
  beforeClear?: boolean;
}

/** Aggregate diff statistics (git diff --numstat totals). */
export interface DiffStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

/** One turn in the session's diff history: what that turn changed on disk. */
export interface DiffHistoryEntry extends DiffStats {
  uuid: string;
  turn: number;
  text?: string;
}

/** Per-turn diff history plus the cumulative stats across the whole session. */
export interface DiffHistoryResult {
  entries: DiffHistoryEntry[];
  total: DiffStats;
}

// ─── PR Info ───

/** Rollup of a PR's status checks (CI). Null when the PR has no checks. */
export interface PrChecksSummary {
  total: number;
  passed: number;
  failed: number;
  pending: number;
}

/** An open pull request, as listed for picking one to review. */
export interface OpenPrSummary {
  number: number;
  title: string;
  /** The PR's head branch. */
  headRefName: string;
  /** Login of the PR's author; empty when gh didn't report one. */
  author: string;
  isDraft: boolean;
  /** Head branch lives in a fork, so it isn't a branch of this repo. */
  isCrossRepository: boolean;
  url: string;
}

export interface PrInfo {
  number: number;
  url: string;
  state?: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft?: boolean;
  title?: string;
  /** APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | '' (no reviews requested). */
  reviewDecision?: string;
  checks?: PrChecksSummary | null;
  /** Head commit the checks ran against. */
  headSha?: string;
  /** Names of the currently failing checks. */
  failingChecks?: string[];
  /** Opaque ids of conversation comments + submitted reviews — diffed to detect new feedback. */
  commentSignature?: string[];
  /** Branch the PR merges from. Not always the session's recorded branch: the
   *  agent may open a PR from another branch it checked out in the session. */
  headRefName?: string;
  /** Branch the PR merges into. Two open PRs from one head differ only here. */
  baseRefName?: string;
}

/** A review comment or review body on a PR (flattened for prompts/UI). */
export interface PrReviewComment {
  id: string;
  author: string;
  /** OWNER | MEMBER | COLLABORATOR | CONTRIBUTOR | NONE | ... */
  authorAssociation: string;
  /** File the comment is anchored to (absent for review bodies / conversation comments). */
  path?: string;
  line?: number;
  body: string;
}

export interface PrCreateOpts {
  title: string;
  body: string;
  base: string;
  draft?: boolean;
}

/** Local branch position vs its upstream. Upstream null = branch never pushed. */
export interface GitSyncStatus {
  upstream: string | null;
  ahead: number;
  behind: number;
}

/** One commit on the session branch that isn't on the base branch. */
export interface BranchCommit {
  subject: string;
  body: string;
}

/** A commit with its id, for pickers (cherry-pick source lists). */
export interface CommitEntry {
  sha: string;
  shortSha: string;
  subject: string;
}

/** Outcome of a branch operation (rebase / cherry-pick / squash). A failed
 *  operation is always unwound (`--abort`) before returning, so the worktree
 *  is never left mid-operation; `conflicts` lists the files that clashed. */
export interface GitOpResult {
  success: boolean;
  conflicts?: string[];
  error?: string;
}

/** What merging a conversation's branch into another branch would do, for
 *  the confirmation dialog. `mergeInto` checks the same things again. */
export interface MergeIntoPlan {
  /** The conversation's branch, merged from. */
  branch: string;
  /** The branch merged into. */
  target: string;
  /** Commits on `branch` that `target` doesn't have yet. */
  commits: number;
  /** The checkout that has `target`, where the merge runs. Null when no
   *  checkout has it: then `target` can only be fast-forwarded. */
  checkoutPath: string | null;
  /** Files with uncommitted changes in the conversation. They aren't part of
   *  the merge. */
  uncommitted: number;
  /** Why the merge can't run as things stand, in words for the dialog. */
  blocked?: string;
}

/** Outcome of switching a conversation's checkout to another branch. Every
 *  conversation sharing that checkout moves with it, so `sessionIds` lists
 *  all of them (the one that asked included). */
export type BranchSwitchResult =
  | { success: true; branch: string; sessionIds: string[] }
  | { success: false; error: string };

/** The recorded branch moved to follow the checkout (the agent or a terminal
 *  ran `git checkout`). `sessionIds` are every conversation sharing it. */
export interface BranchSyncResult {
  branch: string;
  sessionIds: string[];
}

// ─── Thinking Level ───

/** Provider-agnostic thinking/reasoning effort level. Each adapter maps these
 *  to its own mechanism (token budgets, effort params, on/off, ...).
 *  'high' means the provider's default/maximum reasoning behavior.
 *  'adaptive' lets the model decide when and how much to think. */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'adaptive';

/** Canonical order of the Claude adapter's thinking options. */
export const THINKING_LEVELS: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'adaptive'];

// ─── Session Controls ───

/** Visual weight for a control option's status-bar badge. Adapters pick a
 *  tone; the renderer maps it to theme colours so providers never hardcode
 *  CSS. */
export type ControlTone = 'muted' | 'neutral' | 'info' | 'warning' | 'accent' | 'accent-soft' | 'success' | 'highlight';

export interface ControlOption {
  value: string;
  /** Short badge text, e.g. "Plan" or "Think: Low". */
  label: string;
  /** Longer explanation for settings UIs and tooltips. */
  description?: string;
  tone?: ControlTone;
  /** Options that belong to a different source than the provider's own
   *  (e.g. an app-level mode) name it here. The UI draws a divider and this
   *  heading where the group changes, so ungrouped options come first. */
  group?: string;
}

/**
 * A runtime toggle an adapter exposes for a session (permission mode, effort,
 * speed, ...). Adapters declare these per model so the status bar renders
 * exactly the options a provider supports instead of forcing every provider
 * into one fixed enum. Well-known ids get app-level keyboard shortcuts (see
 * CONTROL_SHORTCUTS); any other id is rendered as a plain cycling badge.
 */
export interface ControlDescriptor {
  id: string;
  /** Human label for tooltips and settings, e.g. "Mode", "Thinking". */
  label: string;
  /** Ordered options; the badge cycles through them in this order. */
  options: ControlOption[];
  /** Value applied when the session has no recorded choice. */
  default: string;
}

/** Control ids the app knows about. Permission mode is special-cased because
 *  the session manager implements app-level behaviour (read-safe mode) on top of
 *  the adapter's mapping; everything else is opaque to the app. */
export const CONTROL_IDS = {
  permissionMode: 'permissionMode',
  thinking: 'thinking',
  effort: 'effort',
  speed: 'speed',
} as const;

/** App-level shortcuts bound to well-known control ids. */
export const CONTROL_SHORTCUTS: Record<string, string> = {
  [CONTROL_IDS.permissionMode]: 'Alt+M',
  [CONTROL_IDS.thinking]: 'Alt+T',
  [CONTROL_IDS.effort]: 'Alt+E',
};

// ─── Provider usage ("runway") ───

/** One plan rate-limit window as reported by a provider. */
export interface UsageWindow {
  /** Provider-defined id, e.g. 'five_hour', 'seven_day', 'model:Fable'. */
  id: string;
  /** Short display label, e.g. "5-hour", "Weekly · Opus". */
  label: string;
  /** Fraction of the window consumed, 0–1. */
  utilization: number;
  /** Epoch seconds when the window resets. */
  resetsAt?: number;
}

/** Account-level usage for a provider. Not per session: every session on the
 *  same sign-in shares these windows. */
export interface ProviderUsage {
  /** False when the sign-in has no plan limits to report (API key, Bedrock,
   *  Vertex, ...). `windows` is empty in that case. */
  available: boolean;
  /** Subscription name when known, e.g. 'pro', 'max'. */
  plan?: string | null;
  windows: UsageWindow[];
  /** Epoch ms of the fetch that produced this snapshot. */
  fetchedAt: number;
}

/** Snapshot of a session's controls: the descriptors valid for its current
 *  model plus the recorded value for each. `values` never carries
 *  permissionMode — that flows through mode_sync so stale-SDK handling stays
 *  in one place. */
export interface SessionControls {
  descriptors: ControlDescriptor[];
  values: Record<string, string>;
}

// ─── Skills ───

/** A skill discovered on disk or reported by a running session. */
export interface SkillInfo {
  /** Skill name (SKILL.md frontmatter `name`, falling back to the directory name). */
  name: string;
  /** Frontmatter `description` — empty when the manifest has none or the skill
   *  is only known from a session's init report. */
  description: string;
  /** Where the skill was found: the worktree's `.claude/skills`, the user's
   *  `~/.claude/skills`, or only reported by the running session (e.g. a
   *  plugin-provided skill with no scannable location). */
  source: 'project' | 'user' | 'session';
  /** Absolute path to SKILL.md for on-disk skills. */
  path?: string;
}

/** Provider-neutral definition for authoring a new skill. Each adapter
 *  serializes this into its native packaged-instructions format. */
export interface SkillDefinition {
  /** Kebab-case identifier, e.g. "release-notes". */
  name: string;
  /** When the agent should invoke the skill. */
  description: string;
  /** Markdown instruction body. */
  instructions: string;
  /** 'project' writes into the session's worktree (ships with the branch);
   *  'user' writes to the provider's global location (all repos). */
  scope: 'project' | 'user';
}

/** A proposed skill mined from recurring session patterns. */
export interface SkillSuggestion {
  /** Stable id derived from the underlying pattern — dismissals key on it. */
  id: string;
  /** Proposed kebab-case skill name. */
  name: string;
  /** Proposed trigger description. */
  description: string;
  /** Draft instruction body to prefill the Add Skill dialog with. */
  draftInstructions: string;
  /** One-line human-readable why (e.g. "Similar requests in 4 sessions"). */
  rationale: string;
  /** Example prompt/command excerpts the pattern was mined from. */
  evidence: string[];
  /** Distinct sessions the pattern appeared in. */
  sessionCount: number;
}

// ─── MCP Servers ───

/** Provider-agnostic snapshot of an agent's MCP server connection. */
export interface McpServerInfo {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  /** Error message when status is 'failed'. */
  error?: string;
  /** Config scope (e.g. project, user, local) when the provider reports one. */
  scope?: string;
  /** Where the server comes from, as a short label for display (e.g. user,
   *  project, a plugin). Worked out by the adapter. */
  origin?: string;
  /** Number of tools the server exposes, when connected. */
  toolCount?: number;
  /** The server's tools, when connected. */
  tools?: McpToolInfo[];
}

export interface McpToolInfo {
  name: string;
  description?: string;
  /** Server-declared hints (MCP tool annotations). */
  readOnly?: boolean;
  destructive?: boolean;
}

/** An MCP server asking the user for input during a tool call (MCP
 *  elicitation). Form mode asks for fields; URL mode asks the user to open a
 *  page, e.g. to sign in. */
export interface McpElicitationRequest {
  serverName: string;
  message: string;
  mode: 'form' | 'url';
  /** Page to open (URL mode). */
  url?: string;
  /** JSON Schema of the requested fields (form mode). The MCP spec limits it
   *  to a flat object of string, number, integer, boolean and enum fields. */
  requestedSchema?: Record<string, unknown>;
  /** Heading the server supplied, if any. */
  title?: string;
}

export interface McpElicitationResponse {
  action: 'accept' | 'decline' | 'cancel';
  content?: Record<string, string | number | boolean | string[]>;
}

/** How much of the context window one MCP server's tool definitions use. */
export interface McpServerContextCost {
  serverName: string;
  /** Tokens of tool definitions loaded into the context window. */
  tokens: number;
  /** Tokens of tool definitions held back until the agent searches for them. */
  deferredTokens: number;
}

/** Result of kicking off an OAuth sign-in for an MCP server. */
export interface McpAuthStartResult {
  /** URL the user must open to authorize. Absent when no user action is needed. */
  authUrl?: string;
  /** True when the provider will redirect back to the agent, which then
   *  finishes the flow and reconnects on its own. False means the user must
   *  reconnect manually after authorizing (e.g. claude.ai connectors). */
  callbackExpected: boolean;
}

/** An MCP server from the agent CLI's configuration (settings page view).
 *  Unlike McpServerInfo this is config-level, not tied to a running session. */
export interface McpConfiguredServer {
  name: string;
  /** Command line (stdio) or URL (http/sse) the server is configured with. */
  target: string;
  /** Transport when the CLI reports one (e.g. HTTP, SSE). */
  transport?: string;
  /** `needs-approval` and `rejected` are project (.mcp.json) servers the user
   *  hasn't approved, or has turned down. Neither is connected. */
  status: McpServerInfo['status'] | 'needs-approval' | 'rejected';
  /** Set when something else owns the server (e.g. a plugin), so it can't be
   *  removed from Grove. */
  managedBy?: McpServerManager;
}

/** The owner of an MCP server Grove can't remove, as the adapter describes it. */
export interface McpServerManager {
  /** Short tag shown in place of Remove, e.g. "figma plugin". */
  label: string;
  /** How to turn the server off instead. */
  hint: string;
}

/**
 * How an agent handles MCP servers, and the wording and rules the UI uses
 * for them. Each adapter describes its own, so nothing in the UI assumes
 * one agent's behaviour.
 */
export interface McpSupport {
  /** Controls on a running conversation. Each needs the matching optional
   *  AgentQueryHandle method. */
  controls: {
    /** Live server status (listMcpServers). */
    list: boolean;
    reconnect: boolean;
    /** Connect / Disconnect (setMcpServerEnabled). */
    toggle: boolean;
    /** Browser sign-in for a server that needs it (authenticateMcpServer). */
    signIn: boolean;
    /** Context-window cost per server (getMcpContextCost). */
    contextCost: boolean;
  };
  /** Tooltip for Disconnect: how long it lasts and what it affects. */
  disconnectHint: string;
  /** Editing configured servers (Settings > MCP). Absent: not supported. */
  config?: {
    /** Scopes a server can be added to. */
    scopes: { value: McpConfigScope; label: string; description: string }[];
    /** Server names the agent accepts, as a RegExp source, and the rule in words. */
    namePattern: string;
    nameRule: string;
    /** Set when project servers must be approved before they connect: the
     *  explanation shown next to Approve. */
    approvalHint?: string;
  };
}

export type McpConfigScope = 'local' | 'user' | 'project';

/** Options for registering a new MCP server in the agent CLI's config. */
export interface McpAddServerOpts {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  /** Command (stdio) or URL (http/sse). */
  commandOrUrl: string;
  /** Extra command arguments (stdio only). */
  args?: string[];
  /** Environment variables (stdio only). */
  env?: Record<string, string>;
  /** Request headers, e.g. "Authorization: Bearer ..." (http/sse only). */
  headers?: string[];
  scope: McpConfigScope;
  /** Repo directory the scope is resolved against (local/project scopes). */
  cwd?: string;
}

// ─── OS Notifications ───

/** Renderer → main request to show a desktop notification. Main gates on
 *  window focus and the per-kind settings, so callers can fire unconditionally. */
export interface OsNotificationRequest {
  kind: 'turn_complete' | 'permission_request' | 'pr_alert';
  /** Session to focus when the notification is clicked. */
  sessionId: string;
  title: string;
  body: string;
}

// ─── Spell check ───

/** Main → renderer: the user right-clicked a misspelled word. The renderer
 *  draws the suggestion menu in the app's own style. */
export interface SpellcheckMenuRequest {
  /** Where the click landed, in window coordinates (fallback position). */
  x: number;
  y: number;
  misspelledWord: string;
  suggestions: string[];
}

// ─── Image Attachment ───

export interface ImageAttachment {
  /** base64-encoded image data (no data: prefix) */
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  name: string;
}

// ─── Plugins ───

export interface InstalledPlugin {
  id: string;
  version: string;
  scope: 'user' | 'project' | 'local';
  enabled: boolean;
  installPath: string;
  installedAt: string;
  lastUpdated: string;
  projectPath?: string;
}

export interface AvailablePlugin {
  pluginId: string;
  name: string;
  description: string;
  marketplaceName: string;
  version: string;
  source: string;
  installCount: number;
}

export interface PluginListResult {
  installed: InstalledPlugin[];
  available: AvailablePlugin[];
}

/** Sidebar session ordering: key + direction (persisted via app-state). */
export interface SessionSortState {
  key: 'name' | 'age';
  dir: 'asc' | 'desc';
}

// ─── IPC API (exposed via contextBridge) ───

// ─── Preview tab ───

/** The two pages behind a conversation's Preview tab: yours (an interactive
 *  browser view) and Claude's (an offscreen page the agent's browser tools
 *  drive). They share cookies and storage. */
export type PreviewPageKind = 'user' | 'agent';

/** Where your page sits in the window, in CSS pixels from the top-left. */
export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewPageState {
  /** '' until something is loaded. */
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Last main-frame load failure; cleared by the next successful load. */
  error: { code: number; description: string; url: string } | null;
  /** The page's process died. Reload to recover. */
  crashed: boolean;
  /** Claude's page only: its last action and when it happened. */
  lastAction?: { text: string; at: number } | null;
  /** Claude's page only: viewport size in CSS pixels. */
  size?: { width: number; height: number };
}

export type PreviewCommand = 'back' | 'forward' | 'reload' | 'hardReload' | 'stop' | 'devtools';

/** A key pressed in your page that Grove should handle. */
export type PreviewKeyForward =
  | { action: 'focusAddress' }
  | { action: 'key'; key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean };

export interface GroveBenchAPI {
  // Repo operations
  addRepo(): Promise<string | null>;
  removeRepo(repoPath: string): Promise<void>;
  validateRepo(path: string): Promise<boolean>;

  // Session operations
  createSession(opts: CreateSessionOpts): Promise<{ id: string; branch: string; agentType: string }>;
  resumeSession(id: string, repoPath: string): Promise<{ id: string; branch: string }>;
  /** Stop the current turn; the agent process stays up for the next message. */
  stopSession(id: string): Promise<void>;
  /** Close a conversation: shut down its agent, background tasks and
   *  terminal (and the ports they hold), keeping it resumable. */
  closeSession(id: string): Promise<void>;
  /** Put an idle conversation to sleep: shut down its agent process but keep
   *  it open. Resolves false when it is busy or not live, and stays awake. */
  sleepSession(id: string): Promise<boolean>;
  /** Wake a sleeping conversation (restart its agent on the same transcript). */
  wakeSession(id: string): Promise<void>;
  /** Stop one running background task (Agent tool sub-task) without
   *  interrupting the session's current turn. */
  stopBackgroundTask(sessionId: string, taskId: string): Promise<void>;
  destroySession(id: string, deleteBranch?: boolean): Promise<void>;
  renameSession(sessionId: string, displayName: string): Promise<void>;
  /** Refresh a conversation's automatic name (provider title, else a name
   *  from the first prompt). Resolves to the new name, or null when it is
   *  unchanged or was set by the user. */
  autoNameSession(sessionId: string): Promise<string | null>;
  /** Rename a conversation's placeholder branch (see tempBranchName) to one
   *  generated from its task. Returns the new name, or null when nothing
   *  changed (already named, pushed, no prompt yet, or generation failed). */
  autoNameBranch(sessionId: string): Promise<string | null>;
  /** Persist the completed flag (see WorktreeInfo.completedAt). */
  setSessionCompleted(sessionId: string, completed: boolean): Promise<void>;
  listSessions(): Promise<SessionInfo[]>;

  // Worktree operations
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>;
  listRepos(): Promise<string[]>;

  // Branch operations
  /** Local and remote branch names (remote prefix stripped). Fetches first
   *  unless `fetch` is false. */
  listBranches(repoPath: string, opts?: { fetch?: boolean }): Promise<string[]>;
  /** The repo's default branch (origin/HEAD, falling back to main/master). */
  getDefaultBranch(repoPath: string): Promise<string>;
  renameBranch(sessionId: string, newBranchName: string): Promise<{ branch: string }>;
  /** Check out another branch in the conversation's checkout, or with
   *  `create` a new one at HEAD. `busySessionIds` are conversations mid-turn;
   *  the switch is refused if any of them shares the checkout. */
  switchBranch(sessionId: string, branch: string, opts: { create: boolean; busySessionIds: string[] }): Promise<BranchSwitchResult>;
  /** Record the branch the conversation's checkout is on now, if it moved
   *  outside the app. Null when nothing changed. */
  syncBranch(sessionId: string): Promise<BranchSyncResult | null>;

  // Agent I/O (replaces terminal I/O)
  sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): void;
  respondToPermission(sessionId: string, decision: PermissionDecision): Promise<boolean>;
  /** Answer an MCP elicitation. False when it already resolved or timed out. */
  respondToElicitation(sessionId: string, requestId: string, response: McpElicitationResponse): Promise<boolean>;
  onAgentEvent(sessionId: string, callback: (event: AgentEvent) => void): () => void;
  offAgentEvent(sessionId: string): void;
  getEventHistory(sessionId: string): Promise<AgentEvent[]>;
  /** Load the last `limit` events, optionally ending before `beforeIndex`. */
  getEventHistoryPage(sessionId: string, limit: number, beforeIndex?: number): Promise<{ events: AgentEvent[]; totalCount: number; startIndex: number }>;
  /** Get the total number of persisted events for a session. */
  getEventHistoryCount(sessionId: string): Promise<number>;
  /** Search the full event history (main-process), newest match first. */
  searchEventHistory(sessionId: string, query: string, limit?: number): Promise<EventSearchHit[]>;
  /** Search every given session's full history (main-process), in the given
   *  order. Hits are capped per session and tagged with their sessionId, newest
   *  match first per session; the search stops once `maxHits` are found. */
  searchAllEventHistory(sessionIds: string[], query: string, limitPerSession?: number, maxHits?: number): Promise<CrossSessionSearchHit[]>;
  /** First-prompt / last-message previews for the given sessions (main-process). */
  getSessionPreviews(sessionIds: string[]): Promise<Record<string, SessionPreview>>;
  clearEventHistory(sessionId: string): Promise<void>;
  /** Resolve a message's stable SDK uuid to its absolute event index (or null). */
  findEventIndexByUuid(sessionId: string, uuid: string): Promise<number | null>;

  // Bookmarks
  listBookmarks(): Promise<Bookmark[]>;
  addBookmark(bookmark: Omit<Bookmark, 'id' | 'createdAt'>): Promise<Bookmark>;
  removeBookmark(id: string): Promise<void>;
  updateBookmark(id: string, patch: Partial<Pick<Bookmark, 'note' | 'eventIndex'>>): Promise<void>;

  // Prerequisites
  /** Full check of git + agent CLI (spawns processes; excludes gh). */
  checkPrerequisites(): Promise<PrerequisiteStatus>;
  /** Last check result, from this or a previous launch, or null. Instant. */
  getCachedPrerequisites(): Promise<PrerequisiteStatus | null>;
  /** GitHub CLI availability/auth — may hit the network, never gates the app. */
  checkGhPrerequisite(): Promise<NonNullable<PrerequisiteStatus['gh']>>;
  /** Encrypt and save an API key for one agent. Rejects with a user-facing
   *  message when the key is malformed or can't be stored. Resolves with the
   *  updated status. */
  setApiKey(adapterId: string, key: string): Promise<PrerequisiteStatus>;
  /** Remove an agent's saved API key. Resolves with the updated status. */
  clearApiKey(adapterId: string): Promise<PrerequisiteStatus>;
  /** Tell main that startup session restore has finished. */
  notifyRestoreComplete(): void;

  // Session status updates (from main → renderer)
  onSessionStatus(callback: (sessionId: string, status: SessionStatus) => void): () => void;

  // Mode control
  setMode(sessionId: string, mode: PermissionMode): Promise<void>;

  // Model control
  setModel(sessionId: string, model?: string): Promise<void>;

  // Session controls (adapter-declared: thinking, speed, ...)
  /** Descriptors for the session's current model plus recorded values. Falls
   *  back to the default adapter's descriptors for an unknown session. */
  getControls(sessionId: string): Promise<SessionControls>;
  /** Set a non-permission control; rejects unknown ids/values. */
  setControl(sessionId: string, controlId: string, value: string): Promise<void>;
  /** Plan usage windows for the session's provider, or null when the session
   *  has no live query or the adapter cannot report usage. */
  getUsage(sessionId: string): Promise<ProviderUsage | null>;

  // MCP server control
  listMcpServers(sessionId: string): Promise<McpServerInfo[]>;
  /** Context-window cost of each MCP server's tools. Empty when the
   *  conversation has no live query or the agent can't report it. */
  getMcpContextCost(sessionId: string): Promise<McpServerContextCost[]>;
  /** Skills visible to a session (project + user `.claude/skills` scan).
   *  Resolves the session's worktree when it is running; `fallbackPath`
   *  (typically the repo path) covers stopped sessions. */
  listSkills(sessionId: string, fallbackPath: string): Promise<SkillInfo[]>;
  /** Author a new skill for the session's agent provider. Project scope
   *  writes into the session's worktree; user scope applies to all repos. */
  addSkill(sessionId: string, fallbackPath: string, def: SkillDefinition): Promise<SkillInfo>;
  /** Cached skill suggestions for a repo (last analysis result). */
  getSkillSuggestions(repoPath: string): Promise<SkillSuggestion[]>;
  /** Mine the repo's session history for patterns and refresh suggestions. */
  analyzeSkillSuggestions(repoPath: string): Promise<SkillSuggestion[]>;
  /** Permanently dismiss one suggestion for a repo. */
  dismissSkillSuggestion(repoPath: string, suggestionId: string): Promise<void>;
  reconnectMcpServer(sessionId: string, serverName: string): Promise<void>;
  setMcpServerEnabled(sessionId: string, serverName: string, enabled: boolean): Promise<void>;
  /** Start OAuth sign-in for a `needs-auth` server and open the auth URL in the browser. */
  authenticateMcpServer(sessionId: string, serverName: string): Promise<McpAuthStartResult>;

  // File operations (for @ file picker)
  listFiles(sessionId: string): Promise<string[]>;
  readFile(sessionId: string, filePath: string): Promise<string>;
  openInEditor(sessionId: string, filePath: string, line?: number): Promise<void>;

  // File revert (for changes review)
  revertFile(sessionId: string, filePath: string, staged?: boolean): Promise<void>;
  getFileDiff(sessionId: string, filePath: string, staged?: boolean, opts?: FileDiffOptions): Promise<FileDiffResult>;
  getFileLines(sessionId: string, filePath: string, staged?: boolean): Promise<FileLinesResult>;
  getImageDiffContent(sessionId: string, filePath: string): Promise<ImageDiffContent>;
  stageFile(sessionId: string, filePath: string): Promise<void>;
  unstageFile(sessionId: string, filePath: string): Promise<void>;
  commit(sessionId: string, message: string): Promise<void>;
  /** Ask the agent to write a commit message for the staged changes. */
  generateCommitMessage(sessionId: string): Promise<string>;
  push(sessionId: string): Promise<void>;
  getGitSyncStatus(sessionId: string): Promise<GitSyncStatus>;
  getBranchCommits(sessionId: string, base: string): Promise<BranchCommit[]>;
  /** Commits on `ref` (a branch name or commit) that aren't on `base`, newest first, with ids. */
  gitLogCommits(sessionId: string, ref: string, base: string): Promise<CommitEntry[]>;
  /** Rebase the session branch onto another branch. Conflicts are aborted and reported. */
  gitRebase(sessionId: string, onto: string): Promise<GitOpResult>;
  /** Apply one commit onto the session branch. Conflicts are aborted and reported. */
  gitCherryPick(sessionId: string, sha: string): Promise<GitOpResult>;
  /** Squash every commit since the merge base with `base` into one. */
  gitSquash(sessionId: string, base: string, message: string): Promise<GitOpResult>;
  /** What merging the conversation's branch into `target` would do, or why it can't. */
  gitMergePlan(sessionId: string, target: string): Promise<MergeIntoPlan>;
  /** Merge the conversation's branch into `target` in the project folder (or
   *  fast-forward it when nothing has it checked out). Conflicts are aborted and reported. */
  gitMergeInto(sessionId: string, target: string): Promise<GitOpResult>;

  // Checkpoint rewind
  rewindSession(sessionId: string, userMessageId: string, options?: RewindOptions): Promise<void>;
  getCheckpointDiff(sessionId: string, userMessageId: string): Promise<string>;
  listCheckpoints(sessionId: string): Promise<CheckpointListItem[]>;

  // Diff history tracking
  getDiffHistory(sessionId: string): Promise<DiffHistoryResult>;
  getTurnDiff(sessionId: string, userMessageId: string): Promise<string>;
  getFullThreadDiff(sessionId: string): Promise<string>;
  getCheckpointFiles(sessionId: string, uuid: string, scope: CheckpointDiffScope): Promise<GitStatusResult>;
  getCheckpointFileDiff(sessionId: string, uuid: string, scope: CheckpointDiffScope, filePath: string): Promise<FileDiffResult>;
  getCheckpointFileLines(sessionId: string, uuid: string, scope: CheckpointDiffScope, filePath: string): Promise<FileLinesResult>;

  // Git status
  getGitStatus(sessionId: string, opts?: GitStatusOptions): Promise<GitStatusResult>;

  // PR info
  /** Every PR tied to the session — its branch plus branches checked out in
   *  it since it started — ordered primary first (open before closed/merged,
   *  newest first within each). Empty when none exist. */
  getPrs(sessionId: string): Promise<PrInfo[]>;
  /** Open PRs in a project, newest first. Throws when gh can't list them. */
  listOpenPrs(repoPath: string): Promise<OpenPrSummary[]>;
  createPr(sessionId: string, opts: PrCreateOpts): Promise<PrInfo>;
  getPrReviewComments(sessionId: string, prNumber: number): Promise<PrReviewComment[]>;

  // External links
  openExternal(url: string): Promise<void>;

  // Preview tab
  /** Load a URL in one of the conversation's Preview pages. Rejects with a
   *  readable reason when the URL isn't allowed there. */
  previewNavigate(sessionId: string, page: PreviewPageKind, url: string): Promise<void>;
  previewCommand(sessionId: string, page: PreviewPageKind, command: PreviewCommand): Promise<void>;
  /** Show your page at these bounds, or hide it (null). */
  previewSetViewport(sessionId: string, bounds: PreviewBounds | null): void;
  /** A picture of your page (JPEG data URL), shown while an overlay covers it. */
  previewSnapshot(sessionId: string): Promise<string | null>;
  /** Claude's page as a JPEG data URL, or null when it hasn't changed since
   *  `sinceVersion` (or doesn't exist). */
  previewAgentFrame(sessionId: string, sinceVersion: number): Promise<{ version: number; dataUrl: string } | null>;
  /** Every conversation's open pages, for the renderer to catch up after a reload. */
  previewGetStates(): Promise<Record<string, { user: PreviewPageState | null; agent: PreviewPageState | null }>>;
  /** A page's state changed; null means the page was closed. */
  onPreviewState(callback: (sessionId: string, page: PreviewPageKind, state: PreviewPageState | null) => void): () => void;
  onPreviewKey(callback: (sessionId: string, key: PreviewKeyForward) => void): () => void;

  // MCP server configuration (agent CLI config, not per-session). `adapterType`
  // picks the agent; the default agent when omitted.
  mcpConfigList(cwd?: string, adapterType?: string): Promise<McpConfiguredServer[]>;
  mcpConfigAdd(opts: McpAddServerOpts, adapterType?: string): Promise<void>;
  mcpConfigRemove(name: string, scope?: McpConfigScope, cwd?: string, adapterType?: string): Promise<void>;
  /** Approve a project server that must be approved before it connects, for
   *  the project at `repoPath` and its conversations' worktrees. */
  mcpConfigApprove(name: string, repoPath: string, adapterType?: string): Promise<void>;

  // Plugins
  pluginList(): Promise<PluginListResult>;
  pluginInstall(pluginId: string, scope?: string): Promise<void>;
  pluginUninstall(pluginId: string): Promise<void>;
  pluginEnable(pluginId: string): Promise<void>;
  pluginDisable(pluginId: string): Promise<void>;

  // Folder
  openSessionFolder(sessionId: string): Promise<void>;

  // Memory
  memoryList(repoPath: string): Promise<MemoryEntry[]>;
  memoryRead(repoPath: string, relativePath: string): Promise<string | null>;
  memoryWrite(repoPath: string, relativePath: string, content: string): Promise<void>;
  memoryDelete(repoPath: string, relativePath: string): Promise<boolean>;
  memoryCompact(repoPath: string): Promise<MemoryCompactionStatus>;
  memoryCompactCancel(repoPath: string): Promise<boolean>;
  onMemoryCompactEvent(callback: (event: MemoryCompactionEvent) => void): () => void;
  memoryListBackups(repoPath: string): Promise<MemoryBackupInfo[]>;
  memoryRestoreBackup(repoPath: string, backupId: string): Promise<MemoryRestoreStatus>;
  memoryStats(repoPath: string): Promise<MemoryStatsResult>;
  memoryBackupPreview(repoPath: string, backupId: string): Promise<MemoryBackupFile[]>;
  memoryReadBackupFile(repoPath: string, backupId: string, relativePath: string): Promise<string | null>;

  // Shell / Terminal (legacy)
  shellRun(sessionId: string, command: string): Promise<string>;
  shellKill(execId: string): Promise<void>;
  shellInput(execId: string, data: string): void;
  onShellOutput(sessionId: string, callback: (event: ShellOutputEvent) => void): () => void;

  // PTY Terminal (per-session persistent shell)
  ptySpawn(sessionId: string): Promise<boolean>;
  ptyWrite(sessionId: string, data: string): void;
  ptyResize(sessionId: string, cols: number, rows: number): void;
  ptyKill(sessionId: string): Promise<void>;
  ptyIsAlive(sessionId: string): Promise<boolean>;
  onPtyData(sessionId: string, callback: (data: string) => void): () => void;
  onPtyExit(sessionId: string, callback: (exitCode: number, signal?: number) => void): () => void;

  // Settings
  getSettings(): Promise<GroveBenchSettings>;
  saveSettings(settings: GroveBenchSettings): Promise<void>;

  // App state persistence
  getOpenTabs(): Promise<string[]>;
  setOpenTabs(ids: string[]): void;
  getCollapsedRepos(): Promise<Record<string, boolean>>;
  setCollapsedRepos(map: Record<string, boolean>): void;
  getSessionSort(): Promise<SessionSortState>;
  setSessionSort(sort: SessionSortState): void;
  getSidebarWidth(): Promise<number | null>;
  setSidebarWidth(width: number): void;
  /** Sessions flagged unread (finished a turn / got a PR alert while not
   *  focused) when the app last ran, so the flag survives a restart. */
  getUnreadSessions(): Promise<string[]>;
  setUnreadSessions(ids: string[]): void;

  // App lifecycle
  onAppClosing(callback: () => void): () => void;
  onPowerResume(callback: (resumeIds: string[]) => void): () => void;
  /** An agent's model list changed (it reported its current models). */
  onModelsChanged(callback: (adapterId: string) => void): () => void;

  // Error reporting
  /** Uncaught main-process errors, forwarded so the UI can surface them. */
  onAppError(callback: (report: AppErrorReport) => void): () => void;
  /** Send an uncaught renderer error to main for the file log. */
  reportError(report: AppErrorReport): void;

  // Taskbar attention badge
  /** Overlay `count` on the taskbar icon (Windows overlay icon, macOS dock
   *  badge, Linux badge count). `dataUrl` is a renderer-drawn PNG used for the
   *  Windows overlay; 0 clears the badge. */
  setAttentionBadge(count: number, dataUrl: string | null): void;

  // OS notifications
  notify(req: OsNotificationRequest): void;
  /** Fired when the user clicks an OS notification — jump to that session. */
  onFocusSession(callback: (sessionId: string) => void): () => void;

  // Window controls
  winMinimize(): void;
  winMaximize(): void;
  winClose(): void;
  winIsMaximized(): Promise<boolean>;

  // Spell check
  /** Fired when the user right-clicks a misspelled word. */
  onSpellcheckMenu(callback: (req: SpellcheckMenuRequest) => void): () => void;
  /** Replace the misspelled word with one of the offered suggestions. */
  spellcheckReplace(suggestion: string): void;
  /** Add the misspelled word to the user's dictionary. */
  spellcheckAddWord(): void;

  // Agent adapters
  /** Registered agents, in registration order. `isDefault` marks the one new
   *  conversations use unless another is picked. */
  listAdapters(): Promise<AgentSummary[]>;
  /** Control descriptors an adapter declares for `model` (null = its default
   *  model), without needing a session. Used by Settings for per-adapter
   *  defaults. Unknown adapter = []. */
  getAdapterControls(adapterType?: string, model?: string | null): Promise<ControlDescriptor[]>;
  getModels(adapterType?: string): Promise<Array<{ id: string; label: string; family?: string; contextWindow?: number }>>;

  // Auto-update
  checkForUpdate(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
}

// ─── Caveman ───

export type CavemanMode = 'off' | 'lite' | 'full' | 'ultra';

// ─── Settings ───

/**
 * A tool allow/deny rule: `<tool>` or `<tool>(<glob>)`.
 *
 * `<tool>` is preferably one of the adapter-neutral keywords below (so the
 * same rule works for every agent), or a provider tool name for anything the
 * keywords don't cover (Claude: `Bash`, `NotebookEdit`, `mcp__github__*`).
 * The glob matches the call's specifier — the command for `shell`, the file
 * path for `edit`/`read`, the URL for `web`, the prompt for `agent`, and the
 * server/tool name after `mcp__` for `mcp`. `*` matches anything.
 *
 *   shell(npm run *)   edit(src/**)   read(**\/.env*)   web(*github.com*)
 *   mcp(github__*)     question       Bash(git push *)
 */
export interface ToolRule {
  pattern: string;
}

/** Neutral rule keywords → the tool category they stand for. `mcp` is
 *  special-cased by the matcher (provider tools prefixed `mcp__`). */
export const TOOL_RULE_KEYWORDS: Record<string, ToolCategory> = {
  shell: 'bash',
  bash: 'bash',
  edit: 'edit',
  write: 'edit',
  read: 'read',
  web: 'web_fetch',
  fetch: 'web_fetch',
  agent: 'agent',
  question: 'question',
};

export interface GroveBenchSettings {
  // Permission & Security
  toolAllowRules: ToolRule[];
  toolDenyRules: ToolRule[];
  /** Skill names hidden from agent sessions. Applied when a session's query
   *  (re)starts — the SDK receives an allowlist of every known skill minus
   *  these. Empty = all skills enabled (the CLI default). */
  disabledSkills: string[];
  /** Auto-analyze finished sessions for recurring workflows and surface skill
   *  suggestions in the status bar. Off by default — each analysis is a model
   *  call, so the status bar's manual "Suggest" button is the main route. */
  autoSkillSuggestions: boolean;

  // Agent Defaults
  /** Model new conversations start on, keyed by adapter id. Missing or empty
   *  means the adapter's first model. */
  defaultModels: Record<string, string>;
  /** Default values for each adapter's declared session controls (permission
   *  mode, thinking, speed, ...), keyed by adapter id then control id. Only
   *  ids the adapter actually offers for the session's model are applied;
   *  anything else is ignored, so a stale entry never breaks a session. */
  adapterDefaults: Record<string, Record<string, string>>;
  /** Caveman mode — terse output to reduce token usage. Default 'off'. */
  cavemanMode: CavemanMode;
  workingDirectories: string[];
  defaultSystemPromptAppend: string;

  // Memory
  /** Enable auto-save of memories at end of session / compaction. Default true. */
  memoryAutoSave: boolean;
  /** Enable automatic memory compaction (dedupe, contradiction resolution,
   *  session-note pruning) when memory grows past its budget. Default false —
   *  it costs an LLM call; the panel's manual Compact button always works. */
  memoryAutoCompact: boolean;
  /** Abort a memory compaction pass after this many seconds. Clamped to a
   *  30-second minimum. Default 300 (5 minutes). */
  memoryCompactTimeoutSeconds: number;
  /** Model for background tasks (memory notes and compaction, commit
   *  messages, skill suggestions), keyed by adapter id. Missing or empty
   *  means the adapter's own cheap default (Haiku for Claude). */
  backgroundModels: Record<string, string>;

  // Worktree
  /** Automatically run npm install in new worktrees. Default false. */
  autoInstallDeps: boolean;

  // Preview
  /** Give the agent browser tools that drive its own page in the Preview tab
   *  (local URLs only). Applies when a conversation's agent next starts.
   *  Default true. */
  previewAgentTools: boolean;

  // Sessions
  /** Put a conversation to sleep after this many minutes idle (not focused,
   *  not running a turn or background task, no pending permission) to free
   *  its agent process. It stays open and wakes when opened. 0 disables.
   *  Default 30. */
  idleSleepMinutes: number;

  // General
  /** Base branch for new worktrees and PRs. Empty = auto-detect the
   *  repository's default branch (origin/HEAD, falling back to main/master). */
  defaultBaseBranch: string;
  /** How to name branches that are named automatically, in the user's own
   *  words (e.g. "<type>/<ticket>-<short-description>"). Empty = copy the
   *  pattern of the repo's recent branch names. */
  branchNamingRule: string;
  theme: 'system' | 'dark' | 'light';
  alwaysOnTop: boolean;

  // Appearance
  /** Custom accent color per repository path. Keys are repo paths, values are hex colors. */
  repoColors: Record<string, string>;
  /** Show small pixel characters for conversation status: in the sidebar in
   *  place of the status dot, in permission and question prompts, in the
   *  empty states, and walking through the grove while a stopped conversation
   *  starts up again.
   *  Each status gets its own pose as well as its colour. Default true. */
  groveCharacters: boolean;

  // Editor
  /** Default diff view mode in the Changes tab. */
  diffViewMode: 'unified' | 'side-by-side';
  /** Activity view a session starts in. Each session can still switch from
   *  the status bar; that choice is per session and not persisted. Default 'summary'. */
  defaultActivityView: ActivityViewMode;
  /** Enable spell checking in the prompt textarea. */
  spellcheck: boolean;

  // Notifications (OS-level; shown only while the window is unfocused)
  /** Notify when an agent finishes a turn. Default true. */
  notifyOnTurnComplete: boolean;
  /** Notify when an agent is blocked waiting on a permission decision. Default true. */
  notifyOnPermission: boolean;
  /** Notify on PR-watch alerts (new CI failure, review comments, needs-human). Default true. */
  notifyOnPrAlert: boolean;
  /** Flash the taskbar button alongside a notification. Default true. */
  notifyTaskbarFlash: boolean;
  /** Overlay a badge on the taskbar icon with the number of sessions that
   *  need attention (blocked on input, or finished while unfocused). Default true. */
  notifyTaskbarBadge: boolean;

  // Privacy
  /** Enable anonymous usage analytics (PostHog). Off by default. */
  analyticsEnabled: boolean;
  /** Whether the user has been shown the analytics consent prompt. */
  analyticsPrompted: boolean;
  /** Send uncaught exceptions (message + stack, no code or paths beyond the
   *  stack itself) to the analytics backend. Only effective while
   *  analyticsEnabled is on. Off by default. */
  crashReportsEnabled: boolean;
}

/**
 * Activity panel view modes:
 * - 'detailed': everything (tool calls, thinking, system, ...)
 * - 'summary':  hides thinking and non-essential tool calls
 * - 'focus':    only user prompts, assistant text, question blocks (with
 *               the answer given), unanswered permission blocks, errors
 *               and turn results
 */
export type ActivityViewMode = 'detailed' | 'summary' | 'focus';
export const ACTIVITY_VIEW_MODES: readonly ActivityViewMode[] = ['detailed', 'summary', 'focus'];

// ─── Error reporting ───

/** An uncaught error captured in either process. Main-process errors are
 *  forwarded to the renderer for display; renderer errors are forwarded to
 *  main for the file log. */
export interface AppErrorReport {
  source: 'main' | 'renderer';
  /** What surfaced it: 'uncaughtException', 'unhandledRejection', 'error',
   *  'boundary', ... */
  kind: string;
  message: string;
  stack?: string;
  /** Session whose view raised it, when known (renderer error boundaries). */
  sessionId?: string;
  timestamp: number;
}

// ─── Memory ───

export interface MemoryEntry {
  relativePath: string;  // e.g. "repo/overview.md"
  title: string;         // from frontmatter
  updatedAt: string;     // ISO date from frontmatter
  folder: string;        // e.g. "repo", "conventions", "sessions"
}

export interface MemoryCompactionStatus {
  compacted: boolean;
  skippedReason?: string;   // why compaction was skipped, when it was
  error?: string;           // the pass was attempted but failed — not a no-op
  filesChanged: string[];   // paths written, rewritten, or deleted
  /** Per-file summary of what the pass did (action, path, model's reason). */
  changes?: Array<{ action: 'update' | 'delete'; path: string; reason: string }>;
  /** Snapshot taken before applying — restore it to undo the compaction. */
  backupId?: string;
}

export type MemoryCompactionStage = 'pruning' | 'generating' | 'validating' | 'applying';

/** Pushed from main over MEMORY_COMPACT_EVENT while a compaction pass runs. */
export type MemoryCompactionEvent =
  | { kind: 'stage'; repoPath: string; auto: boolean; stage: MemoryCompactionStage }
  | { kind: 'done'; repoPath: string; auto: boolean; status: MemoryCompactionStatus };

export interface MemoryStatsResult {
  totalBytes: number;        // non-session memory bytes (frontmatter stripped)
  budgetBytes: number;       // system-prompt budget
  fileCount: number;         // non-session files
  sessionNoteCount: number;
  skippedFiles: string[];    // files that no longer fit in the prompt budget
  lastCompactedAt: string | null;
  lastAuto?: boolean;        // last pass was automatic (vs the panel button)
  lastFilesChanged?: number;
}

export interface MemoryBackupFile {
  path: string;
  bytes: number;
}

export interface MemoryBackupInfo {
  id: string;               // snapshot folder name, sortable
  createdAt: string;        // ISO timestamp
  fileCount: number;
}

export interface MemoryRestoreStatus {
  restored: boolean;
  error?: string;
  filesChanged: string[];   // paths written or deleted by the restore
}

// ─── Bookmarks ───

export interface Bookmark {
  id: string;                 // randomUUID, assigned in main on add
  sessionId: string;          // per-run session id: fast same-run jump + grouping
  repoPath: string;           // durable grouping/label key
  sessionLabel: string;       // snapshot of displayName/branch for headings
  messageUuid: string | null; // primary durable anchor (SDK event uuid); null if unavailable
  eventIndex: number | null;  // cached fast-jump hint; may go stale -> re-resolve via uuid
  selectedText: string;       // the bookmarked snippet (preview + ultimate fallback)
  note?: string;              // optional user note
  createdAt: number;
}

// ─── Auto-Update ───

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseName?: string;
  releaseDate?: string;
}

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; info: UpdateInfo }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; info: UpdateInfo }
  | { state: 'error'; message: string };

// ─── IPC Channel Names ───

/** Session permission modes.
 *
 *  'readSafe' is Grove Bench's own mode (not an SDK mode): edits are
 *  auto-accepted like acceptEdits, and read-only tool calls scoped to the
 *  worktree (git status/log/diff, ls, grep, …) run without prompting —
 *  mutating, out-of-worktree, network-fetching, or unrecognized calls prompt.
 *  Adapters map it to their closest native mode.
 *
 *  'auto' is the provider's native auto mode (Claude Code's model classifier
 *  approves or blocks each action instead of prompting). It is passed
 *  through to the adapter untouched. */
export const PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'readSafe', 'auto'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const IPC = {
  FILE_OPEN_IN_EDITOR: 'file:openInEditor',
  REPO_SELECT: 'repo:select',
  REPO_REMOVE: 'repo:remove',
  REPO_VALIDATE: 'repo:validate',
  SESSION_CREATE: 'session:create',
  SESSION_RESUME: 'session:resume',
  SESSION_STOP: 'session:stop',
  SESSION_CLOSE: 'session:close',
  SESSION_SLEEP: 'session:sleep',
  SESSION_WAKE: 'session:wake',
  SESSION_STOP_TASK: 'session:stopTask',
  SESSION_DESTROY: 'session:destroy',
  SESSION_RENAME: 'session:rename',
  SESSION_AUTO_NAME: 'session:autoName',
  SESSION_SET_COMPLETED: 'session:setCompleted',
  SESSION_LIST: 'session:list',
  WORKTREE_LIST: 'worktree:list',
  WORKTREE_LIST_REPOS: 'worktree:listRepos',
  BRANCH_LIST: 'branch:list',
  BRANCH_DEFAULT: 'branch:default',
  BRANCH_RENAME: 'branch:rename',
  BRANCH_SWITCH: 'branch:switch',
  BRANCH_SYNC: 'branch:sync',
  BRANCH_AUTO_NAME: 'branch:autoName',
  PREREQUISITES_CHECK: 'prerequisites:check',
  PREREQUISITES_CACHED: 'prerequisites:cached',
  PREREQUISITES_GH: 'prerequisites:gh',
  CREDENTIALS_SET_API_KEY: 'credentials:setApiKey',
  CREDENTIALS_CLEAR_API_KEY: 'credentials:clearApiKey',
  /** Renderer → main: session restore finished; deferred background work may start. */
  APP_RESTORE_COMPLETE: 'app:restoreComplete',
  AGENT_EVENT: 'agent:event',          // agent:event:{sessionId}
  AGENT_SEND: 'agent:send',
  AGENT_PERMISSION: 'agent:permission',
  AGENT_HISTORY: 'agent:history',
  AGENT_HISTORY_PAGE: 'agent:history-page',
  AGENT_HISTORY_COUNT: 'agent:history-count',
  AGENT_HISTORY_SEARCH: 'agent:history-search',
  AGENT_HISTORY_SEARCH_ALL: 'agent:history-search-all',
  SESSION_PREVIEWS: 'session:previews',
  AGENT_CLEAR_HISTORY: 'agent:clear-history',
  SESSION_STATUS: 'session:status',
  APP_CLOSING: 'app:closing',
  POWER_RESUME: 'power:resume',
  NOTIFY_SHOW: 'notify:show',
  NOTIFY_FOCUS_SESSION: 'notify:focusSession',
  FILE_LIST: 'file:list',
  FILE_READ: 'file:read',
  AGENT_SET_MODE: 'agent:setMode',
  OPEN_EXTERNAL: 'shell:openExternal',
  FILE_REVERT: 'file:revert',
  FILE_DIFF: 'file:diff',
  FILE_LINES: 'file:lines',
  FILE_CONTENT_DATA_URL: 'file:contentDataUrl',
  FILE_STAGE: 'file:stage',
  FILE_UNSTAGE: 'file:unstage',
  GIT_STATUS: 'git:status',
  GIT_COMMIT: 'git:commit',
  GIT_PUSH: 'git:push',
  GIT_SYNC_STATUS: 'git:syncStatus',
  GIT_BRANCH_COMMITS: 'git:branchCommits',
  GIT_LOG_COMMITS: 'git:logCommits',
  GIT_REBASE: 'git:rebase',
  GIT_CHERRY_PICK: 'git:cherryPick',
  GIT_SQUASH: 'git:squash',
  GIT_MERGE_PLAN: 'git:mergePlan',
  GIT_MERGE_INTO: 'git:mergeInto',
  GIT_GENERATE_COMMIT_MESSAGE: 'git:generateCommitMessage',
  PR_LIST: 'pr:list',
  PR_LIST_OPEN: 'pr:listOpen',
  PR_CREATE: 'pr:create',
  PR_REVIEW_COMMENTS: 'pr:reviewComments',
  AGENT_SET_MODEL: 'agent:setModel',
  AGENT_SET_CONTROL: 'agent:setControl',
  AGENT_GET_CONTROLS: 'agent:getControls',
  AGENT_GET_USAGE: 'agent:getUsage',
  AGENT_MCP_LIST: 'agent:mcpList',
  SKILLS_LIST: 'skills:list',
  SKILLS_ADD: 'skills:add',
  SKILLS_SUGGESTIONS_GET: 'skills:suggestionsGet',
  SKILLS_SUGGESTIONS_ANALYZE: 'skills:suggestionsAnalyze',
  SKILLS_SUGGESTION_DISMISS: 'skills:suggestionDismiss',
  AGENT_MCP_RECONNECT: 'agent:mcpReconnect',
  AGENT_MCP_TOGGLE: 'agent:mcpToggle',
  AGENT_MCP_AUTHENTICATE: 'agent:mcpAuthenticate',
  AGENT_MCP_CONTEXT_COST: 'agent:mcpContextCost',
  AGENT_ELICITATION: 'agent:elicitation',
  MCP_CONFIG_LIST: 'mcpConfig:list',
  MCP_CONFIG_ADD: 'mcpConfig:add',
  MCP_CONFIG_REMOVE: 'mcpConfig:remove',
  MCP_CONFIG_APPROVE: 'mcpConfig:approve',
  PLUGIN_LIST: 'plugin:list',
  PLUGIN_INSTALL: 'plugin:install',
  PLUGIN_UNINSTALL: 'plugin:uninstall',
  PLUGIN_ENABLE: 'plugin:enable',
  PLUGIN_DISABLE: 'plugin:disable',
  WIN_MINIMIZE: 'win:minimize',
  WIN_MAXIMIZE: 'win:maximize',
  WIN_CLOSE: 'win:close',
  WIN_IS_MAXIMIZED: 'win:isMaximized',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  APP_STATE_GET_OPEN_TABS: 'appState:getOpenTabs',
  APP_STATE_SET_OPEN_TABS: 'appState:setOpenTabs',
  APP_STATE_GET_COLLAPSED_REPOS: 'appState:getCollapsedRepos',
  APP_STATE_SET_COLLAPSED_REPOS: 'appState:setCollapsedRepos',
  APP_STATE_GET_SESSION_SORT: 'appState:getSessionSort',
  APP_STATE_SET_SESSION_SORT: 'appState:setSessionSort',
  APP_STATE_GET_SIDEBAR_WIDTH: 'appState:getSidebarWidth',
  APP_STATE_SET_SIDEBAR_WIDTH: 'appState:setSidebarWidth',
  APP_STATE_GET_UNREAD: 'appState:getUnreadSessions',
  APP_STATE_SET_UNREAD: 'appState:setUnreadSessions',
  /** Main → renderer: an uncaught main-process error. */
  APP_ERROR: 'app:error',
  /** Renderer → main: an uncaught renderer error, for the file log. */
  APP_REPORT_ERROR: 'app:reportError',
  WIN_SET_ATTENTION_BADGE: 'win:setAttentionBadge',
  /** Main → renderer: show the spell check menu for a misspelled word. */
  SPELLCHECK_MENU: 'spellcheck:menu',
  /** Renderer → main: replace the misspelled word with a suggestion. */
  SPELLCHECK_REPLACE: 'spellcheck:replace',
  /** Renderer → main: add the misspelled word to the dictionary. */
  SPELLCHECK_ADD_WORD: 'spellcheck:addWord',
  OPEN_SESSION_FOLDER: 'session:openFolder',
  BOOKMARKS_LIST: 'bookmarks:list',
  BOOKMARK_ADD: 'bookmarks:add',
  BOOKMARK_REMOVE: 'bookmarks:remove',
  BOOKMARK_UPDATE: 'bookmarks:update',
  FIND_EVENT_INDEX_BY_UUID: 'agent:findEventIndexByUuid',
  MEMORY_LIST: 'memory:list',
  MEMORY_READ: 'memory:read',
  MEMORY_WRITE: 'memory:write',
  MEMORY_DELETE: 'memory:delete',
  MEMORY_COMPACT: 'memory:compact',
  MEMORY_COMPACT_CANCEL: 'memory:compactCancel',
  MEMORY_COMPACT_EVENT: 'memory:compactEvent',
  MEMORY_LIST_BACKUPS: 'memory:listBackups',
  MEMORY_RESTORE_BACKUP: 'memory:restoreBackup',
  MEMORY_STATS: 'memory:stats',
  MEMORY_BACKUP_PREVIEW: 'memory:backupPreview',
  MEMORY_BACKUP_READ_FILE: 'memory:backupReadFile',
  SHELL_RUN: 'shell:run',
  SHELL_KILL: 'shell:kill',
  SHELL_INPUT: 'shell:input',
  SHELL_OUTPUT: 'shell:output',
  // PTY channels (per-session persistent terminal)
  PTY_SPAWN: 'pty:spawn',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_KILL: 'pty:kill',
  PTY_IS_ALIVE: 'pty:isAlive',
  PTY_DATA: 'pty:data',      // pty:data:{sessionId}
  PTY_EXIT: 'pty:exit',      // pty:exit:{sessionId}
  AGENT_REWIND: 'agent:rewind',
  AGENT_CHECKPOINT_DIFF: 'agent:checkpointDiff',
  AGENT_LIST_CHECKPOINTS: 'agent:listCheckpoints',
  AGENT_DIFF_HISTORY: 'agent:diffHistory',
  AGENT_TURN_DIFF: 'agent:turnDiff',
  AGENT_FULL_THREAD_DIFF: 'agent:fullThreadDiff',
  AGENT_CHECKPOINT_FILES: 'agent:checkpointFiles',
  AGENT_CHECKPOINT_FILE_DIFF: 'agent:checkpointFileDiff',
  AGENT_CHECKPOINT_FILE_LINES: 'agent:checkpointFileLines',
  AGENT_LIST_ADAPTERS: 'agent:listAdapters',
  AGENT_MODELS_CHANGED: 'agent:modelsChanged',
  AGENT_GET_ADAPTER_CONTROLS: 'agent:getAdapterControls',
  AGENT_GET_MODELS: 'agent:getModels',
  // Auto-updater
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS: 'update:status',
  // Preview tab
  PREVIEW_NAVIGATE: 'preview:navigate',
  PREVIEW_COMMAND: 'preview:command',
  PREVIEW_SET_VIEWPORT: 'preview:setViewport',
  PREVIEW_SNAPSHOT: 'preview:snapshot',
  PREVIEW_AGENT_FRAME: 'preview:agentFrame',
  PREVIEW_GET_STATES: 'preview:getStates',
  /** Main → renderer: (sessionId, page, state | null). */
  PREVIEW_STATE: 'preview:state',
  /** Main → renderer: (sessionId, PreviewKeyForward). */
  PREVIEW_KEY: 'preview:key',
} as const;
