import { app, ipcMain, BrowserWindow, dialog, shell } from 'electron';
import { isSkipped, runProcess } from './process-host.js';
import { inBackground } from './background-work.js';
import { IPC, isPermissionMode } from '../shared/types.js';
import type { BranchSwitchResult, ClaudeAccountPreview, ClaudeAccountSetting, BranchSyncResult, ConversationGoal, CreateSessionOpts, EventHistoryPage, ThreadUsage, OpenPrSummary, PrerequisiteStatus, PermissionDecision, RegistryAgentSummary, SessionInfo, SkillDefinition, SkillReach, WorktreeInfo } from '../shared/types.js';
import { sessionManager } from './agent-session.js';
import { todaySpend } from './session-limits.js';
import { searchEvents, findEventIndexByUuid, extractSessionPreview, firstUserPrompt } from './event-search.js';
import { decideAutoName } from './session-auto-name.js';
import { cleanUserGoal, generateGoal, goalInputFromEvents, type GoalInput } from './session-goal.js';
import { launchEditor } from './editor-launch.js';
import { worktreeManager } from './worktree-manager.js';
import { apiKeyState, checkCorePrerequisites, checkGh } from './prerequisites.js';
import { canStoreApiKey, clearApiKey, parseApiKey, saveApiKey } from './credentials.js';
import { adapterRegistry, registerClaudeAccount } from './adapters/index.js';
import { claudeAccounts, isClaudeAccountId, newClaudeAccount } from './adapters/claude-accounts.js';
import type { AgentAdapter } from './adapters/types.js';
import { agentForProject, recordedAgent } from './background-tasks.js';
import { validateBranchName, branchExists, branchExistsAnywhere, worktreeBranches, listBranches, getDefaultBranch, git, fileDiff, fileDiffAgainst, isTracked, patchResult, patchOverLimit, MAX_TEXT_FILE_BYTES, resolveMergeBase, blobLines, hashWorkingFiles, listProjectFiles, revertFile, gitOperation, continueGitOperation, abortGitOperation, synthesizeUntrackedDiff, detectBinaryDiff, imageExtFor, looksBinary, textLines, mimeForImageExt, stageFile, unstageFile, commit, push, syncStatus, branchCommits, logCommits, rebaseOnto, cherryPick, squashSince, currentBranch, recentCheckouts, getGitIdentity, gitVersion } from './git.js';
import { inspectProjectFolder, projectKind } from './project-path.js';
import { prsForBranches, prCreate, prReviewComments, ghLogin, isNetworkError, isRateLimitError, openPrs, GH_OFFLINE_COOLDOWN_MS, GH_OFFLINE_MESSAGE, GH_RATE_LIMITED_MESSAGE } from './gh.js';
import { tempBranchName, isTempBranch, generateBranchName } from './branch-name.js';
import { displayTextFromSent } from '../shared/prompt-text.js';
import { EMPTY_THREAD_ITEMS, threadItems } from '../shared/thread-items.js';
import { openAttachedFile, removeAttachments } from './attachments.js';
import { openWorktreeFile } from './worktree-files.js';
import { generateCommitMessage } from './commit-message.js';
import { exportFileName, threadJson, threadMarkdown, type ThreadExportInfo } from './thread-export.js';
import type { PreviewBounds, PreviewCommand, PreviewPageKind } from '../shared/types.js';
import type { CheckpointDiffScope, FileDiffResult, GitOperation, FileLinesResult, GitStatusOptions, GitStatusResult, GitStatusEntry, ImageDiffContent, OpenWorktreeFileResult, PrCreateOpts, PrReviewSubmitResult } from '../shared/types.js';
import { parsePrReviewSubmit, submitPrReview } from './pr-review.js';
import { showOsNotification, showTestNotification } from './notifications.js';
import { parseGitStatusPorcelain, parseNumstat, parseNameStatus, parseHashObjectOutput } from './git-status-parser.js';
import { logger } from './logger.js';
import { terminalManager } from './terminal.js';
import { previewManager } from './preview.js';
import { applyUpdateSettings, checkForUpdate, downloadUpdate, getUpdateState, restartToUpdate } from './auto-updater.js';
import * as settings from './settings.js';
import { catalogs, installFor, launchFor } from './catalogs.js';
import { ACP_PRESETS } from './adapters/acp/presets.js';
import * as skillSuggestions from './skill-suggestions.js';
import * as memory from './memory.js';
import * as memoryCompact from './memory-compact.js';
import * as bookmarks from './bookmarks.js';
import { deleteSchedule, listSchedules, recordScheduleRun, saveSchedule } from './skill-schedules.js';
import { linkSkills, setSkillReach, skillSharing } from './skill-sharing.js';
import { CLAUDE_SKILL_DIRS, markWorktreeOnly, readSkillFile, readsSharedSkills, saveSkillFile, type SkillDirs } from './skills.js';
import { accountLinkDirs } from './session-skills.js';
import { listProjects, rememberProject, forgetProject, loadOpenTabs, saveOpenTabs, loadCollapsedRepos, saveCollapsedRepos, loadSessionSort, saveSessionSort, loadSidebarWidth, saveSidebarWidth, loadCollapsedPanels, saveCollapsedPanels, loadConversationGroups, saveConversationGroups, saveUnreadSessionIds, loadUnreadSessionIds, saveTodoSessionIds, loadTodoSessionIds, loadPrerequisiteCache, savePrerequisiteCache, loadUsageSnapshot } from './app-state.js';
import { logRendererError } from './crash-handling.js';
import { freezeLog } from './freeze-log.js';
import { isThreadId } from './session-event-store.js';
import { perfSteps, logWindowTiming } from './perf-steps.js';
import { recordTrace, lastTracePath } from './perf-trace.js';
import { perfLogPath } from './perf-log.js';
import { detectPackageManager, installDependencies, type PackageManager } from './deps-install.js';
import { applyAttentionBadge } from './attention-badge.js';
import { replaceMisspelling, addWordToDictionary } from './spellcheck.js';
import crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

/** App-level lifecycle signals from the renderer (e.g. 'restore-complete'). */
export const appEvents = new EventEmitter();

/** Buffer for events emitted before the session object exists (worktree creation, npm install).
 *  These are sent live via IPC but not persisted — the AGENT_HISTORY handler
 *  prepends them so the renderer's history replay can show them. */
const prelaunchEvents = new Map<string, import('../shared/types.js').AgentEvent[]>();

/** Build the prelaunch-prefixed event array — the index space that all eventIndex
 *  values (search hits, bookmark anchors) refer to. Keep search and uuid lookups
 *  using this single builder so their index spaces never drift apart. */
function prelaunchPrefixedEvents(sessionId: string): import('../shared/types.js').AgentEvent[] {
  const prelaunch = prelaunchEvents.get(sessionId) ?? [];
  const history = sessionManager.getEventHistory(sessionId);
  return prelaunch.length > 0 ? [...prelaunch, ...history] : history;
}

/** Control values the renderer chose for a new conversation: string values
 *  only, and never the mode, which travels as permissionMode. */
function sanitizeControls(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' && k !== 'permissionMode') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Automatic branch renames per session this run: in flight, or how many
 *  attempts have been made. Bounded so a failing agent isn't asked again on
 *  every turn. */
const branchAutoNameInFlight = new Set<string>();
const branchAutoNameAttempts = new Map<string, number>();
/** Names generated but not applied because a turn had started; used on the
 *  next try instead of asking the agent again. */
const branchAutoNamePending = new Map<string, string>();
const MAX_BRANCH_AUTO_NAME_ATTEMPTS = 2;

/** Conversations whose goal is being generated, and how many automatic
 *  tries each has had this run. Bounded like branch names, so a failing
 *  agent isn't asked again after every turn. */
const goalInFlight = new Set<string>();
const goalAutoAttempts = new Map<string, number>();
const MAX_GOAL_AUTO_ATTEMPTS = 2;

/** Longest idle sleep loop line written to the app log (APP_LOG_IDLE). */
export const IDLE_LOG_MAX_CHARS = 500;

/** Generate a goal from a conversation's messages on its own agent and save
 *  it, unless the goal changed from `current` meanwhile. Resolves to the
 *  saved goal, or null when it wasn't saved. `substitute`: the agent the user
 *  picked for a conversation whose agent is gone (recordedAgent). */
async function generateAndSaveGoal(sessionId: string, current: ConversationGoal, input: GoalInput, substitute?: string): Promise<ConversationGoal | null> {
  const live = sessionManager.getSession(sessionId);
  const adapter = live?.adapter ?? await recordedAgent(sessionId, substitute);
  const cwd = live?.worktreePath ?? (await worktreeManager.getWorktreeOrManifest(sessionId))?.path;
  if (!cwd) throw new Error('The thread\'s folder could not be found');
  const text = await generateGoal(input, adapter, cwd);
  return worktreeManager.saveGoal(sessionId, text, 'auto', current);
}

/** Search a session in prelaunchPrefixedEvents' index space, using the cached
 *  search index for the history instead of scanning the combined array. */
function searchPrefixedHistory(sessionId: string, query: string, limit: number): import('../shared/types.js').EventSearchHit[] {
  const prelaunch = prelaunchEvents.get(sessionId) ?? [];
  const hits = sessionManager.searchEventHistory(sessionId, query, limit);
  if (prelaunch.length === 0) return hits;
  // Prelaunch events sit before the history, so they hold the oldest matches.
  const shifted = hits.map((h) => ({ ...h, eventIndex: h.eventIndex + prelaunch.length }));
  if (shifted.length >= limit) return shifted;
  return [...shifted, ...searchEvents(prelaunch, query, limit - shifted.length)];
}

/** Latest AGENT_HISTORY_SEARCH_ALL request; older ones stop at their next yield. */
let searchAllGeneration = 0;

/**
 * Resolve a user/agent-supplied file path to a worktree-relative path, stripping Docker
 * container prefixes and absolute host prefixes, and rejecting path traversal outside the worktree.
 */
function sanitizeWorktreeRelPath(worktreePath: string, filePath: string): { relPath: string; resolved: string } {
  // Strip Docker container paths (/workspace/...) and make relative
  let relPath = filePath.replace(/^\/workspace\//, '');
  const normalWt = path.normalize(worktreePath) + path.sep;
  if (path.normalize(relPath).startsWith(normalWt)) {
    relPath = path.relative(worktreePath, relPath);
  }
  const resolved = path.resolve(worktreePath, relPath);
  if (!path.normalize(resolved).startsWith(normalWt)) {
    throw new Error('Path traversal not allowed');
  }
  return { relPath, resolved };
}

/** The Changes tab's `git status`, which runs in the background. Without
 *  git's optional locks, as git-status's "Background refresh" advises: else
 *  it rewrites the index as it reads, and that lock can make a git command
 *  typed in the terminal meanwhile fail ("index.lock exists"). The diffs
 *  after it still can, once, after files change: diff ignores the setting. */
const statusGit = (cwd: string) => git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd, { optionalLocks: false });

/** Attach per-file line counts (`git diff <base> --numstat`) as a sidebar hint.
 *  Scoped to the changed paths so this doesn't walk the whole tree after every
 *  agent edit; falls back to the full diff when the path list would be
 *  unreasonably long for a command line. Best-effort (e.g. no HEAD yet). */
async function attachNumstat(cwd: string, entries: GitStatusEntry[], base: string): Promise<void> {
  try {
    const paths = new Set<string>();
    for (const e of entries) {
      paths.add(e.filePath);
      if (e.origPath) paths.add(e.origPath);
    }
    // -z: names as the -z status entries have them, a rename under its new
    // name rather than "a => b", and a name outside ASCII unquoted.
    const numstatArgs = ['diff', base, '--numstat', '-z'];
    if (paths.size <= 200) numstatArgs.push('--', ...paths);
    const numstatRaw = await git(numstatArgs, cwd);
    const stats = new Map(parseNumstat(numstatRaw).map(s => [s.path, s]));
    for (const entry of entries) {
      const stat = stats.get(entry.filePath);
      if (stat && !stat.binary) {
        entry.additions = stat.additions;
        entry.deletions = stat.deletions;
      }
    }
  } catch { /* numstat is best-effort */ }
}

/** Attach working-tree blob hashes so the UI can tell a file changed since the
 *  user marked it viewed. One `git hash-object --stdin-paths` call; deleted
 *  files get a fixed marker. Best-effort. */
async function attachContentHashes(cwd: string, entries: GitStatusEntry[]): Promise<void> {
  try {
    // A file in conflict can be gone (both sides deleted it, or someone did
    // since), and one missing path fails the whole call.
    const missing = new Set<string>();
    for (const e of entries) {
      if (e.status === 'conflicted' && !(await fs.access(path.join(cwd, e.filePath)).then(() => true, () => false))) missing.add(e.filePath);
    }
    const gone = (e: GitStatusEntry) => e.status === 'deleted' || missing.has(e.filePath);
    const present = [...new Set(entries.filter(e => !gone(e)).map(e => e.filePath))];
    if (present.length > 200) return;
    const hashes = parseHashObjectOutput(await hashWorkingFiles(cwd, present), present);
    for (const entry of entries) {
      entry.contentHash = gone(entry) ? 'deleted' : hashes.get(entry.filePath);
    }
  } catch { /* hashes are best-effort */ }
}

const ID_IN_USE = 'The new thread\'s id is already in use. Try starting it again.';

/** The id for a new thread: the one the renderer picked (its row is already
 *  in the sidebar under it), or a fresh one. The id names the worktree
 *  folder and the event log, so only the shape main makes itself is taken,
 *  and not one live or being set up. No await, so the caller can track it
 *  before another request can look; a stopped thread's id is checked after. */
function newSessionId(requested: unknown): string {
  if (requested === undefined) return crypto.randomUUID().slice(0, 8);
  if (typeof requested !== 'string' || !/^[0-9a-f]{8}$/.test(requested)) {
    throw new Error('The new thread\'s id is not valid. Try starting it again.');
  }
  if (sessionManager.getSession(requested) || sessionManager.hasPendingSetup(requested)) {
    throw new Error(ID_IN_USE);
  }
  return requested;
}

/** Open a file in VS Code, then Cursor (launchEditor handles Windows .cmd
 *  shims), then the OS default opener, which goes straight to the OS
 *  (ShellExecute on Windows) with no cmd.exe parsing of the path. False
 *  when none could. */
async function openInEditor(file: string, line: unknown): Promise<boolean> {
  if (await launchEditor('code', file, line)) return true;
  if (await launchEditor('cursor', file, line)) return true;
  return (await shell.openPath(file)) === '';
}

export function registerHandlers() {
  // ─── Repo ───

  ipcMain.handle(IPC.REPO_SELECT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select a project folder',
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    // A folder outside any repository comes back as 'folder' and is added
    // as a plain folder.
    const picked = await inspectProjectFolder(result.filePaths[0]);
    // Remembered from the start, so it survives a restart before it has
    // any conversations.
    rememberProject(picked.path);

    if (picked.kind === 'git') {
      // Clean up any orphan worktrees from previous crashes
      const orphans = await worktreeManager.cleanupOrphans(picked.path);
      if (orphans > 0) {
        logger.info(`Cleaned up ${orphans} orphan worktree(s) in ${picked.path}`);
      }
    }

    return picked;
  });

  ipcMain.handle(IPC.REPO_VALIDATE, async (_event, repoPath: string) => {
    return worktreeManager.validateRepo(repoPath);
  });

  ipcMain.handle(IPC.REPO_REMEMBER, async (_event, repoPath: string) => {
    if (typeof repoPath !== 'string' || !path.isAbsolute(repoPath)) return;
    rememberProject(repoPath);
  });

  ipcMain.handle(IPC.REPO_KIND, async (_event, repoPath: string) => {
    if (typeof repoPath !== 'string' || !repoPath) return 'missing';
    return projectKind(repoPath);
  });

  ipcMain.handle(IPC.GIT_HAS_IDENTITY, async (_event, dir: string) => {
    if (typeof dir !== 'string' || !dir) return false;
    return !!(await getGitIdentity(dir));
  });

  ipcMain.handle(IPC.REPO_REMOVE, async (_event, repoPath: string) => {
    const activeSessions = sessionManager.getSessionsByRepo(repoPath);
    if (activeSessions.length > 0) {
      throw new Error('Cannot remove a project while it has active threads');
    }

    if (await projectKind(repoPath) === 'git') {
      const orphans = await worktreeManager.cleanupOrphans(repoPath);
      if (orphans > 0) {
        logger.info(`Cleaned up ${orphans} orphan worktree(s) on repo remove for ${repoPath}`);
      }
    }
    // Last, so a failed cleanup leaves the project both shown and remembered.
    forgetProject(repoPath);
  });

  // ─── Sessions ───

  ipcMain.handle(IPC.SESSION_CREATE, async (event, opts: CreateSessionOpts) => {
    // Step timings (perf-steps.ts) start here; they begin under the id once
    // the checks pass.
    const startedAt = performance.now();
    // Usually picked by the renderer, which shows the thread's row from the
    // moment the user sends, so main counts the thread as being set up from
    // here, before any await: closing it while the checks run waits for
    // them, and deleting it stops them before anything is made. A check that
    // fails takes the row away again.
    const id = newSessionId(opts.id);
    const checksAbort = new AbortController();
    let checksDone!: () => void;
    sessionManager.trackPendingSetup(id, new Promise<void>((resolve) => { checksDone = resolve; }), checksAbort);
    try {
      return await startNewSession(event, opts, id, startedAt, checksAbort.signal);
    } finally {
      checksDone();
    }
  });

  /** SESSION_CREATE once the id is settled: the checks, then the setup (in
   *  the background for a new worktree). `deleted` fires when the thread is
   *  deleted during the checks. */
  async function startNewSession(
    event: Electron.IpcMainInvokeEvent, opts: CreateSessionOpts, id: string, startedAt: number, deleted: AbortSignal,
  ) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window found');
    // Any other mode is dropped so the agent's saved default applies.
    const permissionMode = isPermissionMode(opts.permissionMode) ? opts.permissionMode : undefined;
    const model = typeof opts.model === 'string' && opts.model ? opts.model : undefined;
    const controls = sanitizeControls(opts.controls);
    // A stopped thread keeps its id in the manifest.
    if (opts.id !== undefined && await worktreeManager.getWorktreeOrManifest(id)) throw new Error(ID_IN_USE);

    // A folder project (not a repository, or git isn't installed) can only
    // run in the folder.
    const kind = await projectKind(opts.repoPath);
    if (kind === 'missing') throw new Error(`The project folder ${opts.repoPath} wasn't found.`);
    const noGit = kind === 'folder';
    if (noGit && !opts.direct) {
      throw new Error((await gitVersion())
        ? 'This project isn\'t a git repository, so a thread can only work in the project folder itself.'
        : 'Git isn\'t installed, so a thread can only work in the project folder itself.');
    }

    if (opts.direct) {
      // Direct mode: run in-place on the repo's current checkout, no worktree created.
      const branch = noGit
        ? ''
        : opts.branchName || (await git(['rev-parse', '--abbrev-ref', 'HEAD'], opts.repoPath)).trim();
      logger.info(`Creating direct session: branch=${branch || '(no git)'}, repo=${opts.repoPath}`);

      deleted.throwIfAborted();
      const entry = await worktreeManager.registerDirect(opts.repoPath, branch, { noGit, id });
      perfSteps.begin(entry.id, 'new conversation', startedAt);
      perfSteps.step(entry.id, 'checks');

      let session: SessionInfo;
      try {
        session = await sessionManager.createSession({
          id: entry.id,
          branch: entry.branch,
          cwd: opts.repoPath,
          repoPath: opts.repoPath,
          window: win,
          adapterType: opts.adapterType,
          permissionMode,
          model,
          controls,
          noGit,
        });
      } catch (err) {
        perfSteps.fail(entry.id, 'setup failed');
        throw err;
      }

      logger.info(`Direct session created: id=${session.id}`);
      return { id: session.id, branch: session.branch, agentType: session.agentType, ...(noGit ? { noGit: true } : {}) };
    }

    // A conversation joining a group on the group's branch continues that
    // branch where the project has it already. Git allows a branch in one
    // checkout at a time, so one held by another (a conversation, or the
    // project folder itself) is refused here rather than failing later.
    let useExisting = !!opts.useExisting;
    if (!useExisting && opts.continueBranch && opts.branchName.trim()) {
      const name = opts.branchName.trim();
      if (await branchExistsAnywhere(opts.repoPath, name)) {
        const holder = (await worktreeBranches(opts.repoPath).catch(() => null))?.get(name);
        if (holder) {
          throw new Error(`Branch "${name}" is already checked out at ${holder}. Pick another branch name for this thread.`);
        }
        useExisting = true;
      }
    }

    // No name for a new branch: start on a placeholder that is renamed from
    // the task after the first turn (BRANCH_AUTO_NAME).
    const branch = useExisting ? opts.branchName.trim() : (opts.branchName.trim() || tempBranchName(id));

    // ── Validation (synchronous — errors shown in dialog) ──

    if (useExisting) {
      const exists = await branchExistsAnywhere(opts.repoPath, branch);
      if (!exists) {
        throw new Error(`Branch "${branch}" does not exist`);
      }
      // Git checks a branch out in one place at a time. Refused here, so the
      // draft comes back with the reason, rather than the new thread failing
      // as it makes its copy. (A group's branch was checked above.)
      let held: Map<string, string> | null = null;
      if (opts.useExisting) {
        try {
          held = await worktreeBranches(opts.repoPath);
        } catch {
          held = null; // git makes the copy, and says so, if it can't
        }
      }
      const holder = held?.get(branch);
      if (holder) {
        // git prints its paths with forward slashes, in its own letter case.
        const key = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
        throw new Error(key(holder) === key(opts.repoPath)
          ? `${branch} is checked out in the project folder. Pick Project folder to work there, or pick another branch.`
          : `${branch} is checked out at ${holder}. A branch can only be checked out in one place, so pick another branch.`);
      }
    } else {
      const exists = await branchExists(opts.repoPath, branch);
      const validName = await validateBranchName(branch);
      if (!validName) {
        throw new Error(`Invalid branch name: "${branch}"`);
      }
      if (exists) {
        throw new Error(`Branch "${branch}" already exists`);
      }
    }

    deleted.throwIfAborted();
    logger.info(`Creating session: branch=${branch}, repo=${opts.repoPath}, useExisting=${useExisting}`);
    perfSteps.begin(id, 'new conversation', startedAt);
    perfSteps.step(id, 'checks');

    // Helper to emit agent events before the session object exists.
    // Events are buffered so history replay can show them even if the
    // renderer subscribes after they were sent.
    prelaunchEvents.set(id, []);
    const emitPrelaunch = (evt: import('../shared/types.js').AgentEvent) => {
      prelaunchEvents.get(id)?.push(evt);
      if (!win.isDestroyed()) {
        win.webContents.send(`${IPC.AGENT_EVENT}:${id}`, evt);
      }
    };

    // Return fast — the dialog can close and a tab can open
    // Run the heavy work (worktree, npm install, agent start) in the background.
    // Deleting the conversation meanwhile aborts it (see destroySession).
    const setupAbort = new AbortController();
    const { signal } = setupAbort;
    const setupPromise = (async () => {
      try {
        emitPrelaunch({ type: 'status', message: 'Creating worktree…' });

        const worktree = await worktreeManager.create({
          repoPath: opts.repoPath,
          branchName: branch,
          baseBranch: opts.baseBranch,
          useExisting,
          id,
          adapterType: opts.adapterType,
        });
        perfSteps.step(id, 'worktree');
        signal.throwIfAborted();

        // Auto-copy untracked files (.env, etc.)
        try {
          const config = await worktreeManager.getRepoConfig(opts.repoPath);
          if (config.copyFiles.length > 0) {
            await worktreeManager.copyUntrackedFiles(worktree.id, config.copyFiles);
            logger.info(`Copied ${config.copyFiles.length} config file(s) to worktree`);
          }
        } catch (e) {
          logger.warn('Failed to copy untracked files:', e);
        }
        perfSteps.step(id, 'copy files');

        // Install dependencies if enabled and the project has a package.json,
        // with the package manager the project uses
        if (settings.getSettings().autoInstallDeps) {
          let manager: PackageManager = 'npm';
          try {
            await fs.access(path.join(worktree.path, 'package.json'));
            if (!win.isDestroyed()) {
              win.webContents.send(IPC.SESSION_STATUS, worktree.id, 'installing');
            }

            manager = await detectPackageManager(worktree.path);
            emitPrelaunch({ type: 'status', message: 'Installing dependencies…' });
            logger.info(`Running ${manager} install in worktree ${worktree.id}`);
            await installDependencies(worktree.path, manager, signal);
            perfSteps.step(id, 'install dependencies');
            logger.info(`${manager} install completed for worktree ${worktree.id}`);
          } catch (e) {
            if (signal.aborted) throw e;
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
              perfSteps.step(id, 'install dependencies (failed)');
              const err = e as { stderr?: string; message?: string };
              const stderr = err.stderr || err.message || String(e);
              logger.warn(`${manager} install failed for worktree ${worktree.id}:`, e);
              emitPrelaunch({ type: 'error', message: `${manager} install failed:\n${stderr}` });
            }
          }
        }

        // Start agent in the worktree
        signal.throwIfAborted();
        emitPrelaunch({ type: 'status', message: 'Starting agent…' });
        await sessionManager.createSession({
          id: worktree.id,
          branch: worktree.branch,
          cwd: worktree.path,
          repoPath: opts.repoPath,
          window: win,
          adapterType: opts.adapterType,
          permissionMode,
          model,
          controls,
          adoptSetupEvents: () => {
            const events = prelaunchEvents.get(id) ?? [];
            prelaunchEvents.delete(id);
            return events;
          },
        });

        logger.info(`Session created: id=${worktree.id}`);
      } catch (err) {
        if (signal.aborted) {
          perfSteps.fail(id, 'deleted');
          logger.info(`Session setup stopped for ${id}: the conversation was deleted`);
          return;
        }
        perfSteps.fail(id, 'setup failed');
        const msg = (err as Error | null)?.message || String(err);
        logger.error(`Session setup failed for ${id}:`, msg);
        emitPrelaunch({ type: 'error', message: msg });
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.SESSION_STATUS, id, 'error');
        }
      } finally {
        // Clean up prelaunch buffer — events are now in the session's
        // own eventHistory or no longer needed.
        prelaunchEvents.delete(id);
      }
    })();

    // Don't await — let it run in the background
    setupPromise.catch(() => {}); // prevent unhandled rejection
    // Prompts sent to the new tab while setup runs wait for it to finish.
    sessionManager.trackPendingSetup(id, setupPromise, setupAbort);

    // The agent the session will run on, resolved as sessionManager.createSession
    // does. The session doesn't exist yet, and without this the renderer files
    // the conversation under the default agent (its models, controls, usage)
    // until the app restarts.
    return { id, branch, agentType: opts.adapterType ?? adapterRegistry.getDefault().id };
  }

  ipcMain.handle(IPC.SESSION_RESUME, async (event, id: string, repoPath: string) => {
    const startedAt = performance.now();
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window found');

    // Its agent is up (or asleep, or starting): just reattach the window so
    // events flow to the new webContents.
    const existing = sessionManager.getSession(id);
    if (existing && existing.status !== 'stopped' && existing.status !== 'error') {
      sessionManager.reattachWindow(id, win);
      return { id: existing.id, branch: existing.branch };
    }
    // Its agent ended (exited or crashed, died in system sleep, or failed to
    // start) but the session is still held: reattaching would leave the tab
    // looking live with nothing behind it. Close it and resume below, as
    // after an app restart.
    if (existing) await sessionManager.closeSession(id);

    // The renderer already shows the tab and its input while this runs, so
    // register the resume as a pending setup: prompts sent meanwhile are held
    // by sendMessage() until the session exists.
    perfSteps.begin(id, 'resume', startedAt);
    if (existing) perfSteps.step(id, 'close old agent');
    const resumePromise = (async () => {
      const worktree = await worktreeManager.getWorktreeOrManifest(id);
      if (!worktree) {
        throw new Error(`Worktree ${id} not found`);
      }

      // Look up saved provider session ID for conversation resumption
      const providerSessionId = await worktreeManager.getProviderSessionId(id);
      // Restore the model the session last ran with (falls back to default if unset)
      const savedModel = await worktreeManager.getModel(id);
      // ...on the agent it ran with. A Codex conversation must not come back on Claude.
      const adapterType = await worktreeManager.getAdapterType(id);
      // ...and what it has spent, which its history may no longer add up to.
      const savedLimits = await worktreeManager.getThreadLimits(id);
      logger.info(`Resuming session: id=${id}, branch=${worktree.branch}, providerSession=${providerSessionId ?? 'none'}, model=${savedModel ?? 'default'}`);
      perfSteps.step(id, 'lookup');

      const session = await sessionManager.createSession({
        id: worktree.id,
        branch: worktree.branch,
        cwd: worktree.path,
        repoPath,
        window: win,
        resumeSessionId: providerSessionId,
        model: savedModel,
        adapterType,
        noGit: !!worktree.noGit,
        savedLimits,
      });

      logger.info(`Session resumed: id=${session.id}`);
      return { id: session.id, branch: session.branch, agentType: session.agentType };
    })();
    resumePromise.catch(() => perfSteps.fail(id, 'resume failed'));
    sessionManager.trackPendingSetup(id, resumePromise);
    return resumePromise;
  });

  ipcMain.handle(IPC.SESSION_STOP, async (_event, id: string) => {
    logger.info(`Interrupting session query (keeping process alive): id=${id}`);
    await sessionManager.interruptQuery(id);
    logger.info(`Session query interrupted, ready for follow-up: id=${id}`);
  });

  ipcMain.handle(IPC.SESSION_CLOSE, async (_event, id: string) => {
    logger.info(`Closing session (agent, background tasks and terminal): id=${id}`);
    previewManager.close(id);
    await Promise.all([
      terminalManager.killAllForSession(id),
      sessionManager.closeSession(id),
    ]);
    logger.info(`Session closed: id=${id}`);
  });

  // Idle sleep: the agent process goes, and so does the agent's Preview page,
  // which nothing drives while it sleeps. The terminal and anything running
  // in it are left alone, so a dev server there keeps serving, and so is
  // your own Preview page.
  ipcMain.handle(IPC.SESSION_SLEEP, async (_event, id: string) => {
    const slept = await sessionManager.sleepSession(id);
    if (slept) {
      previewManager.closeAgentPage(id);
      logger.info(`Session asleep: id=${id}`);
    }
    return slept;
  });

  ipcMain.handle(IPC.SESSION_WAKE, async (_event, id: string) => {
    logger.info(`Waking session: id=${id}`);
    sessionManager.wakeSession(id);
  });

  ipcMain.handle(IPC.SESSION_STOP_TASK, async (_event, id: string, taskId: string) => {
    logger.info(`Stopping background task: session=${id} task=${taskId}`);
    await sessionManager.stopTask(id, taskId);
  });

  ipcMain.handle(IPC.SESSION_DESTROY, async (_event, id: string, deleteBranch: boolean = false) => {
    logger.info(`Destroying session: id=${id}, deleteBranch=${deleteBranch}`);
    // Refuse before stopping anything if other conversations share its worktree.
    await worktreeManager.assertRemovable(id);
    previewManager.close(id);
    await terminalManager.killAllForSession(id);
    await sessionManager.destroySession(id); // includes its wait for Windows to release file handles (handleReleaseMs)
    await worktreeManager.remove(id, deleteBranch);
    // Cascade: no orphan bookmarks. The conversation is already gone, so a
    // bookmarks file that can't be read right now doesn't fail the delete.
    try { bookmarks.removeBookmarksForSession(id); } catch (err) { logger.warn(`Could not remove bookmarks for ${id}:`, err); }
    void removeAttachments(id); // images and files shown in its thread
    goalAutoAttempts.delete(id);
    logger.info(`Session destroyed: id=${id}`);
  });

  ipcMain.handle(IPC.SESSION_LIST, async (): Promise<SessionInfo[]> => {
    return sessionManager.listSessions();
  });

  // ─── Thread export ───

  /** Save a thread to a file the user picks: Markdown, or JSON when they
   *  pick that type. Resolves to the path written, or null if cancelled. */
  ipcMain.handle(IPC.SESSION_EXPORT, async (event, sessionId: unknown): Promise<string | null> => {
    if (!isThreadId(sessionId)) throw new Error('No such thread to export.');
    const worktree = await worktreeManager.getWorktreeOrManifest(sessionId);
    if (!worktree) throw new Error('This thread is gone, so there is nothing to export.');
    const live = sessionManager.getSession(sessionId);
    const displayName = live?.displayName ?? (await worktreeManager.getDisplayNameState(sessionId))?.displayName;
    const agentId = live?.agentType ?? await worktreeManager.getAdapterType(sessionId);
    const info: ThreadExportInfo = {
      id: sessionId,
      title: displayName || worktree.branch || 'New thread',
      project: path.basename(worktree.repoPath),
      branch: worktree.branch,
      agent: (agentId && adapterRegistry.get(agentId)?.displayName) || 'Agent',
    };

    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.SaveDialogOptions = {
      title: 'Export thread',
      defaultPath: path.join(app.getPath('documents'), exportFileName(info.title, 'md')),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'JSON (every event)', extensions: ['json'] },
      ],
    };
    const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return null;

    const events = sessionManager.getEventHistory(sessionId);
    const now = new Date();
    const json = path.extname(picked.filePath).toLowerCase() === '.json';
    const text = freezeLog.timeWork(`thread export, ${events.length} events`,
      () => json ? threadJson(events, info, now) : threadMarkdown(events, info, now));
    await fs.writeFile(picked.filePath, text);
    logger.info(`Exported thread ${sessionId} as ${json ? 'JSON' : 'Markdown'} (${events.length} events)`);
    return picked.filePath;
  });

  // ─── Session rename ───

  ipcMain.handle(IPC.SESSION_RENAME, async (_event, sessionId: string, displayName: string) => {
    sessionManager.renameSession(sessionId, displayName);
    // Persist so the name survives app restart (displayName was in-memory only).
    await worktreeManager.saveDisplayName(sessionId, displayName);
  });

  ipcMain.handle(IPC.SESSION_AUTO_NAME, async (_event, sessionId: string): Promise<string | null> => {
    const state = await worktreeManager.getDisplayNameState(sessionId);
    if (!state || state.source === 'user') return null;
    const live = sessionManager.getSession(sessionId);
    const next = await decideAutoName(state, {
      providerTitle: async () => {
        // Stopped sessions have no live adapter: use the agent they ran on.
        const adapterType = live ? undefined : await worktreeManager.getAdapterType(sessionId);
        const adapter = live?.adapter ?? (adapterType ? adapterRegistry.get(adapterType) : undefined);
        const providerSessionId = live?.providerSessionId ?? await worktreeManager.getProviderSessionId(sessionId);
        const cwd = live?.worktreePath ?? (await worktreeManager.getWorktreeOrManifest(sessionId))?.path;
        if (!adapter?.getConversationTitle || !providerSessionId || !cwd) return null;
        try {
          return await adapter.getConversationTitle(providerSessionId, cwd);
        } catch (e) {
          logger.debug(`[session-auto-name] no provider title for ${sessionId}:`, e);
          return null;
        }
      },
      firstPrompt: () => firstUserPrompt(prelaunchPrefixedEvents(sessionId)),
    });
    if (!next || !(await worktreeManager.saveAutoDisplayName(sessionId, state, next))) return null;
    if (next.source !== 'auto') return null;
    sessionManager.renameSession(sessionId, next.displayName);
    return next.displayName;
  });

  // ─── Conversation goal ───

  ipcMain.handle(IPC.SESSION_GOAL_GET, async (_event, sessionId: string): Promise<ConversationGoal | null> => {
    return (await worktreeManager.getGoal(sessionId)) ?? null;
  });

  ipcMain.handle(IPC.SESSION_GOALS_GET, async (_event, sessionIds: unknown): Promise<Record<string, ConversationGoal>> => {
    if (!Array.isArray(sessionIds)) return {};
    return worktreeManager.getGoals(sessionIds.filter((id): id is string => typeof id === 'string'));
  });

  ipcMain.handle(IPC.SESSION_GOAL_SET, async (_event, sessionId: string, text: string): Promise<ConversationGoal | null> => {
    return worktreeManager.saveGoal(sessionId, cleanUserGoal(typeof text === 'string' ? text : ''), 'user');
  });

  ipcMain.handle(IPC.SESSION_GOAL_HIDE, async (_event, sessionId: string, hidden: boolean): Promise<ConversationGoal | null> => {
    return worktreeManager.setGoalHidden(sessionId, hidden === true);
  });

  ipcMain.handle(IPC.SESSION_GOAL_AUTO, async (_event, sessionId: string): Promise<ConversationGoal | null> => {
    if (!settings.getSettings().showConversationGoal || goalInFlight.has(sessionId)) return null;
    const attempts = goalAutoAttempts.get(sessionId) ?? 0;
    if (attempts >= MAX_GOAL_AUTO_ATTEMPTS) return null;
    // Marked before the first await, so a second call can't pass the checks.
    goalInFlight.add(sessionId);
    try {
      const current = await worktreeManager.getGoal(sessionId);
      // Only ever once: a goal generated or typed before, even one the user
      // cleared, stays as it is. Refresh makes a new one on request. None for
      // a conversation whose bar was closed: nobody would see it.
      if (!current || current.source || current.hidden) return null;
      const input = goalInputFromEvents(prelaunchPrefixedEvents(sessionId));
      if (input.prompts.length === 0 || !input.reply) return null; // no reply to summarise yet
      goalAutoAttempts.set(sessionId, attempts + 1);
      return await generateAndSaveGoal(sessionId, current, input);
    } catch (e) {
      logger.warn(`Automatic goal failed for ${sessionId}:`, e);
      if (/does not support text generation/.test(String((e as Error)?.message ?? e))) {
        goalAutoAttempts.set(sessionId, MAX_GOAL_AUTO_ATTEMPTS);
      }
      return null;
    } finally {
      goalInFlight.delete(sessionId);
    }
  });

  ipcMain.handle(IPC.SESSION_GOAL_REFRESH, async (_event, sessionId: string, substitute?: unknown): Promise<ConversationGoal | null> => {
    // One is already being written: its result is on the way.
    if (goalInFlight.has(sessionId)) return (await worktreeManager.getGoal(sessionId)) ?? null;
    goalInFlight.add(sessionId);
    try {
      const current = await worktreeManager.getGoal(sessionId);
      if (!current) return null;
      const input = goalInputFromEvents(prelaunchPrefixedEvents(sessionId));
      // Not saved when the goal was edited meanwhile: the edit stands.
      const agent = typeof substitute === 'string' ? substitute : undefined;
      return (await generateAndSaveGoal(sessionId, current, input, agent)) ?? (await worktreeManager.getGoal(sessionId)) ?? null;
    } finally {
      goalInFlight.delete(sessionId);
    }
  });

  // ─── Branches ───

  ipcMain.handle(IPC.BRANCH_LIST, async (_event, repoPath: string, opts?: { fetch?: boolean }) => {
    return listBranches(repoPath, { fetch: opts?.fetch !== false });
  });

  ipcMain.handle(IPC.BRANCH_CHECKED_OUT, async (_event, repoPath: string) => {
    return Object.fromEntries(await worktreeBranches(repoPath));
  });

  ipcMain.handle(IPC.BRANCH_DEFAULT, async (_event, repoPath: string) => {
    return getDefaultBranch(repoPath);
  });

  ipcMain.handle(IPC.BRANCH_RENAME, async (_event, sessionId: string, newBranchName: string) => {
    const newName = await worktreeManager.renameBranch(sessionId, newBranchName);
    sessionManager.setBranch(sessionId, newName);
    return { branch: newName };
  });

  ipcMain.handle(IPC.BRANCH_AUTO_NAME, async (_event, sessionId: string): Promise<string | null> => {
    const live = sessionManager.getSession(sessionId);
    // Only the conversation that owns the placeholder renames it: one attached
    // to the same worktree has another id, and follows via BRANCH_SYNC.
    if (!live || live.branch !== tempBranchName(sessionId) || !isTempBranch(live.branch)) return null;
    if (branchAutoNameInFlight.has(sessionId)) return null;
    // Renaming the checked-out branch under a running turn could break a git
    // command the agent is running (a push of the old name, say). The
    // renderer asks again after the next turn ends.
    if (sessionManager.isMidTurn(sessionId)) return null;
    const attempts = branchAutoNameAttempts.get(sessionId) ?? 0;
    if (attempts >= MAX_BRANCH_AUTO_NAME_ATTEMPTS) return null;
    // As the chat showed it: attached files as a name label, not their content,
    // which would otherwise crowd the typed task out of the prompt.
    const sent = firstUserPrompt(prelaunchPrefixedEvents(sessionId));
    const task = sent ? displayTextFromSent(sent).trim() : '';
    if (!task) return null; // nothing to name it from yet

    branchAutoNameInFlight.add(sessionId);
    branchAutoNameAttempts.set(sessionId, attempts + 1);
    try {
      const title = (await worktreeManager.getDisplayNameState(sessionId))?.displayName ?? null;
      const name = branchAutoNamePending.get(sessionId) ?? await generateBranchName({
        repoPath: live.repoPath,
        cwd: live.worktreePath,
        task,
        title,
        rule: settings.getSettings().branchNamingRule || null,
      }, live.adapter);
      branchAutoNamePending.delete(sessionId);
      // The user may have renamed it while the name was being generated.
      if (sessionManager.getSession(sessionId)?.branch !== tempBranchName(sessionId)) return null;
      // A queued message may have started a turn meanwhile: try again after
      // it, without using up an attempt.
      if (sessionManager.isMidTurn(sessionId)) {
        branchAutoNameAttempts.set(sessionId, attempts);
        branchAutoNamePending.set(sessionId, name);
        return null;
      }
      const newName = await worktreeManager.renameBranch(sessionId, name);
      sessionManager.setBranch(sessionId, newName);
      logger.info(`Named branch for ${sessionId}: ${newName}`);
      return newName;
    } catch (e) {
      // Pushed already, generation failed, or the agent can't generate text.
      // The placeholder stays; the user can still rename it by hand.
      logger.warn(`Automatic branch name failed for ${sessionId}:`, e);
      if (/pushed to a remote|does not support text generation/.test(String((e as Error)?.message ?? e))) {
        branchAutoNameAttempts.set(sessionId, MAX_BRANCH_AUTO_NAME_ATTEMPTS);
      }
      return null;
    } finally {
      branchAutoNameInFlight.delete(sessionId);
    }
  });

  ipcMain.handle(IPC.CHECKOUT_SHARERS, async (_event, sessionId: string): Promise<string[]> => {
    return worktreeManager.checkoutSharers(sessionId);
  });

  ipcMain.handle(IPC.BRANCH_SWITCH, async (
    _event, sessionId: string, branch: string, opts?: { create?: boolean; busySessionIds?: string[] },
  ): Promise<BranchSwitchResult> => {
    if (typeof branch !== 'string') return { success: false, error: 'Pick a branch.' };
    const create = opts?.create === true;
    const busySessionIds = Array.isArray(opts?.busySessionIds) ? opts.busySessionIds : [];
    logger.info(`Switching session ${sessionId} to ${create ? 'new ' : ''}branch ${branch}`);
    const result = await worktreeManager.switchBranch(sessionId, branch, { create, busySessionIds });
    if (result.success) {
      for (const id of result.sessionIds) sessionManager.setBranch(id, result.branch);
    } else {
      logger.warn(`Branch switch failed for session ${sessionId}: ${result.error}`);
    }
    return result;
  });

  // Polled to keep what's shown current: background work (background-work.ts).
  ipcMain.handle(IPC.BRANCH_SYNC, (_event, sessionId: string) => inBackground(async (): Promise<BranchSyncResult | null> => {
    const result = await worktreeManager.syncBranch(sessionId);
    if (result) {
      logger.info(`Session ${sessionId} checkout is now on branch ${result.branch}`);
      for (const id of result.sessionIds) sessionManager.setBranch(id, result.branch);
    }
    return result;
  }));

  // ─── Worktrees ───

  ipcMain.handle(IPC.WORKTREE_LIST, async (_event, repoPath: string) => {
    const worktrees = await worktreeManager.list(repoPath);
    for (const wt of worktrees) {
      worktreeManager.register(wt);
    }
    return worktrees;
  });

  ipcMain.handle(IPC.WORKTREE_LIST_REPOS, async () => {
    return listProjects(await worktreeManager.listRepos());
  });

  // ─── Prerequisites ───

  // Core check (git + agent). Carries forward the last known gh status so the
  // renderer keeps PR features enabled while the slower gh check runs. Every
  // result is cached, pass or fail: the renderer shows it at the next launch
  // while a fresh check runs, and nothing blocks on it.
  ipcMain.handle(IPC.PREREQUISITES_CHECK, async (): Promise<PrerequisiteStatus> => {
    const core = await checkCorePrerequisites();
    const status: PrerequisiteStatus = { ...core, gh: loadPrerequisiteCache()?.status.gh };
    savePrerequisiteCache(status);
    return status;
  });

  ipcMain.handle(IPC.PREREQUISITES_CACHED, (): PrerequisiteStatus | null => {
    return loadPrerequisiteCache()?.status ?? null;
  });

  // One agent's sign-in, checked for real (it starts the agent briefly),
  // then the core check again so the answer shows everywhere.
  ipcMain.handle(IPC.PREREQUISITES_CHECK_SIGN_IN, async (_event, adapterId: unknown): Promise<PrerequisiteStatus> => {
    const adapter = typeof adapterId === 'string' ? adapterRegistry.get(adapterId) : undefined;
    if (!adapter?.checkSignIn) throw new Error('This agent can\'t be asked whether it is signed in.');
    await adapter.checkSignIn();
    const core = await checkCorePrerequisites();
    const status: PrerequisiteStatus = { ...core, gh: loadPrerequisiteCache()?.status.gh };
    savePrerequisiteCache(status);
    return status;
  });

  ipcMain.handle(IPC.PREREQUISITES_GH, async () => {
    const gh = await checkGh();
    const cached = loadPrerequisiteCache();
    if (cached) savePrerequisiteCache({ ...cached.status, gh });
    return gh;
  });

  // Saving or removing a key only changes that agent's key state, so patch
  // the last check rather than re-running every CLI probe (which can take
  // seconds).
  async function withFreshApiKeyState(adapter: AgentAdapter): Promise<PrerequisiteStatus> {
    const cached = loadPrerequisiteCache()?.status;
    const status: PrerequisiteStatus = cached?.agents[adapter.id]
      ? {
          ...cached,
          agents: { ...cached.agents, [adapter.id]: { ...cached.agents[adapter.id], apiKey: apiKeyState(adapter) } },
        }
      : { ...(await checkCorePrerequisites()), gh: cached?.gh };
    savePrerequisiteCache(status);
    return status;
  }

  function adapterForKey(adapterId: unknown): AgentAdapter {
    const adapter = typeof adapterId === 'string' ? adapterRegistry.get(adapterId) : undefined;
    if (!adapter) throw new Error(`Unknown agent: ${String(adapterId)}`);
    if (!adapter.apiKey) throw new Error(`${adapter.displayName} does not take an API key.`);
    return adapter;
  }

  // A key the provider refuses is turned away here, so a typo shows up next
  // to the field rather than after a conversation has been created. When the
  // provider can't be reached the key is saved anyway and marked unchecked.
  ipcMain.handle(IPC.CREDENTIALS_SET_API_KEY, async (_event, adapterId: unknown, rawKey: unknown): Promise<PrerequisiteStatus> => {
    const adapter = adapterForKey(adapterId);
    const key = parseApiKey(rawKey);
    if (!canStoreApiKey()) {
      throw new Error('This computer has no secure storage, so the API key cannot be saved.');
    }
    const accepted = adapter.verifyApiKey ? await adapter.verifyApiKey(key) : true;
    if (accepted === false) {
      throw new Error('That key was refused. Check you copied all of it, or create a new one.');
    }
    saveApiKey(adapter.id, key, { unverified: accepted === null });
    return withFreshApiKeyState(adapter);
  });

  ipcMain.handle(IPC.CREDENTIALS_CLEAR_API_KEY, async (_event, adapterId: unknown): Promise<PrerequisiteStatus> => {
    const adapter = adapterForKey(adapterId);
    clearApiKey(adapter.id);
    return withFreshApiKeyState(adapter);
  });

  ipcMain.on(IPC.APP_RESTORE_COMPLETE, () => {
    appEvents.emit('restore-complete');
  });

  // ─── Agent I/O ───

  ipcMain.on(IPC.AGENT_SEND, (
    event,
    sessionId: string,
    content: string,
    images?: import('../shared/types.js').ImageAttachment[],
    files?: import('../shared/types.js').FileAttachment[],
  ) => {
    // Tell the user the prompt was not delivered, then unlock the renderer
    // so it doesn't stay stuck in "Writing message".
    const notDelivered = (message: string) => {
      const channel = `${IPC.AGENT_EVENT}:${sessionId}`;
      if (event.sender.isDestroyed()) return;
      event.sender.send(channel, { type: 'error', message });
      event.sender.send(channel, { type: 'process_exit' });
    };
    sessionManager.sendMessage(sessionId, content, images, files).then(
      (ok) => {
        // Session is dead or never connected
        if (!ok) notDelivered('Message not delivered: the agent is not connected. Send it again once the thread shows as connected.');
      },
      (err) => {
        logger.warn(`[AGENT_SEND] session=${sessionId} failed:`, err);
        notDelivered('Message not delivered: sending it failed. See the log for details, then send it again.');
      },
    );
  });

  // The file name is checked against the stored-name pattern, so it can't
  // reach outside the conversation's attachments folder.
  ipcMain.handle(IPC.ATTACHMENT_OPEN, (_event, sessionId: unknown, file: unknown) =>
    typeof sessionId === 'string' && typeof file === 'string' ? openAttachedFile(sessionId, file) : false);

  ipcMain.handle(IPC.WORKTREE_FILE_OPEN, async (_event, sessionId: unknown, filePath: unknown): Promise<OpenWorktreeFileResult> => {
    const worktree = typeof sessionId === 'string' ? worktreeManager.getWorktree(sessionId) : undefined;
    if (!worktree || typeof filePath !== 'string') return { kind: 'missing' };
    return openWorktreeFile(worktree.path, filePath);
  });

  ipcMain.handle(IPC.AGENT_SET_MODE, (_event, sessionId: string, mode: string) => {
    sessionManager.setMode(sessionId, mode);
  });

  ipcMain.handle(IPC.AGENT_SET_MODEL, (_event, sessionId: string, model?: string) => {
    return sessionManager.setModel(sessionId, model);
  });

  ipcMain.handle(IPC.AGENT_GET_CONTROLS, (_event, sessionId: string) => {
    return sessionManager.getControls(sessionId);
  });

  ipcMain.handle(IPC.AGENT_GET_USAGE, (_event, sessionId: string) => {
    return sessionManager.getUsage(sessionId);
  });

  ipcMain.handle(IPC.AGENT_SWITCH, (_event, sessionId: unknown, adapterId: unknown, transcript: unknown) => {
    if (typeof sessionId !== 'string' || typeof adapterId !== 'string') throw new Error('Bad agent switch request');
    return sessionManager.switchAgent(sessionId, adapterId, { transcript: transcript === true });
  });

  ipcMain.handle(IPC.AGENT_GET_CACHED_USAGE, (_event, adapterId: string) => {
    return typeof adapterId === 'string' ? loadUsageSnapshot(adapterId) : null;
  });

  ipcMain.handle(IPC.AGENT_SET_CONTROL, (_event, sessionId: string, controlId: string, value: string) => {
    return sessionManager.setControl(sessionId, controlId, value);
  });

  ipcMain.handle(IPC.AGENT_MCP_LIST, (_event, sessionId: string) => {
    return sessionManager.listMcpServers(sessionId);
  });

  ipcMain.handle(IPC.AGENT_MCP_CONTEXT_COST, (_event, sessionId: string) => {
    return sessionManager.getMcpContextCost(sessionId);
  });

  ipcMain.handle(IPC.AGENT_MCP_RECONNECT, (_event, sessionId: string, serverName: string) => {
    return sessionManager.reconnectMcpServer(sessionId, serverName);
  });

  ipcMain.handle(IPC.AGENT_MCP_TOGGLE, (_event, sessionId: string, serverName: string, enabled: boolean) => {
    return sessionManager.setMcpServerEnabled(sessionId, serverName, enabled);
  });

  ipcMain.handle(IPC.AGENT_MCP_RECONNECT_DOWN, (_event, sessionId: string, serverName?: string) => {
    return sessionManager.reconnectDownMcpServers(sessionId, serverName);
  });

  ipcMain.handle(IPC.AGENT_MCP_AUTHENTICATE, async (_event, sessionId: string, serverName: string) => {
    const result = await sessionManager.authenticateMcpServer(sessionId, serverName);
    if (result.authUrl) {
      if (!/^https?:\/\//i.test(result.authUrl)) {
        throw new Error('MCP sign-in returned a non-http auth URL');
      }
      await shell.openExternal(result.authUrl);
    }
    return result;
  });

  /** A thread's agent, running or not: the live one, else the one its
   *  manifest records, else the default for an id with no thread (yet).
   *  Undefined when the recorded agent is gone, so no other agent's files
   *  are read or written for it. */
  async function threadAgent(sessionId: string): Promise<AgentAdapter | undefined> {
    const live = sessionManager.getSessionAdapter(sessionId);
    if (live) return live;
    const recorded = sessionId ? await worktreeManager.getAdapterType(sessionId).catch(() => undefined) : undefined;
    return recorded ? adapterRegistry.get(recorded) : adapterRegistry.getDefault();
  }

  ipcMain.handle(IPC.SKILLS_LIST, async (_event, sessionId: string, fallbackPath: string) => {
    const adapter = await threadAgent(sessionId);
    const root = sessionManager.getWorktreePath(sessionId) ?? fallbackPath;
    if (!root || !adapter?.listSkills) return [];
    const skills = await adapter.listSkills(root);
    // A thread in its own worktree may have project skills a new thread
    // wouldn't (not committed, or only on its branch).
    const repoPath = sessionManager.getSession(sessionId)?.repoPath;
    return repoPath ? markWorktreeOnly(skills, root, repoPath) : skills;
  });

  ipcMain.handle(IPC.SKILLS_LIST_FOR_AGENT, async (_event, agentId: unknown, repoPath: unknown) => {
    if (typeof agentId !== 'string' || typeof repoPath !== 'string' || !repoPath) return [];
    // A gone agent lists nothing rather than the default agent's skills.
    const adapter = adapterRegistry.get(agentId);
    return adapter?.listSkills ? adapter.listSkills(repoPath) : [];
  });

  ipcMain.handle(IPC.SKILLS_ADD, async (_event, sessionId: string, fallbackPath: string, def: unknown) => {
    const adapter = await threadAgent(sessionId);
    if (!adapter) throw new Error("This thread's agent isn't available any more, so skills can't be added for it");
    if (!adapter.addSkill) {
      throw new Error(`${adapter.displayName} does not support adding skills`);
    }
    const root = sessionManager.getWorktreePath(sessionId) ?? fallbackPath;
    if (!root) throw new Error('No project root available for this thread');
    const d = def as Partial<SkillDefinition> | null;
    if (!d || typeof d.name !== 'string' || typeof d.description !== 'string' || typeof d.instructions !== 'string'
      || (d.scope !== 'project' && d.scope !== 'user')) throw new Error('No skill given');
    return adapter.addSkill(root, { name: d.name, description: d.description, instructions: d.instructions, scope: d.scope }, accountLinkDirs());
  });

  /** Where a thread's skills are edited: its project root and its agent's
   *  skill folders, which bound the files that can be read and written. */
  async function skillEditTarget(sessionId: string, fallbackPath: string, skillPath: unknown): Promise<{ root: string; dirs: SkillDirs; skillPath: string }> {
    if (typeof skillPath !== 'string' || !skillPath) throw new Error('No skill given');
    const dirs = (await threadAgent(sessionId))?.skillDirs;
    if (!dirs) throw new Error("This thread's agent has no skill files Grove can edit");
    const root = sessionManager.getWorktreePath(sessionId) ?? fallbackPath;
    if (!root) throw new Error('No project root available for this thread');
    return { root, dirs: { ...dirs, userLinks: accountLinkDirs() }, skillPath };
  }

  ipcMain.handle(IPC.SKILLS_READ, async (_event, sessionId: string, fallbackPath: string, skillPath: unknown) => {
    const { root, dirs, skillPath: file } = await skillEditTarget(sessionId, fallbackPath, skillPath);
    return readSkillFile(root, dirs, file);
  });

  ipcMain.handle(IPC.SKILLS_SAVE, async (_event, sessionId: string, fallbackPath: string, skillPath: unknown, expected: unknown, content: unknown) => {
    if (typeof expected !== 'string' || typeof content !== 'string') throw new Error('No skill text given');
    const { root, dirs, skillPath: file } = await skillEditTarget(sessionId, fallbackPath, skillPath);
    return saveSkillFile(root, dirs, file, expected, content);
  });

  ipcMain.handle(IPC.SKILLS_SET_REACH, async (_event, sessionId: string, fallbackPath: string, skillPath: unknown, reach: unknown) => {
    const r = reach as Partial<SkillReach> | null;
    if (!r || (r.agents !== 'claude' && r.agents !== 'all') || (r.projects !== 'project' && r.projects !== 'all')) throw new Error('No reach given');
    const { root, dirs, skillPath: file } = await skillEditTarget(sessionId, fallbackPath, skillPath);
    await setSkillReach(root, dirs, file, { agents: r.agents, projects: r.projects });
  });

  ipcMain.handle(IPC.SKILLS_SHOW_FOLDER, async (_event, sessionId: string, fallbackPath: string, skillPath: unknown) => {
    const { root, dirs, skillPath: file } = await skillEditTarget(sessionId, fallbackPath, skillPath);
    shell.showItemInFolder((await readSkillFile(root, dirs, file)).path);
  });

  ipcMain.handle(IPC.SKILLS_OPEN, async (_event, sessionId: string, fallbackPath: string, skillPath: unknown) => {
    const { root, dirs, skillPath: file } = await skillEditTarget(sessionId, fallbackPath, skillPath);
    const target = (await readSkillFile(root, dirs, file)).path;
    if (!(await openInEditor(target, undefined))) throw new Error('Could not open SKILL.md. Install the VS Code or Cursor CLI.');
  });

  /** Where Share and Link work for a thread: its project root, and Claude
   *  Code's folders — the thread's agent's when it needs links (a Claude
   *  account's user folder is its own), else the default's, as Share still
   *  helps other agents there. */
  async function sharingTarget(sessionId: string, fallbackPath: string): Promise<{ root: string; dirs: SkillDirs }> {
    const own = (await threadAgent(sessionId))?.skillDirs;
    const links = !!own && (!readsSharedSkills(own, 'project') || !readsSharedSkills(own, 'user'));
    const root = sessionManager.getWorktreePath(sessionId) ?? fallbackPath;
    if (!root) throw new Error('No project root available for this thread');
    return { root, dirs: { ...(links ? own : CLAUDE_SKILL_DIRS), userLinks: accountLinkDirs() } };
  }

  ipcMain.handle(IPC.SKILLS_SHARING, async (_event, sessionId: string, fallbackPath: string) => {
    const { root, dirs } = await sharingTarget(sessionId, fallbackPath);
    return skillSharing(root, dirs);
  });

  ipcMain.handle(IPC.SKILLS_LINK, async (_event, sessionId: string, fallbackPath: string) => {
    const { root, dirs } = await sharingTarget(sessionId, fallbackPath);
    return linkSkills(root, dirs);
  });

  ipcMain.handle(IPC.SKILLS_SUGGESTIONS_GET, (_event, repoPath: string) => {
    return skillSuggestions.getCachedSuggestions(repoPath);
  });

  ipcMain.handle(IPC.SKILLS_SUGGESTIONS_ANALYZE, (_event, repoPath: string) => {
    return sessionManager.analyzeSkillSuggestionsForRepo(repoPath);
  });

  ipcMain.handle(IPC.SKILLS_SUGGESTION_DISMISS, (_event, repoPath: string, suggestionId: string) => {
    skillSuggestions.dismissSuggestion(repoPath, suggestionId);
  });

  ipcMain.handle(IPC.AGENT_PERMISSION, (_event, sessionId: string, decision: PermissionDecision) => {
    return sessionManager.respondToPermission(sessionId, decision);
  });

  ipcMain.handle(IPC.AGENT_ELICITATION, (_event, sessionId: string, requestId: string, response: import('../shared/types.js').McpElicitationResponse) => {
    return sessionManager.respondToElicitation(sessionId, requestId, response);
  });

  ipcMain.handle(IPC.AGENT_LIMIT, (_event, sessionId: string, requestId: string, decision: unknown) => {
    if (decision !== 'continue' && decision !== 'stop') return false;
    return sessionManager.respondToLimit(sessionId, requestId, decision);
  });

  ipcMain.handle(IPC.LIMITS_DAILY_SPEND, () => todaySpend().usd);

  // The id names the thread's log file: a plain name only.
  ipcMain.handle(IPC.LIMITS_THREAD_USAGE, (_event, sessionId: unknown): Promise<ThreadUsage> | ThreadUsage =>
    isThreadId(sessionId) ? sessionManager.threadUsage(sessionId) : { spendUsd: 0, tokens: { input: 0, output: 0 } });

  ipcMain.handle(IPC.AGENT_HISTORY, (_event, sessionId: string) => {
    const prelaunch = prelaunchEvents.get(sessionId) ?? [];
    const history = sessionManager.getEventHistory(sessionId);
    // Prepend prelaunch events (worktree/install status) that aren't in the
    // session's own history — they were emitted before the session existed.
    return prelaunch.length > 0 ? [...prelaunch, ...history] : history;
  });

  ipcMain.handle(IPC.AGENT_HISTORY_PAGE, (_event, sessionId: string, limit: number, beforeIndex?: number): EventHistoryPage => {
    const prelaunch = prelaunchEvents.get(sessionId) ?? [];
    if (prelaunch.length === 0) return sessionManager.getEventHistoryPage(sessionId, limit, beforeIndex);
    // Page over the prelaunch-prefixed index space the renderer, search and
    // bookmarks use, beforeIndex included. Prelaunch events (worktree/install
    // status) only exist while setup runs, when the history is short.
    const all = prelaunchPrefixedEvents(sessionId);
    const end = beforeIndex !== undefined ? Math.min(beforeIndex, all.length) : all.length;
    const start = Math.max(0, end - limit);
    return { events: all.slice(start, end), totalCount: all.length, startIndex: start, turn: sessionManager.turnState(sessionId) };
  });

  ipcMain.handle(IPC.AGENT_HISTORY_COUNT, (_event, sessionId: string) => {
    const prelaunch = prelaunchEvents.get(sessionId) ?? [];
    return sessionManager.getEventHistoryCount(sessionId) + prelaunch.length;
  });

  // Over the whole history, in the index space the renderer pages over, so
  // a task or file can jump to its message like a search hit.
  ipcMain.handle(IPC.AGENT_THREAD_ITEMS, (_event, sessionId: unknown) =>
    typeof sessionId === 'string' ? threadItems(prelaunchPrefixedEvents(sessionId)) : EMPTY_THREAD_ITEMS);

  ipcMain.handle(IPC.AGENT_HISTORY_SEARCH, (_event, sessionId: string, query: string, limit?: number) => {
    // Search in the same prelaunch-prefixed index space the renderer pages over, so
    // returned eventIndex values line up with getEventHistoryPage's index space.
    sessionManager.beginSearch();
    return searchPrefixedHistory(sessionId, query, limit ?? 100);
  });

  ipcMain.handle(IPC.AGENT_HISTORY_SEARCH_ALL, async (_event, sessionIds: string[], query: string, limitPerSession?: number, maxHits?: number) => {
    // Cross-session search for the SessionFinder. Same prelaunch-prefixed index
    // space as AGENT_HISTORY_SEARCH, so hits feed the same jump path.
    const generation = ++searchAllGeneration;
    const endSweep = sessionManager.beginSearch({ sweep: true });
    try {
      const hits: import('../shared/types.js').CrossSessionSearchHit[] = [];
      const perSession = limitPerSession ?? 5;
      let sliceStart = performance.now();
      for (const id of sessionIds ?? []) {
        if (maxHits !== undefined && hits.length >= maxHits) break;
        try {
          for (const hit of searchPrefixedHistory(id, query, perSession)) {
            hits.push({ ...hit, sessionId: id });
          }
        } catch (e) {
          logger.warn(`[history-search-all] search failed for ${id}:`, e);
        }
        // The first search after launch parses every log it reaches. Yield now
        // and then so terminals and other IPC keep flowing, and give up once a
        // newer query has replaced this one (the renderer drops stale results).
        if (performance.now() - sliceStart > 16) {
          await new Promise((resolve) => setImmediate(resolve));
          if (generation !== searchAllGeneration) return [];
          sliceStart = performance.now();
        }
      }
      return maxHits !== undefined ? hits.slice(0, maxHits) : hits;
    } finally {
      endSweep();
    }
  });

  ipcMain.handle(IPC.SESSION_PREVIEWS, async (_event, sessionIds: string[]) => {
    const previews: Record<string, import('../shared/types.js').SessionPreview> = {};
    // A stopped conversation's preview parses its whole event log, and the
    // sidebar asks for all of them at startup. Yield now and then, as the
    // cross-conversation search does, so terminals and agent output keep flowing.
    let sliceStart = performance.now();
    for (const id of sessionIds ?? []) {
      try {
        previews[id] = extractSessionPreview(prelaunchPrefixedEvents(id));
      } catch (e) {
        logger.warn(`[session-previews] preview failed for ${id}:`, e);
      }
      if (performance.now() - sliceStart > 16) {
        await new Promise((resolve) => setImmediate(resolve));
        sliceStart = performance.now();
      }
    }
    return previews;
  });

  ipcMain.handle(IPC.FIND_EVENT_INDEX_BY_UUID, (_event, sessionId: string, uuid: string): number | null => {
    // Same index space as AGENT_HISTORY_SEARCH so the returned index feeds the
    // renderer's loadOlderUntil / findMessageIdForEventIndex jump path directly.
    const idx = findEventIndexByUuid(prelaunchPrefixedEvents(sessionId), uuid);
    return idx >= 0 ? idx : null;
  });

  ipcMain.handle(IPC.AGENT_CLEAR_HISTORY, (_event, sessionId: string) => {
    sessionManager.clearEventHistory(sessionId);
  });

  // ─── File operations (for @ file picker) ───

  ipcMain.handle(IPC.FILE_LIST, async (_event, sessionId: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const files = await listProjectFiles(worktree.path);

    // Extract unique directories from file paths
    const dirs = new Set<string>();
    for (const f of files) {
      const parts = f.split('/');
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join('/') + '/');
      }
    }

    // Return dirs first (sorted), then files
    const sortedDirs = [...dirs].sort();
    return [...sortedDirs, ...files];
  });

  ipcMain.handle(IPC.FILE_OPEN_IN_EDITOR, async (_event, sessionId: string, filePath: string, line?: number) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const resolved = path.resolve(worktree.path, filePath);
    const normalizedResolved = path.normalize(resolved);
    const normalizedWorktree = path.normalize(worktree.path) + path.sep;
    if (!normalizedResolved.startsWith(normalizedWorktree)) {
      throw new Error('Path traversal not allowed');
    }

    if (!(await openInEditor(resolved, line))) throw new Error('Could not open file. Install the VS Code or Cursor CLI.');
  });

  // ─── External links & process cleanup ───

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
    // Only allow http/https URLs for security
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Only http/https URLs are allowed');
    }
    await shell.openExternal(url);
  });

  // ─── Preview tab ───

  const PREVIEW_PAGES = new Set(['user', 'agent']);
  const PREVIEW_COMMANDS = new Set(['back', 'forward', 'reload', 'hardReload', 'stop', 'devtools']);
  const isPreviewPage = (page: unknown): page is PreviewPageKind => typeof page === 'string' && PREVIEW_PAGES.has(page);

  ipcMain.handle(IPC.PREVIEW_NAVIGATE, (_event, sessionId: string, page: unknown, url: unknown) => {
    if (!isPreviewPage(page) || typeof url !== 'string') throw new Error('Invalid preview request');
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error("This thread's worktree isn't ready yet.");
    previewManager.navigate(sessionId, worktree.path, page, url);
  });

  ipcMain.handle(IPC.PREVIEW_COMMAND, (_event, sessionId: string, page: unknown, command: unknown) => {
    if (!isPreviewPage(page) || typeof command !== 'string' || !PREVIEW_COMMANDS.has(command)) throw new Error('Invalid preview request');
    previewManager.command(sessionId, page, command as PreviewCommand);
  });

  ipcMain.on(IPC.PREVIEW_SET_VIEWPORT, (_event, sessionId: string, bounds: PreviewBounds | null) => {
    const valid = bounds === null || (bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every((n) => Number.isFinite(n)));
    if (typeof sessionId !== 'string' || !valid) return;
    previewManager.setViewport(sessionId, bounds);
  });

  ipcMain.handle(IPC.PREVIEW_SNAPSHOT, (_event, sessionId: string) => previewManager.snapshot(sessionId));

  ipcMain.handle(IPC.PREVIEW_AGENT_FRAME, (_event, sessionId: string, sinceVersion: number) =>
    previewManager.agentFrame(sessionId, Number(sinceVersion) || 0));

  ipcMain.handle(IPC.PREVIEW_GET_STATES, () => previewManager.getStates());

  ipcMain.handle(IPC.OPEN_SESSION_FOLDER, async (_event, sessionId: string) => {
    const session = sessionManager.getSession(sessionId);
    if (session) {
      await shell.openPath(session.worktreePath);
      return;
    }
    const wt = await worktreeManager.getWorktreeOrManifest(sessionId);
    if (wt) {
      await shell.openPath(wt.path);
      return;
    }
    throw new Error('Thread not found');
  });

  // ─── File revert & diff (for changes review panel) ───

  ipcMain.handle(IPC.FILE_REVERT, async (_event, sessionId: string, filePath: string, staged?: boolean, renamedFrom?: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const { relPath } = sanitizeWorktreeRelPath(worktree.path, filePath);
    const oldPath = typeof renamedFrom === 'string' && renamedFrom ? sanitizeWorktreeRelPath(worktree.path, renamedFrom).relPath : undefined;
    await revertFile(worktree.path, relPath, staged === true, oldPath);
  });

  ipcMain.handle(IPC.FILE_DIFF, async (_event, sessionId: string, filePath: string, staged?: boolean, opts?: { base?: string }): Promise<FileDiffResult> => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const { relPath, resolved } = sanitizeWorktreeRelPath(worktree.path, filePath);

    // Images get a before/after thumbnail view rather than a text diff.
    const imgExt = imageExtFor(relPath);
    if (imgExt) return { kind: 'image', ext: imgExt };

    // Branch scope: working tree vs the merge base with the base branch, so
    // commits the agent already made on the branch stay in the diff.
    // Otherwise staged diff = index vs HEAD; unstaged diff = working tree vs index.
    let diff: string | null = '';
    let diffError: Error | undefined;
    try {
      if (opts?.base) {
        const mb = await resolveMergeBase(worktree.path, opts.base);
        if (!mb) throw new Error(`no merge base with ${opts.base}`);
        diff = await fileDiffAgainst(worktree.path, relPath, mb.mergeBase);
      } else {
        diff = await fileDiff(worktree.path, relPath, { staged });
      }
    } catch (e) {
      diffError = e instanceof Error ? e : new Error(String(e));
    }
    if (diff === null) return patchOverLimit();
    if (detectBinaryDiff(diff)) return { kind: 'binary' };
    if (diff) return patchResult(diff);
    // A staged-but-empty diff genuinely has no changes; don't synthesize for it.
    if (staged && !diffError) return { kind: 'text', patch: '' };
    // An empty or failed diff means a new file only when git doesn't track
    // it. A tracked file with an empty diff has no changes (reverted since
    // the list was read), and a failed diff of one is a real error.
    if (await isTracked(worktree.path, relPath)) {
      if (diffError) throw diffError;
      return { kind: 'text', patch: '' };
    }
    try {
      const { size } = await fs.stat(resolved);
      if (size > MAX_TEXT_FILE_BYTES) return { kind: 'tooLarge', bytes: size };
      const buf = await fs.readFile(resolved);
      if (looksBinary(buf)) return { kind: 'binary' };
      // The '+' on every line can take the patch over the limit the file was under.
      return patchResult(synthesizeUntrackedDiff(relPath, buf.toString('utf-8')));
    } catch {
      return { kind: 'text', patch: '' };
    }
  });

  // Lines of the new side of a file, for expanding context around hunks.
  // Staged diffs compare against the index, so serve the index version there.
  ipcMain.handle(IPC.FILE_LINES, async (_event, sessionId: string, filePath: string, staged?: boolean): Promise<FileLinesResult> => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) return null;
    const { relPath, resolved } = sanitizeWorktreeRelPath(worktree.path, filePath);
    try {
      // The index's copy for a staged diff, under the same limits.
      if (staged) {
        const lines = await blobLines(worktree.path, '', relPath);
        return lines ? { lines } : null;
      }
      if ((await fs.stat(resolved)).size > MAX_TEXT_FILE_BYTES) return null;
      const lines = textLines(await fs.readFile(resolved));
      return lines ? { lines } : null;
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC.FILE_CONTENT_DATA_URL, async (_event, sessionId: string, filePath: string): Promise<ImageDiffContent> => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const { relPath, resolved } = sanitizeWorktreeRelPath(worktree.path, filePath);
    const mime = mimeForImageExt(imageExtFor(relPath) ?? '');

    let working: string | null = null;
    try {
      const buf = await fs.readFile(resolved);
      working = `data:${mime};base64,${buf.toString('base64')}`;
    } catch { /* file may have been deleted */ }

    let head: string | null = null;
    try {
      const posix = relPath.replace(/\\/g, '/');
      const { stdout } = await runProcess('git', ['show', `HEAD:${posix}`], { cwd: worktree.path, encoding: 'buffer' });
      head = `data:${mime};base64,${Buffer.from(stdout).toString('base64')}`;
    } catch { /* not present in HEAD (newly added) */ }

    return { working, head };
  });

  ipcMain.handle(IPC.FILE_STAGE, async (_event, sessionId: string, filePath: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const { relPath } = sanitizeWorktreeRelPath(worktree.path, filePath);
    await stageFile(worktree.path, relPath);
  });

  ipcMain.handle(IPC.FILE_UNSTAGE, async (_event, sessionId: string, filePath: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const { relPath } = sanitizeWorktreeRelPath(worktree.path, filePath);
    await unstageFile(worktree.path, relPath);
  });

  ipcMain.handle(IPC.GIT_COMMIT, async (_event, sessionId: string, message: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    await commit(worktree.path, message);
  });

  // A merge, rebase, cherry-pick or revert stopped part way (GitStatusResult.operation).
  for (const [channel, act] of [[IPC.GIT_OPERATION_CONTINUE, continueGitOperation], [IPC.GIT_OPERATION_ABORT, abortGitOperation]] as const) {
    ipcMain.handle(channel, async (_event, sessionId: string, kind: GitOperation['kind']) => {
      const worktree = worktreeManager.getWorktree(sessionId);
      if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
      // The agent may be the one running it, or editing the files it touches.
      if (sessionManager.isMidTurn(sessionId)) throw new Error('Wait for the agent to finish its turn.');
      await act(worktree.path, kind);
    });
  }

  ipcMain.handle(IPC.GIT_GENERATE_COMMIT_MESSAGE, async (_event, sessionId: string, substitute?: unknown) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    // The conversation's own agent, recorded in the manifest when it isn't
    // running, or the one the user picked when that agent is gone.
    const adapter = sessionManager.getSession(sessionId)?.adapter
      ?? await recordedAgent(sessionId, typeof substitute === 'string' ? substitute : undefined);
    return generateCommitMessage(worktree.path, adapter);
  });

  ipcMain.handle(IPC.GIT_PUSH, async (_event, sessionId: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    await push(worktree.path, worktree.branch);
  });

  // Polled to keep what's shown current: background work (background-work.ts).
  ipcMain.handle(IPC.GIT_SYNC_STATUS, (_event, sessionId: string) => inBackground(async () => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree || worktree.noGit) return { upstream: null, ahead: 0, behind: 0 };
    try {
      return await syncStatus(worktree.path);
    } catch (e) {
      // Skipped (the process host down): the renderer keeps the last one.
      if (isSkipped(e)) throw e;
      logger.warn(`git sync status failed for session ${sessionId}:`, e);
      return { upstream: null, ahead: 0, behind: 0 };
    }
  }));

  // ─── Branch operations ───
  // Each handler resolves the session's worktree and returns a GitOpResult;
  // git.ts guarantees a failed operation is aborted before it returns.

  ipcMain.handle(IPC.GIT_LOG_COMMITS, async (_event, sessionId: string, ref: string, base: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) return [];
    if (typeof ref !== 'string' || !ref || ref.startsWith('-')) return [];
    if (typeof base !== 'string' || !base || base.startsWith('-')) return [];
    try {
      return await logCommits(worktree.path, ref, base);
    } catch (e) {
      logger.warn(`log commits failed for session ${sessionId}:`, e);
      return [];
    }
  });

  ipcMain.handle(IPC.GIT_REBASE, async (_event, sessionId: string, onto: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    if (typeof onto !== 'string' || !onto.trim() || onto.startsWith('-')) return { success: false, error: 'Pick a branch to rebase onto.' };
    logger.info(`Rebasing session ${sessionId} (${worktree.branch}) onto ${onto}`);
    return rebaseOnto(worktree.path, onto.trim());
  });

  ipcMain.handle(IPC.GIT_CHERRY_PICK, async (_event, sessionId: string, sha: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    logger.info(`Cherry-picking ${sha} into session ${sessionId} (${worktree.branch})`);
    return cherryPick(worktree.path, typeof sha === 'string' ? sha.trim() : '');
  });

  ipcMain.handle(IPC.GIT_SQUASH, async (_event, sessionId: string, base: string, message: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    if (typeof base !== 'string' || !base.trim() || base.startsWith('-')) return { success: false, error: 'Pick a base branch.' };
    logger.info(`Squashing session ${sessionId} (${worktree.branch}) since ${base}`);
    return squashSince(worktree.path, base.trim(), typeof message === 'string' ? message : '');
  });

  ipcMain.handle(IPC.GIT_BRANCH_COMMITS, async (_event, sessionId: string, base: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) return [];
    try {
      return await branchCommits(worktree.path, base);
    } catch (e) {
      logger.warn(`branch commits failed for session ${sessionId}:`, e);
      return [];
    }
  });

  // ─── Checkpoint rewind ───

  ipcMain.handle(IPC.AGENT_REWIND, async (_event, sessionId: string, userMessageId: string, options?: import('../shared/types.js').RewindOptions) => {
    await sessionManager.rewindFiles(sessionId, userMessageId, options);
  });

  ipcMain.handle(IPC.AGENT_BRING_BACK_FILES, async (_event, sessionId: string, copy: string) => {
    await sessionManager.bringBackFiles(sessionId, copy);
  });

  ipcMain.handle(IPC.AGENT_CHECKPOINT_DIFF, async (_event, sessionId: string, userMessageId: string) => {
    return sessionManager.getCheckpointDiff(sessionId, userMessageId);
  });

  ipcMain.handle(IPC.AGENT_LIST_CHECKPOINTS, async (_event, sessionId: string) => {
    return sessionManager.listCheckpoints(sessionId);
  });

  ipcMain.handle(IPC.AGENT_DIFF_HISTORY, async (_event, sessionId: string) => {
    return sessionManager.getDiffHistory(sessionId);
  });

  ipcMain.handle(IPC.AGENT_CHECKPOINT_FILES, async (_event, sessionId: string, uuid: string, scope: CheckpointDiffScope) => {
    return sessionManager.getCheckpointFiles(sessionId, uuid, scope);
  });

  ipcMain.handle(IPC.AGENT_CHECKPOINT_FILE_DIFF, async (_event, sessionId: string, uuid: string, scope: CheckpointDiffScope, filePath: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const { relPath } = sanitizeWorktreeRelPath(worktree.path, filePath);
    return sessionManager.getCheckpointFileDiff(sessionId, uuid, scope, relPath);
  });

  ipcMain.handle(IPC.AGENT_CHECKPOINT_FILE_LINES, async (_event, sessionId: string, uuid: string, scope: CheckpointDiffScope, filePath: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) return null;
    const { relPath } = sanitizeWorktreeRelPath(worktree.path, filePath);
    return sessionManager.getCheckpointFileLines(sessionId, uuid, scope, relPath);
  });

  // ─── Git status ───

  // Polled to keep what's shown current: background work (background-work.ts).
  ipcMain.handle(IPC.GIT_STATUS, (_event, sessionId: string, opts?: GitStatusOptions) => inBackground(async (): Promise<GitStatusResult> => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree || worktree.noGit) return { entries: [] };
    const cwd = worktree.path;
    // A merge or rebase stopped part way: the Changes tab finishes or aborts it.
    const operation = Promise.resolve().then(() => gitOperation(cwd)).catch((e) => {
      logger.warn(`git operation check failed for session ${sessionId}:`, e);
      return null;
    });
    const withOperation = async (r: GitStatusResult): Promise<GitStatusResult> => {
      const op = await operation;
      return op ? { ...r, operation: op } : r;
    };

    try {
      let result: GitStatusResult;
      let numstatBase = 'HEAD';
      if (opts?.scope === 'branch') {
        const base = opts.base?.trim();
        const mb = base ? await resolveMergeBase(cwd, base) : null;
        if (!mb) {
          return withOperation({ entries: [], scopeError: base ? `No merge base with ${base}` : 'No base branch' });
        }
        numstatBase = mb.mergeBase;
        // Tracked changes (committed or not) since the merge base, plus untracked files.
        const tracked = parseNameStatus(await git(['diff', '--name-status', '-z', mb.mergeBase], cwd));
        const status = parseGitStatusPorcelain(await statusGit(cwd));
        const untracked = status.entries.filter(e => e.status === 'untracked');
        // The diff from the base lists a file in conflict as an ordinary change.
        const conflicted = status.entries.filter(e => e.status === 'conflicted');
        const conflictPaths = new Set(conflicted.map(e => e.filePath));
        result = {
          entries: [...conflicted, ...tracked.filter(e => !conflictPaths.has(e.filePath)), ...untracked],
          baseRef: mb.ref,
          uncommitted: status.entries.length,
        };
      } else {
        const raw = await statusGit(cwd);
        result = parseGitStatusPorcelain(raw);
      }
      if (result.entries.length === 0) return withOperation(result);
      await attachNumstat(cwd, result.entries, numstatBase);
      await attachContentHashes(cwd, result.entries);
      return withOperation(result);
    } catch (e) {
      // Skipped (the process host down): the renderer keeps the last status.
      if (isSkipped(e)) throw e;
      logger.warn(`git status failed for session ${sessionId}:`, e);
      return { entries: [], error: e instanceof Error ? e.message : String(e) };
    }
  }));

  // ─── PR info ───

  /** Head branches whose PRs belong to this session: the recorded branch,
   *  whatever is checked out now, and every branch switched to inside the
   *  checkout since the session started (the agent may open a PR from a
   *  second branch). The repo's default branch is left out — it is never a
   *  PR head for session work, and in direct mode it is checked out often.
   *  Capped so a long-lived direct session doesn't turn into a gh call per
   *  branch it ever visited. */
  const MAX_SESSION_PR_BRANCHES = 5;
  async function sessionPrBranches(worktree: WorktreeInfo): Promise<string[]> {
    const [current, recent, defaultBranch] = await Promise.all([
      currentBranch(worktree.path),
      recentCheckouts(worktree.path, worktree.createdAt),
      getDefaultBranch(worktree.repoPath).catch(() => null),
    ]);
    const ordered = [worktree.branch, current, ...recent].filter((b): b is string => !!b && b !== defaultBranch);
    return [...new Set(ordered)].slice(0, MAX_SESSION_PR_BRANCHES);
  }

  /** An unreachable or rate-limiting GitHub is routine (laptop offline, VPN,
   *  GitHub down, many open conversations) and the renderer already keeps its
   *  last snapshot and marks it stale, so it does not deserve a stack trace
   *  per session per sweep. Record it once per cooldown and rethrow a one-line
   *  error; the rejection is what tells the renderer the data is stale, so it
   *  cannot be swallowed. */
  let lastOfflineLog = 0;
  function rethrowGhFailure(e: unknown): never {
    const rateLimited = isRateLimitError(e);
    if (!rateLimited && !isNetworkError(e)) throw e;
    const now = Date.now();
    if (now - lastOfflineLog >= GH_OFFLINE_COOLDOWN_MS) {
      lastOfflineLog = now;
      logger.warn(rateLimited
        ? 'GitHub rate limit reached; PR status polling backs off and stays stale until it lifts'
        : 'GitHub is unreachable; PR status stays stale until it responds again');
    }
    throw new Error(rateLimited ? GH_RATE_LIMITED_MESSAGE : GH_OFFLINE_MESSAGE);
  }

  // Polled to keep what's shown current: background work (background-work.ts).
  ipcMain.handle(IPC.PR_LIST, (_event, sessionId: string) => inBackground(async () => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree || worktree.noGit) return [];
    // Own comments are excluded from the feedback signature so the agent
    // replying on the PR doesn't trigger (and then auto-answer) a "new
    // comments" event about itself.
    const selfLogin = await ghLogin();
    const branches = await sessionPrBranches(worktree);
    try {
      return await prsForBranches(worktree.repoPath, branches, selfLogin);
    } catch (e) {
      rethrowGhFailure(e);
    }
  }));

  ipcMain.handle(IPC.PR_LIST_OPEN, async (_event, repoPath: string): Promise<OpenPrSummary[]> => {
    if (typeof repoPath !== 'string' || !(await worktreeManager.validateRepo(repoPath))) return [];
    try {
      return await openPrs(repoPath);
    } catch (e) {
      rethrowGhFailure(e);
    }
  });

  ipcMain.handle(IPC.PR_REVIEW_COMMENTS, async (_event, sessionId: string, prNumber: number) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) return [];
    try {
      return await prReviewComments(worktree.repoPath, prNumber);
    } catch (e) {
      rethrowGhFailure(e);
    }
  });

  ipcMain.handle(IPC.PR_SUBMIT_REVIEW, async (_event, sessionId: string, review: unknown): Promise<PrReviewSubmitResult> => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree || worktree.noGit) throw new Error(`Worktree not found for session ${sessionId}`);
    return submitPrReview(worktree.path, worktree.repoPath, parsePrReviewSubmit(review));
  });

  ipcMain.handle(IPC.PR_CREATE, async (_event, sessionId: string, opts: PrCreateOpts) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    // The branch must exist on origin before gh can open a PR for it.
    await push(worktree.path, worktree.branch);
    return prCreate(worktree.repoPath, worktree.branch, opts);
  });

  // ─── Plugins ───

  /** The agent a Settings or status-bar call names, else the default agent
   *  (the Settings tabs configure that one). An id that isn't registered is
   *  refused rather than taken for the default, so another agent's
   *  configuration is never changed in its place. */
  function resolveAdapter(adapterType?: string, fallback = () => adapterRegistry.getDefault()) {
    if (!adapterType) return fallback();
    const adapter = adapterRegistry.get(adapterType);
    if (!adapter) throw new Error(`The agent "${adapterType}" isn't available`);
    return adapter;
  }

  /** Plugins configure the built-in agent (Claude Code's first account)
   *  whatever the default agent is: the Plugins section names no agent. */
  const builtInAgent = () => adapterRegistry.getBuiltInDefault();

  // ─── MCP server configuration ───

  ipcMain.handle(IPC.MCP_CONFIG_LIST, async (_event, cwd?: string, adapterType?: string) => {
    const adapter = resolveAdapter(adapterType);
    if (!adapter.listConfiguredMcpServers) return [];
    try {
      return await adapter.listConfiguredMcpServers(cwd);
    } catch (e) {
      logger.warn('Failed to list configured MCP servers:', e instanceof Error ? e.message : String(e));
      throw e;
    }
  });

  ipcMain.handle(IPC.MCP_CONFIG_ADD, async (_event, opts: import('../shared/types.js').McpAddServerOpts, adapterType?: string) => {
    const adapter = resolveAdapter(adapterType);
    if (!adapter.addConfiguredMcpServer) throw new Error(`Adapter "${adapter.id}" does not support MCP configuration`);
    await adapter.addConfiguredMcpServer(opts);
  });

  ipcMain.handle(IPC.MCP_CONFIG_REMOVE, async (_event, name: string, scope?: import('../shared/types.js').McpConfigScope, cwd?: string, adapterType?: string) => {
    const adapter = resolveAdapter(adapterType);
    if (!adapter.removeConfiguredMcpServer) throw new Error(`Adapter "${adapter.id}" does not support MCP configuration`);
    await adapter.removeConfiguredMcpServer(name, scope, cwd);
  });

  ipcMain.handle(IPC.MCP_CONFIG_APPROVE, async (_event, name: string, repoPath: string, adapterType?: string) => {
    const adapter = resolveAdapter(adapterType);
    if (!adapter.approveProjectMcpServer) throw new Error(`Adapter "${adapter.id}" does not support MCP server approval`);
    if (typeof repoPath !== 'string' || (await projectKind(repoPath)) === 'missing') {
      throw new Error(`The project folder ${repoPath} wasn't found.`);
    }
    const worktrees = await worktreeManager.list(repoPath);
    await adapter.approveProjectMcpServer(name, [repoPath, ...worktrees.map((w) => w.path)]);
  });

  ipcMain.handle(IPC.PLUGIN_LIST, async (_event, adapterType?: string) => {
    const adapter = resolveAdapter(adapterType, builtInAgent);
    if (!adapter.capabilities.plugins || !adapter.listPlugins) {
      return { installed: [], available: [] };
    }
    try {
      return await adapter.listPlugins();
    } catch (e) {
      logger.warn('Failed to list plugins:', e instanceof Error ? e.message : String(e));
      return { installed: [], available: [] };
    }
  });

  ipcMain.handle(IPC.PLUGIN_INSTALL, async (_event, pluginId: string, scope: string = 'user', adapterType?: string) => {
    const adapter = resolveAdapter(adapterType, builtInAgent);
    if (!adapter.installPlugin) throw new Error(`Adapter "${adapter.id}" does not support plugins`);
    await adapter.installPlugin(pluginId, scope);
  });

  ipcMain.handle(IPC.PLUGIN_UNINSTALL, async (_event, pluginId: string, adapterType?: string) => {
    const adapter = resolveAdapter(adapterType, builtInAgent);
    if (!adapter.uninstallPlugin) throw new Error(`Adapter "${adapter.id}" does not support plugins`);
    await adapter.uninstallPlugin(pluginId);
  });

  ipcMain.handle(IPC.PLUGIN_ENABLE, async (_event, pluginId: string, adapterType?: string) => {
    const adapter = resolveAdapter(adapterType, builtInAgent);
    if (!adapter.enablePlugin) throw new Error(`Adapter "${adapter.id}" does not support plugins`);
    await adapter.enablePlugin(pluginId);
  });

  ipcMain.handle(IPC.PLUGIN_DISABLE, async (_event, pluginId: string, adapterType?: string) => {
    const adapter = resolveAdapter(adapterType, builtInAgent);
    if (!adapter.disablePlugin) throw new Error(`Adapter "${adapter.id}" does not support plugins`);
    await adapter.disablePlugin(pluginId);
  });

  // ─── PTY Terminal (per-session persistent shell) ───

  ipcMain.handle(IPC.PTY_SPAWN, (event, sessionId: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) {
      // Worktree may not exist yet (still being created in background).
      // Return false so the renderer can retry later instead of showing an error.
      logger.debug(`[PTY_SPAWN] Worktree not ready for session ${sessionId}`);
      return false;
    }
    return terminalManager.spawnPty(sessionId, worktree.path, event.sender);
  });

  ipcMain.on(IPC.PTY_WRITE, (_event, sessionId: string, data: string) => {
    terminalManager.write(sessionId, data);
  });

  ipcMain.on(IPC.PTY_RESIZE, (_event, sessionId: string, cols: number, rows: number) => {
    terminalManager.resize(sessionId, cols, rows);
  });

  ipcMain.handle(IPC.PTY_KILL, (_event, sessionId: string) => {
    return terminalManager.killPty(sessionId);
  });

  ipcMain.handle(IPC.PTY_IS_ALIVE, (_event, sessionId: string) => {
    return terminalManager.isAlive(sessionId);
  });

  // ─── Agent Adapters ───

  // An agent's model list can change at run time (the Claude adapter reads
  // the SDK's list when a conversation starts). Tell every window so pickers
  // and the status bar refetch.
  function forwardModelChanges(adapter: AgentAdapter): void {
    adapter.onModelsChanged?.(() => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(IPC.AGENT_MODELS_CHANGED, adapter.id);
      }
    });
  }
  for (const adapter of adapterRegistry.list()) forwardModelChanges(adapter);

  // ─── Other Claude accounts (claude-accounts.ts) ───
  // Checked against the saved accounts here; the renderer saves the entry
  // add returns, as it does every other setting.

  ipcMain.handle(IPC.CLAUDE_ACCOUNT_PREVIEW, (_event, input: unknown): ClaudeAccountPreview => {
    try {
      const { account } = newClaudeAccount(accountInput(input), settings.getSettings().claudeAccounts);
      return { ok: true, configDir: account.configDir };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(IPC.CLAUDE_ACCOUNT_ADD, (_event, input: unknown): { setting: ClaudeAccountSetting; adapterId: string } => {
    const { account, setting } = newClaudeAccount(accountInput(input), settings.getSettings().claudeAccounts);
    forwardModelChanges(registerClaudeAccount(account));
    logger.info(`[claude-accounts] Added ${account.id} (${account.configDir})`);
    return { setting, adapterId: account.id };
  });

  // ─── ACP Registry and models.dev (catalogs.ts) ───

  ipcMain.handle(IPC.CATALOGS_REGISTRY, (): RegistryAgentSummary[] => {
    const builtIn = new Set(ACP_PRESETS.map((p) => p.registryId).filter(Boolean));
    return catalogs.registry().map((a) => ({
      id: a.id,
      name: a.name,
      version: a.version,
      ...(a.description ? { description: a.description } : {}),
      ...(a.website?.startsWith('https://') ? { website: a.website } : {}),
      install: installFor(a),
      launch: launchFor(a),
      builtIn: builtIn.has(a.id),
    }));
  });

  ipcMain.handle(IPC.CATALOGS_ICON, (_event, id: unknown) => {
    const agent = typeof id === 'string' ? catalogs.registryAgent(id) : null;
    // With online lookups off, only icons already on disk.
    return agent ? catalogs.icon(agent, { download: settings.getSettings().onlineCatalogs }) : null;
  });

  ipcMain.handle(IPC.CATALOGS_REFRESH, async () => {
    if (settings.getSettings().onlineCatalogs) await catalogs.refresh(true);
    return { fetchedAt: catalogs.registryFetchedAt() };
  });

  ipcMain.handle(IPC.AGENT_LIST_ADAPTERS, () => {
    // The built-in default: the user's pick (settings.defaultAgent) can change
    // after the list loads, so the renderer applies it itself.
    const defaultId = adapterRegistry.getBuiltInDefault().id;
    // Other Claude accounts go right after the Claude agent, also ones added
    // after launch, which the registry lists last.
    const all = adapterRegistry.list();
    const ordered = all.filter((a) => !isClaudeAccountId(a.id));
    ordered.splice(ordered.findIndex((a) => a.id === defaultId) + 1, 0, ...all.filter((a) => isClaudeAccountId(a.id)));
    // An account taken out of Settings stays registered for threads already
    // on it until a restart; it is marked so it isn't offered.
    const saved = new Set(claudeAccounts(settings.getSettings().claudeAccounts).map((a) => a.id));
    return ordered.map(a => ({
      id: a.id,
      displayName: a.displayName,
      // mcpConfig: the adapter can list and edit configured MCP servers (the
      // Settings MCP tab). Derived from the optional methods, which have no
      // capability flag of their own.
      capabilities: { ...a.capabilities, mcpConfig: !!a.listConfiguredMcpServers },
      isDefault: a.id === defaultId,
      ...(a.stage ? { stage: a.stage } : {}),
      ...(a.backgroundModel ? { backgroundModel: a.backgroundModel } : {}),
      ...(a.mcp ? { mcp: a.mcp } : {}),
      ...(a.generatedFiles?.length ? { generatedFiles: [...a.generatedFiles] } : {}),
      ...(a.account ? { account: { name: a.account.name, configDir: a.account.configDir, ...(saved.has(a.id) ? {} : { removed: true }) } } : {}),
    }));
  });

  ipcMain.handle(IPC.AGENT_GET_ADAPTER_CONTROLS, (_event, adapterType?: string, model?: string | null) => {
    const adapter = adapterType
      ? adapterRegistry.get(adapterType)
      : adapterRegistry.getDefault();
    if (!adapter) return [];
    // No default model set: new conversations start on the adapter's first
    // model (see AgentSessionManager), so describe that model's controls.
    const resolved = typeof model === 'string' && model ? model : adapter.getModels()[0]?.id ?? null;
    return adapter.getControls(resolved);
  });

  ipcMain.handle(IPC.AGENT_GET_MODELS, (_event, adapterType?: string) => {
    const adapter = adapterType
      ? adapterRegistry.get(adapterType)
      : adapterRegistry.getDefault();
    if (!adapter) return [];
    return adapter.getModels();
  });

  // ─── Memory ───

  ipcMain.handle(IPC.MEMORY_LIST, (_event, repoPath: string) => {
    return memory.listMemoryFiles(repoPath);
  });

  ipcMain.handle(IPC.MEMORY_READ, (_event, repoPath: string, relativePath: string) => {
    return memory.readMemoryFile(repoPath, relativePath);
  });

  ipcMain.handle(IPC.MEMORY_WRITE, (_event, repoPath: string, relativePath: string, content: string) => {
    memory.writeMemoryFile(repoPath, relativePath, content);
  });

  ipcMain.handle(IPC.MEMORY_DELETE, (_event, repoPath: string, relativePath: string) => {
    return memory.deleteMemoryFile(repoPath, relativePath);
  });

  ipcMain.handle(IPC.MEMORY_COMPACT, async (_event, repoPath: string) => {
    // Manual compaction belongs to no one conversation: run it on the agent the
    // project was most recently used with.
    const adapter = await agentForProject(repoPath);
    return memoryCompact.compactMemory({ repoPath, adapterType: adapter.id });
  });

  ipcMain.handle(IPC.MEMORY_COMPACT_CANCEL, (_event, repoPath: string) => {
    return memoryCompact.cancelCompaction(repoPath);
  });

  // Broadcast compaction progress (manual and auto passes) so the renderer can
  // show status-bar/toast feedback without keeping the memory panel open.
  memoryCompact.onCompactionEvent((evt) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.MEMORY_COMPACT_EVENT, evt);
    }
  });

  ipcMain.handle(IPC.MEMORY_LIST_BACKUPS, (_event, repoPath: string) => {
    return memoryCompact.listBackups(repoPath);
  });

  ipcMain.handle(IPC.MEMORY_RESTORE_BACKUP, (_event, repoPath: string, backupId: string) => {
    return memoryCompact.restoreBackup(repoPath, backupId);
  });

  ipcMain.handle(IPC.MEMORY_STATS, (_event, repoPath: string) => {
    return { ...memory.getMemoryStats(repoPath), ...memoryCompact.getCompactionInfo(repoPath) };
  });

  ipcMain.handle(IPC.MEMORY_BACKUP_PREVIEW, (_event, repoPath: string, backupId: string) => {
    return memoryCompact.previewBackup(repoPath, backupId);
  });

  ipcMain.handle(IPC.MEMORY_BACKUP_READ_FILE, (_event, repoPath: string, backupId: string, relativePath: string) => {
    return memoryCompact.readBackupFile(repoPath, backupId, relativePath);
  });

  // ─── Bookmarks ───

  ipcMain.handle(IPC.BOOKMARKS_LIST, () => {
    return bookmarks.getBookmarks();
  });

  ipcMain.handle(IPC.BOOKMARK_ADD, (_event, bookmark: Omit<import('../shared/types.js').Bookmark, 'id' | 'createdAt'>) => {
    return bookmarks.addBookmark(bookmark);
  });

  ipcMain.handle(IPC.BOOKMARK_REMOVE, (_event, id: string) => {
    bookmarks.removeBookmark(id);
  });

  ipcMain.handle(IPC.BOOKMARK_UPDATE, (_event, id: string, patch: Partial<Pick<import('../shared/types.js').Bookmark, 'note' | 'eventIndex'>>) => {
    bookmarks.updateBookmark(id, patch);
  });

  // ─── Settings ───

  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return settings.getSettings();
  });

  ipcMain.handle(IPC.SETTINGS_SAVE, (event, data: import('../shared/types.js').GroveBenchSettings) => {
    settings.saveSettings(data);
    const win = BrowserWindow.fromWebContents(event.sender);
    // The saved copy, which saveSettings has checked, so only a valid theme
    // reaches nativeTheme.themeSource
    const saved = settings.getSettings();
    settings.applyImmediateEffects(win, saved);
    applyUpdateSettings(saved);
  });

  // ─── App State ───

  // Loads read the state in memory, which has every change, saved or not,
  // so the renderer always gets the latest (closed tabs don't reopen after a
  // Vite hot reload) without a write here.
  ipcMain.handle(IPC.APP_STATE_GET_OPEN_TABS, () => loadOpenTabs());

  ipcMain.on(IPC.APP_STATE_SET_OPEN_TABS, (_event, ids: string[]) => {
    saveOpenTabs(ids);
  });

  ipcMain.handle(IPC.APP_STATE_GET_COLLAPSED_REPOS, () => loadCollapsedRepos());

  ipcMain.on(IPC.APP_STATE_SET_COLLAPSED_REPOS, (_event, map: Record<string, boolean>) => {
    saveCollapsedRepos(map);
  });

  ipcMain.handle(IPC.APP_STATE_GET_SESSION_SORT, () => loadSessionSort());

  ipcMain.on(IPC.APP_STATE_SET_SESSION_SORT, (_event, sort: import('../shared/types.js').SessionSortState) => {
    saveSessionSort(sort);
  });

  ipcMain.handle(IPC.APP_STATE_GET_SIDEBAR_WIDTH, () => loadSidebarWidth());

  ipcMain.on(IPC.APP_STATE_SET_SIDEBAR_WIDTH, (_event, width: number) => {
    if (typeof width === 'number' && Number.isFinite(width)) {
      saveSidebarWidth(Math.round(width));
    }
  });

  ipcMain.handle(IPC.APP_STATE_GET_COLLAPSED_PANELS, () => loadCollapsedPanels());

  ipcMain.on(IPC.APP_STATE_SET_COLLAPSED_PANELS, (_event, panels: unknown) => {
    saveCollapsedPanels(panels);
  });

  ipcMain.handle(IPC.APP_STATE_GET_GROUPS, () => loadConversationGroups());

  ipcMain.on(IPC.APP_STATE_SET_GROUPS, (_event, groups: unknown) => {
    saveConversationGroups(groups);
  });

  ipcMain.handle(IPC.APP_STATE_GET_UNREAD, () => loadUnreadSessionIds());

  ipcMain.on(IPC.APP_STATE_SET_UNREAD, (_event, ids: unknown) => {
    if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) {
      saveUnreadSessionIds(ids);
    }
  });

  ipcMain.handle(IPC.APP_STATE_GET_TODO, () => loadTodoSessionIds());

  ipcMain.on(IPC.APP_STATE_SET_TODO, (_event, ids: unknown) => {
    saveTodoSessionIds(ids);
  });

  // ─── Skill schedules ───

  ipcMain.handle(IPC.SKILL_SCHEDULES_LIST, () => listSchedules());
  ipcMain.handle(IPC.SKILL_SCHEDULES_SAVE, (_event, schedule: unknown) => saveSchedule(schedule));
  ipcMain.handle(IPC.SKILL_SCHEDULES_DELETE, (_event, id: unknown) => {
    if (typeof id === 'string') deleteSchedule(id);
  });
  ipcMain.handle(IPC.SKILL_SCHEDULES_RECORD_RUN, (_event, id: unknown, outcome: unknown) =>
    typeof id === 'string' ? recordScheduleRun(id, outcome) : null);

  // ─── Error reporting ───

  ipcMain.on(IPC.APP_REPORT_ERROR, (_event, report: import('../shared/types.js').AppErrorReport) => {
    if (!report || typeof report.message !== 'string') return;
    logRendererError({
      source: 'renderer',
      kind: typeof report.kind === 'string' ? report.kind : 'error',
      message: report.message.slice(0, 2000),
      ...(typeof report.stack === 'string' ? { stack: report.stack.slice(0, 8000) } : {}),
      ...(typeof report.sessionId === 'string' ? { sessionId: report.sessionId } : {}),
      timestamp: typeof report.timestamp === 'number' ? report.timestamp : Date.now(),
    });
  });

  ipcMain.on(IPC.APP_REPORT_FREEZE, (_event, report: unknown) => {
    freezeLog.logWindowFreeze(report);
  });

  ipcMain.on(IPC.APP_REPORT_TIMING, (_event, report: unknown) => {
    logWindowTiming(report);
  });

  // The idle sleep loop's view (renderer lib/idle-manager.ts): why a thread
  // was or wasn't asked to sleep, beside main's own `[sleep]` lines. One line
  // each, so a newline can't forge another entry.
  ipcMain.on(IPC.APP_LOG_IDLE, (_event, line: unknown) => {
    if (typeof line !== 'string' || !line) return;
    logger.debug(`[idle] ${line.slice(0, IDLE_LOG_MAX_CHARS).replace(/[\r\n]+/g, ' ')}`);
  });

  ipcMain.handle(IPC.PERF_RECORD_TRACE, () => recordTrace());

  ipcMain.handle(IPC.PERF_SHOW_FILE, async (_event, which: unknown) => {
    // Paths come from here, never from the renderer.
    const file = which === 'trace' ? lastTracePath() : which === 'log' ? perfLogPath() : null;
    if (!file) return;
    try {
      await fs.access(file);
      shell.showItemInFolder(file);
    } catch {
      // Not written yet: open the folder it will be in.
      await shell.openPath(path.dirname(file));
    }
  });

  // ─── OS notifications ───

  ipcMain.on(IPC.NOTIFY_SHOW, (event, req: import('../shared/types.js').OsNotificationRequest) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    showOsNotification(win, req, settings.getSettings());
  });

  ipcMain.handle(IPC.NOTIFY_TEST, () => showTestNotification());

  // ─── Taskbar attention badge ───

  ipcMain.on(IPC.WIN_SET_ATTENTION_BADGE, (event, count: unknown, dataUrl: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const n = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    applyAttentionBadge(win, n, typeof dataUrl === 'string' ? dataUrl : null);
  });

  // ─── Spell check ───

  ipcMain.on(IPC.SPELLCHECK_REPLACE, (event, suggestion: unknown) => {
    replaceMisspelling(event.sender, suggestion);
  });

  ipcMain.on(IPC.SPELLCHECK_ADD_WORD, (event) => {
    addWordToDictionary(event.sender);
  });

  // ─── Window controls ───

  ipcMain.on(IPC.WIN_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(IPC.WIN_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.isMaximized() ? win.unmaximize() : win.maximize();
    }
  });

  ipcMain.on(IPC.WIN_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(IPC.WIN_IS_MAXIMIZED, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle(IPC.FILE_READ, async (_event, sessionId: string, filePath: string) => {
    const worktree = worktreeManager.getWorktree(sessionId);
    if (!worktree) throw new Error(`Worktree not found for session ${sessionId}`);
    const resolved = path.resolve(worktree.path, filePath.replace(/\/$/, ''));
    // Security: ensure resolved path is within the worktree
    if (!path.normalize(resolved).startsWith(path.normalize(worktree.path) + path.sep)) {
      throw new Error('Path traversal not allowed');
    }
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      // Return a listing of the files under this directory
      const prefix = path.relative(worktree.path, resolved).replace(/\\/g, '/');
      const entries = (await listProjectFiles(worktree.path))
        .filter(f => f.startsWith(prefix ? prefix + '/' : ''));
      return entries.join('\n');
    }
    // Cap at 100KB, reading no more than that.
    const maxBytes = 100 * 1024;
    const handle = await fs.open(resolved, 'r');
    try {
      const buf = Buffer.alloc(Math.min(stat.size, maxBytes));
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      const text = buf.subarray(0, bytesRead).toString('utf-8');
      return stat.size > maxBytes ? text + '\n... (truncated at 100KB)' : text;
    } finally {
      await handle.close();
    }
  });

  // ─── Auto-updater ───

  ipcMain.handle(IPC.UPDATE_GET_STATE, () => getUpdateState());
  ipcMain.handle(IPC.UPDATE_CHECK, () => checkForUpdate());
  ipcMain.handle(IPC.UPDATE_DOWNLOAD, () => downloadUpdate());
  ipcMain.handle(IPC.UPDATE_RESTART, () => restartToUpdate());
}

/** The name and folder sent from the Add account dialog. */
function accountInput(input: unknown): { name: unknown; configDir: unknown } {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return { name: o.name, configDir: o.configDir };
}
