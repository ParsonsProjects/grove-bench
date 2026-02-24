import { ipcMain, BrowserWindow, dialog } from 'electron';
import { IPC } from '../shared/types.js';
import type { CreateSessionOpts, PrerequisiteStatus, SessionInfo } from '../shared/types.js';
import { sessionManager } from './agent-session.js';
import { worktreeManager } from './worktree-manager.js';
import { checkAllPrerequisites } from './prerequisites.js';
import { validateBranchName, branchExists, listBranches } from './git.js';
import { logger } from './logger.js';

export function registerHandlers() {
  // ─── Repo ───

  ipcMain.handle(IPC.REPO_SELECT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Git Repository',
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    const repoPath = result.filePaths[0];

    const valid = await worktreeManager.validateRepo(repoPath);
    if (!valid) return null;

    // Clean up any orphan worktrees from previous crashes
    const orphans = await worktreeManager.cleanupOrphans(repoPath);
    if (orphans > 0) {
      logger.info(`Cleaned up ${orphans} orphan worktree(s) in ${repoPath}`);
    }

    return repoPath;
  });

  ipcMain.handle(IPC.REPO_VALIDATE, async (_event, repoPath: string) => {
    return worktreeManager.validateRepo(repoPath);
  });

  ipcMain.handle(IPC.REPO_REMOVE, async (_event, repoPath: string) => {
    const activeSessions = sessionManager.getSessionsByRepo(repoPath);
    if (activeSessions.length > 0) {
      throw new Error('Cannot remove repo while it has active sessions');
    }

    const orphans = await worktreeManager.cleanupOrphans(repoPath);
    if (orphans > 0) {
      logger.info(`Cleaned up ${orphans} orphan worktree(s) on repo remove for ${repoPath}`);
    }
  });

  // ─── Sessions ───

  ipcMain.handle(IPC.SESSION_CREATE, async (event, opts: CreateSessionOpts) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window found');

    const exists = await branchExists(opts.repoPath, opts.branchName);

    if (opts.useExisting) {
      // Existing branch mode: require the branch exists
      if (!exists) {
        throw new Error(`Branch "${opts.branchName}" does not exist`);
      }
    } else {
      // New branch mode: validate name, reject if exists
      const validName = await validateBranchName(opts.branchName);
      if (!validName) {
        throw new Error(`Invalid branch name: "${opts.branchName}"`);
      }
      if (exists) {
        throw new Error(`Branch "${opts.branchName}" already exists`);
      }
    }

    logger.info(`Creating session: branch=${opts.branchName}, repo=${opts.repoPath}, useExisting=${!!opts.useExisting}`);

    // Create worktree
    const worktree = await worktreeManager.create({
      repoPath: opts.repoPath,
      branchName: opts.branchName,
      baseBranch: opts.baseBranch,
      useExisting: opts.useExisting,
    });

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

    // Spawn PTY in the worktree
    const session = await sessionManager.createSession({
      id: worktree.id,
      branch: worktree.branch,
      cwd: worktree.path,
      repoPath: opts.repoPath,
      window: win,
    });

    logger.info(`Session created: id=${session.id}`);
    return { id: session.id, branch: session.branch };
  });

  ipcMain.handle(IPC.SESSION_DESTROY, async (_event, id: string, deleteBranch = false) => {
    logger.info(`Destroying session: id=${id}, deleteBranch=${deleteBranch}`);
    await sessionManager.destroySession(id);
    // Wait for file handles before removing worktree
    await new Promise((r) => setTimeout(r, 500));
    await worktreeManager.remove(id, deleteBranch);
    logger.info(`Session destroyed: id=${id}`);
  });

  ipcMain.handle(IPC.SESSION_LIST, async (): Promise<SessionInfo[]> => {
    return sessionManager.listSessions();
  });

  // ─── Branches ───

  ipcMain.handle(IPC.BRANCH_LIST, async (_event, repoPath: string) => {
    return listBranches(repoPath);
  });

  // ─── Worktrees ───

  ipcMain.handle(IPC.WORKTREE_LIST, async (_event, repoPath: string) => {
    const worktrees = await worktreeManager.list(repoPath);
    // Register into internal map so they can be destroyed later
    for (const wt of worktrees) {
      worktreeManager.register(wt);
    }
    return worktrees;
  });

  // ─── Prerequisites ───

  ipcMain.handle(IPC.PREREQUISITES_CHECK, async (): Promise<PrerequisiteStatus> => {
    return checkAllPrerequisites();
  });

  // ─── Terminal I/O ───

  ipcMain.on(IPC.TERM_WRITE, (_event, sessionId: string, data: string) => {
    sessionManager.write(sessionId, data);
  });

  ipcMain.on(IPC.TERM_RESIZE, (_event, sessionId: string, cols: number, rows: number) => {
    sessionManager.resize(sessionId, cols, rows);
  });
}
