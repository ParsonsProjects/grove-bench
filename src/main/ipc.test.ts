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
      'getSessionsByRepo', 'createSession', 'getSession', 'reattachWindow', 'trackPendingSetup', 'interruptQuery',
      'closeSession', 'sleepSession', 'wakeSession', 'stopTask', 'destroySession', 'listSessions', 'renameSession',
      'setBranch', 'isMidTurn', 'getEventHistory', 'getEventHistoryPage', 'getEventHistoryCount', 'searchEventHistory',
      'beginSearch', 'clearEventHistory', 'sendMessage', 'setMode', 'setModel', 'getControls', 'getUsage', 'setControl',
      'listMcpServers', 'getMcpContextCost', 'reconnectMcpServer', 'setMcpServerEnabled', 'authenticateMcpServer',
      'getSessionAdapter', 'getWorktreePath', 'analyzeSkillSuggestionsForRepo', 'respondToPermission',
      'respondToElicitation', 'rewindFiles', 'getCheckpointDiff', 'listCheckpoints', 'getDiffHistory', 'getTurnDiff',
      'getFullThreadDiff', 'getCheckpointFiles', 'getCheckpointFileDiff', 'getCheckpointFileLines',
    ),
    worktreeManager: fns(
      'validateRepo', 'cleanupOrphans', 'getWorktreeOrManifest', 'registerDirect', 'create', 'getRepoConfig',
      'copyUntrackedFiles', 'getNpmCachePath', 'getProviderSessionId', 'getModel', 'getAdapterType', 'remove',
      'saveDisplayName', 'getDisplayNameState', 'saveAutoDisplayName', 'saveCompleted', 'renameBranch', 'switchBranch',
      'syncBranch', 'list', 'register', 'listRepos', 'getWorktree',
    ),
    terminalManager: fns('killAllForSession', 'spawnPty', 'write', 'resize', 'killPty', 'isAlive'),
    previewManager: fns('close', 'closeAgentPage', 'navigate', 'command', 'setViewport', 'snapshot', 'agentFrame', 'getStates'),
    adapterRegistry: fns('get', 'getDefault', 'list'),
    settings: fns('getSettings', 'saveSettings', 'applyImmediateEffects'),
    appState: fns(
      'loadAppState', 'saveOpenTabs', 'saveCollapsedRepos', 'saveSessionSort', 'saveSidebarWidth', 'saveUnreadSessionIds',
      'loadUnreadSessionIds', 'flushPendingSaves', 'loadPrerequisiteCache', 'savePrerequisiteCache',
    ),
    prerequisites: fns('apiKeyState', 'checkCorePrerequisites', 'checkGh'),
    credentials: fns('clearApiKey', 'saveApiKey'),
    bookmarks: fns('getBookmarks', 'addBookmark', 'removeBookmark', 'updateBookmark', 'removeBookmarksForSession'),
    memoryCompact: fns('compactMemory', 'cancelCompaction', 'onCompactionEvent', 'listBackups', 'restoreBackup', 'getCompactionInfo', 'previewBackup', 'readBackupFile'),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('./agent-session.js', () => ({ sessionManager: m.sessionManager }));
vi.mock('./worktree-manager.js', () => ({ worktreeManager: m.worktreeManager }));
vi.mock('./terminal.js', () => ({ terminalManager: m.terminalManager }));
vi.mock('./preview.js', () => ({ previewManager: m.previewManager }));
vi.mock('./adapters/index.js', () => ({ adapterRegistry: m.adapterRegistry }));
vi.mock('./settings.js', () => m.settings);
vi.mock('./app-state.js', () => m.appState);
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
vi.mock('./auto-updater.js', () => ({ checkForUpdate: vi.fn(), downloadUpdate: vi.fn(), installUpdate: vi.fn() }));
vi.mock('./attention-badge.js', () => ({ applyAttentionBadge: vi.fn() }));
vi.mock('./spellcheck.js', () => ({ replaceMisspelling: vi.fn(), addWordToDictionary: vi.fn() }));
vi.mock('./crash-handling.js', () => ({ logRendererError: vi.fn() }));
vi.mock('./git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./git.js')>();
  const runsGit = [
    'git', 'validateBranchName', 'branchExists', 'branchExistsAnywhere', 'listBranches', 'getDefaultBranch', 'fileDiff',
    'fileDiffAgainst', 'resolveMergeBase', 'indexFileContent', 'hashWorkingFiles', 'listProjectFiles', 'revertFile',
    'stageFile', 'unstageFile', 'commit', 'push', 'syncStatus', 'branchCommits', 'logCommits', 'rebaseOnto', 'cherryPick',
    'squashSince', 'currentBranch', 'recentCheckouts',
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

import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import { execa } from 'execa';
import { IPC } from '../shared/types.js';
import type { AgentEvent } from '../shared/types.js';
import * as git from './git.js';
import * as gh from './gh.js';
import { generateBranchName } from './branch-name.js';
import { launchEditor } from './editor-launch.js';
import { installDependencies } from './deps-install.js';
import { logRendererError } from './crash-handling.js';
import { applyAttentionBadge } from './attention-badge.js';
import { registerHandlers } from './ipc.js';

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
  m.sessionManager.getEventHistory.mockReturnValue([]);
  m.sessionManager.getSession.mockReturnValue(undefined);
  m.sessionManager.isMidTurn.mockReturnValue(false);
  m.sessionManager.beginSearch.mockReturnValue(vi.fn());
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
    m.worktreeManager.validateRepo.mockResolvedValue(true);
    m.worktreeManager.cleanupOrphans.mockResolvedValue(2);

    expect(await invoke(IPC.REPO_SELECT)).toBe('/repo');
    expect(m.worktreeManager.cleanupOrphans).toHaveBeenCalledWith('/repo');
  });

  it('REPO_SELECT returns null for a cancelled pick or a folder that is not a repo', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await invoke(IPC.REPO_SELECT)).toBeNull();

    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['/not-a-repo'] });
    m.worktreeManager.validateRepo.mockResolvedValue(false);
    expect(await invoke(IPC.REPO_SELECT)).toBeNull();
    expect(m.worktreeManager.cleanupOrphans).not.toHaveBeenCalled();
  });

  it('REPO_REMOVE refuses while the project has live conversations', async () => {
    m.sessionManager.getSessionsByRepo.mockReturnValue([{ id: 's1' }]);
    await expect(invoke(IPC.REPO_REMOVE, '/repo')).rejects.toThrow('active conversations');
    expect(m.worktreeManager.cleanupOrphans).not.toHaveBeenCalled();
  });
});

// ─── Creating a conversation ───

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
    expect(m.sessionManager.trackPendingSetup).not.toHaveBeenCalled();
  });

  it('returns at once and sets up in the background: worktree, copied files, agent', async () => {
    m.worktreeManager.getRepoConfig.mockResolvedValue({ copyFiles: ['.env'] });

    const result = await create({
      permissionMode: 'not-a-mode', model: '', controls: { effort: 'high', permissionMode: 'x', count: 3 },
    });
    // No name given: a placeholder branch, renamed after the first turn.
    expect(result).toEqual({ id: expect.stringMatching(/^[0-9a-f]{8}$/), branch: `grove/${result.id}` });

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
    expect(m.worktreeManager.registerDirect).toHaveBeenCalledWith('/repo', 'main', '/repo');
    expect(m.sessionManager.createSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1', cwd: '/repo' }));
  });

  it('attaching shares another conversation\'s worktree and branch', async () => {
    m.worktreeManager.getWorktreeOrManifest.mockResolvedValue({ id: 'src', path: '/wt/src', branch: 'feat-x' });
    m.worktreeManager.registerDirect.mockResolvedValue({ id: 'd2', branch: 'feat-x', path: '/wt/src' });

    await create({ attachToSessionId: 'src' });
    expect(m.worktreeManager.registerDirect).toHaveBeenCalledWith('/repo', 'feat-x', '/wt/src');

    m.worktreeManager.getWorktreeOrManifest.mockResolvedValue(undefined);
    await expect(create({ attachToSessionId: 'gone' })).rejects.toThrow('Conversation gone not found');
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

    const result = invoke(IPC.SESSION_RESUME, 's1', '/repo');
    // Prompts sent while it starts wait on the same promise.
    expect(lastSetup()).toMatchObject({ id: 's1', promise: result });
    await result;

    expect(m.sessionManager.createSession).toHaveBeenCalledWith(expect.objectContaining({
      id: 's1', cwd: wt, resumeSessionId: 'prov-1', model: 'opus', adapterType: 'codex',
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
});

// ─── Agent I/O and history ───

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

    expect(invoke(IPC.AGENT_HISTORY_COUNT, id)).toBe(5);
    const newest = invoke(IPC.AGENT_HISTORY_PAGE, id, 2);
    expect(newest).toMatchObject({ totalCount: 5, startIndex: 3 });
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
      kind: 'text', patch: git.synthesizeUntrackedDiff('new.ts', 'hi\n'),
    });
    // A staged diff that is empty really is empty.
    expect(await invoke(IPC.FILE_DIFF, 's1', 'new.ts', true)).toEqual({ kind: 'text', patch: '' });
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

  it('GIT_STATUS returns no entries when git fails', async () => {
    vi.mocked(git.git).mockRejectedValue(new Error('not a git repository'));
    expect(await invoke(IPC.GIT_STATUS, 's1')).toEqual({ entries: [] });
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

  it('saving a key patches the last check instead of re-running every probe', async () => {
    m.adapterRegistry.get.mockReturnValue(claude);
    m.appState.loadPrerequisiteCache.mockReturnValue({
      status: { git: { ok: true }, agents: { claude: { installed: true, apiKey: 'missing' } }, gh: { installed: true } },
    });
    m.prerequisites.apiKeyState.mockReturnValue('set');

    const status = await invoke(IPC.CREDENTIALS_SET_API_KEY, 'claude', 'sk-test');

    expect(m.credentials.saveApiKey).toHaveBeenCalledWith('claude', 'sk-test');
    expect(status.agents.claude).toEqual({ installed: true, apiKey: 'set' });
    expect(m.prerequisites.checkCorePrerequisites).not.toHaveBeenCalled();
    expect(m.appState.savePrerequisiteCache).toHaveBeenCalledWith(status);
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

  it('SKILLS_ADD needs an agent that can add skills and a project folder', () => {
    m.sessionManager.getSessionAdapter.mockReturnValue(undefined);
    m.adapterRegistry.getDefault.mockReturnValue({ displayName: 'Plain' });
    expect(() => invoke(IPC.SKILLS_ADD, 's1', '/repo', { name: 'x' })).toThrow('does not support adding skills');

    const addSkill = vi.fn();
    m.adapterRegistry.getDefault.mockReturnValue({ displayName: 'Claude Code', addSkill });
    m.sessionManager.getWorktreePath.mockReturnValue(undefined);
    expect(() => invoke(IPC.SKILLS_ADD, 's1', '', { name: 'x' })).toThrow('No project root');

    invoke(IPC.SKILLS_ADD, 's1', '/repo', { name: 'x' });
    expect(addSkill).toHaveBeenCalledWith('/repo', { name: 'x' });
  });

  it('MCP_CONFIG_APPROVE approves a server for the project and all its worktrees', async () => {
    const approveProjectMcpServer = vi.fn();
    m.adapterRegistry.getDefault.mockReturnValue({ id: 'claude', approveProjectMcpServer });
    m.worktreeManager.validateRepo.mockResolvedValue(true);
    m.worktreeManager.list.mockResolvedValue([{ path: '/wt/a' }, { path: '/wt/b' }]);

    await invoke(IPC.MCP_CONFIG_APPROVE, 'srv', '/repo');
    expect(approveProjectMcpServer).toHaveBeenCalledWith('srv', ['/repo', '/wt/a', '/wt/b']);

    m.worktreeManager.validateRepo.mockResolvedValue(false);
    await expect(invoke(IPC.MCP_CONFIG_APPROVE, 'srv', '/nowhere')).rejects.toThrow('not a git repository');
  });
});
