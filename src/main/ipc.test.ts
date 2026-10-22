/**
 * IPC handler tests. registerHandlers() runs once against the recording
 * ipcMain from the electron mock; each test calls a channel's handler with
 * the arguments the preload sends. Everything the handlers call out to is
 * mocked except pure helpers (event search, auto-naming, git status parsing,
 * prompt text) and the file system, which is a temp directory.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, type Mock } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const m = vi.hoisted(() => {
  const fns = <T extends string>(...names: T[]) =>
    Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<T, Mock<(...args: any[]) => any>>;
  return {
    sessionManager: fns(
      'getSessionsByRepo', 'createSession', 'getSession', 'reattachWindow', 'trackPendingSetup', 'hasPendingSetup', 'interruptQuery',
      'closeSession', 'sleepSession', 'wakeSession', 'stopTask', 'destroySession', 'listSessions', 'renameSession',
      'setBranch', 'isMidTurn', 'turnState', 'getEventHistory', 'getEventHistoryPage', 'getEventHistoryCount', 'searchEventHistory',
      'beginSearch', 'clearEventHistory', 'sendMessage', 'setMode', 'setModel', 'getControls', 'getUsage', 'setControl',
      'listMcpServers', 'getMcpContextCost', 'reconnectMcpServer', 'setMcpServerEnabled', 'authenticateMcpServer', 'reconnectDownMcpServers',
      'getSessionAdapter', 'getWorktreePath', 'analyzeSkillSuggestionsForRepo', 'respondToPermission',
      'respondToElicitation', 'rewindFiles', 'getCheckpointDiff', 'listCheckpoints', 'getDiffHistory',
      'getCheckpointFiles', 'getCheckpointFileDiff', 'getCheckpointFileLines', 'threadUsage',
    ),
    worktreeManager: fns(
      'validateRepo', 'cleanupOrphans', 'getWorktreeOrManifest', 'registerDirect', 'create', 'getRepoConfig',
      'copyUntrackedFiles', 'getNpmCachePath', 'getProviderSessionId', 'getModel', 'getAdapterType', 'getThreadLimits', 'remove',
      'saveDisplayName', 'getDisplayNameState', 'saveAutoDisplayName', 'renameBranch', 'switchBranch',
      'syncBranch', 'list', 'register', 'listRepos', 'getWorktree', 'assertRemovable', 'checkoutSharers',
      'getGoal', 'getGoals', 'saveGoal', 'setGoalHidden',
    ),
    terminalManager: fns('killAllForSession', 'spawnPty', 'write', 'resize', 'killPty', 'isAlive'),
    previewManager: fns('close', 'closeAgentPage', 'navigate', 'command', 'setViewport', 'snapshot', 'agentFrame', 'getStates'),
    adapterRegistry: fns('get', 'getDefault', 'getBuiltInDefault', 'list'),
    registerClaudeAccount: vi.fn((account: { id: string }) => ({ id: account.id })),
    settings: fns('getSettings', 'saveSettings', 'applyImmediateEffects'),
    appState: fns(
      'listProjects', 'rememberProject', 'forgetProject', 'saveCollapsedPanels', 'loadConversationGroups', 'saveConversationGroups',
      'loadOpenTabs', 'saveOpenTabs', 'loadCollapsedRepos', 'saveCollapsedRepos', 'loadSessionSort', 'saveSessionSort',
      'loadSidebarWidth', 'saveSidebarWidth', 'loadCollapsedPanels', 'saveUnreadSessionIds',
      'loadUnreadSessionIds', 'loadTodoSessionIds', 'saveTodoSessionIds', 'flushPendingSaves', 'loadPrerequisiteCache', 'savePrerequisiteCache',
    ),
    prerequisites: fns('apiKeyState', 'checkCorePrerequisites', 'checkGh'),
    credentials: fns('canStoreApiKey', 'clearApiKey', 'parseApiKey', 'saveApiKey'),
    bookmarks: fns('getBookmarks', 'addBookmark', 'removeBookmark', 'updateBookmark', 'removeBookmarksForSession'),
    memoryCompact: fns('compactMemory', 'cancelCompaction', 'onCompactionEvent', 'listBackups', 'restoreBackup', 'getCompactionInfo', 'previewBackup', 'readBackupFile'),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    projectPath: fns('inspectProjectFolder', 'projectKind'),
  };
});

vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('./agent-session.js', () => ({ sessionManager: m.sessionManager }));
vi.mock('./worktree-manager.js', () => ({ worktreeManager: m.worktreeManager }));
vi.mock('./terminal.js', () => ({ terminalManager: m.terminalManager }));
vi.mock('./preview.js', () => ({ previewManager: m.previewManager }));
vi.mock('./adapters/index.js', () => ({ adapterRegistry: m.adapterRegistry, registerClaudeAccount: m.registerClaudeAccount }));
vi.mock('./settings.js', () => m.settings);
vi.mock('./app-state.js', () => m.appState);
vi.mock('./project-path.js', () => m.projectPath);
vi.mock('./prerequisites.js', () => m.prerequisites);
vi.mock('./credentials.js', () => m.credentials);
vi.mock('./bookmarks.js', () => m.bookmarks);
vi.mock('./memory-compact.js', () => m.memoryCompact);
vi.mock('./logger.js', () => ({ logger: m.logger }));
vi.mock('./memory.js', () => ({
  listMemoryFiles: vi.fn(), readMemoryFile: vi.fn(), writeMemoryFile: vi.fn(), deleteMemoryFile: vi.fn(), getMemoryStats: vi.fn(),
}));
vi.mock('./skill-suggestions.js', () => ({ getCachedSuggestions: vi.fn(), dismissSuggestion: vi.fn() }));
vi.mock('./background-tasks.js', () => ({ agentForProject: vi.fn(), recordedAgent: vi.fn(), backgroundModelFor: vi.fn() }));
vi.mock('./editor-launch.js', () => ({ launchEditor: vi.fn() }));
vi.mock('./deps-install.js', () => ({ installDependencies: vi.fn() }));
vi.mock('./commit-message.js', () => ({ generateCommitMessage: vi.fn() }));
vi.mock('./notifications.js', () => ({ showOsNotification: vi.fn() }));
vi.mock('./auto-updater.js', () => ({ applyUpdateSettings: vi.fn(), checkForUpdate: vi.fn(), downloadUpdate: vi.fn(), getUpdateState: vi.fn(), restartToUpdate: vi.fn() }));
vi.mock('./attention-badge.js', () => ({ applyAttentionBadge: vi.fn() }));
vi.mock('./spellcheck.js', () => ({ replaceMisspelling: vi.fn(), addWordToDictionary: vi.fn() }));
vi.mock('./crash-handling.js', () => ({ logRendererError: vi.fn() }));
vi.mock('./git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./git.js')>();
  const runsGit = [
    'git', 'validateBranchName', 'branchExists', 'branchExistsAnywhere', 'listBranches', 'getDefaultBranch', 'fileDiff',
    'fileDiffAgainst', 'resolveMergeBase', 'indexFileContent', 'hashWorkingFiles', 'listProjectFiles', 'revertFile',
    'stageFile', 'unstageFile', 'commit', 'push', 'syncStatus', 'branchCommits', 'logCommits', 'rebaseOnto', 'cherryPick',
    'squashSince', 'currentBranch', 'recentCheckouts', 'worktreeBranches', 'isTracked',
  ];
  return { ...actual, ...Object.fromEntries(runsGit.map((n) => [n, vi.fn()])) };
});
vi.mock('./gh.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gh.js')>()),
  prsForBranches: vi.fn(), prCreate: vi.fn(), prReviewComments: vi.fn(), ghLogin: vi.fn(), openPrs: vi.fn(),
}));
vi.mock('./branch-name.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./branch-name.js')>()),
  generateBranchName: vi.fn(),
}));
vi.mock('./session-goal.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./session-goal.js')>()),
  generateGoal: vi.fn(),
}));

import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import { execa } from 'execa';
import { IPC } from '../shared/types.js';
import type { AgentEvent } from '../shared/types.js';
import * as git from './git.js';
import * as gh from './gh.js';
import { generateBranchName } from './branch-name.js';
import { generateGoal } from './session-goal.js';
import { launchEditor } from './editor-launch.js';
import { installDependencies } from './deps-install.js';
import { logRendererError } from './crash-handling.js';
import { applyAttentionBadge } from './attention-badge.js';
import { recordedAgent } from './background-tasks.js';
import { generateCommitMessage } from './commit-message.js';
import { registerHandlers, IDLE_LOG_MAX_CHARS } from './ipc.js';

// ─── Harness ───

type Handler = (event: unknown, ...args: any[]) => any;
const handlers = new Map<string, Handler>();

const win = { isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } };
const sender = { isDestroyed: vi.fn(() => false), send: vi.fn() };

function invoke(channel: string, ...args: unknown[]): any {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({ sender }, ...args);
}

const flush = () => new Promise((r) => setImmediate(r));

/** The setup SESSION_CREATE/SESSION_RESUME handed to trackPendingSetup. */
function lastSetup() {
  const [id, promise, abort] = m.sessionManager.trackPendingSetup.mock.calls.at(-1)!;
  return { id: id as string, promise: promise as Promise<unknown>, abort: abort as AbortController | undefined };
}

/** Events a new conversation's tab was sent. */
function tabEvents(id: string): AgentEvent[] {
  return win.webContents.send.mock.calls
    .filter(([channel]) => channel === `${IPC.AGENT_EVENT}:${id}`)
    .map(([, evt]) => evt);
}

let tmp: string;
/** Worktree of conversation 's1'. */
let wt: string;
const wtInfo = () => ({ id: 's1', path: wt, branch: 'feat', repoPath: '/repo', createdAt: 0 });

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-ipc-'));
  wt = path.join(tmp, 'wt');
  fs.mkdirSync(wt);
  Object.assign(BrowserWindow, { fromWebContents: vi.fn(), getAllWindows: vi.fn() });
  Object.assign(shell, { openPath: vi.fn() });
  m.adapterRegistry.list.mockReturnValue([]);
  registerHandlers();
  for (const [channel, handler] of [...vi.mocked(ipcMain.handle).mock.calls, ...vi.mocked(ipcMain.on).mock.calls]) {
    handlers.set(channel as string, handler as Handler);
  }
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset, not clear: a return value set by one test must not leak into the next.
  vi.resetAllMocks();
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(win as never);
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win] as never);
  vi.mocked(shell.openPath).mockResolvedValue('');
  vi.mocked(shell.openExternal).mockResolvedValue(undefined);

  m.settings.getSettings.mockReturnValue({ autoInstallDeps: false, branchNamingRule: '' });
  m.adapterRegistry.getDefault.mockReturnValue({ id: 'claude-code' });
  m.sessionManager.getEventHistory.mockReturnValue([]);
  m.sessionManager.getSession.mockReturnValue(undefined);
  m.sessionManager.isMidTurn.mockReturnValue(false);
  m.sessionManager.beginSearch.mockReturnValue(vi.fn());
  m.projectPath.projectKind.mockResolvedValue('git');
  m.sessionManager.createSession.mockImplementation(async (o: { id: string; branch: string }) => ({ id: o.id, branch: o.branch, agentType: 'claude' }));

  m.worktreeManager.getWorktree.mockImplementation((id: string) => (id === 's1' ? wtInfo() : undefined));
  m.worktreeManager.create.mockImplementation(async (c: { id: string; branchName: string }) => ({
    id: c.id, path: wt, branch: c.branchName, repoPath: '/repo', createdAt: 0,
  }));
  m.worktreeManager.getRepoConfig.mockResolvedValue({ copyFiles: [] });
  m.worktreeManager.getNpmCachePath.mockResolvedValue('/cache');

  vi.mocked(git.validateBranchName).mockResolvedValue(true);
  vi.mocked(git.branchExists).mockResolvedValue(false);
  vi.mocked(git.branchExistsAnywhere).mockResolvedValue(true);
  vi.mocked(git.getDefaultBranch).mockResolvedValue('main');
});

// ─── Repos ───

describe('repos', () => {
  it('REPO_SELECT returns a picked git repo after clearing its orphan worktrees', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/repo'] });
    m.projectPath.inspectProjectFolder.mockResolvedValue({ kind: 'git', path: '/repo' });
    m.worktreeManager.cleanupOrphans.mockResolvedValue(2);

    expect(await invoke(IPC.REPO_SELECT)).toEqual({ kind: 'git', path: '/repo' });
    expect(m.worktreeManager.cleanupOrphans).toHaveBeenCalledWith('/repo');
    expect(m.appState.rememberProject).toHaveBeenCalledWith('/repo');
  });

  it('REPO_SELECT returns null for a cancelled pick, and adds a plain folder without git work', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await invoke(IPC.REPO_SELECT)).toBeNull();

    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/notes'] });
    m.projectPath.inspectProjectFolder.mockResolvedValue({ kind: 'folder', path: '/notes' });
    expect(await invoke(IPC.REPO_SELECT)).toEqual({ kind: 'folder', path: '/notes' });
    expect(m.worktreeManager.cleanupOrphans).not.toHaveBeenCalled();
  });

  it('REPO_REMOVE refuses while the project has live conversations', async () => {
    m.sessionManager.getSessionsByRepo.mockReturnValue([{ id: 's1' }]);
    await expect(invoke(IPC.REPO_REMOVE, '/repo')).rejects.toThrow('active threads');
    expect(m.worktreeManager.cleanupOrphans).not.toHaveBeenCalled();
  });
});

// ─── Creating a conversation ───

describe('AGENT_LIST_ADAPTERS', () => {
  it('lists other Claude accounts after the Claude agent, and marks ones taken out of Settings', async () => {
    const claude = { id: 'claude-code', displayName: 'Claude Agent', capabilities: {} };
    const gemini = { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} };
    const account = (slug: string) => ({ id: `claude-account-${slug}`, displayName: slug, capabilities: {}, account: { name: slug, configDir: `/h/.claude-${slug}` } });
    // Added after launch: the registry lists it last.
    m.adapterRegistry.list.mockReturnValue([claude, account('work'), gemini, account('client'), account('old')]);
    m.adapterRegistry.getBuiltInDefault.mockReturnValue(claude);
    m.settings.getSettings.mockReturnValueOnce({ claudeAccounts: [{ id: 'work', name: 'work', configDir: '' }, { id: 'client', name: 'client', configDir: '' }] });
    const list = await invoke(IPC.AGENT_LIST_ADAPTERS);
    expect(list.map((a: { id: string; account?: { removed?: boolean } }) => [a.id, !!a.account?.removed]))
      .toEqual([['claude-code', false], ['claude-account-work', false], ['claude-account-client', false], ['claude-account-old', true], ['gemini-cli', false]]);
    expect(list[1].account).toEqual({ name: 'work', configDir: '/h/.claude-work' });
  });

  it('marks an alpha agent, and only that one', async () => {
    const claude = { id: 'claude-code', displayName: 'Claude Agent', capabilities: {} };
    const opencode = { id: 'opencode', displayName: 'OpenCode', capabilities: {}, stage: 'alpha' };
    m.adapterRegistry.list.mockReturnValue([claude, opencode]);
    m.adapterRegistry.getBuiltInDefault.mockReturnValue(claude);
    const list = await invoke(IPC.AGENT_LIST_ADAPTERS);
    expect(list.map((a: { id: string; stage?: string; isDefault: boolean }) => [a.id, a.stage ?? null, a.isDefault]))
      .toEqual([['claude-code', null, true], ['opencode', 'alpha', false]]);
  });

  it("marks the built-in default even when the user picked another, which the renderer applies itself", async () => {
    const claude = { id: 'claude-code', displayName: 'Claude Agent', capabilities: {} };
    const gemini = { id: 'gemini-cli', displayName: 'Gemini CLI', capabilities: {} };
    m.adapterRegistry.list.mockReturnValue([claude, gemini]);
    m.adapterRegistry.getBuiltInDefault.mockReturnValue(claude);
    m.adapterRegistry.getDefault.mockReturnValue(gemini);
    const list = await invoke(IPC.AGENT_LIST_ADAPTERS);
    expect(list.map((a: { id: string; isDefault: boolean }) => [a.id, a.isDefault]))
      .toEqual([['claude-code', true], ['gemini-cli', false]]);
  });
});

describe('SESSION_CREATE', () => {
  const create = (opts: Record<string, unknown> = {}) =>
    invoke(IPC.SESSION_CREATE, { repoPath: '/repo', branchName: '', ...opts });

  it('refuses an invalid or taken branch name before any setup starts', async () => {
    vi.mocked(git.validateBranchName).mockResolvedValueOnce(false);
    await expect(create({ branchName: 'bad..name' })).rejects.toThrow('Invalid branch name');

    vi.mocked(git.branchExists).mockResolvedValueOnce(true);
    await expect(create({ branchName: 'feat' })).rejects.toThrow('already exists');

    vi.mocked(git.branchExistsAnywhere).mockResolvedValueOnce(false);
    await expect(create({ branchName: 'gone', useExisting: true })).rejects.toThrow('does not exist');

    expect(m.worktreeManager.create).not.toHaveBeenCalled();
    // Each was tracked as setting up only while its checks ran: all settled,
    // so a close or delete waiting on one goes on.
    expect(m.sessionManager.trackPendingSetup).toHaveBeenCalledTimes(3);
    await Promise.all(m.sessionManager.trackPendingSetup.mock.calls.map(([, promise]) => promise));
  });

  it('makes nothing for a thread deleted while its checks run', async () => {
    let checked!: (exists: boolean) => void;
    vi.mocked(git.branchExists).mockReturnValueOnce(new Promise((r) => { checked = r; }));
    const created = create({ id: 'abc12345', branchName: 'feat' });
    await vi.waitFor(() => expect(m.sessionManager.trackPendingSetup).toHaveBeenCalled());
    const checks = lastSetup();
    expect(checks.id).toBe('abc12345');
    // What deleting the thread does (sessionManager.destroySession).
    checks.abort!.abort();
    checked(false);
    await expect(created).rejects.toThrow();
    await checks.promise;
    expect(m.worktreeManager.create).not.toHaveBeenCalled();

    // A direct thread stops before it is registered.
    let headRead!: (out: string) => void;
    vi.mocked(git.git).mockReturnValueOnce(new Promise((r) => { headRead = r; }));
    const direct = create({ id: 'def67890', direct: true });
    await vi.waitFor(() => expect(lastSetup().id).toBe('def67890'));
    lastSetup().abort!.abort();
    headRead('main\n');
    await expect(direct).rejects.toThrow();
    expect(m.worktreeManager.registerDirect).not.toHaveBeenCalled();
  });

  it('names the picked agent for a worktree conversation before its setup finishes', async () => {
    const result = await create({ adapterType: 'gemini-cli' });
    expect(result.agentType).toBe('gemini-cli');
    await lastSetup().promise;
    expect(m.sessionManager.createSession).toHaveBeenCalledWith(expect.objectContaining({ adapterType: 'gemini-cli' }));
  });

  describe('joining a group on its branch (continueBranch)', () => {
    it('continues the branch when the project has it and nothing has it checked out', async () => {
      vi.mocked(git.branchExistsAnywhere).mockResolvedValue(true);
      vi.mocked(git.worktreeBranches).mockResolvedValueOnce(new Map([['main', '/repo']]));
      const result = await create({ branchName: 'feat/billing', continueBranch: true });
      await lastSetup().promise;

      expect(result.branch).toBe('feat/billing');
      expect(git.branchExists).not.toHaveBeenCalled();
      expect(m.worktreeManager.create).toHaveBeenCalledWith(expect.objectContaining({ branchName: 'feat/billing', useExisting: true }));
    });

    it('refuses a branch another checkout has, before any setup starts', async () => {
      vi.mocked(git.branchExistsAnywhere).mockResolvedValue(true);
      vi.mocked(git.worktreeBranches).mockResolvedValueOnce(new Map([['feat/billing', '/repo']]));
      await expect(create({ branchName: 'feat/billing', continueBranch: true }))
        .rejects.toThrow('Branch "feat/billing" is already checked out at /repo');
      expect(m.worktreeManager.create).not.toHaveBeenCalled();
    });

    it('creates the branch when the project doesn\'t have it', async () => {
      vi.mocked(git.branchExistsAnywhere).mockResolvedValueOnce(false);
      await create({ branchName: 'feat/billing', continueBranch: true });
      await lastSetup().promise;
      expect(m.worktreeManager.create).toHaveBeenCalledWith(expect.objectContaining({ branchName: 'feat/billing', useExisting: false }));
    });

    it('still refuses an existing name without it', async () => {
      vi.mocked(git.branchExists).mockResolvedValueOnce(true);
      await expect(create({ branchName: 'feat/billing' })).rejects.toThrow('already exists');
    });
  });

  it('returns at once and sets up in the background: worktree, copied files, agent', async () => {
    m.worktreeManager.getRepoConfig.mockResolvedValue({ copyFiles: ['.env'] });

    const result = await create({
      permissionMode: 'not-a-mode', model: '', controls: { effort: 'high', permissionMode: 'x', count: 3 },
    });
    // No name given: a placeholder branch, renamed after the first turn.
    // No agent given: the default one, named so the renderer files it there.
    expect(result).toEqual({ id: expect.stringMatching(/^[0-9a-f]{8}$/), branch: `grove/${result.id}`, agentType: 'claude-code' });

    const setup = lastSetup();
    expect(setup.id).toBe(result.id);
    expect(setup.abort).toBeInstanceOf(AbortController);
    await setup.promise;

    expect(m.worktreeManager.create).toHaveBeenCalledWith(expect.objectContaining({
      repoPath: '/repo', branchName: `grove/${result.id}`, id: result.id,
    }));
    expect(m.worktreeManager.copyUntrackedFiles).toHaveBeenCalledWith(result.id, ['.env']);
    // Unknown modes, empty models and non-string controls are dropped.
    expect(m.sessionManager.createSession).toHaveBeenCalledWith(expect.objectContaining({
      id: result.id, cwd: wt, repoPath: '/repo', window: win,
      permissionMode: undefined, model: undefined, controls: { effort: 'high' },
    }));
    expect(tabEvents(result.id).map((e) => (e as { message?: string }).message)).toEqual([
      'Creating worktree…', 'Starting agent…',
    ]);
  });

  it('installs dependencies only when enabled and the project has a package.json', async () => {
    m.settings.getSettings.mockReturnValue({ autoInstallDeps: true });
    await create();
    await lastSetup().promise;
    expect(installDependencies).not.toHaveBeenCalled();

    const withPkg = fs.mkdtempSync(path.join(tmp, 'pkg-'));
    fs.writeFileSync(path.join(withPkg, 'package.json'), '{}');
    m.worktreeManager.create.mockImplementation(async (c: { id: string; branchName: string }) => ({
      id: c.id, path: withPkg, branch: c.branchName, repoPath: '/repo', createdAt: 0,
    }));
    const { id } = await create();
    const setup = lastSetup();
    await setup.promise;

    expect(installDependencies).toHaveBeenCalledWith(withPkg, '/cache', setup.abort!.signal);
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.SESSION_STATUS, id, 'installing');
  });

  it('reports a failed install and still starts the agent', async () => {
    m.settings.getSettings.mockReturnValue({ autoInstallDeps: true });
    const withPkg = fs.mkdtempSync(path.join(tmp, 'pkg-'));
    fs.writeFileSync(path.join(withPkg, 'package.json'), '{}');
    m.worktreeManager.create.mockImplementation(async (c: { id: string; branchName: string }) => ({
      id: c.id, path: withPkg, branch: c.branchName, repoPath: '/repo', createdAt: 0,
    }));
    vi.mocked(installDependencies).mockRejectedValue(Object.assign(new Error('failed'), { stderr: 'npm ERR! 404' }));

    const { id } = await create();
    await lastSetup().promise;

    expect(tabEvents(id)).toContainEqual({ type: 'error', message: 'npm install failed:\nnpm ERR! 404' });
    expect(m.sessionManager.createSession).toHaveBeenCalled();
  });

  it("skips the install quietly when npm isn't installed, and still starts the agent", async () => {
    m.settings.getSettings.mockReturnValue({ autoInstallDeps: true });
    const withPkg = fs.mkdtempSync(path.join(tmp, 'pkg-'));
    fs.writeFileSync(path.join(withPkg, 'package.json'), '{}');
    m.worktreeManager.create.mockImplementation(async (c: { id: string; branchName: string }) => ({
      id: c.id, path: withPkg, branch: c.branchName, repoPath: '/repo', createdAt: 0,
    }));
    // As installDependencies rejects on Windows too, where cmd.exe said npm
    // "is not recognized" (deps-install.test.ts).
    vi.mocked(installDependencies).mockRejectedValue(Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT', syscall: 'spawn npm' }));

    const { id } = await create();
    await lastSetup().promise;

    expect(tabEvents(id).some((e) => e.type === 'error')).toBe(false);
    expect(m.sessionManager.createSession).toHaveBeenCalled();
  });

  it('tells the tab when setup fails', async () => {
    m.worktreeManager.create.mockRejectedValue(new Error('worktree add failed'));

    const { id } = await create();
    await lastSetup().promise;

    expect(tabEvents(id)).toContainEqual({ type: 'error', message: 'worktree add failed' });
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.SESSION_STATUS, id, 'error');
    expect(m.sessionManager.createSession).not.toHaveBeenCalled();
  });

  it('stops quietly when the conversation is deleted during setup', async () => {
    m.settings.getSettings.mockReturnValue({ autoInstallDeps: true });
    const withPkg = fs.mkdtempSync(path.join(tmp, 'pkg-'));
    fs.writeFileSync(path.join(withPkg, 'package.json'), '{}');
    m.worktreeManager.create.mockImplementation(async (c: { id: string; branchName: string }) => ({
      id: c.id, path: withPkg, branch: c.branchName, repoPath: '/repo', createdAt: 0,
    }));
    // An install that runs until it is aborted.
    vi.mocked(installDependencies).mockImplementation((_cwd, _cache, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }));

    const { id } = await create();
    const setup = lastSetup();
    await vi.waitFor(() => expect(installDependencies).toHaveBeenCalled());
    setup.abort!.abort();
    await setup.promise;

    expect(m.sessionManager.createSession).not.toHaveBeenCalled();
    expect(tabEvents(id).some((e) => e.type === 'error')).toBe(false);
    expect(win.webContents.send).not.toHaveBeenCalledWith(IPC.SESSION_STATUS, id, 'error');
  });

  it('direct mode runs on the checkout\'s current branch', async () => {
    vi.mocked(git.git).mockResolvedValue('main\n');
    m.worktreeManager.registerDirect.mockResolvedValue({ id: 'd1', branch: 'main', path: '/repo' });

    expect(await create({ direct: true })).toEqual({ id: 'd1', branch: 'main', agentType: 'claude' });
    expect(m.worktreeManager.registerDirect).toHaveBeenCalledWith('/repo', 'main', { noGit: false, id: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(m.sessionManager.createSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1', cwd: '/repo' }));
  });

  it('sets up under the id the renderer picked, which its row already has', async () => {
    const result = await create({ id: 'abc12345' });
    expect(result).toMatchObject({ id: 'abc12345', branch: 'grove/abc12345' });
    await lastSetup().promise;
    expect(m.worktreeManager.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'abc12345' }));

    vi.mocked(git.git).mockResolvedValue('main\n');
    m.worktreeManager.registerDirect.mockImplementation(async (_repo: string, branch: string, o: { id: string }) => ({ id: o.id, branch, path: '/repo' }));
    expect(await create({ id: 'def67890', direct: true })).toMatchObject({ id: 'def67890' });
  });

  it('refuses a malformed id, or one in use, before any setup starts', async () => {
    // The id names the worktree folder and the event log.
    await expect(create({ id: '../../x' })).rejects.toThrow('not valid');
    // Being set up already: refused before it is tracked again.
    m.sessionManager.hasPendingSetup.mockReturnValueOnce(true);
    await expect(create({ id: 'abc12345', direct: true })).rejects.toThrow('already in use');
    expect(m.sessionManager.trackPendingSetup).not.toHaveBeenCalled();
    // A stopped thread's id, found in the manifest.
    m.worktreeManager.getWorktreeOrManifest.mockResolvedValueOnce(wtInfo());
    await expect(create({ id: 'abc12345' })).rejects.toThrow('already in use');
    await lastSetup().promise;

    expect(m.worktreeManager.create).not.toHaveBeenCalled();
    expect(m.worktreeManager.registerDirect).not.toHaveBeenCalled();
  });
});

// ─── Resume, close, destroy ───

describe('conversation lifecycle', () => {
  it('SESSION_RESUME reattaches a live conversation instead of starting another agent', async () => {
    m.sessionManager.getSession.mockReturnValue({ id: 's1', branch: 'feat', status: 'running' });

    expect(await invoke(IPC.SESSION_RESUME, 's1', '/repo')).toEqual({ id: 's1', branch: 'feat' });
    expect(m.sessionManager.reattachWindow).toHaveBeenCalledWith('s1', win);
    expect(m.sessionManager.createSession).not.toHaveBeenCalled();
  });

  it('SESSION_RESUME starts a new agent for a held conversation whose agent ended', async () => {
    for (const status of ['stopped', 'error']) {
      vi.clearAllMocks();
      m.sessionManager.getSession.mockReturnValue({ id: 's1', branch: 'feat', status });
      m.sessionManager.closeSession.mockResolvedValue(undefined);
      m.sessionManager.createSession.mockResolvedValue({ id: 's1', branch: 'feat', agentType: 'claude-code' });
      m.worktreeManager.getWorktreeOrManifest.mockResolvedValue(wtInfo());
      m.worktreeManager.getProviderSessionId.mockResolvedValue('prov-1');

      await invoke(IPC.SESSION_RESUME, 's1', '/repo');

      expect(m.sessionManager.reattachWindow).not.toHaveBeenCalled();
      expect(m.sessionManager.closeSession).toHaveBeenCalledWith('s1');
      expect(m.sessionManager.createSession).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', resumeSessionId: 'prov-1' }));
      expect(m.sessionManager.closeSession.mock.invocationCallOrder[0]).toBeLessThan(m.sessionManager.createSession.mock.invocationCallOrder[0]);
    }
  });

  it('SESSION_RESUME restarts on the saved provider session, model and agent', async () => {
    m.worktreeManager.getWorktreeOrManifest.mockResolvedValue(wtInfo());
    m.worktreeManager.getProviderSessionId.mockResolvedValue('prov-1');
    m.worktreeManager.getModel.mockResolvedValue('opus');
    m.worktreeManager.getAdapterType.mockResolvedValue('codex');
    m.worktreeManager.getThreadLimits.mockResolvedValue({ spendUsd: 2.5, allowanceUsd: 5 });

    const result = invoke(IPC.SESSION_RESUME, 's1', '/repo');
    // Prompts sent while it starts wait on the same promise.
    expect(lastSetup()).toMatchObject({ id: 's1', promise: result });
    await result;

    expect(m.sessionManager.createSession).toHaveBeenCalledWith(expect.objectContaining({
      id: 's1', cwd: wt, resumeSessionId: 'prov-1', model: 'opus', adapterType: 'codex', savedLimits: { spendUsd: 2.5, allowanceUsd: 5 },
    }));
  });

  it('SESSION_RESUME fails when the worktree is gone', async () => {
    m.worktreeManager.getWorktreeOrManifest.mockResolvedValue(undefined);
    await expect(invoke(IPC.SESSION_RESUME, 'gone', '/repo')).rejects.toThrow('Worktree gone not found');
  });

  it('SESSION_CLOSE stops the preview, terminal and agent', async () => {
    await invoke(IPC.SESSION_CLOSE, 's1');
    expect(m.previewManager.close).toHaveBeenCalledWith('s1');
    expect(m.terminalManager.killAllForSession).toHaveBeenCalledWith('s1');
    expect(m.sessionManager.closeSession).toHaveBeenCalledWith('s1');
    expect(m.worktreeManager.remove).not.toHaveBeenCalled();
  });

  it('SESSION_SLEEP closes Claude\'s preview page once the agent is asleep', async () => {
    m.sessionManager.sleepSession.mockResolvedValue(true);
    await expect(invoke(IPC.SESSION_SLEEP, 's1')).resolves.toBe(true);
    expect(m.previewManager.closeAgentPage).toHaveBeenCalledWith('s1');
    // The rest of the preview stays, like the terminal.
    expect(m.previewManager.close).not.toHaveBeenCalled();
    expect(m.terminalManager.killAllForSession).not.toHaveBeenCalled();
  });

  it('SESSION_SLEEP leaves the preview alone when the agent stays awake', async () => {
    m.sessionManager.sleepSession.mockResolvedValue(false);
    await expect(invoke(IPC.SESSION_SLEEP, 's1')).resolves.toBe(false);
    expect(m.previewManager.closeAgentPage).not.toHaveBeenCalled();
  });

  it('SESSION_DESTROY stops nothing when other conversations share the worktree', async () => {
    m.worktreeManager.assertRemovable.mockRejectedValue(new Error('Another thread is still working in this worktree.'));

    await expect(invoke(IPC.SESSION_DESTROY, 's1', true)).rejects.toThrow('Another thread');

    expect(m.previewManager.close).not.toHaveBeenCalled();
    expect(m.terminalManager.killAllForSession).not.toHaveBeenCalled();
    expect(m.sessionManager.destroySession).not.toHaveBeenCalled();
    expect(m.worktreeManager.remove).not.toHaveBeenCalled();
  });

  it('SESSION_DESTROY stops everything before removing the worktree, then drops bookmarks', async () => {
    await invoke(IPC.SESSION_DESTROY, 's1', true);

    const order = (fn: Mock) => fn.mock.invocationCallOrder[0];
    expect(m.worktreeManager.remove).toHaveBeenCalledWith('s1', true);
    expect(order(m.terminalManager.killAllForSession)).toBeLessThan(order(m.sessionManager.destroySession));
    expect(order(m.sessionManager.destroySession)).toBeLessThan(order(m.worktreeManager.remove));
    expect(order(m.worktreeManager.remove)).toBeLessThan(order(m.bookmarks.removeBookmarksForSession));
  });
});

// ─── Naming ───

describe('SESSION_AUTO_NAME', () => {
  it('keeps a name the user set', async () => {
    m.worktreeManager.getDisplayNameState.mockResolvedValue({ displayName: 'Mine', source: 'user' });
    expect(await invoke(IPC.SESSION_AUTO_NAME, 's1')).toBeNull();
    expect(m.worktreeManager.saveAutoDisplayName).not.toHaveBeenCalled();
  });

  it('names a live conversation from the provider\'s title', async () => {
    m.worktreeManager.getDisplayNameState.mockResolvedValue({ displayName: null, source: 'auto' });
    m.worktreeManager.saveAutoDisplayName.mockResolvedValue(true);
    const getConversationTitle = vi.fn().mockResolvedValue('Fix the login redirect');
    m.sessionManager.getSession.mockReturnValue({
      id: 's1', adapter: { getConversationTitle }, providerSessionId: 'prov-1', worktreePath: wt,
    });

    expect(await invoke(IPC.SESSION_AUTO_NAME, 's1')).toBe('Fix the login redirect');
    expect(getConversationTitle).toHaveBeenCalledWith('prov-1', wt);
    expect(m.sessionManager.renameSession).toHaveBeenCalledWith('s1', 'Fix the login redirect');
  });
});

describe('BRANCH_AUTO_NAME', () => {
  /** A live conversation still on its placeholder branch. Each test uses its
   *  own id: attempt counts are kept per conversation for the app's life. */
  function liveOnPlaceholder(id: string) {
    const live = { id, branch: `grove/${id}`, repoPath: '/repo', worktreePath: wt, adapter: {} };
    m.sessionManager.getSession.mockReturnValue(live);
    m.sessionManager.getEventHistory.mockReturnValue([{ type: 'user_message', text: 'Add a dark mode toggle' }]);
    m.worktreeManager.getDisplayNameState.mockResolvedValue({ displayName: 'Dark mode', source: 'auto' });
    m.worktreeManager.renameBranch.mockImplementation(async (_id: string, name: string) => name);
    return live;
  }

  it('renames the placeholder from the first prompt', async () => {
    const live = liveOnPlaceholder('a0000001');
    vi.mocked(generateBranchName).mockResolvedValue('feat/dark-mode');

    expect(await invoke(IPC.BRANCH_AUTO_NAME, 'a0000001')).toBe('feat/dark-mode');
    expect(generateBranchName).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'Add a dark mode toggle', title: 'Dark mode', cwd: wt }), live.adapter,
    );
    expect(m.sessionManager.setBranch).toHaveBeenCalledWith('a0000001', 'feat/dark-mode');
  });

  it('leaves alone a branch that is not the placeholder, and waits out a running turn', async () => {
    liveOnPlaceholder('a0000002');
    m.sessionManager.getSession.mockReturnValue({ id: 'a0000002', branch: 'main' });
    expect(await invoke(IPC.BRANCH_AUTO_NAME, 'a0000002')).toBeNull();

    liveOnPlaceholder('a0000003');
    m.sessionManager.isMidTurn.mockReturnValue(true);
    expect(await invoke(IPC.BRANCH_AUTO_NAME, 'a0000003')).toBeNull();
    expect(generateBranchName).not.toHaveBeenCalled();
  });

  it('keeps a name generated while a turn started, without using up an attempt', async () => {
    liveOnPlaceholder('a0000004');
    vi.mocked(generateBranchName).mockResolvedValue('feat/dark-mode');
    // Idle when asked, mid-turn by the time the name comes back.
    m.sessionManager.isMidTurn.mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(await invoke(IPC.BRANCH_AUTO_NAME, 'a0000004')).toBeNull();
    expect(m.worktreeManager.renameBranch).not.toHaveBeenCalled();

    expect(await invoke(IPC.BRANCH_AUTO_NAME, 'a0000004')).toBe('feat/dark-mode');
    expect(generateBranchName).toHaveBeenCalledTimes(1);
  });

  it('gives up after two failed attempts', async () => {
    liveOnPlaceholder('a0000005');
    vi.mocked(generateBranchName).mockRejectedValue(new Error('model busy'));
    await invoke(IPC.BRANCH_AUTO_NAME, 'a0000005');
    await invoke(IPC.BRANCH_AUTO_NAME, 'a0000005');
    expect(await invoke(IPC.BRANCH_AUTO_NAME, 'a0000005')).toBeNull();
    expect(generateBranchName).toHaveBeenCalledTimes(2);
  });

  it('gives up at once when the branch was already pushed', async () => {
    liveOnPlaceholder('a0000006');
    vi.mocked(generateBranchName).mockResolvedValue('feat/x');
    m.worktreeManager.renameBranch.mockRejectedValue(new Error('Branch was already pushed to a remote'));
    await invoke(IPC.BRANCH_AUTO_NAME, 'a0000006');
    expect(await invoke(IPC.BRANCH_AUTO_NAME, 'a0000006')).toBeNull();
    expect(generateBranchName).toHaveBeenCalledTimes(1);
  });
});

describe('conversation goal', () => {
  const NO_GOAL = { text: null, source: null, hidden: false };

  /** A live conversation that has had one reply. Each test uses its own id:
   *  attempt counts are kept per conversation for the app's life. */
  function liveWithReply(id: string) {
    const live = { id, worktreePath: wt, adapter: { id: 'claude' } };
    m.sessionManager.getSession.mockReturnValue(live);
    m.sessionManager.getEventHistory.mockReturnValue([
      { type: 'user_message', text: 'Add a dark mode toggle' },
      { type: 'assistant_text', text: 'Added it to settings.', uuid: 'a1' },
    ]);
    m.settings.getSettings.mockReturnValue({ showConversationGoal: true });
    m.worktreeManager.getGoal.mockResolvedValue(NO_GOAL);
    m.worktreeManager.saveGoal.mockImplementation(async (_id: string, text: string, source: string) => ({ text, source, hidden: false }));
    return live;
  }

  it('writes the first goal from the messages and the reply', async () => {
    const live = liveWithReply('g0000001');
    vi.mocked(generateGoal).mockResolvedValue('Add a dark mode toggle');

    expect(await invoke(IPC.SESSION_GOAL_AUTO, 'g0000001')).toEqual({ text: 'Add a dark mode toggle', source: 'auto', hidden: false });
    expect(generateGoal).toHaveBeenCalledWith(
      { prompts: ['Add a dark mode toggle'], skipped: 0, reply: 'Added it to settings.' }, live.adapter, wt,
    );
    // Saved only if nothing changed while it was generated.
    expect(m.worktreeManager.saveGoal).toHaveBeenCalledWith('g0000001', 'Add a dark mode toggle', 'auto', NO_GOAL);
  });

  it('reads several goals at once, ignoring anything that is not an id', async () => {
    const goals = { g0000010: { text: 'Fix sort', source: 'auto', hidden: false } };
    m.worktreeManager.getGoals.mockResolvedValue(goals);
    expect(await invoke(IPC.SESSION_GOALS_GET, ['g0000010', 7, null])).toEqual(goals);
    expect(m.worktreeManager.getGoals).toHaveBeenCalledWith(['g0000010']);
    expect(await invoke(IPC.SESSION_GOALS_GET, 'g0000010')).toEqual({});
  });

  it('writes a goal only once, never over one already made or typed', async () => {
    liveWithReply('g0000002');
    m.worktreeManager.getGoal.mockResolvedValue({ text: null, source: 'user', hidden: false });
    expect(await invoke(IPC.SESSION_GOAL_AUTO, 'g0000002')).toBeNull();
    // Nor for a conversation whose bar was closed.
    m.worktreeManager.getGoal.mockResolvedValue({ text: null, source: null, hidden: true });
    expect(await invoke(IPC.SESSION_GOAL_AUTO, 'g0000002')).toBeNull();
    expect(generateGoal).not.toHaveBeenCalled();
  });

  it('writes nothing when goals are off or there is no reply yet', async () => {
    liveWithReply('g0000003');
    m.settings.getSettings.mockReturnValue({ showConversationGoal: false });
    expect(await invoke(IPC.SESSION_GOAL_AUTO, 'g0000003')).toBeNull();

    liveWithReply('g0000004');
    m.sessionManager.getEventHistory.mockReturnValue([{ type: 'user_message', text: 'Add a dark mode toggle' }]);
    expect(await invoke(IPC.SESSION_GOAL_AUTO, 'g0000004')).toBeNull();
    expect(generateGoal).not.toHaveBeenCalled();
  });

  it('gives up after two failed attempts, and at once for an agent that cannot write text', async () => {
    liveWithReply('g0000005');
    vi.mocked(generateGoal).mockRejectedValue(new Error('model busy'));
    await invoke(IPC.SESSION_GOAL_AUTO, 'g0000005');
    await invoke(IPC.SESSION_GOAL_AUTO, 'g0000005');
    expect(await invoke(IPC.SESSION_GOAL_AUTO, 'g0000005')).toBeNull();
    expect(generateGoal).toHaveBeenCalledTimes(2);

    vi.mocked(generateGoal).mockClear();
    liveWithReply('g0000006');
    vi.mocked(generateGoal).mockRejectedValue(new Error('The Test agent does not support text generation'));
    await invoke(IPC.SESSION_GOAL_AUTO, 'g0000006');
    expect(await invoke(IPC.SESSION_GOAL_AUTO, 'g0000006')).toBeNull();
    expect(generateGoal).toHaveBeenCalledTimes(1);
  });

  it('makes one call when two arrive together', async () => {
    liveWithReply('g0000009');
    let finish!: (goal: string) => void;
    vi.mocked(generateGoal).mockReturnValue(new Promise((r) => { finish = r; }));

    const first = invoke(IPC.SESSION_GOAL_AUTO, 'g0000009');
    const second = invoke(IPC.SESSION_GOAL_AUTO, 'g0000009');
    expect(await second).toBeNull();
    await flush();
    finish('Add a dark mode toggle');
    expect(await first).toMatchObject({ text: 'Add a dark mode toggle' });
    expect(generateGoal).toHaveBeenCalledTimes(1);
  });

  it('forgets the attempts of a deleted conversation', async () => {
    liveWithReply('g0000010');
    vi.mocked(generateGoal).mockRejectedValue(new Error('model busy'));
    await invoke(IPC.SESSION_GOAL_AUTO, 'g0000010');
    await invoke(IPC.SESSION_GOAL_AUTO, 'g0000010');
    expect(generateGoal).toHaveBeenCalledTimes(2);

    await invoke(IPC.SESSION_DESTROY, 'g0000010', false);
    await invoke(IPC.SESSION_GOAL_AUTO, 'g0000010');
    expect(generateGoal).toHaveBeenCalledTimes(3);
  });

  it('refreshes over a typed goal, and reports a failure', async () => {
    liveWithReply('g0000007');
    const typed = { text: 'Mine', source: 'user', hidden: false };
    m.worktreeManager.getGoal.mockResolvedValue(typed);
    vi.mocked(generateGoal).mockResolvedValue('Ship dark mode');

    expect(await invoke(IPC.SESSION_GOAL_REFRESH, 'g0000007')).toEqual({ text: 'Ship dark mode', source: 'auto', hidden: false });
    expect(m.worktreeManager.saveGoal).toHaveBeenCalledWith('g0000007', 'Ship dark mode', 'auto', typed);

    vi.mocked(generateGoal).mockRejectedValue(new Error('model busy'));
    await expect(invoke(IPC.SESSION_GOAL_REFRESH, 'g0000007')).rejects.toThrow('model busy');
  });

  it('keeps an edit made during a refresh', async () => {
    liveWithReply('g0000008');
    vi.mocked(generateGoal).mockResolvedValue('Generated');
    m.worktreeManager.saveGoal.mockResolvedValue(null);
    const edited = { text: 'Edited meanwhile', source: 'user', hidden: false };
    m.worktreeManager.getGoal.mockResolvedValueOnce(NO_GOAL).mockResolvedValueOnce(edited);

    expect(await invoke(IPC.SESSION_GOAL_REFRESH, 'g0000008')).toEqual(edited);
  });

  it("writes the goal of a thread that isn't running on the agent the user picked for it", async () => {
    m.worktreeManager.getGoal.mockResolvedValue(NO_GOAL);
    m.worktreeManager.getWorktreeOrManifest.mockResolvedValue({ path: '/wt' });
    vi.mocked(recordedAgent).mockResolvedValue({ id: 'gemini-cli' } as never);
    vi.mocked(generateGoal).mockResolvedValue('Goal');

    await invoke(IPC.SESSION_GOAL_REFRESH, 'g0000011', 'gemini-cli');
    expect(recordedAgent).toHaveBeenCalledWith('g0000011', 'gemini-cli');
    await invoke(IPC.SESSION_GOAL_REFRESH, 'g0000011', { not: 'an id' });
    expect(recordedAgent).toHaveBeenLastCalledWith('g0000011', undefined);
  });

  it('saves a typed goal on one line, and hides the bar', async () => {
    m.worktreeManager.saveGoal.mockResolvedValue({ text: 'Ship it', source: 'user', hidden: false });
    await invoke(IPC.SESSION_GOAL_SET, 's1', '  Ship\n it ');
    expect(m.worktreeManager.saveGoal).toHaveBeenCalledWith('s1', 'Ship it', 'user');

    await invoke(IPC.SESSION_GOAL_HIDE, 's1', true);
    expect(m.worktreeManager.setGoalHidden).toHaveBeenCalledWith('s1', true);
  });
});

describe('GIT_GENERATE_COMMIT_MESSAGE', () => {
  it("runs on a thread's recorded agent, or the one the user picked when that is gone", async () => {
    m.worktreeManager.getWorktree.mockReturnValue({ path: '/wt' });
    vi.mocked(recordedAgent).mockResolvedValue({ id: 'gemini-cli' } as never);
    vi.mocked(generateCommitMessage).mockResolvedValue('feat: x');

    expect(await invoke(IPC.GIT_GENERATE_COMMIT_MESSAGE, 's1', 'gemini-cli')).toBe('feat: x');
    expect(recordedAgent).toHaveBeenCalledWith('s1', 'gemini-cli');
    expect(generateCommitMessage).toHaveBeenCalledWith('/wt', { id: 'gemini-cli' });
  });
});

describe('branch switching', () => {
  it('moves every conversation sharing the checkout to the new branch', async () => {
    m.worktreeManager.switchBranch.mockResolvedValue({ success: true, branch: 'b', sessionIds: ['s1', 's2'] });
    await invoke(IPC.BRANCH_SWITCH, 's1', 'b', { create: true, busySessionIds: ['s9'] });

    expect(m.worktreeManager.switchBranch).toHaveBeenCalledWith('s1', 'b', { create: true, busySessionIds: ['s9'] });
    expect(m.sessionManager.setBranch).toHaveBeenCalledWith('s1', 'b');
    expect(m.sessionManager.setBranch).toHaveBeenCalledWith('s2', 'b');
  });

  it('refuses a non-string branch', async () => {
    expect(await invoke(IPC.BRANCH_SWITCH, 's1', 42)).toEqual({ success: false, error: 'Pick a branch.' });
    expect(m.worktreeManager.switchBranch).not.toHaveBeenCalled();
  });

  it('lists the conversations sharing a checkout', async () => {
    m.worktreeManager.checkoutSharers.mockResolvedValue(['s1', 's2']);
    expect(await invoke(IPC.CHECKOUT_SHARERS, 's1')).toEqual(['s1', 's2']);
    expect(m.worktreeManager.checkoutSharers).toHaveBeenCalledWith('s1');
  });
});

// ─── Agent I/O and history ───

describe('SESSION_EXPORT', () => {
  const events = [
    { type: 'user_message', text: 'Fix the login' },
    { type: 'assistant_text', text: 'Done.', uuid: 'a1' },
  ];

  beforeEach(() => {
    m.worktreeManager.getWorktreeOrManifest.mockResolvedValue(wtInfo());
    m.worktreeManager.getDisplayNameState.mockResolvedValue({ displayName: 'Login fix', source: 'user' });
    m.worktreeManager.getAdapterType.mockResolvedValue('claude-code');
    m.adapterRegistry.get.mockReturnValue({ id: 'claude-code', displayName: 'Claude Agent' });
    m.sessionManager.getSession.mockReturnValue(undefined);
    m.sessionManager.getEventHistory.mockReturnValue(events);
  });

  it('asks where to save, under the thread\'s name, and writes Markdown there', async () => {
    const file = path.join(tmp, 'login.md');
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: file });

    expect(await invoke(IPC.SESSION_EXPORT, 's1')).toBe(file);
    const options = vi.mocked(dialog.showSaveDialog).mock.calls.at(-1)!.at(-1) as Electron.SaveDialogOptions;
    expect(path.basename(options.defaultPath!)).toBe('Login fix.md');
    const written = fs.readFileSync(file, 'utf8');
    expect(written).toContain('# Login fix');
    expect(written).toContain('Project: repo');
    expect(written).toContain('## Claude Agent\n\nDone.');
  });

  it('writes every event as JSON when that type is picked', async () => {
    const file = path.join(tmp, 'login.json');
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: file });

    await invoke(IPC.SESSION_EXPORT, 's1');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(parsed.events).toEqual(events);
    expect(parsed.thread).toMatchObject({ id: 's1', title: 'Login fix', branch: 'feat', agent: 'Claude Agent' });
  });

  it('writes nothing when the dialog is cancelled', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' });
    expect(await invoke(IPC.SESSION_EXPORT, 's1')).toBeNull();
    expect(m.sessionManager.getEventHistory).not.toHaveBeenCalled();
  });

  it('names an unnamed thread by its branch', async () => {
    m.worktreeManager.getDisplayNameState.mockResolvedValue({ displayName: null });
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' });
    await invoke(IPC.SESSION_EXPORT, 's1');
    const options = vi.mocked(dialog.showSaveDialog).mock.calls.at(-1)!.at(-1) as Electron.SaveDialogOptions;
    expect(path.basename(options.defaultPath!)).toBe('feat.md');
  });

  it('refuses a thread that is gone, or an id that isn\'t one', async () => {
    m.worktreeManager.getWorktreeOrManifest.mockResolvedValue(undefined);
    await expect(invoke(IPC.SESSION_EXPORT, 's1')).rejects.toThrow('This thread is gone');
    await expect(invoke(IPC.SESSION_EXPORT, '../x')).rejects.toThrow('No such thread');
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  });
});

describe('LIMITS_THREAD_USAGE', () => {
  it('gives the thread\'s usage, and none for a malformed id', async () => {
    const usage = { spendUsd: 1.25, tokens: { input: 900, output: 40 } };
    const none = { spendUsd: 0, tokens: { input: 0, output: 0 } };
    m.sessionManager.threadUsage.mockResolvedValue(usage);
    expect(await invoke(IPC.LIMITS_THREAD_USAGE, 's1')).toEqual(usage);
    expect(m.sessionManager.threadUsage).toHaveBeenCalledWith('s1');

    m.sessionManager.threadUsage.mockClear();
    expect(await invoke(IPC.LIMITS_THREAD_USAGE, { id: 's1' })).toEqual(none);
    // The id names a log file: nothing that could reach outside its folder.
    expect(await invoke(IPC.LIMITS_THREAD_USAGE, '../../x')).toEqual(none);
    expect(await invoke(IPC.LIMITS_THREAD_USAGE, 'a/b')).toEqual(none);
    expect(m.sessionManager.threadUsage).not.toHaveBeenCalled();
  });
});

describe('agent I/O', () => {
  it('tells the tab when a message could not be delivered', async () => {
    m.sessionManager.sendMessage.mockResolvedValue(false);
    invoke(IPC.AGENT_SEND, 's1', 'hello');
    await flush();

    const channel = `${IPC.AGENT_EVENT}:s1`;
    expect(sender.send).toHaveBeenCalledWith(channel, expect.objectContaining({ type: 'error' }));
    expect(sender.send).toHaveBeenCalledWith(channel, { type: 'process_exit' });
  });

  it('stays quiet when the message was delivered', async () => {
    m.sessionManager.sendMessage.mockResolvedValue(true);
    invoke(IPC.AGENT_SEND, 's1', 'hello');
    await flush();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('opens only web sign-in URLs for MCP servers', async () => {
    m.sessionManager.authenticateMcpServer.mockResolvedValue({ authUrl: 'https://auth.example.com/x' });
    await invoke(IPC.AGENT_MCP_AUTHENTICATE, 's1', 'srv');
    expect(shell.openExternal).toHaveBeenCalledWith('https://auth.example.com/x');

    vi.mocked(shell.openExternal).mockClear();
    m.sessionManager.authenticateMcpServer.mockResolvedValue({ authUrl: 'file:///C:/evil.hta' });
    await expect(invoke(IPC.AGENT_MCP_AUTHENTICATE, 's1', 'srv')).rejects.toThrow('non-http');
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});

describe('history', () => {
  const ev = (n: number): AgentEvent => ({ type: 'assistant_text', text: `h${n}` } as AgentEvent);

  it('passes paging straight through when there is no setup status', () => {
    const page = { events: [ev(1)], totalCount: 9, startIndex: 8 };
    m.sessionManager.getEventHistoryPage.mockReturnValue(page);
    expect(invoke(IPC.AGENT_HISTORY_PAGE, 's1', 1, 9)).toBe(page);
    expect(m.sessionManager.getEventHistoryPage).toHaveBeenCalledWith('s1', 1, 9);
  });

  it("gives the thread's tasks and files from its whole history", () => {
    m.sessionManager.getEventHistory.mockReturnValue([
      ev(0),
      { type: 'assistant_tool_use', toolName: 'TodoWrite', toolInput: { todos: [{ content: 'Ship', status: 'pending' }] }, toolUseId: 't', uuid: 'u' },
      { type: 'files_made', files: [{ path: 'a.pdf', kind: 'pdf', size: 1 }] },
    ] as AgentEvent[]);
    expect(invoke(IPC.AGENT_THREAD_ITEMS, 's1')).toEqual({
      tasks: [{ id: '0', content: 'Ship', status: 'pending' }],
      tasksEventIndex: 1,
      files: [{ kind: 'made', made: { path: 'a.pdf', kind: 'pdf', size: 1 }, eventIndex: 2 }],
    });
    expect(invoke(IPC.AGENT_THREAD_ITEMS, 42)).toEqual({ tasks: [], tasksEventIndex: null, files: [] });
  });

  it('pages over setup status and history as one list while setup runs', async () => {
    m.settings.getSettings.mockReturnValue({ autoInstallDeps: true });
    const withPkg = fs.mkdtempSync(path.join(tmp, 'pkg-'));
    fs.writeFileSync(path.join(withPkg, 'package.json'), '{}');
    m.worktreeManager.create.mockImplementation(async (c: { id: string; branchName: string }) => ({
      id: c.id, path: withPkg, branch: c.branchName, repoPath: '/repo', createdAt: 0,
    }));
    let finishInstall!: () => void;
    vi.mocked(installDependencies).mockImplementation(() => new Promise<void>((r) => { finishInstall = r; }));

    const { id } = await invoke(IPC.SESSION_CREATE, { repoPath: '/repo', branchName: '' });
    await vi.waitFor(() => expect(installDependencies).toHaveBeenCalled());
    // Two status events so far (creating worktree, installing), then history.
    m.sessionManager.getEventHistory.mockImplementation((sid: string) => (sid === id ? [ev(0), ev(1), ev(2)] : []));
    m.sessionManager.getEventHistoryCount.mockReturnValue(3);
    // As AgentSessionManager pages its own history (no setup status in it).
    m.sessionManager.getEventHistoryPage.mockImplementation((sid: string, limit: number, before?: number) => {
      const all = m.sessionManager.getEventHistory(sid) as AgentEvent[];
      const end = before !== undefined ? Math.min(before, all.length) : all.length;
      const start = Math.max(0, end - limit);
      return { events: all.slice(start, end), totalCount: all.length, startIndex: start };
    });
    const texts = (page: { events: AgentEvent[] }) => page.events.map((e) => (e as { text?: string; message?: string }).text ?? (e as { message?: string }).message);

    // The thread being set up has no agent yet: nothing running or asked.
    const idle = { midTurn: false, pendingPromptIds: [], agentLive: false };
    m.sessionManager.turnState.mockReturnValue(idle);

    expect(invoke(IPC.AGENT_HISTORY_COUNT, id)).toBe(5);
    const newest = invoke(IPC.AGENT_HISTORY_PAGE, id, 2);
    expect(newest).toMatchObject({ totalCount: 5, startIndex: 3, turn: idle });
    expect(m.sessionManager.turnState).toHaveBeenCalledWith(id);
    expect(texts(newest)).toEqual(['h1', 'h2']);
    const older = invoke(IPC.AGENT_HISTORY_PAGE, id, 2, 3);
    expect(older.startIndex).toBe(1);
    expect(texts(older)).toEqual(['Installing dependencies…', 'h0']);
    expect(texts(invoke(IPC.AGENT_HISTORY_PAGE, id, 2, 1))).toEqual(['Creating worktree…']);

    // Search hits land in the same index space.
    m.sessionManager.searchEventHistory.mockReturnValue([{ eventIndex: 1 }]);
    expect(invoke(IPC.AGENT_HISTORY_SEARCH, id, 'h1', 10)[0].eventIndex).toBe(3);

    finishInstall();
    await lastSetup().promise;
    expect(texts({ events: invoke(IPC.AGENT_HISTORY, id) })).toEqual(['h0', 'h1', 'h2']);
  });

  it('hands the setup status to the new conversation, which keeps it in its history', async () => {
    let adopted: AgentEvent[] = [];
    let countDuringAdoption = -1;
    m.sessionManager.getEventHistoryCount.mockReturnValue(0);
    m.sessionManager.createSession.mockImplementation(async (opts: { id: string; adoptSetupEvents?: () => AgentEvent[] }) => {
      adopted = opts.adoptSetupEvents?.() ?? [];
      // Taken in the same tick: the prefixed index space no longer counts them.
      countDuringAdoption = invoke(IPC.AGENT_HISTORY_COUNT, opts.id);
    });
    await invoke(IPC.SESSION_CREATE, { repoPath: '/repo', branchName: '' });
    await lastSetup().promise;

    expect(adopted.map((e) => (e as { message: string }).message)).toEqual(['Creating worktree…', 'Starting agent…']);
    expect(countDuringAdoption).toBe(0);
  });

  it('cross-conversation search gives up once a newer search starts', async () => {
    // Each search takes longer than one 16ms slice, so the handler yields.
    m.sessionManager.searchEventHistory.mockImplementation(() => {
      const start = performance.now();
      while (performance.now() - start < 20) { /* busy */ }
      return [{ eventIndex: 0 }];
    });

    const first = invoke(IPC.AGENT_HISTORY_SEARCH_ALL, ['s1', 's2', 's3'], 'q');
    const second = invoke(IPC.AGENT_HISTORY_SEARCH_ALL, ['s1'], 'q');

    expect(await first).toEqual([]);
    expect(await second).toEqual([{ eventIndex: 0, sessionId: 's1' }]);
  });

  it('previews skip a conversation whose history cannot be read', async () => {
    m.sessionManager.getEventHistory.mockImplementation((id: string) => {
      if (id === 'bad') throw new Error('corrupt log');
      return [{ type: 'user_message', text: 'Hello there' }];
    });
    const previews = await invoke(IPC.SESSION_PREVIEWS, ['ok', 'bad']);
    expect(Object.keys(previews)).toEqual(['ok']);
    expect(previews.ok.firstPrompt).toBe('Hello there');
  });
});

// ─── Files ───

describe('file handlers', () => {
  const write = (rel: string, content: string | Buffer) => {
    const abs = path.join(wt, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
  };

  it('FILE_READ refuses paths outside the worktree, including a look-alike sibling folder', async () => {
    await expect(invoke(IPC.FILE_READ, 's1', '../outside.txt')).rejects.toThrow('Path traversal');
    const sibling = path.join(path.dirname(wt), `${path.basename(wt)}-evil`, 'x.txt');
    await expect(invoke(IPC.FILE_READ, 's1', sibling)).rejects.toThrow('Path traversal');
  });

  it('FILE_READ returns a file, and at most 100KB of a large one', async () => {
    write('small.txt', 'hello');
    expect(await invoke(IPC.FILE_READ, 's1', 'small.txt')).toBe('hello');

    write('big.txt', 'x'.repeat(150 * 1024));
    const text: string = await invoke(IPC.FILE_READ, 's1', 'big.txt');
    expect(text.startsWith('x'.repeat(100 * 1024))).toBe(true);
    expect(text.endsWith('\n... (truncated at 100KB)')).toBe(true);
    expect(text.length).toBe(100 * 1024 + '\n... (truncated at 100KB)'.length);
  });

  it('FILE_READ on a folder lists the files under it', async () => {
    fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
    vi.mocked(git.listProjectFiles).mockResolvedValue(['src/a.ts', 'src/b/c.ts', 'srcx/d.ts', 'README.md']);
    expect(await invoke(IPC.FILE_READ, 's1', 'src/')).toBe('src/a.ts\nsrc/b/c.ts');
  });

  it('FILE_LIST adds each file\'s folders, folders first', async () => {
    vi.mocked(git.listProjectFiles).mockResolvedValue(['b.ts', 'src/x/y.ts', 'src/a.ts']);
    expect(await invoke(IPC.FILE_LIST, 's1')).toEqual(['src/', 'src/x/', 'b.ts', 'src/x/y.ts', 'src/a.ts']);
  });

  it('FILE_LINES skips large and binary files and serves the index for staged diffs', async () => {
    write('lines.ts', 'a\nb\n');
    expect(await invoke(IPC.FILE_LINES, 's1', 'lines.ts')).toEqual({ lines: ['a', 'b'] });

    write('huge.txt', Buffer.alloc(5 * 1024 * 1024, 'a'));
    expect(await invoke(IPC.FILE_LINES, 's1', 'huge.txt')).toBeNull();

    write('bin.dat', Buffer.from([0x50, 0x00, 0x01, 0x02]));
    expect(await invoke(IPC.FILE_LINES, 's1', 'bin.dat')).toBeNull();

    vi.mocked(git.indexFileContent).mockResolvedValue('x\ny');
    expect(await invoke(IPC.FILE_LINES, 's1', 'lines.ts', true)).toEqual({ lines: ['x', 'y'] });
    expect(git.indexFileContent).toHaveBeenCalledWith(wt, 'lines.ts');
  });

  it('FILE_DIFF: images get a thumbnail view, untracked files a synthesized diff', async () => {
    expect(await invoke(IPC.FILE_DIFF, 's1', 'img/logo.png')).toEqual({ kind: 'image', ext: 'png' });

    write('new.ts', 'hi\n');
    vi.mocked(git.fileDiff).mockResolvedValue('');
    expect(await invoke(IPC.FILE_DIFF, 's1', 'new.ts')).toEqual({
      kind: 'text', patch: '--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,1 @@\n+hi',
    });
    // A staged diff that is empty really is empty.
    expect(await invoke(IPC.FILE_DIFF, 's1', 'new.ts', true)).toEqual({ kind: 'text', patch: '' });
  });

  it('FILE_DIFF never shows a tracked file as new: an empty diff is no change, a failed one an error', async () => {
    write('a.ts', 'all of the file\n');
    vi.mocked(git.isTracked).mockResolvedValue(true);
    vi.mocked(git.fileDiff).mockResolvedValue('');
    expect(await invoke(IPC.FILE_DIFF, 's1', 'a.ts')).toEqual({ kind: 'text', patch: '' });
    expect(git.isTracked).toHaveBeenCalledWith(wt, 'a.ts');

    vi.mocked(git.fileDiff).mockRejectedValue(new Error('index.lock exists'));
    await expect(invoke(IPC.FILE_DIFF, 's1', 'a.ts')).rejects.toThrow('index.lock exists');
  });

  it('FILE_DIFF still shows a new file whose diff fails, and skips one too large to read', async () => {
    write('new.ts', 'hi\n');
    vi.mocked(git.fileDiff).mockRejectedValue(new Error('fatal'));
    expect(await invoke(IPC.FILE_DIFF, 's1', 'new.ts')).toEqual({
      kind: 'text', patch: '--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,1 @@\n+hi',
    });

    write('big.log', Buffer.alloc(5 * 1024 * 1024, 'a'));
    vi.mocked(git.fileDiff).mockResolvedValue('');
    expect(await invoke(IPC.FILE_DIFF, 's1', 'big.log')).toEqual({ kind: 'tooLarge', bytes: 5 * 1024 * 1024 });
  });

  it('FILE_DIFF does not send a patch over the size limit to the window', async () => {
    const patch = `@@ -1 +1 @@\n-a\n+${'b'.repeat(5 * 1024 * 1024)}\n`;
    vi.mocked(git.fileDiff).mockResolvedValue(patch);
    expect(await invoke(IPC.FILE_DIFF, 's1', 'bundle.js')).toEqual({ kind: 'tooLarge', bytes: Buffer.byteLength(patch) });

    vi.mocked(git.fileDiff).mockResolvedValue('@@ -1 +1 @@\n-a\n+b\n');
    expect(await invoke(IPC.FILE_DIFF, 's1', 'bundle.js')).toEqual({ kind: 'text', patch: '@@ -1 +1 @@\n-a\n+b\n' });

    // Git was stopped at the limit (gitPatch), so the size is only that.
    vi.mocked(git.fileDiff).mockResolvedValue(null);
    expect(await invoke(IPC.FILE_DIFF, 's1', 'bundle.js')).toEqual({ kind: 'tooLarge', bytes: git.MAX_TEXT_FILE_BYTES, atLeast: true });

    // A new file under the limit whose patch, a '+' on every line, is over it.
    write('lines.txt', 'a\n'.repeat(1_900_000));
    vi.mocked(git.fileDiff).mockResolvedValue('');
    expect(await invoke(IPC.FILE_DIFF, 's1', 'lines.txt')).toMatchObject({ kind: 'tooLarge' });
  });

  it('FILE_DIFF diffs against the merge base in branch scope', async () => {
    vi.mocked(git.resolveMergeBase).mockResolvedValue({ ref: 'main', mergeBase: 'abc123' });
    vi.mocked(git.fileDiffAgainst).mockResolvedValue('@@ -1 +1 @@\n-a\n+b\n');

    expect(await invoke(IPC.FILE_DIFF, 's1', 'src/a.ts', false, { base: 'main' })).toEqual({
      kind: 'text', patch: '@@ -1 +1 @@\n-a\n+b\n',
    });
    expect(git.fileDiffAgainst).toHaveBeenCalledWith(wt, 'src/a.ts', 'abc123');
  });

  it('FILE_REVERT strips container and host prefixes and passes staged as a boolean', async () => {
    await invoke(IPC.FILE_REVERT, 's1', '/workspace/src/a.ts');
    expect(git.revertFile).toHaveBeenLastCalledWith(wt, 'src/a.ts', false);

    await invoke(IPC.FILE_REVERT, 's1', path.join(wt, 'src', 'b.ts'), 'yes');
    expect(git.revertFile).toHaveBeenLastCalledWith(wt, path.join('src', 'b.ts'), false);

    await invoke(IPC.FILE_REVERT, 's1', 'src/c.ts', true);
    expect(git.revertFile).toHaveBeenLastCalledWith(wt, 'src/c.ts', true);

    await expect(invoke(IPC.FILE_REVERT, 's1', '../../etc/passwd')).rejects.toThrow('Path traversal');
  });

  it('FILE_OPEN_IN_EDITOR tries VS Code, then Cursor, then the OS opener', async () => {
    vi.mocked(launchEditor).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await invoke(IPC.FILE_OPEN_IN_EDITOR, 's1', 'src/a.ts', 12);

    const resolved = path.join(wt, 'src', 'a.ts');
    expect(launchEditor).toHaveBeenNthCalledWith(1, 'code', resolved, 12);
    expect(launchEditor).toHaveBeenNthCalledWith(2, 'cursor', resolved, 12);
    expect(shell.openPath).toHaveBeenCalledWith(resolved);

    vi.mocked(launchEditor).mockResolvedValue(false);
    vi.mocked(shell.openPath).mockResolvedValue('No application is associated');
    await expect(invoke(IPC.FILE_OPEN_IN_EDITOR, 's1', 'src/a.ts')).rejects.toThrow('Could not open file');
  });

  it('FILE_OPEN_IN_EDITOR stops at the first editor that opens', async () => {
    vi.mocked(launchEditor).mockResolvedValue(true);
    await invoke(IPC.FILE_OPEN_IN_EDITOR, 's1', 'src/a.ts');
    expect(launchEditor).toHaveBeenCalledTimes(1);
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it('FILE_CONTENT_DATA_URL returns the working copy and the HEAD version', async () => {
    write('img/logo.png', Buffer.from([1, 2, 3]));
    vi.mocked(execa).mockResolvedValue({ stdout: Uint8Array.from([4, 5]) } as never);

    expect(await invoke(IPC.FILE_CONTENT_DATA_URL, 's1', 'img/logo.png')).toEqual({
      working: 'data:image/png;base64,AQID', head: 'data:image/png;base64,BAU=',
    });
    expect(execa).toHaveBeenCalledWith('git', ['show', 'HEAD:img/logo.png'], { cwd: wt, encoding: 'buffer' });
  });

  it('refuses file requests for an unknown conversation', async () => {
    await expect(invoke(IPC.FILE_READ, 'nope', 'a.ts')).rejects.toThrow('Worktree not found');
    await expect(invoke(IPC.FILE_LIST, 'nope')).rejects.toThrow('Worktree not found');
    expect(await invoke(IPC.FILE_LINES, 'nope', 'a.ts')).toBeNull();
  });
});

// ─── Git ───

describe('git handlers', () => {
  it('refuse refs git would read as options', async () => {
    expect(await invoke(IPC.GIT_LOG_COMMITS, 's1', '--output=x', 'main')).toEqual([]);
    expect(await invoke(IPC.GIT_LOG_COMMITS, 's1', 'feat', '-p')).toEqual([]);
    expect(await invoke(IPC.GIT_REBASE, 's1', '--exec=calc')).toMatchObject({ success: false });
    expect(await invoke(IPC.GIT_SQUASH, 's1', '-b', 'msg')).toMatchObject({ success: false });
    expect(git.logCommits).not.toHaveBeenCalled();
    expect(git.rebaseOnto).not.toHaveBeenCalled();
    expect(git.squashSince).not.toHaveBeenCalled();
  });

  it('GIT_STATUS branch scope explains a missing base or merge base', async () => {
    expect(await invoke(IPC.GIT_STATUS, 's1', { scope: 'branch' })).toEqual({ entries: [], scopeError: 'No base branch' });

    vi.mocked(git.resolveMergeBase).mockResolvedValue(null);
    expect(await invoke(IPC.GIT_STATUS, 's1', { scope: 'branch', base: 'main' }))
      .toEqual({ entries: [], scopeError: 'No merge base with main' });
  });

  it('GIT_STATUS branch scope lists changes since the merge base plus untracked files, with line counts', async () => {
    vi.mocked(git.resolveMergeBase).mockResolvedValue({ ref: 'origin/main', mergeBase: 'mb' });
    vi.mocked(git.git).mockImplementation(async (args: string[]) => {
      if (args[0] === 'diff' && args[1] === '--name-status') return 'M\0src/a.ts\0';
      if (args[0] === 'status') return '?? new.ts\0';
      if (args[0] === '-c') return '3\t1\tsrc/a.ts\n';
      return '';
    });
    vi.mocked(git.hashWorkingFiles).mockResolvedValue('h1\nh2\n');

    const result = await invoke(IPC.GIT_STATUS, 's1', { scope: 'branch', base: 'main' });

    expect(result.baseRef).toBe('origin/main');
    expect(result.entries).toEqual([
      expect.objectContaining({ filePath: 'src/a.ts', status: 'modified', additions: 3, deletions: 1, contentHash: 'h1' }),
      expect.objectContaining({ filePath: 'new.ts', status: 'untracked', contentHash: 'h2' }),
    ]);
    expect(git.git).toHaveBeenCalledWith(
      ['-c', 'core.quotePath=false', 'diff', 'mb', '--numstat', '--', 'src/a.ts', 'new.ts'], wt,
    );
  });

  it('GIT_STATUS says so when git fails, rather than reading as a clean tree', async () => {
    vi.mocked(git.git).mockRejectedValue(new Error('not a git repository'));
    expect(await invoke(IPC.GIT_STATUS, 's1')).toEqual({ entries: [], error: 'not a git repository' });
  });

  it('GIT_SYNC_STATUS reads as no upstream when git fails', async () => {
    vi.mocked(git.syncStatus).mockRejectedValue(new Error('boom'));
    expect(await invoke(IPC.GIT_SYNC_STATUS, 's1')).toEqual({ upstream: null, ahead: 0, behind: 0 });
  });
});

// ─── Pull requests ───

describe('pull requests', () => {
  beforeEach(() => {
    vi.mocked(gh.ghLogin).mockResolvedValue('me');
    vi.mocked(git.currentBranch).mockResolvedValue('feat');
    vi.mocked(git.recentCheckouts).mockResolvedValue(['main', 'feat-2']);
  });

  it('PR_LIST looks up the conversation\'s branches, never the default branch', async () => {
    vi.mocked(gh.prsForBranches).mockResolvedValue([]);
    await invoke(IPC.PR_LIST, 's1');
    expect(gh.prsForBranches).toHaveBeenCalledWith('/repo', ['feat', 'feat-2'], 'me');
  });

  it('turns GitHub being unreachable into one short error, logged once per cooldown', async () => {
    const offline = Object.assign(new Error('gh pr list failed'), { stderr: 'error connecting to api.github.com' });
    vi.mocked(gh.prsForBranches).mockRejectedValue(offline);

    await expect(invoke(IPC.PR_LIST, 's1')).rejects.toThrow(gh.GH_OFFLINE_MESSAGE);
    await expect(invoke(IPC.PR_LIST, 's1')).rejects.toThrow(gh.GH_OFFLINE_MESSAGE);
    expect(m.logger.warn.mock.calls.filter(([msg]) => String(msg).includes('unreachable'))).toHaveLength(1);
  });

  it('passes other GitHub errors through', async () => {
    vi.mocked(gh.prsForBranches).mockRejectedValue(new Error('HTTP 401: Bad credentials'));
    await expect(invoke(IPC.PR_LIST, 's1')).rejects.toThrow('Bad credentials');
  });

  it('PR_CREATE pushes the branch before opening the PR', async () => {
    vi.mocked(gh.prCreate).mockResolvedValue({ number: 7 } as never);
    await invoke(IPC.PR_CREATE, 's1', { title: 't', body: 'b' });
    expect(git.push).toHaveBeenCalledWith(wt, 'feat');
    expect(vi.mocked(git.push).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(gh.prCreate).mock.invocationCallOrder[0]);
  });

  it('PR_LIST_OPEN returns nothing for a path that is not a repository', async () => {
    m.worktreeManager.validateRepo.mockResolvedValue(false);
    expect(await invoke(IPC.PR_LIST_OPEN, '/nowhere')).toEqual([]);
    expect(gh.openPrs).not.toHaveBeenCalled();
  });
});

// ─── Prerequisites and credentials ───

describe('prerequisites and API keys', () => {
  const claude = { id: 'claude', displayName: 'Claude Code', apiKey: { envVar: 'ANTHROPIC_API_KEY' } };

  beforeEach(() => {
    m.credentials.parseApiKey.mockImplementation((k: unknown) => String(k).trim());
    m.credentials.canStoreApiKey.mockReturnValue(true);
  });

  it('saving a key patches the last check instead of re-running every probe', async () => {
    m.adapterRegistry.get.mockReturnValue(claude);
    m.appState.loadPrerequisiteCache.mockReturnValue({
      status: { git: { ok: true }, agents: { claude: { installed: true, apiKey: 'missing' } }, gh: { installed: true } },
    });
    m.prerequisites.apiKeyState.mockReturnValue('set');

    const status = await invoke(IPC.CREDENTIALS_SET_API_KEY, 'claude', 'sk-test');

    expect(m.credentials.saveApiKey).toHaveBeenCalledWith('claude', 'sk-test', { unverified: false });
    expect(status.agents.claude).toEqual({ installed: true, apiKey: 'set' });
    expect(m.prerequisites.checkCorePrerequisites).not.toHaveBeenCalled();
    expect(m.appState.savePrerequisiteCache).toHaveBeenCalledWith(status);
  });

  it('checks the key with the provider before saving it', async () => {
    const verifyApiKey = vi.fn().mockResolvedValue(true);
    m.adapterRegistry.get.mockReturnValue({ ...claude, verifyApiKey });
    m.appState.loadPrerequisiteCache.mockReturnValue({ status: { git: {}, agents: { claude: {} } } });

    await invoke(IPC.CREDENTIALS_SET_API_KEY, 'claude', '  sk-test  ');

    expect(verifyApiKey).toHaveBeenCalledWith('sk-test');
    expect(m.credentials.saveApiKey).toHaveBeenCalledWith('claude', 'sk-test', { unverified: false });
  });

  it('turns away a key the provider refuses, without saving it', async () => {
    m.adapterRegistry.get.mockReturnValue({ ...claude, verifyApiKey: vi.fn().mockResolvedValue(false) });

    await expect(invoke(IPC.CREDENTIALS_SET_API_KEY, 'claude', 'typo')).rejects.toThrow('That key was refused');
    expect(m.credentials.saveApiKey).not.toHaveBeenCalled();
  });

  it('saves a key it could not check, marked unchecked', async () => {
    m.adapterRegistry.get.mockReturnValue({ ...claude, verifyApiKey: vi.fn().mockResolvedValue(null) });
    m.appState.loadPrerequisiteCache.mockReturnValue({ status: { git: {}, agents: { claude: {} } } });

    await invoke(IPC.CREDENTIALS_SET_API_KEY, 'claude', 'sk-test');

    expect(m.credentials.saveApiKey).toHaveBeenCalledWith('claude', 'sk-test', { unverified: true });
  });

  it('says there is no secure storage before sending the key anywhere', async () => {
    const verifyApiKey = vi.fn();
    m.adapterRegistry.get.mockReturnValue({ ...claude, verifyApiKey });
    m.credentials.canStoreApiKey.mockReturnValue(false);

    await expect(invoke(IPC.CREDENTIALS_SET_API_KEY, 'claude', 'sk-test')).rejects.toThrow('no secure storage');
    expect(verifyApiKey).not.toHaveBeenCalled();
    expect(m.credentials.saveApiKey).not.toHaveBeenCalled();
  });

  it('refuses an unknown agent or one that takes no key', async () => {
    m.adapterRegistry.get.mockReturnValue(undefined);
    await expect(invoke(IPC.CREDENTIALS_SET_API_KEY, 'nope', 'k')).rejects.toThrow('Unknown agent');

    m.adapterRegistry.get.mockReturnValue({ id: 'x', displayName: 'X' });
    await expect(invoke(IPC.CREDENTIALS_CLEAR_API_KEY, 'x')).rejects.toThrow('does not take an API key');
    expect(m.credentials.clearApiKey).not.toHaveBeenCalled();
  });

  it('PREREQUISITES_CHECK keeps the last gh result while the slower gh check runs', async () => {
    const lastGh = { installed: true, authenticated: true };
    m.prerequisites.checkCorePrerequisites.mockResolvedValue({ git: { ok: true }, agents: {} });
    m.appState.loadPrerequisiteCache.mockReturnValue({ status: { gh: lastGh } });

    expect(await invoke(IPC.PREREQUISITES_CHECK)).toEqual({ git: { ok: true }, agents: {}, gh: lastGh });
  });
});

// ─── Checks on renderer input ───

describe('renderer input checks', () => {
  it('preview: unknown pages, commands and malformed bounds are refused', async () => {
    expect(() => invoke(IPC.PREVIEW_NAVIGATE, 's1', 'other', 'http://localhost:3000')).toThrow('Invalid preview request');
    expect(() => invoke(IPC.PREVIEW_COMMAND, 's1', 'user', 'rm')).toThrow('Invalid preview request');
    expect(() => invoke(IPC.PREVIEW_NAVIGATE, 'nope', 'user', 'http://localhost:3000')).toThrow("isn't ready");

    invoke(IPC.PREVIEW_NAVIGATE, 's1', 'user', 'http://localhost:3000');
    expect(m.previewManager.navigate).toHaveBeenCalledWith('s1', wt, 'user', 'http://localhost:3000');

    invoke(IPC.PREVIEW_SET_VIEWPORT, 's1', { x: 0, y: 0, width: Number.NaN, height: 10 });
    expect(m.previewManager.setViewport).not.toHaveBeenCalled();
    invoke(IPC.PREVIEW_SET_VIEWPORT, 's1', null);
    expect(m.previewManager.setViewport).toHaveBeenCalledWith('s1', null);
  });

  it('OPEN_EXTERNAL opens web links only', async () => {
    await expect(invoke(IPC.OPEN_EXTERNAL, 'file:///C:/Windows/System32/calc.exe')).rejects.toThrow('Only http/https');
    await invoke(IPC.OPEN_EXTERNAL, 'https://example.com');
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('app state: each getter reads only its own field', () => {
    m.appState.loadOpenTabs.mockReturnValue(['t']);
    m.appState.loadCollapsedRepos.mockReturnValue({ '/r': true });
    m.appState.loadSessionSort.mockReturnValue({ key: 'age', dir: 'desc' });
    m.appState.loadSidebarWidth.mockReturnValue(240);
    m.appState.loadCollapsedPanels.mockReturnValue({ sidebar: true });
    expect(invoke(IPC.APP_STATE_GET_OPEN_TABS)).toEqual(['t']);
    expect(invoke(IPC.APP_STATE_GET_COLLAPSED_REPOS)).toEqual({ '/r': true });
    expect(invoke(IPC.APP_STATE_GET_SESSION_SORT)).toEqual({ key: 'age', dir: 'desc' });
    expect(invoke(IPC.APP_STATE_GET_SIDEBAR_WIDTH)).toBe(240);
    expect(invoke(IPC.APP_STATE_GET_COLLAPSED_PANELS)).toEqual({ sidebar: true });
  });

  it('app state: To do flags go to app-state, which checks them', () => {
    m.appState.loadTodoSessionIds.mockReturnValue(['a']);
    expect(invoke(IPC.APP_STATE_GET_TODO)).toEqual(['a']);
    // null (an unreadable file) reaches the renderer as is, so it keeps its list
    m.appState.loadTodoSessionIds.mockReturnValue(null);
    expect(invoke(IPC.APP_STATE_GET_TODO)).toBeNull();
    invoke(IPC.APP_STATE_SET_TODO, ['a']);
    expect(m.appState.saveTodoSessionIds).toHaveBeenCalledWith(['a']);
  });

  it('app state: unread ids must be strings, sidebar widths finite numbers', () => {
    invoke(IPC.APP_STATE_SET_UNREAD, [1, 2]);
    invoke(IPC.APP_STATE_SET_UNREAD, 'a');
    expect(m.appState.saveUnreadSessionIds).not.toHaveBeenCalled();
    invoke(IPC.APP_STATE_SET_UNREAD, ['a', 'b']);
    expect(m.appState.saveUnreadSessionIds).toHaveBeenCalledWith(['a', 'b']);

    invoke(IPC.APP_STATE_SET_SIDEBAR_WIDTH, 'wide');
    invoke(IPC.APP_STATE_SET_SIDEBAR_WIDTH, Number.POSITIVE_INFINITY);
    invoke(IPC.APP_STATE_SET_SIDEBAR_WIDTH, 241.6);
    expect(m.appState.saveSidebarWidth).toHaveBeenCalledTimes(1);
    expect(m.appState.saveSidebarWidth).toHaveBeenCalledWith(242);
  });

  it('renderer error reports are typed and trimmed before logging', () => {
    invoke(IPC.APP_REPORT_ERROR, { kind: 'error' });
    expect(logRendererError).not.toHaveBeenCalled();

    invoke(IPC.APP_REPORT_ERROR, { kind: 7, message: 'm'.repeat(5000), stack: 's'.repeat(9000), sessionId: 3, timestamp: 'now' });
    const report = vi.mocked(logRendererError).mock.calls[0][0];
    expect(report).toMatchObject({ source: 'renderer', kind: 'error' });
    expect(report.message).toHaveLength(2000);
    expect(report.stack).toHaveLength(8000);
    expect(report).not.toHaveProperty('sessionId');
    expect(typeof report.timestamp).toBe('number');
  });

  it('idle sleep loop lines are logged only as strings, on one line, capped', () => {
    invoke(IPC.APP_LOG_IDLE, 42);
    invoke(IPC.APP_LOG_IDLE, { line: 'session=s1 focused' });
    invoke(IPC.APP_LOG_IDLE, '');
    expect(m.logger.debug).not.toHaveBeenCalled();

    invoke(IPC.APP_LOG_IDLE, 'session=s1 focused');
    expect(m.logger.debug).toHaveBeenCalledWith('[idle] session=s1 focused');

    invoke(IPC.APP_LOG_IDLE, 'session=s1 x\r\n[2026-01-01] [ERROR] forged' + 'y'.repeat(5000));
    const line = m.logger.debug.mock.calls[1][0] as string;
    expect(line.startsWith('[idle] session=s1 x [2026-01-01] [ERROR] forged')).toBe(true);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line.length).toBeLessThanOrEqual('[idle] '.length + IDLE_LOG_MAX_CHARS);
    expect(m.logger.debug).toHaveBeenCalledTimes(2);
  });

  it('attention badge counts are whole, non-negative numbers', () => {
    invoke(IPC.WIN_SET_ATTENTION_BADGE, -3, 'data:x');
    invoke(IPC.WIN_SET_ATTENTION_BADGE, 2.7, 42);
    invoke(IPC.WIN_SET_ATTENTION_BADGE, 'many', null);
    expect(vi.mocked(applyAttentionBadge).mock.calls.map(([, n, url]) => [n, url])).toEqual([
      [0, 'data:x'], [2, null], [0, null],
    ]);
  });

  it('PTY_SPAWN waits for the worktree instead of failing', () => {
    expect(invoke(IPC.PTY_SPAWN, 'nope')).toBe(false);
    invoke(IPC.PTY_SPAWN, 's1');
    expect(m.terminalManager.spawnPty).toHaveBeenCalledWith('s1', wt, sender);
  });
});

// ─── Adapters, skills, MCP ───

describe('adapters, skills and MCP config', () => {
  it('AGENT_GET_ADAPTER_CONTROLS describes the first model when none is chosen', () => {
    const getControls = vi.fn(() => ['c']);
    m.adapterRegistry.getDefault.mockReturnValue({ getModels: () => [{ id: 'm1' }, { id: 'm2' }], getControls });

    invoke(IPC.AGENT_GET_ADAPTER_CONTROLS);
    invoke(IPC.AGENT_GET_ADAPTER_CONTROLS, undefined, 'm2');
    expect(getControls.mock.calls).toEqual([['m1'], ['m2']]);

    m.adapterRegistry.get.mockReturnValue(undefined);
    expect(invoke(IPC.AGENT_GET_ADAPTER_CONTROLS, 'unknown')).toEqual([]);
  });

  it('SKILLS_ADD needs an agent that can add skills and a project folder', async () => {
    m.sessionManager.getSessionAdapter.mockReturnValue(undefined);
    m.worktreeManager.getAdapterType.mockResolvedValue(undefined);
    m.adapterRegistry.getDefault.mockReturnValue({ displayName: 'Plain' });
    await expect(invoke(IPC.SKILLS_ADD, 's1', '/repo', { name: 'x' })).rejects.toThrow('does not support adding skills');

    const addSkill = vi.fn();
    m.adapterRegistry.getDefault.mockReturnValue({ displayName: 'Claude Code', addSkill });
    m.sessionManager.getWorktreePath.mockReturnValue(undefined);
    await expect(invoke(IPC.SKILLS_ADD, 's1', '', { name: 'x' })).rejects.toThrow('No project root');

    await invoke(IPC.SKILLS_ADD, 's1', '/repo', { name: 'x' });
    expect(addSkill).toHaveBeenCalledWith('/repo', { name: 'x' });
  });

  it("skills of a thread that isn't running come from its own agent, and none from one that is gone", async () => {
    const listSkills = vi.fn(async () => [{ name: 'gem' }]);
    m.sessionManager.getSessionAdapter.mockReturnValue(undefined);
    m.sessionManager.getWorktreePath.mockReturnValue(undefined);
    m.adapterRegistry.getDefault.mockReturnValue({ displayName: 'Claude Code', listSkills: vi.fn(async () => [{ name: 'claude' }]) });
    m.worktreeManager.getAdapterType.mockResolvedValue('gemini-cli');
    m.adapterRegistry.get.mockImplementation((id: string) => (id === 'gemini-cli' ? { displayName: 'Gemini CLI', listSkills } : undefined));
    expect(await invoke(IPC.SKILLS_LIST, 's1', '/repo')).toEqual([{ name: 'gem' }]);

    m.worktreeManager.getAdapterType.mockResolvedValue('removed-agent');
    expect(await invoke(IPC.SKILLS_LIST, 's1', '/repo')).toEqual([]);
    await expect(invoke(IPC.SKILLS_ADD, 's1', '/repo', { name: 'x' })).rejects.toThrow("isn't available any more");
  });

  it("refuses MCP and plugin calls for an agent that isn't registered, rather than change the default's", async () => {
    const addConfiguredMcpServer = vi.fn();
    m.adapterRegistry.getDefault.mockReturnValue({ id: 'claude-code', addConfiguredMcpServer });
    m.adapterRegistry.get.mockReturnValue(undefined);
    await expect(invoke(IPC.MCP_CONFIG_ADD, { name: 'x' }, 'removed-agent')).rejects.toThrow('The agent "removed-agent" isn\'t available');
    expect(addConfiguredMcpServer).not.toHaveBeenCalled();
    await invoke(IPC.MCP_CONFIG_ADD, { name: 'x' });
    expect(addConfiguredMcpServer).toHaveBeenCalledWith({ name: 'x' });
  });

  it('keeps Plugins on the built-in agent whatever the default agent is', async () => {
    const listPlugins = vi.fn(async () => ({ installed: [{ id: 'p' }], available: [] }));
    m.adapterRegistry.getDefault.mockReturnValue({ id: 'gemini-cli', capabilities: { plugins: false } });
    m.adapterRegistry.getBuiltInDefault.mockReturnValue({ id: 'claude-code', capabilities: { plugins: true }, listPlugins });
    expect(await invoke(IPC.PLUGIN_LIST)).toEqual({ installed: [{ id: 'p' }], available: [] });
  });

  it('lists no plugins for an agent without them, and refuses to install one', async () => {
    const listPlugins = vi.fn();
    m.adapterRegistry.get.mockReturnValue({ id: 'gemini-cli', capabilities: { plugins: false }, listPlugins });
    expect(await invoke(IPC.PLUGIN_LIST, 'gemini-cli')).toEqual({ installed: [], available: [] });
    expect(listPlugins).not.toHaveBeenCalled();
    await expect(invoke(IPC.PLUGIN_INSTALL, 'p', 'user', 'gemini-cli')).rejects.toThrow('Adapter "gemini-cli" does not support plugins');
  });

  it('passes plugin installs and changes to the built-in agent', async () => {
    const agent = {
      id: 'claude-code', capabilities: { plugins: true },
      installPlugin: vi.fn(), uninstallPlugin: vi.fn(), enablePlugin: vi.fn(), disablePlugin: vi.fn(),
    };
    m.adapterRegistry.getBuiltInDefault.mockReturnValue(agent);
    await invoke(IPC.PLUGIN_INSTALL, 'p', 'project');
    await invoke(IPC.PLUGIN_INSTALL, 'q');
    await invoke(IPC.PLUGIN_UNINSTALL, 'p');
    await invoke(IPC.PLUGIN_ENABLE, 'p');
    await invoke(IPC.PLUGIN_DISABLE, 'p');
    expect(agent.installPlugin.mock.calls).toEqual([['p', 'project'], ['q', 'user']]);
    expect(agent.uninstallPlugin).toHaveBeenCalledWith('p');
    expect(agent.enablePlugin).toHaveBeenCalledWith('p');
    expect(agent.disablePlugin).toHaveBeenCalledWith('p');
  });

  it('MCP_CONFIG_APPROVE approves a server for the project and all its worktrees', async () => {
    const approveProjectMcpServer = vi.fn();
    m.adapterRegistry.getDefault.mockReturnValue({ id: 'claude', approveProjectMcpServer });
    m.worktreeManager.list.mockResolvedValue([{ path: '/wt/a' }, { path: '/wt/b' }]);

    await invoke(IPC.MCP_CONFIG_APPROVE, 'srv', '/repo');
    expect(approveProjectMcpServer).toHaveBeenCalledWith('srv', ['/repo', '/wt/a', '/wt/b']);

    m.projectPath.projectKind.mockResolvedValue('missing');
    await expect(invoke(IPC.MCP_CONFIG_APPROVE, 'srv', '/nowhere')).rejects.toThrow("The project folder /nowhere wasn't found");
  });
});

describe('SETTINGS_SAVE', () => {
  it('applies the saved, checked settings rather than what the renderer sent', () => {
    const saved = { theme: 'system', alwaysOnTop: false };
    m.settings.getSettings.mockReturnValue(saved);

    invoke(IPC.SETTINGS_SAVE, { theme: 'bogus', alwaysOnTop: false });
    expect(m.settings.saveSettings).toHaveBeenCalledWith({ theme: 'bogus', alwaysOnTop: false });
    expect(m.settings.applyImmediateEffects).toHaveBeenCalledWith(win, saved);
  });
});

describe('Claude accounts', () => {
  beforeEach(() => {
    m.settings.getSettings.mockReturnValue({ claudeAccounts: [{ id: 'work', name: 'Work', configDir: '' }] });
  });

  it('previews the folder an account would use, or why it cannot be added', async () => {
    const ok = await invoke(IPC.CLAUDE_ACCOUNT_PREVIEW, { name: 'Client', configDir: '' });
    expect(ok).toMatchObject({ ok: true });
    expect(ok.configDir).toMatch(/\.claude-client$/);
    expect(await invoke(IPC.CLAUDE_ACCOUNT_PREVIEW, { name: 'work', configDir: '' }))
      .toEqual({ ok: false, error: 'You already have an account called "Work". Pick another name.' });
    expect(m.registerClaudeAccount).not.toHaveBeenCalled();
  });

  it('registers an added account straight away and returns the entry to save', async () => {
    const result = await invoke(IPC.CLAUDE_ACCOUNT_ADD, { name: 'Client', configDir: '' });
    expect(result).toEqual({ setting: { id: 'client', name: 'Client', configDir: '' }, adapterId: 'claude-account-client' });
    expect(m.registerClaudeAccount).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude-account-client', name: 'Client' }));
  });

  it('turns an account away without registering it', async () => {
    await expect(Promise.resolve().then(() => invoke(IPC.CLAUDE_ACCOUNT_ADD, { name: 'Work', configDir: '' }))).rejects.toThrow(/already have an account/);
    expect(m.registerClaudeAccount).not.toHaveBeenCalled();
  });
});
